const db = require('better-sqlite3')('../data/chatpulse.sqlite');

try {
    // Find all message contents that have duplicates for the same character
    const result = db.prepare(`
        DELETE FROM messages 
        WHERE id NOT IN (
            SELECT MIN(id) 
            FROM messages 
            GROUP BY character_id, content
        )
    `).run();
    console.log(`Cleaned up ${result.changes} duplicate messages.`);
} catch (e) {
    console.error('Error cleaning DB:', e);
}
