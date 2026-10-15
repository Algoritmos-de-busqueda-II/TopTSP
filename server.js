const express = require('express');
const https = require('https');
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const multer = require('multer');
const { initializeDatabase, getDatabase } = require('./database');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const app = express();
const PORT = process.env.PORT || 443;
const LOCAL_PORT = 3000;
const SSL_KEY_PATH = '/home/vmuser/abii.gia.etsii.urjc.es.key';
const SSL_CERT_PATH = '/home/vmuser/abii.gia.etsii.urjc.es.pem';
let sslOptions = null;
let useHttps = false;
try {
    if (fs.existsSync(SSL_KEY_PATH) && fs.existsSync(SSL_CERT_PATH)) {
        sslOptions = {
            key: fs.readFileSync(SSL_KEY_PATH),
            cert: fs.readFileSync(SSL_CERT_PATH)
        };
        useHttps = true;
    }
} catch (err) {
    console.error('Error loading SSL certificates:', err);
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'topabii-urjc-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: useHttps,  // Only secure cookies when using HTTPS
        maxAge: 24 * 60 * 60 * 1000,  // 24 hours
        httpOnly: true,
        sameSite: 'strict'
    }
}));

// Multer configuration for file uploads
const upload = multer({
    dest: path.join(__dirname, 'uploads'),
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session.user) {
        next();
    } else {
        res.status(401).json({ error: 'Authentication required' });
    }
}

function requireAdmin(req, res, next) {
    if (req.session.user && req.session.user.is_admin) {
        next();
    } else {
        // For HTML pages, redirect to login
        if (req.path === '/admin' || req.path === '/ranking-report') {
            res.redirect('/login');
        } else {
            // For API endpoints, return JSON error
            res.status(403).json({ error: 'Admin privileges required' });
        }
    }
}

// Enhanced auth middleware for HTML pages
function requireAuthHTML(req, res, next) {
    if (req.session.user) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Routes

// Login endpoint
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    
    const db = getDatabase();
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
        if (err) {
            db.close();
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!user || !bcrypt.compareSync(password, user.password)) {
            db.close();
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        req.session.user = {
            id: user.id,
            email: user.email,
            is_admin: user.is_admin,
            first_login: user.first_login
        };
        
        db.close();
        res.json({ 
            success: true, 
            user: req.session.user,
            requirePasswordChange: user.first_login
        });
    });
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Change password endpoint
app.post('/api/change-password', requireAuth, (req, res) => {
    const { newPassword } = req.body;
    
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }
    
    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    const db = getDatabase();
    
    db.run('UPDATE users SET password = ?, first_login = FALSE WHERE id = ?', 
        [hashedPassword, req.session.user.id], (err) => {
        if (err) {
            db.close();
            return res.status(500).json({ error: 'Database error' });
        }
        
        req.session.user.first_login = false;
        db.close();
        res.json({ success: true });
    });
});

// Create users endpoint (admin only)
app.post('/api/admin/create-users', requireAdmin, (req, res) => {
    const { emails } = req.body;
    
    if (!emails) {
        return res.status(400).json({ error: 'Emails required' });
    }
    
    const emailList = emails.split(';').map(email => email.trim()).filter(email => email);
    const db = getDatabase();
    
    let created = 0;
    let errors = [];
    
    const createUser = (index) => {
        if (index >= emailList.length) {
            db.close();
            return res.json({ success: true, created, errors });
        }
        
        const email = emailList[index];
        const password = bcrypt.hashSync(email, 10);
        
        db.run('INSERT INTO users (email, password, is_admin, first_login) VALUES (?, ?, ?, ?)',
            [email, password, false, true], (err) => {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    errors.push(`User ${email} already exists`);
                } else {
                    errors.push(`Error creating user ${email}: ${err.message}`);
                }
            } else {
                created++;
            }
            createUser(index + 1);
        });
    };
    
    createUser(0);
});

// Get current TSP instance info (admin only)
app.get('/api/admin/current-tsp', requireAdmin, (req, res) => {
    const db = getDatabase();
    
    db.get('SELECT value FROM system_settings WHERE key = ?', ['current_tsp_instance'], (err, setting) => {
        if (err || !setting) {
            db.close();
            return res.json({ hasInstance: false });
        }
        
        const tspInstanceId = parseInt(setting.value);
        
        db.get('SELECT * FROM tsp_instances WHERE id = ?', [tspInstanceId], (err, instance) => {
            db.close();
            if (err || !instance) {
                return res.json({ hasInstance: false });
            }
            
            res.json({ 
                hasInstance: true, 
                instance: {
                    id: instance.id,
                    name: instance.name,
                    dimension: instance.dimension,
                    type: instance.type,
                    comment: instance.comment,
                    created_at: instance.created_at
                }
            });
        });
    });
});

