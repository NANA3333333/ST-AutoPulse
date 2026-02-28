const db = require('./db');
db.initDb();
const groups = db.getGroups();
console.log('--- Groups and Members ---');
groups.forEach(g => {
    console.log(`Group: ${g.name} (${g.id})`);
    console.log('Members:', g.members);
});
console.log('\n--- User Profile ---');
console.log(db.getUserProfile());
process.exit(0);
