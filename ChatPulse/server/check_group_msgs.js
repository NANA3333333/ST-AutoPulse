const db = require('./db');
db.initDb();
console.log('--- User Profile ---');
console.log(db.getUserProfile());

const groups = db.getGroups();
if (groups.length > 0) {
    const groupId = groups[0].id;
    console.log(`\n--- Messages for Group: ${groups[0].name} (${groupId}) ---`);
    const msgs = db.getGroupMessages(groupId, 10);
    msgs.forEach(m => {
        console.log(`ID: ${m.id}, Sender: ${m.sender_id}, Content: ${m.content}`);
    });
} else {
    console.log('No groups found.');
}
process.exit(0);
