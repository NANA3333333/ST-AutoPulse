const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, '..', 'data', 'chatpulse.db');
const db = new Database(dbPath);

try {
    db.exec(`ALTER TABLE characters ADD COLUMN pressure_level INTEGER DEFAULT 0;`);
    console.log('Added pressure_level column');
} catch (e) {
    console.log('pressure_level already exists', e.message);
}

try {
    db.exec(`ALTER TABLE characters ADD COLUMN last_user_msg_time INTEGER DEFAULT 0;`);
    console.log('Added last_user_msg_time column');
} catch (e) {
    console.log('last_user_msg_time already exists', e.message);
}