// Upload TSP instance endpoint (admin only)
app.post('/api/admin/upload-tsp', requireAdmin, (req, res) => {
    const { tspData, replaceExisting } = req.body;
    
    if (!tspData) {
        return res.status(400).json({ error: 'TSP data is required' });
    }
    
    // Parse TSPLIB format
    const parsedTSP = parseTSPLIB(tspData);
    if (!parsedTSP.success) {
        return res.status(400).json({ error: parsedTSP.error });
    }
    
    const db = getDatabase();
    
    // Check if we should replace existing instance
    if (replaceExisting) {
        // Save the final standings in the general classification before wiping them
        archiveCurrentCompetition(db)
            .then(clearCurrentCompetition)
            .catch(err => {
                console.error('Error archiving competition:', err);
                db.close();
                res.status(500).json({ error: 'Error al archivar la competición actual. No se ha cambiado la instancia.' });
            });
    } else {
        insertTSPInstance();
    }

    function clearCurrentCompetition() {
        // Clear all solutions and rankings
        db.run('DELETE FROM solutions', (err) => {
            if (err) {
                db.close();
                return res.status(500).json({ error: 'Error clearing solutions' });
            }
            
            db.run('DELETE FROM user_best_solutions', (err) => {
                if (err) {
                    db.close();
                    return res.status(500).json({ error: 'Error clearing rankings' });
                }
                
                insertTSPInstance();
            });
        });
    }
    
    function insertTSPInstance() {
        db.run(`INSERT INTO tsp_instances (name, type, comment, dimension, edge_weight_type, 
                coordinates, distance_matrix, original_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [parsedTSP.name, parsedTSP.type, parsedTSP.comment, parsedTSP.dimension, 
             parsedTSP.edgeWeightType, JSON.stringify(parsedTSP.coordinates), 
             JSON.stringify(parsedTSP.distanceMatrix), tspData], function(err) {
            if (err) {
                db.close();
                return res.status(500).json({ error: 'Database error' });
            }
            
            const instanceId = this.lastID;

            // New instance starts a new competition: set it as current and reset its configuration
            // (name from the TSPLIB file, no end date, not paused, ranking not frozen)
            const newSettings = [
                ['current_tsp_instance', String(instanceId)],
                ['instance_name', parsedTSP.name],
                ['competition_end_date', ''],
                ['competition_paused', 'false'],
                ['ranking_frozen', 'false'],
                ['frozen_ranking_data', ''],
                ['frozen_ranking_timestamp', '']
            ];

            Promise.all(newSettings.map(([key, value]) =>
                dbRun(db, 'INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', [key, value])))
                .then(() => {
                    db.close();
                    res.json({
                        success: true,
                        instanceId,
                        cleared: replaceExisting
                    });
                })
                .catch(err => {
                    console.error('Error resetting competition settings:', err);
                    db.close();
                    res.status(500).json({ error: 'Error setting current instance' });
                });
        });
    }
});

// Reset ranking (admin only)
app.post('/api/admin/reset-ranking', requireAdmin, (req, res) => {
    const db = getDatabase();
    
    db.run('DELETE FROM solutions', (err) => {
        if (err) {
            db.close();
            return res.status(500).json({ error: 'Error clearing solutions' });
        }
        
        db.run('DELETE FROM user_best_solutions', (err) => {
            db.close();
            if (err) {
                return res.status(500).json({ error: 'Error clearing rankings' });
            }

            res.json({ success: true });
        });
    });
});

// Default Berlin52 TSPLIB instance used to reseed the system on a full reset
const BERLIN52_TSPLIB = `NAME: berlin52
TYPE: TSP
COMMENT: 52 locations in Berlin (Groetschel)
DIMENSION: 52
EDGE_WEIGHT_TYPE: EUC_2D
NODE_COORD_SECTION
1 565.0 575.0
2 25.0 185.0
3 345.0 750.0
4 945.0 685.0
5 845.0 655.0
6 880.0 660.0
7 25.0 230.0
8 525.0 1000.0
9 580.0 1175.0
10 650.0 1130.0
11 1605.0 620.0
12 1220.0 580.0
13 1465.0 200.0
14 1530.0 5.0
15 845.0 680.0
16 725.0 370.0
17 145.0 665.0
18 415.0 635.0
19 510.0 875.0
20 560.0 365.0
21 300.0 465.0
22 520.0 585.0
23 480.0 415.0
24 835.0 625.0
25 975.0 580.0
26 1215.0 245.0
27 1320.0 315.0
28 1250.0 400.0
29 660.0 180.0
30 410.0 250.0
31 420.0 555.0
32 575.0 665.0
33 1150.0 1160.0
34 700.0 580.0
35 685.0 595.0
36 685.0 610.0
37 770.0 610.0
38 795.0 645.0
39 720.0 635.0
40 760.0 650.0
41 475.0 960.0
42 95.0 260.0
43 875.0 920.0
44 700.0 500.0
45 555.0 815.0
46 830.0 485.0
47 1170.0 65.0
48 830.0 610.0
49 605.0 625.0
50 595.0 360.0
51 1340.0 725.0
52 1740.0 245.0
EOF`;

// Full system reset (admin only): wipes users, solutions, rankings and TSP
// instances, keeps admin accounts, and reseeds the default Berlin52 instance
app.post('/api/admin/full-reset', requireAdmin, (req, res) => {
    const dbPath = path.join(__dirname, 'topabii.db');

    // Safety backup before a fully destructive operation
    let safetyBackupFilename;
    try {
        safetyBackupFilename = `topabii_before_full_reset_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)}.db`;
        fs.copyFileSync(dbPath, path.join(__dirname, safetyBackupFilename));
    } catch (error) {
        console.error('Full reset safety backup error:', error);
        return res.status(500).json({ error: 'Error al crear el backup de seguridad previo al reinicio' });
    }

    const parsedTSP = parseTSPLIB(BERLIN52_TSPLIB);
    if (!parsedTSP.success) {
        return res.status(500).json({ error: 'Error al preparar la instancia Berlin52 por defecto' });
    }

    const db = getDatabase();

    db.serialize(() => {
        db.run('DELETE FROM solutions');
        db.run('DELETE FROM user_best_solutions');
        db.run('DELETE FROM competition_results');
        db.run('DELETE FROM competition_history');
        db.run('DELETE FROM tsp_instances');
        db.run('DELETE FROM users WHERE is_admin = 0');
        db.run('DELETE FROM system_settings');

        db.run(`INSERT INTO tsp_instances (name, type, comment, dimension, edge_weight_type,
                coordinates, distance_matrix, original_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [parsedTSP.name, parsedTSP.type, parsedTSP.comment, parsedTSP.dimension,
             parsedTSP.edgeWeightType, JSON.stringify(parsedTSP.coordinates),
             JSON.stringify(parsedTSP.distanceMatrix), BERLIN52_TSPLIB], function (err) {
            if (err) {
                db.close();
                return res.status(500).json({ error: 'Error al crear la instancia Berlin52 por defecto' });
            }

            const instanceId = this.lastID;
            const defaultSettings = [
                ['ranking_frozen', 'false'],
                ['current_tsp_instance', String(instanceId)],
                ['frozen_ranking_data', ''],
                ['frozen_ranking_timestamp', ''],
                ['competition_end_date', ''],
                ['competition_paused', 'false'],
                ['instance_name', 'Berlin 52']
            ];

            const insertSetting = (index) => {
                if (index >= defaultSettings.length) {
                    db.close();
                    return res.json({ success: true, instanceId, safetyBackup: safetyBackupFilename });
                }
                const [key, value] = defaultSettings[index];
                db.run('INSERT INTO system_settings (key, value) VALUES (?, ?)', [key, value], (err) => {
                    if (err) {
                        db.close();
                        return res.status(500).json({ error: 'Error al restablecer la configuración del sistema' });
                    }
                    insertSetting(index + 1);
                });
            };

            insertSetting(0);
        });
    });
});

