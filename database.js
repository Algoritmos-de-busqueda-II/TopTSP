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
                submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id),
                FOREIGN KEY (tsp_instance_id) REFERENCES tsp_instances (id)
            )`);

            // User best solutions table
            db.run(`CREATE TABLE IF NOT EXISTS user_best_solutions (
                user_id INTEGER PRIMARY KEY,
                best_solution_id INTEGER,
                best_objective_value REAL,
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
                ['sergio.cavero@urjc.es', adminPassword, true, true]);

            // Set default system settings
            db.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)`, ['ranking_frozen', 'false']);
            db.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)`, ['current_tsp_instance', '1']);
            db.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)`, ['frozen_ranking_data', '']);
            db.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)`, ['frozen_ranking_timestamp', '']);
            db.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)`, ['competition_end_date', '']);
            db.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)`, ['instance_name', 'Berlin 52']);
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