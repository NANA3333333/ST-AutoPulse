const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, '..', 'data', 'chatpulse.db');
const db = new Database(dbPath);

try {
    db.exec(`ALTER TABLE characters ADD COLUMN is_blocked INTEGER DEFAULT 0;`);
    console.log('Added is_blocked column');
} catch (e) {
    console.log('is_blocked already exists', e.message);
}

// Ensure Alice has a high pressure or low affinity for easy testing later if we want
