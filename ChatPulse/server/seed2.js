const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, '..', 'data', 'chatpulse.db');
const db = new Database(dbPath);

console.log('Adding test Moments and Diaries...');

const chars = db.prepare('SELECT * FROM characters').all();
const firstChar = chars[0];

if (firstChar) {
    db.prepare(`
        INSERT INTO moments (character_id, content, timestamp) 
        VALUES (?, ?, ?)
    `).run(firstChar.id, 'Just got a new plant for my desk! 🌿 Feeling productive today.', Date.now() - 3600000);

    db.prepare(`
        INSERT INTO diaries (character_id, content, emotion, is_unlocked, timestamp) 
        VALUES (?, ?, ?, ?, ?)
    `).run(firstChar.id, 'Sometimes I wonder if anyone actually reads my messages... Oh well, at least the plant listens to me.', 'sad', 1, Date.now() - 7200000);

    console.log('Added moment and unlocked diary for ' + firstChar.name);
} else {
    console.log('No characters found, skipping seed.');
}
