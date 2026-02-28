const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, '..', 'data', 'chatpulse.db');
const db = new Database(dbPath);

console.log('Creating tables for Phase 3...');

db.exec(`
    CREATE TABLE IF NOT EXISTS moments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id TEXT NOT NULL,
        content TEXT NOT NULL,
        image_url TEXT,
        visibility TEXT DEFAULT 'all',
        timestamp INTEGER NOT NULL,
        likes INTEGER DEFAULT 0
    );
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS diaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id TEXT NOT NULL,
        content TEXT NOT NULL,
        emotion TEXT,
        is_unlocked INTEGER DEFAULT 0,
        timestamp INTEGER NOT NULL
    );
`);

console.log('Phase 3 tables created successfully.');
