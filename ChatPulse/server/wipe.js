const db = require('better-sqlite3')('../data/chatpulse.sqlite');

try {
    db.exec(`
        DELETE FROM messages;
        DELETE FROM moments;
        DELETE FROM diaries;
    `);
    console.log('Successfully wiped all test messages, moments, and diaries.');
} catch (e) {
    console.error('Error wiping DB:', e);
}