// Submit solution endpoint
app.post('/api/submit-solution', requireAuth, (req, res) => {
    const { solution, method, time } = req.body;
    
    if (!solution) {
        return res.status(400).json({ error: 'Solution required' });
    }

    // Optional, informative time in seconds
    let timeSeconds = null;
    if (time !== undefined && time !== null && String(time).trim() !== '') {
        timeSeconds = Number(String(time).trim().replace(',', '.'));
        if (!isFinite(timeSeconds) || timeSeconds < 0 || timeSeconds > 1e8) {
            return res.status(400).json({ error: 'El tiempo debe ser un número de segundos mayor o igual que 0.' });
        }
        timeSeconds = Math.round(timeSeconds * 1000) / 1000;
    }
    
    const db = getDatabase();
    
    // Check competition end date and pause first
    db.all('SELECT key, value FROM system_settings WHERE key IN (?, ?)', ['competition_end_date', 'competition_paused'], (err, settingRows) => {
        if (err) {
            db.close();
            return res.status(500).json({ error: 'Database error' });
        }

        const settings = {};
        settingRows.forEach(row => { settings[row.key] = row.value; });

        if (settings.competition_paused === 'true') {
            db.close();
            return res.status(403).json({ error: 'La competición está pausada. No se pueden enviar soluciones hasta que se reanude.' });
        }
        
        if (settings.competition_end_date) {
            const endDate = new Date(settings.competition_end_date);
            const now = new Date();
            if (now > endDate) {
                db.close();
                return res.status(403).json({ error: 'La competición ha finalizado. No se pueden enviar más soluciones.' });
            }
        }
        
        // Get current TSP instance
        db.get('SELECT value FROM system_settings WHERE key = ?', ['current_tsp_instance'], (err, setting) => {
            if (err || !setting) {
                db.close();
                return res.status(400).json({ error: 'No hay una instancia TSP disponible actualmente. Contacta con el administrador.' });
            }
            
            const tspInstanceId = parseInt(setting.value);
        
        // Get TSP instance details
        db.get('SELECT * FROM tsp_instances WHERE id = ?', [tspInstanceId], (err, instance) => {
            if (err || !instance) {
                db.close();
                return res.status(400).json({ error: 'La instancia TSP configurada no existe. Contacta con el administrador.' });
            }
            
            const nodes = instance.dimension;
            const distanceMatrix = JSON.parse(instance.distance_matrix);
            
            // Validate solution
            const solutionArray = solution.split(',').map(n => parseInt(n.trim()));
            const isValid = validateTSPSolution(solutionArray, nodes);
            
            if (!isValid.valid) {
                db.close();
                return res.status(400).json({ error: isValid.error });
            }
            
            // Calculate objective value
            const objectiveValue = calculateObjectiveValue(solutionArray, distanceMatrix);
            
            // Insert solution
            const methodValue = method && method.length <= 10 ? method.trim() : '';
            db.run('INSERT INTO solutions (user_id, tsp_instance_id, solution, objective_value, is_valid, method, time_seconds) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [req.session.user.id, tspInstanceId, solution, objectiveValue, true, methodValue, timeSeconds], function(err) {
                if (err) {
                    db.close();
                    return res.status(500).json({ error: 'Error saving solution' });
                }
                
                const solutionId = this.lastID;
                
                // Update user's best solution
                updateUserBestSolution(db, req.session.user.id, solutionId, objectiveValue, methodValue, timeSeconds, (err, improved) => {
                    db.close();
                    if (err) {
                        return res.status(500).json({ error: 'Error updating best solution' });
                    }
                    
                    res.json({ 
                        success: true, 
                        objectiveValue, 
                        improved,
                        solutionId
                    });
                });
            });
        });
    });
    });
});

// Get ranking endpoint
app.get('/api/ranking', (req, res) => {
    const db = getDatabase();
    
    // Check if ranking is frozen
    db.get('SELECT value FROM system_settings WHERE key = ?', ['ranking_frozen'], (err, setting) => {
        if (err) {
            db.close();
            return res.status(500).json({ error: 'Database error' });
        }
        
        const isFrozen = setting && setting.value === 'true';
        
        if (isFrozen) {
            // Get frozen ranking data and timestamp
            db.get('SELECT value FROM system_settings WHERE key = ?', ['frozen_ranking_data'], (err, frozenData) => {
                if (err) {
                    db.close();
                    return res.status(500).json({ error: 'Database error' });
                }
                
                db.get('SELECT value FROM system_settings WHERE key = ?', ['frozen_ranking_timestamp'], (err, frozenTimestamp) => {
                    db.close();
                    if (err) {
                        return res.status(500).json({ error: 'Database error' });
                    }
                    
                    let frozenRanking = [];
                    let frozenStats = { totalParticipants: 0, bestSolution: null, totalSolutions: 0 };
                    
                    try {
                        if (frozenData && frozenData.value) {
                            const parsedData = JSON.parse(frozenData.value);
                            frozenRanking = parsedData.ranking || [];
                            frozenStats = parsedData.stats || frozenStats;
                        }
                    } catch (e) {
                        console.error('Error parsing frozen ranking data:', e);
                    }
                    
                    res.json({ 
                        frozen: true, 
                        ranking: frozenRanking,
                        stats: frozenStats,
                        frozenTimestamp: frozenTimestamp ? frozenTimestamp.value : null
                    });
                });
            });
            return;
        }
        
        // Get current ranking
        db.all(`
            SELECT
                ubs.user_id,
                u.email,
                ubs.best_objective_value,
                ubs.best_method,
                ubs.best_time_seconds,
                ubs.last_improvement,
                ubs.total_submissions
            FROM user_best_solutions ubs
            JOIN users u ON ubs.user_id = u.id
            WHERE ubs.best_objective_value IS NOT NULL
            -- Ensure numeric ordering for objective (rounded to 2 decimals to avoid floating precision issues)
            -- and chronological ordering for timestamps (older first)
            ORDER BY ROUND(CAST(ubs.best_objective_value AS REAL), 2) ASC, datetime(ubs.last_improvement) ASC
        `, (err, rows) => {
            db.close();
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            // Round objective values to 2 decimals for output
            rows = rows.map(r => ({
                ...r,
                best_objective_value: r.best_objective_value !== null && r.best_objective_value !== undefined
                    ? Number(Number(r.best_objective_value).toFixed(2))
                    : r.best_objective_value
            }));

            // Calculate current stats
            const totalParticipants = rows.length;
            const bestSolution = rows.length > 0 ? rows[0].best_objective_value : null;
            const totalSolutions = rows.reduce((sum, entry) => sum + (entry.total_submissions || 0), 0);

            res.json({ 
                frozen: false, 
                ranking: rows,
                stats: {
                    totalParticipants,
                    bestSolution,
                    totalSolutions
                }
            });
        });
    });
});

// Freeze/unfreeze ranking (admin only)
app.post('/api/admin/toggle-ranking', requireAdmin, (req, res) => {
    const { frozen } = req.body;
    
    if (frozen) {
        // When freezing, save current ranking snapshot
        saveRankingSnapshot((err) => {
            if (err) {
                return res.status(500).json({ error: 'Error saving ranking snapshot' });
            }
            
            const db = getDatabase();
            db.run('UPDATE system_settings SET value = ? WHERE key = ?', 
                ['true', 'ranking_frozen'], (err) => {
                db.close();
                if (err) {
                    return res.status(500).json({ error: 'Database error' });
                }
                res.json({ success: true });
            });
        });
    } else {
        // When unfreezing, just update the setting
        const db = getDatabase();
        db.run('UPDATE system_settings SET value = ? WHERE key = ?', 
            ['false', 'ranking_frozen'], (err) => {
            db.close();
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            res.json({ success: true });
        });
    }
});

// Set competition end date (admin only)
app.post('/api/admin/set-end-date', requireAdmin, (req, res) => {
    const { endDate } = req.body;
    const db = getDatabase();
    
    db.run('UPDATE system_settings SET value = ? WHERE key = ?', 
        [endDate || '', 'competition_end_date'], (err) => {
        db.close();
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ success: true });
    });
});

// Pause/resume submissions (admin only)
app.post('/api/admin/set-paused', requireAdmin, (req, res) => {
    const paused = req.body.paused === true || req.body.paused === 'true';
    const db = getDatabase();

    db.run('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)',
        ['competition_paused', paused ? 'true' : 'false'], (err) => {
        db.close();
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ success: true, paused });
    });
});

// Set instance name (admin only)
app.post('/api/admin/set-instance-name', requireAdmin, (req, res) => {
    const { instanceName } = req.body;
    const db = getDatabase();
    
    db.run('UPDATE system_settings SET value = ? WHERE key = ?', 
        [instanceName || 'Berlin 52', 'instance_name'], (err) => {
        db.close();
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ success: true });
    });
});

