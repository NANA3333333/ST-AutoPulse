const db = require('./db');
const engine = require('./engine');

(async () => {
    db.initDb();
    const chars = db.getCharacters();
    if (chars.length > 0) {
        try {
            // Note: engine.js doesn't export processTimer if it's internal.
            // Let's check if we can call something else or just run the same logic.
            // If processTimer is not exported, we can just copy the failing part:
            let character = chars[0];
            const allMoments = db.getMoments();
            const otherMoments = allMoments.filter(m => m.character_id !== character.id);
            if (otherMoments.length > 0) {
                const randomMoment = otherMoments[Math.floor(Math.random() * otherMoments.length)];
                const otherChar = db.getCharacter(randomMoment.character_id);
                console.log(otherChar.name);
            }
            console.log("No crash here.");
        } catch (e) {
            console.error("Crash Trace:", e);
        }
    }
})();
