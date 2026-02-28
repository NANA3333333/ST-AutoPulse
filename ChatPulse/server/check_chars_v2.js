const db = require('./db');
db.initDb();
const chars = db.getCharacters();
console.log('Total characters:', chars.length);
chars.forEach(c => {
    console.log(`- ${c.id}: ${c.name} (Status: ${c.status})`);
});
process.exit(0);