// Download current TSP instance
app.get('/api/download-instance', (req, res) => {
    const db = getDatabase();

    db.get('SELECT value FROM system_settings WHERE key = ?', ['current_tsp_instance'], (err, setting) => {
        if (err || !setting) {
            db.close();
            return res.status(404).json({ error: 'No current TSP instance found' });
        }

        const tspInstanceId = parseInt(setting.value);

        db.get('SELECT * FROM tsp_instances WHERE id = ?', [tspInstanceId], (err, instance) => {
            db.close();
            if (err || !instance) {
                return res.status(404).json({ error: 'TSP instance not found' });
            }

            // Set headers for file download
            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Content-Disposition', `attachment; filename="${instance.name.replace(/\s+/g, '_')}.txt"`);

            // Send the original data
            res.send(instance.original_data);
        });
    });
});

// Check if current TSP instance exists
app.get('/api/current-instance', (req, res) => {
    const db = getDatabase();

    db.get('SELECT value FROM system_settings WHERE key = ?', ['current_tsp_instance'], (err, setting) => {
        if (err || !setting) {
            db.close();
            return res.json({ hasInstance: false });
        }

        const tspInstanceId = parseInt(setting.value);

        db.get('SELECT * FROM tsp_instances WHERE id = ?', [tspInstanceId], (err, instance) => {
            db.close();
            if (err || !instance) {
                return res.json({ hasInstance: false });
            }

            res.json({
                hasInstance: true,
                instance: {
                    id: instance.id,
                    name: instance.name,
                    dimension: instance.dimension,
                    type: instance.type,
                    comment: instance.comment,
                    created_at: instance.created_at
                }
            });
        });
    });
});

// Get current TSP instance with coordinates for visualization
app.get('/api/current-instance-coords', (req, res) => {
    const db = getDatabase();

    db.get('SELECT value FROM system_settings WHERE key = ?', ['current_tsp_instance'], (err, setting) => {
        if (err || !setting) {
            db.close();
            return res.json({ hasInstance: false });
        }

        const tspInstanceId = parseInt(setting.value);

        db.get('SELECT * FROM tsp_instances WHERE id = ?', [tspInstanceId], (err, instance) => {
            db.close();
            if (err || !instance) {
                return res.json({ hasInstance: false });
            }

            res.json({
                hasInstance: true,
                instance: {
                    id: instance.id,
                    name: instance.name,
                    dimension: instance.dimension,
                    type: instance.type,
                    comment: instance.comment,
                    coordinates: instance.coordinates,
                    created_at: instance.created_at
                }
            });
        });
    });
});

// Get system settings
app.get('/api/system-settings', (req, res) => {
    const db = getDatabase();
    
    db.all('SELECT key, value FROM system_settings', (err, rows) => {
        db.close();
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        const settings = {};
        rows.forEach(row => {
            settings[row.key] = row.value;
        });
        
        res.json(settings);
    });
});

// Get all users (admin only)
app.get('/api/admin/users', requireAdmin, (req, res) => {
    const db = getDatabase();
    
    db.all(`
        SELECT 
            u.id,
            u.email,
            u.first_login,
            ubs.best_objective_value,
            ubs.last_improvement
        FROM users u
        LEFT JOIN user_best_solutions ubs ON u.id = ubs.user_id
        WHERE u.is_admin = 0
        ORDER BY u.email
    `, (err, rows) => {
        db.close();
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(rows);
    });
});

// Reset user password (admin only)
app.post('/api/admin/reset-password', requireAdmin, (req, res) => {
    const { userId, email } = req.body;
    if (!userId || !email) {
        return res.status(400).json({ error: 'Faltan datos' });
    }
    const db = getDatabase();
    const hashedPassword = bcrypt.hashSync(email, 10);
    db.run('UPDATE users SET password = ?, first_login = TRUE WHERE id = ?', [hashedPassword, userId], (err) => {
        if (err) {
            return res.status(500).json({ error: 'Error al actualizar la contraseña' });
        }
        res.json({ success: true });
    });
});

// Delete user (admin only)
app.post('/api/admin/delete-user', requireAdmin, (req, res) => {
    const { userId } = req.body;
    const db = getDatabase();
    
    // Delete user's solutions first
    db.run('DELETE FROM competition_results WHERE user_id = ?', [userId]);
    db.run('DELETE FROM solutions WHERE user_id = ?', [userId], (err) => {
        if (err) {
            db.close();
            return res.status(500).json({ error: 'Database error' });
        }
        
        // Delete from user_best_solutions
        db.run('DELETE FROM user_best_solutions WHERE user_id = ?', [userId], (err) => {
            if (err) {
                db.close();
                return res.status(500).json({ error: 'Database error' });
            }
            
            // Delete user
            db.run('DELETE FROM users WHERE id = ? AND is_admin = 0', [userId], (err) => {
                db.close();
                if (err) {
                    return res.status(500).json({ error: 'Database error' });
                }
                res.json({ success: true });
            });
        });
    });
});

// Export CSV (admin only)
app.get('/api/admin/export-csv', requireAdmin, (req, res) => {
    const db = getDatabase();

    db.all(`
        SELECT
            u.email,
            s.solution,
            s.objective_value,
            s.method,
            s.time_seconds,
            s.submitted_at,
            s.is_valid
        FROM solutions s
        JOIN users u ON s.user_id = u.id
        ORDER BY s.submitted_at DESC
    `, (err, rows) => {
        db.close();
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        const csvWriter = createCsvWriter({
            path: 'export.csv',
            header: [
                { id: 'email', title: 'Email' },
                { id: 'solution', title: 'Solution' },
                { id: 'objective_value', title: 'Función Objetivo' },
                { id: 'method', title: 'Method' },
                { id: 'time_seconds', title: 'Time (s)' },
                { id: 'submitted_at', title: 'Submitted At' },
                { id: 'is_valid', title: 'Valid' }
            ]
        });

        csvWriter.writeRecords(rows)
            .then(() => {
                res.download('export.csv', 'topabii-export.csv', (err) => {
                    if (err) {
                        console.error('Download error:', err);
                    }
                    fs.unlinkSync('export.csv');
                });
            })
            .catch(err => {
                res.status(500).json({ error: 'Error creating CSV' });
            });
    });
});

// Promise wrappers around a sqlite3 connection (used by the report endpoints)
function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
}

function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
}

// Live ranking (ignores the frozen snapshot, excludes admin test submissions), same ordering as /api/ranking
const LIVE_RANKING_SQL = `
    SELECT
        ubs.user_id,
        u.email,
        ubs.best_objective_value,
        ubs.best_method,
        ubs.best_time_seconds,
        ubs.last_improvement,
        ubs.total_submissions
    FROM user_best_solutions ubs
    JOIN users u ON ubs.user_id = u.id
    WHERE ubs.best_objective_value IS NOT NULL AND u.is_admin = 0
    ORDER BY ROUND(CAST(ubs.best_objective_value AS REAL), 2) ASC, datetime(ubs.last_improvement) ASC
`;

