const db = require('better-sqlite3')('../data/chatpulse.db');
db.prepare("UPDATE characters SET avatar = REPLACE(avatar, 'http://localhost:8000', 'http://localhost:8001')").run();
db.prepare("UPDATE user_profile SET avatar = REPLACE(avatar, 'http://localhost:8000', 'http://localhost:8001')").run();
db.prepare("UPDATE moments SET image_url = REPLACE(image_url, 'http://localhost:8000', 'http://localhost:8001')").run();
db.prepare("UPDATE group_chats SET avatar = REPLACE(avatar, 'http://localhost:8000', 'http://localhost:8001')").run();
console.log('Fixed avatar and image URLs in database to port 8001');
