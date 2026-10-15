const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const dbPath = path.join(__dirname, 'topabii.db');

function initializeDatabase() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('Error opening database:', err);
                reject(err);
                return;
            }
            console.log('Connected to SQLite database');
        });

        db.serialize(() => {
            // Users table
            db.run(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                is_admin BOOLEAN DEFAULT FALSE,
                first_login BOOLEAN DEFAULT TRUE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // TSP instances table
            db.run(`CREATE TABLE IF NOT EXISTS tsp_instances (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                type TEXT DEFAULT 'TSP',
                comment TEXT,
                dimension INTEGER NOT NULL,
                edge_weight_type TEXT DEFAULT 'EUC_2D',
                coordinates TEXT,
                distance_matrix TEXT NOT NULL,
                original_data TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Solutions table
            db.run(`CREATE TABLE IF NOT EXISTS solutions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                tsp_instance_id INTEGER,
                solution TEXT NOT NULL,
                objective_value REAL,
                is_valid BOOLEAN,
                method TEXT DEFAULT '',
                submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id),
                FOREIGN KEY (tsp_instance_id) REFERENCES tsp_instances (id)
            )`);

            // User best solutions table
            db.run(`CREATE TABLE IF NOT EXISTS user_best_solutions (
                user_id INTEGER PRIMARY KEY,
                best_solution_id INTEGER,
                best_objective_value REAL,
                best_method TEXT DEFAULT '',
                total_submissions INTEGER DEFAULT 0,
                last_improvement DATETIME,
                FOREIGN KEY (user_id) REFERENCES users (id),
                FOREIGN KEY (best_solution_id) REFERENCES solutions (id)
            )`);

            // System settings table
            db.run(`CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )`);

            // Create admin user
            const adminPassword = bcrypt.hashSync('admin', 10);
            db.run(`INSERT OR IGNORE INTO users (email, password, is_admin, first_login) VALUES (?, ?, ?, ?)`,
                ['admin@urjc.es', adminPassword, true, true]);

            // Set default system settings
            db.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)`, ['ranking_frozen', 'false']);
            db.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)`, ['current_tsp_instance', '1']);
            db.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)`, ['frozen_ranking_data', '']);
            db.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)`, ['frozen_ranking_timestamp', '']);
            db.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)`, ['competition_end_date', '']);
            db.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)`, ['instance_name', 'Berlin 52']);
            db.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)`, ['competition_paused', 'false']);

            // Add method column to existing solutions table if it doesn't exist
            db.run(`ALTER TABLE solutions ADD COLUMN method TEXT DEFAULT ''`, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.error('Error adding method column:', err);
                }
            });

            // Add best_method column to existing user_best_solutions table if it doesn't exist
            db.run(`ALTER TABLE user_best_solutions ADD COLUMN best_method TEXT DEFAULT ''`, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.error('Error adding best_method column:', err);
                }
            });

            // Optional time (seconds) the student needed to obtain each solution
            db.run(`ALTER TABLE solutions ADD COLUMN time_seconds REAL`, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.error('Error adding time_seconds column:', err);
                }
            });

            db.run(`ALTER TABLE user_best_solutions ADD COLUMN best_time_seconds REAL`, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.error('Error adding best_time_seconds column:', err);
                }
            });

            // Finished competitions, archived when a new instance replaces the current one
            db.run(`CREATE TABLE IF NOT EXISTS competition_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                instance_name TEXT NOT NULL,
                dimension INTEGER,
                best_value REAL,
                participants INTEGER DEFAULT 0,
                archived_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Final standing of every participant in each archived competition
            db.run(`CREATE TABLE IF NOT EXISTS competition_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                competition_id INTEGER NOT NULL,
                user_id INTEGER,
                email TEXT NOT NULL,
                position INTEGER NOT NULL,
                objective_value REAL NOT NULL,
                deviation REAL NOT NULL,
                method TEXT DEFAULT '',
                time_seconds REAL,
                total_submissions INTEGER DEFAULT 0,
                last_improvement TEXT,
                FOREIGN KEY (competition_id) REFERENCES competition_history (id)
            )`);

            // Optional long description of the method (the method field itself is a short acronym)
            db.run(`ALTER TABLE solutions ADD COLUMN method_description TEXT DEFAULT ''`, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.error('Error adding method_description column:', err);
                }
            });

            db.run(`ALTER TABLE competition_results ADD COLUMN method_description TEXT DEFAULT ''`, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.error('Error adding competition_results.method_description column:', err);
                }
            });
        });

        db.close((err) => {
            if (err) {
                console.error('Error closing database:', err);
                reject(err);
            } else {
                console.log('Database initialized successfully');
                resolve();
            }
        });
    });
}

function getDatabase() {
    return new sqlite3.Database(dbPath);
}

module.exports = {
    initializeDatabase,
    getDatabase,
    dbPath
};