// Ranking report data for the printable PDF (admin only, always live data)
app.get('/api/admin/ranking-report', requireAdmin, async (req, res) => {
    const db = getDatabase();

    try {
        const settingsRows = await dbAll(db, 'SELECT key, value FROM system_settings');
        const settings = {};
        settingsRows.forEach(row => { settings[row.key] = row.value; });

        let instance = null;
        const instanceId = parseInt(settings.current_tsp_instance);
        if (!isNaN(instanceId)) {
            const row = await dbGet(db, 'SELECT id, name, dimension, coordinates FROM tsp_instances WHERE id = ?', [instanceId]);
            if (row) {
                let coordinates = [];
                try {
                    coordinates = JSON.parse(row.coordinates || '[]');
                } catch (e) {
                    coordinates = [];
                }
                instance = { id: row.id, name: row.name, dimension: row.dimension, coordinates };
            }
        }

        const ranking = (await dbAll(db, LIVE_RANKING_SQL)).map(r => ({
            user: r.email ? r.email.split('@')[0] : '',
            best_objective_value: Number(Number(r.best_objective_value).toFixed(2)),
            best_method: r.best_method || '',
            best_time_seconds: r.best_time_seconds,
            last_improvement: r.last_improvement,
            total_submissions: r.total_submissions || 0
        }));

        const registered = await dbGet(db, 'SELECT COUNT(*) AS n FROM users WHERE is_admin = 0');
        const submissionCounts = await dbGet(db, `
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN s.is_valid = 1 THEN 1 ELSE 0 END) AS valid,
                   MIN(s.submitted_at) AS first_at,
                   MAX(s.submitted_at) AS last_at
            FROM solutions s
            JOIN users u ON s.user_id = u.id
            WHERE u.is_admin = 0
        `);

        // Valid submissions in chronological order: global best progression and activity per day
        const validRows = await dbAll(db, `
            SELECT s.objective_value, s.method, s.submitted_at, u.email
            FROM solutions s
            JOIN users u ON s.user_id = u.id
            WHERE s.is_valid = 1 AND u.is_admin = 0
            ORDER BY s.submitted_at ASC, s.id ASC
        `);

        const improvements = [];
        const perDay = {};
        let currentBest = Infinity;
        for (const r of validRows) {
            const day = String(r.submitted_at || '').slice(0, 10);
            if (day) perDay[day] = (perDay[day] || 0) + 1;

            const val = Number(r.objective_value);
            if (isNaN(val)) continue;
            if (val < currentBest - 1e-9) {
                currentBest = val;
                improvements.push({
                    date: r.submitted_at,
                    value: Number(val.toFixed(2)),
                    user: r.email ? r.email.split('@')[0] : '',
                    method: r.method || ''
                });
            }
        }

        const best = await dbGet(db, `
            SELECT s.solution, s.method, s.time_seconds, ubs.best_objective_value, u.email
            FROM user_best_solutions ubs
            JOIN solutions s ON ubs.best_solution_id = s.id
            JOIN users u ON ubs.user_id = u.id
            WHERE ubs.best_objective_value IS NOT NULL AND u.is_admin = 0
            ORDER BY ROUND(CAST(ubs.best_objective_value AS REAL), 2) ASC, datetime(ubs.last_improvement) ASC
            LIMIT 1
        `);

        let bestSolution = null;
        if (best) {
            bestSolution = {
                route: String(best.solution || '').split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n)),
                method: best.method || '',
                timeSeconds: best.time_seconds,
                objectiveValue: Number(Number(best.best_objective_value).toFixed(2)),
                user: best.email ? best.email.split('@')[0] : ''
            };
        }

        db.close();

        res.json({
            generatedAt: new Date().toISOString(),
            instanceName: settings.instance_name || (instance ? instance.name : ''),
            endDate: settings.competition_end_date || '',
            frozen: settings.ranking_frozen === 'true',
            instance,
            ranking,
            registeredUsers: registered ? registered.n : 0,
            submissions: {
                total: submissionCounts ? submissionCounts.total || 0 : 0,
                valid: submissionCounts ? submissionCounts.valid || 0 : 0,
                firstAt: submissionCounts ? submissionCounts.first_at : null,
                lastAt: submissionCounts ? submissionCounts.last_at : null,
                perDay: Object.keys(perDay).sort().map(day => ({ day, count: perDay[day] }))
            },
            improvements,
            bestSolution
        });
    } catch (err) {
        db.close();
        console.error('Error building ranking report:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) { return err ? reject(err) : resolve(this); });
    });
}

