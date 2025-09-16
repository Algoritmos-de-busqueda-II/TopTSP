const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const { initializeDatabase, getDatabase } = require('./database');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'topabii-urjc-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

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
        if (req.path === '/admin') {
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
    } else {
        insertTSPInstance();
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
            
            // Set as current TSP instance
            db.run('UPDATE system_settings SET value = ? WHERE key = ?', [this.lastID, 'current_tsp_instance'], (err) => {
                db.close();
                if (err) {
                    return res.status(500).json({ error: 'Error setting current instance' });
                }
                res.json({ 
                    success: true, 
                    instanceId: this.lastID,
                    cleared: replaceExisting
                });
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

// Submit solution endpoint
app.post('/api/submit-solution', requireAuth, (req, res) => {
    const { solution } = req.body;
    
    if (!solution) {
        return res.status(400).json({ error: 'Solution required' });
    }
    
    const db = getDatabase();
    
    // Check competition end date first
    db.get('SELECT value FROM system_settings WHERE key = ?', ['competition_end_date'], (err, endDateSetting) => {
        if (err) {
            db.close();
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (endDateSetting && endDateSetting.value) {
            const endDate = new Date(endDateSetting.value);
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
                return res.status(500).json({ error: 'No TSP instance available' });
            }
            
            const tspInstanceId = parseInt(setting.value);
        
        // Get TSP instance details
        db.get('SELECT * FROM tsp_instances WHERE id = ?', [tspInstanceId], (err, instance) => {
            if (err || !instance) {
                db.close();
                return res.status(500).json({ error: 'TSP instance not found' });
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
            db.run('INSERT INTO solutions (user_id, tsp_instance_id, solution, objective_value, is_valid) VALUES (?, ?, ?, ?, ?)',
                [req.session.user.id, tspInstanceId, solution, objectiveValue, true], function(err) {
                if (err) {
                    db.close();
                    return res.status(500).json({ error: 'Error saving solution' });
                }
                
                const solutionId = this.lastID;
                
                // Update user's best solution
                updateUserBestSolution(db, req.session.user.id, solutionId, objectiveValue, (err, improved) => {
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
                u.email,
                ubs.best_objective_value,
                ubs.last_improvement,
                ubs.total_submissions
            FROM user_best_solutions ubs
            JOIN users u ON ubs.user_id = u.id
            WHERE ubs.best_objective_value IS NOT NULL
            ORDER BY ubs.best_objective_value ASC, ubs.last_improvement ASC
        `, (err, rows) => {
            db.close();
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
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
    const { userId } = req.body;
    const bcrypt = require('bcrypt');
    const defaultPassword = bcrypt.hashSync('password', 10);
    
    const db = getDatabase();
    
    db.run('UPDATE users SET password = ?, first_login = 1 WHERE id = ? AND is_admin = 0', 
        [defaultPassword, userId], (err) => {
        db.close();
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ success: true });
    });
});

// Delete user (admin only)
app.post('/api/admin/delete-user', requireAdmin, (req, res) => {
    const { userId } = req.body;
    const db = getDatabase();
    
    // Delete user's solutions first
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
                { id: 'objective_value', title: 'Objective Value' },
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

function updateUserBestSolution(db, userId, solutionId, objectiveValue, callback) {
    db.get('SELECT * FROM user_best_solutions WHERE user_id = ?', [userId], (err, existing) => {
        if (err) {
            return callback(err, false);
        }
        
        if (!existing) {
            // First solution for this user
            db.run('INSERT INTO user_best_solutions (user_id, best_solution_id, best_objective_value, total_submissions, last_improvement) VALUES (?, ?, ?, ?, ?)',
                [userId, solutionId, objectiveValue, 1, new Date().toISOString()], (err) => {
                callback(err, true);
            });
        } else {
            // Update total submissions
            let improved = false;
            let newBestId = existing.best_solution_id;
            let newBestValue = existing.best_objective_value;
            let lastImprovement = existing.last_improvement;
            
            if (existing.best_objective_value === null || objectiveValue < existing.best_objective_value) {
                improved = true;
                newBestId = solutionId;
                newBestValue = objectiveValue;
                lastImprovement = new Date().toISOString();
            }
            
            db.run('UPDATE user_best_solutions SET best_solution_id = ?, best_objective_value = ?, total_submissions = ?, last_improvement = ? WHERE user_id = ?',
                [newBestId, newBestValue, existing.total_submissions + 1, lastImprovement, userId], (err) => {
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
            u.email,
            ubs.best_objective_value,
            ubs.last_improvement,
            ubs.total_submissions
        FROM user_best_solutions ubs
        JOIN users u ON ubs.user_id = u.id
        WHERE ubs.best_objective_value IS NOT NULL
        ORDER BY ubs.best_objective_value ASC, ubs.last_improvement DESC
    `, (err, rows) => {
        if (err) {
            db.close();
            return callback(err);
        }
        
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

// Initialize database and start server
initializeDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`TopABII server running on port ${PORT}`);
        console.log(`Access the application at http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});