// Store the final standings of the current competition (if anyone took part) in the history.
// Positions follow the live ranking: objective value, then whoever reached it first.
async function archiveCurrentCompetition(db) {
    const rows = await dbAll(db, LIVE_RANKING_SQL);
    if (rows.length === 0) return null;

    const settingsRows = await dbAll(db, 'SELECT key, value FROM system_settings WHERE key IN (?, ?)', ['instance_name', 'current_tsp_instance']);
    const settings = {};
    settingsRows.forEach(row => { settings[row.key] = row.value; });
    const instance = await dbGet(db, 'SELECT name, dimension FROM tsp_instances WHERE id = ?', [parseInt(settings.current_tsp_instance)]);

    const name = settings.instance_name || (instance ? instance.name : '') || 'Competición';
    const round2 = v => Number(Number(v).toFixed(2));
    const best = round2(rows[0].best_objective_value);

    await dbRun(db, 'BEGIN TRANSACTION');
    try {
        const result = await dbRun(db,
            'INSERT INTO competition_history (instance_name, dimension, best_value, participants) VALUES (?, ?, ?, ?)',
            [name, instance ? instance.dimension : null, best, rows.length]);
        const competitionId = result.lastID;

        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const value = round2(r.best_objective_value);
            const deviation = best > 0 ? ((value - best) / best) * 100 : 0;
            await dbRun(db, `INSERT INTO competition_results
                (competition_id, user_id, email, position, objective_value, deviation, method, time_seconds, total_submissions, last_improvement)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [competitionId, r.user_id, r.email, i + 1, value, Number(deviation.toFixed(4)),
                 r.best_method || '', r.best_time_seconds, r.total_submissions || 0, r.last_improvement]);
        }

        await dbRun(db, 'COMMIT');
        return competitionId;
    } catch (err) {
        await dbRun(db, 'ROLLBACK').catch(() => {});
        throw err;
    }
}

// General classification across all archived competitions (public)
app.get('/api/general-ranking', async (req, res) => {
    const db = getDatabase();

    try {
        const competitions = await dbAll(db, 'SELECT * FROM competition_history ORDER BY datetime(archived_at) ASC, id ASC');
        const results = await dbAll(db, 'SELECT * FROM competition_results ORDER BY competition_id ASC, position ASC');
        db.close();

        const resultsByCompetition = new Map(competitions.map(c => [c.id, []]));
        results.forEach(r => {
            if (resultsByCompetition.has(r.competition_id)) resultsByCompetition.get(r.competition_id).push(r);
        });

        const players = new Map();
        competitions.forEach(c => {
            resultsByCompetition.get(c.id).forEach(r => {
                const key = r.user_id !== null ? `id:${r.user_id}` : `email:${r.email}`;
                if (!players.has(key)) {
                    players.set(key, {
                        user_id: r.user_id,
                        user: String(r.email || '').split('@')[0],
                        gold: 0, silver: 0, bronze: 0, optimums: 0,
                        positions: {}, sumPosition: 0, sumDeviation: 0, participations: 0
                    });
                }
                const p = players.get(key);
                p.participations++;
                p.sumPosition += r.position;
                p.sumDeviation += r.deviation;
                p.positions[c.id] = r.position;
                if (r.position === 1) p.gold++;
                else if (r.position === 2) p.silver++;
                else if (r.position === 3) p.bronze++;
                // Optimum: matched the best value of that competition (ties allowed)
                if (Math.abs(r.objective_value - c.best_value) < 0.005) p.optimums++;
            });
        });

        res.json({
            competitions: competitions.map(c => {
                const winner = (resultsByCompetition.get(c.id) || [])[0];
                return {
                    id: c.id,
                    name: c.instance_name,
                    dimension: c.dimension,
                    bestValue: c.best_value,
                    participants: c.participants,
                    archivedAt: c.archived_at,
                    winner: winner ? String(winner.email || '').split('@')[0] : ''
                };
            }),
            players: Array.from(players.values()).map(p => ({
                user_id: p.user_id,
                user: p.user,
                gold: p.gold,
                silver: p.silver,
                bronze: p.bronze,
                optimums: p.optimums,
                participations: p.participations,
                avgPosition: Number((p.sumPosition / p.participations).toFixed(2)),
                avgDeviation: Number((p.sumDeviation / p.participations).toFixed(4)),
                positions: p.positions
            }))
        });
    } catch (err) {
        db.close();
        console.error('Error building general ranking:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// List archived competitions (admin only)
app.get('/api/admin/competition-history', requireAdmin, (req, res) => {
    const db = getDatabase();
    db.all('SELECT * FROM competition_history ORDER BY datetime(archived_at) DESC, id DESC', (err, rows) => {
        db.close();
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ competitions: rows });
    });
});

// Remove an archived competition from the general classification (admin only)
app.post('/api/admin/delete-competition', requireAdmin, (req, res) => {
    const id = parseInt(req.body.id);
    if (isNaN(id)) {
        return res.status(400).json({ error: 'Competición no válida' });
    }

    const db = getDatabase();
    db.serialize(() => {
        db.run('DELETE FROM competition_results WHERE competition_id = ?', [id]);
        db.run('DELETE FROM competition_history WHERE id = ?', [id], (err) => {
            db.close();
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            res.json({ success: true });
        });
    });
});

// Export current (live) ranking as CSV (admin only)
app.get('/api/admin/export-ranking-csv', requireAdmin, (req, res) => {
    const db = getDatabase();

    db.all(LIVE_RANKING_SQL, (err, rows) => {
        db.close();
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        const csvField = (value) => {
            let text = value === null || value === undefined ? '' : String(value);
            // Neutralise spreadsheet formulas in student-provided text
            if (/^[=+\-@\t\r]/.test(text) && isNaN(Number(text))) text = "'" + text;
            return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        };

        const best = rows.length > 0 ? Number(rows[0].best_objective_value) : null;
        const lines = [['Posicion', 'Usuario', 'Email', 'Funcion Objetivo', 'Gap (%)', 'Metodo', 'Envios', 'Tiempo (s)', 'Ultima Mejora'].join(',')];
        rows.forEach((r, index) => {
            const value = Number(r.best_objective_value);
            const gap = best ? ((value - best) / best) * 100 : 0;
            lines.push([
                index + 1,
                r.email ? r.email.split('@')[0] : '',
                r.email,
                value.toFixed(2),
                gap.toFixed(2),
                r.best_method || '',
                r.total_submissions || 0,
                r.best_time_seconds === null || r.best_time_seconds === undefined ? '' : r.best_time_seconds,
                r.last_improvement || ''
            ].map(csvField).join(','));
        });

        const date = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="ranking-${date}.csv"`);
        // BOM so Excel detects UTF-8 (accents in methods)
        res.send('﻿' + lines.join('\r\n') + '\r\n');
    });
});

// Backup database (admin only)
app.post('/api/admin/backup-database', requireAdmin, (req, res) => {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const backupFilename = `topabii_backup_${timestamp}.db`;
        const backupPath = path.join(__dirname, backupFilename);

        // Copy the database file
        fs.copyFileSync(path.join(__dirname, 'topabii.db'), backupPath);

        res.json({
            success: true,
            filename: backupFilename,
            path: backupPath,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Backup error:', error);
        res.status(500).json({ error: 'Error al crear backup de la base de datos' });
    }
});

// Restore database (admin only)
app.post('/api/admin/restore-database', requireAdmin, upload.single('backup'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se ha proporcionado archivo de backup' });
        }

        const backupPath = req.file.path;
        const dbPath = path.join(__dirname, 'topabii.db');

        // Create a safety backup before restoring
        const safetyBackupFilename = `topabii_before_restore_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)}.db`;
        const safetyBackupPath = path.join(__dirname, safetyBackupFilename);
        fs.copyFileSync(dbPath, safetyBackupPath);

        // Restore the backup
        fs.copyFileSync(backupPath, dbPath);

        // Clean up uploaded file
        fs.unlinkSync(backupPath);

        res.json({
            success: true,
            message: 'Base de datos restaurada correctamente',
            safetyBackup: safetyBackupFilename
        });
    } catch (error) {
        console.error('Restore error:', error);
        res.status(500).json({ error: 'Error al restaurar la base de datos' });
    }
});

// Get current user info
app.get('/api/user', requireAuth, (req, res) => {
    res.json({ user: req.session.user });
});

// Get user's solution history
app.get('/api/user/solutions', requireAuth, (req, res) => {
    const db = getDatabase();
    
    db.all(`
        SELECT
            s.solution,
            s.objective_value,
            s.method,
            s.time_seconds,
            s.is_valid,
            s.submitted_at
        FROM solutions s
        WHERE s.user_id = ?
        ORDER BY s.submitted_at DESC
        LIMIT 50
    `, [req.session.user.id], (err, rows) => {
        db.close();
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        res.json({ solutions: rows });
    });
});

// Serve HTML pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/admin', requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/user', requireAuthHTML, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'user.html'));
});

app.get('/ranking', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'ranking.html'));
});

app.get('/ranking-report', requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'ranking-report.html'));
});

app.get('/visualize', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'visualize.html'));
});

// Endpoint: competition best history (returns moments when global best improved)
app.get('/api/competition-best-history', (req, res) => {
    const db = getDatabase();

    // Get all solutions in chronological order
    db.all(`
        SELECT s.objective_value, s.method, s.submitted_at, u.email
        FROM solutions s
        JOIN users u ON s.user_id = u.id
        WHERE s.is_valid = 1
        ORDER BY s.submitted_at ASC
        LIMIT 5000
    `, (err, rows) => {
        db.close();
        if (err) {
            console.error('Error fetching competition history:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        const improvements = [];
        let currentBest = Infinity;

        for (const r of rows) {
            const val = Number(r.objective_value);
            if (isNaN(val)) continue;
            if (currentBest === Infinity || val < currentBest - 1e-9) {
                currentBest = val;
                improvements.push({
                    date: r.submitted_at,
                    value: Number(Number(val).toFixed(2)),
                    user: r.email || '',
                    method: r.method || ''
                });
            }
        }

        res.json({ improvements });
    });
});

// API endpoint to get user's best solution with route
app.get('/api/user-solution/:userId', (req, res) => {
    const userId = parseInt(req.params.userId);

    const db = getDatabase();

    // Get user's best solution including the route and method
    db.get(`
        SELECT s.id AS solution_id, s.solution, s.method AS method, s.time_seconds, ubs.best_objective_value, u.email
        FROM user_best_solutions ubs
        JOIN solutions s ON ubs.best_solution_id = s.id
        JOIN users u ON ubs.user_id = u.id
        WHERE ubs.user_id = ?
    `, [userId], (err, result) => {
        if (err) {
            console.error('Error fetching user solution:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        if (!result) {
            return res.status(404).json({ error: 'Solution not found' });
        }

        // Parse the solution string to array of integers
        let route = [];
        try {
            route = result.solution.split(',').map(n => parseInt(n.trim()));
        } catch (e) {
            console.error('Error parsing solution:', e);
            return res.status(500).json({ error: 'Invalid solution format' });
        }

        // Get the instance name from system settings
        db.get('SELECT value FROM system_settings WHERE key = ?', ['instance_name'], (err2, instanceNameSetting) => {
            db.close();

            const instanceName = instanceNameSetting ? instanceNameSetting.value : null;

            res.json({
                route: route,
                method: result.method || '',
                timeSeconds: result.time_seconds,
                objectiveValue: result.best_objective_value,
                email: result.email,
                instanceName: instanceName,
                solutionId: result.solution_id
            });
        });
    });
});

// Get user's submissions history (public) for visualization
app.get('/api/user-submissions/:userId', (req, res) => {
    const userId = parseInt(req.params.userId);
    const db = getDatabase();

    db.all(`
        SELECT id, objective_value, method, time_seconds, submitted_at
        FROM solutions
        WHERE user_id = ?
        ORDER BY submitted_at ASC, id ASC
        LIMIT 200
    `, [userId], (err, rows) => {
        db.close();
        if (err) {
            console.error('Error fetching user submissions:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        // Normalize rows: ensure submitted_at is ISO string
        const submissions = rows.map(r => ({
            id: r.id,
            objective_value: r.objective_value,
            method: r.method,
            time_seconds: r.time_seconds,
            submitted_at: r.submitted_at
        }));

        res.json({ submissions });
    });
});

// Get the latest submissions of the competition (public), hidden while the ranking is frozen
app.get('/api/recent-submissions', (req, res) => {
    const db = getDatabase();

    db.get('SELECT value FROM system_settings WHERE key = ?', ['ranking_frozen'], (err, setting) => {
        if (err) {
            db.close();
            return res.status(500).json({ error: 'Database error' });
        }

        if (setting && setting.value === 'true') {
            db.close();
            return res.json({ frozen: true, submissions: [] });
        }

        db.all(`
            SELECT s.objective_value, s.method, s.time_seconds, s.submitted_at, u.email
            FROM solutions s
            JOIN users u ON s.user_id = u.id
            WHERE s.is_valid = 1
            ORDER BY s.submitted_at DESC, s.id DESC
            LIMIT 5
        `, (err2, rows) => {
            db.close();
            if (err2) {
                console.error('Error fetching recent submissions:', err2);
                return res.status(500).json({ error: 'Database error' });
            }

            const submissions = rows.map(r => ({
                user: r.email ? r.email.split('@')[0] : '',
                objective_value: r.objective_value !== null && r.objective_value !== undefined
                    ? Number(Number(r.objective_value).toFixed(2))
                    : r.objective_value,
                method: r.method || '',
                time_seconds: r.time_seconds,
                submitted_at: r.submitted_at
            }));

            res.json({ frozen: false, submissions });
        });
    });
});

// Get the route of the competition's best solution (public) for visualization
app.get('/api/competition-best-solution', (req, res) => {
    const db = getDatabase();

    // Same ordering as the live ranking
    db.get(`
        SELECT s.id, s.solution, s.method, ubs.best_objective_value, u.email
        FROM user_best_solutions ubs
        JOIN solutions s ON ubs.best_solution_id = s.id
        JOIN users u ON ubs.user_id = u.id
        WHERE ubs.best_objective_value IS NOT NULL
        ORDER BY ROUND(CAST(ubs.best_objective_value AS REAL), 2) ASC, datetime(ubs.last_improvement) ASC
        LIMIT 1
    `, (err, result) => {
        db.close();
        if (err) {
            console.error('Error fetching competition best solution:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        if (!result) {
            return res.status(404).json({ error: 'Solution not found' });
        }

        let route = [];
        try {
            route = result.solution.split(',').map(n => parseInt(n.trim()));
        } catch (e) {
            console.error('Error parsing solution:', e);
            return res.status(500).json({ error: 'Invalid solution format' });
        }

        res.json({
            solutionId: result.id,
            route: route,
            method: result.method || '',
            objectiveValue: result.best_objective_value,
            email: result.email
        });
    });
});

// Get the route of a specific submission of a user (public) for visualization
app.get('/api/user-submission/:userId/:solutionId', (req, res) => {
    const userId = parseInt(req.params.userId);
    const solutionId = parseInt(req.params.solutionId);
    if (isNaN(userId) || isNaN(solutionId)) {
        return res.status(400).json({ error: 'Invalid parameters' });
    }

    const db = getDatabase();

    db.get(`
        SELECT s.id, s.solution, s.method, s.time_seconds, s.objective_value, s.submitted_at, u.email
        FROM solutions s
        JOIN users u ON s.user_id = u.id
        WHERE s.id = ? AND s.user_id = ?
    `, [solutionId, userId], (err, result) => {
        db.close();
        if (err) {
            console.error('Error fetching user submission:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        if (!result) {
            return res.status(404).json({ error: 'Solution not found' });
        }

        let route = [];
        try {
            route = result.solution.split(',').map(n => parseInt(n.trim()));
        } catch (e) {
            console.error('Error parsing solution:', e);
            return res.status(500).json({ error: 'Invalid solution format' });
        }

        res.json({
            solutionId: result.id,
            route: route,
            method: result.method || '',
            objectiveValue: result.objective_value,
            timeSeconds: result.time_seconds,
            submittedAt: result.submitted_at,
            email: result.email
        });
    });
});

// Helper functions
function validateTSPSolution(solution, nodeCount) {
    if (solution.length !== nodeCount) {
        return { valid: false, error: `Solution must contain exactly ${nodeCount} nodes` };
    }
    
    const uniqueNodes = new Set(solution);
    if (uniqueNodes.size !== nodeCount) {
        return { valid: false, error: 'Solution contains duplicate nodes' };
    }
    
    for (let i = 1; i <= nodeCount; i++) {
        if (!uniqueNodes.has(i)) {
            return { valid: false, error: `Missing node ${i} in solution` };
        }
    }
    
    return { valid: true };
}

function calculateObjectiveValue(solution, distanceMatrix) {
    let totalDistance = 0;
    
    for (let i = 0; i < solution.length; i++) {
        const from = solution[i] - 1; // Convert to 0-based index
        const to = solution[(i + 1) % solution.length] - 1;
        totalDistance += distanceMatrix[from][to];
    }
    
    return totalDistance;
}

function updateUserBestSolution(db, userId, solutionId, objectiveValue, method, timeSeconds, callback) {
    db.get('SELECT * FROM user_best_solutions WHERE user_id = ?', [userId], (err, existing) => {
        if (err) {
            return callback(err, false);
        }
        
        if (!existing) {
            // First solution for this user
            db.run('INSERT INTO user_best_solutions (user_id, best_solution_id, best_objective_value, best_method, best_time_seconds, total_submissions, last_improvement) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [userId, solutionId, objectiveValue, method, timeSeconds, 1, new Date().toISOString()], (err) => {
                callback(err, true);
            });
        } else {
            // Update total submissions
            let improved = false;
            let newBestId = existing.best_solution_id;
            let newBestValue = existing.best_objective_value;
            let newBestMethod = existing.best_method;
            let newBestTime = existing.best_time_seconds;
            let lastImprovement = existing.last_improvement;

            if (existing.best_objective_value === null || objectiveValue < existing.best_objective_value) {
                improved = true;
                newBestId = solutionId;
                newBestValue = objectiveValue;
                newBestMethod = method;
                newBestTime = timeSeconds;
                lastImprovement = new Date().toISOString();
            }

            db.run('UPDATE user_best_solutions SET best_solution_id = ?, best_objective_value = ?, best_method = ?, best_time_seconds = ?, total_submissions = ?, last_improvement = ? WHERE user_id = ?',
                [newBestId, newBestValue, newBestMethod, newBestTime, existing.total_submissions + 1, lastImprovement, userId], (err) => {
                callback(err, improved);
            });
        }
    });
}

// Save current ranking as frozen snapshot
function saveRankingSnapshot(callback) {
    const db = getDatabase();
    
    // Get current ranking and stats
    db.all(`
        SELECT
            ubs.user_id,
            u.email,
            ubs.best_objective_value,
            ubs.best_method,
            ubs.best_time_seconds,
            ubs.last_improvement,
            ubs.total_submissions
        FROM user_best_solutions ubs
        JOIN users u ON ubs.user_id = u.id
        WHERE ubs.best_objective_value IS NOT NULL
    -- Keep same ordering as live ranking: objective asc (rounded to 2 decimals), older timestamps first
    ORDER BY ROUND(CAST(ubs.best_objective_value AS REAL), 2) ASC, datetime(ubs.last_improvement) ASC
    `, (err, rows) => {
        if (err) {
            db.close();
            return callback(err);
        }
        // Round objective values to 2 decimals before saving snapshot
        rows = rows.map(r => ({
            ...r,
            best_objective_value: r.best_objective_value !== null && r.best_objective_value !== undefined
                ? Number(Number(r.best_objective_value).toFixed(2))
                : r.best_objective_value
        }));

        // Calculate stats
        const totalParticipants = rows.length;
        const bestSolution = rows.length > 0 ? rows[0].best_objective_value : null;
        const totalSolutions = rows.reduce((sum, entry) => sum + (entry.total_submissions || 0), 0);
        const timestamp = new Date().toISOString();
        
        // Create frozen data structure
        const frozenData = {
            ranking: rows,
            stats: {
                totalParticipants,
                bestSolution,
                totalSolutions
            },
            frozenAt: timestamp
        };
        
        // Save to database
        db.run('UPDATE system_settings SET value = ? WHERE key = ?', 
            [JSON.stringify(frozenData), 'frozen_ranking_data'], (err) => {
            if (err) {
                db.close();
                return callback(err);
            }
            
            db.run('UPDATE system_settings SET value = ? WHERE key = ?',
                [timestamp, 'frozen_ranking_timestamp'], (err) => {
                db.close();
                callback(err);
            });
        });
    });
}

// Parse TSPLIB format
function parseTSPLIB(tspData) {
    try {
        const lines = tspData.split('\n').map(line => line.trim()).filter(line => line);
        
        let name = '', type = 'TSP', comment = '', dimension = 0, edgeWeightType = 'EUC_2D';
        let coordinates = [];
        let inCoordSection = false;
        
        for (let line of lines) {
            if (line === 'EOF') break;
            
            if (line === 'NODE_COORD_SECTION') {
                inCoordSection = true;
                continue;
            }
            
            if (!inCoordSection) {
                if (line.startsWith('NAME:')) {
                    name = line.substring(5).trim();
                } else if (line.startsWith('TYPE:')) {
                    type = line.substring(5).trim();
                } else if (line.startsWith('COMMENT:')) {
                    comment = line.substring(8).trim();
                } else if (line.startsWith('DIMENSION:')) {
                    dimension = parseInt(line.substring(10).trim());
                } else if (line.startsWith('EDGE_WEIGHT_TYPE:')) {
                    edgeWeightType = line.substring(17).trim();
                }
            } else {
                // Parse coordinates
                const parts = line.split(/\s+/);
                if (parts.length >= 3) {
                    const id = parseInt(parts[0]);
                    const x = parseFloat(parts[1]);
                    const y = parseFloat(parts[2]);
                    coordinates.push({ id, x, y });
                }
            }
        }
        
        if (!name || dimension === 0 || coordinates.length === 0) {
            return { success: false, error: 'Invalid TSP format: missing required fields' };
        }
        
        if (coordinates.length !== dimension) {
            return { success: false, error: `Dimension mismatch: expected ${dimension}, got ${coordinates.length} coordinates` };
        }
        
        // Calculate distance matrix for EUC_2D
        const distanceMatrix = [];
        for (let i = 0; i < dimension; i++) {
            distanceMatrix[i] = [];
            for (let j = 0; j < dimension; j++) {
                if (i === j) {
                    distanceMatrix[i][j] = 0;
                } else {
                    const dx = coordinates[i].x - coordinates[j].x;
                    const dy = coordinates[i].y - coordinates[j].y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    distanceMatrix[i][j] = Math.round(distance * 100) / 100; // Round to 2 decimals
                }
            }
        }
        
        return {
            success: true,
            name,
            type,
            comment,
            dimension,
            edgeWeightType,
            coordinates,
            distanceMatrix
        };
        
    } catch (error) {
        return { success: false, error: `Parse error: ${error.message}` };
    }
}

// Initialize database and start HTTPS server
initializeDatabase().then(() => {
    if (useHttps) {
        https.createServer(sslOptions, app).listen(PORT, () => {
            console.log(`TopTSP HTTPS server running on port ${PORT}`);
            console.log(`Access the application at https://abii.gia.etsii.urjc.es:${PORT}`);
        });
    } else {
        app.listen(LOCAL_PORT, () => {
            console.log(`TopTSP HTTP server running on port ${LOCAL_PORT}`);
            console.log(`Access the application at http://localhost:${LOCAL_PORT}`);
        });
    }
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});