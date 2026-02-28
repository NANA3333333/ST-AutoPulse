const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'chatpulse.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrency performance
db.pragma('journal_mode = WAL');

function initDb() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS characters (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            avatar TEXT,
            persona TEXT,
            world_info TEXT,
            api_endpoint TEXT,
            api_key TEXT,
            model_name TEXT,
            memory_api_endpoint TEXT,
            memory_api_key TEXT,
            memory_model_name TEXT,
            interval_min INTEGER DEFAULT 10,
            interval_max INTEGER DEFAULT 120,
            affinity INTEGER DEFAULT 50,
            status TEXT DEFAULT 'active',
            pressure_level INTEGER DEFAULT 0,
            last_user_msg_time INTEGER DEFAULT 0,
            is_blocked INTEGER DEFAULT 0,
            system_prompt TEXT,
            is_diary_unlocked INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            character_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            read INTEGER DEFAULT 0,
            hidden INTEGER DEFAULT 0,
            FOREIGN KEY (character_id) REFERENCES characters(id)
        );

        CREATE TABLE IF NOT EXISTS memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            character_id TEXT NOT NULL,
            time TEXT,
            location TEXT,
            people TEXT,
            event TEXT NOT NULL,
            relationships TEXT,
            items TEXT,
            importance INTEGER DEFAULT 5,
            embedding BLOB,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (character_id) REFERENCES characters(id)
        );

        CREATE TABLE IF NOT EXISTS moments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            character_id TEXT NOT NULL,
            content TEXT NOT NULL,
            image_url TEXT,
            visibility TEXT DEFAULT 'all',
            timestamp INTEGER NOT NULL,
            likes INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS diaries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            character_id TEXT NOT NULL,
            content TEXT NOT NULL,
            emotion TEXT,
            is_unlocked INTEGER DEFAULT 0,
            timestamp INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS user_profile (
            id TEXT PRIMARY KEY DEFAULT 'default',
            name TEXT DEFAULT 'User',
            avatar TEXT,
            bio TEXT DEFAULT '',
            theme TEXT DEFAULT 'light',
            group_msg_limit INTEGER DEFAULT 20,
            group_skip_rate INTEGER DEFAULT 10,
            group_proactive_enabled INTEGER DEFAULT 0,
            group_interval_min INTEGER DEFAULT 10,
            group_interval_max INTEGER DEFAULT 60,
            theme_config TEXT DEFAULT '{}',
            banner TEXT
        );
        CREATE TABLE IF NOT EXISTS moment_likes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            moment_id INTEGER NOT NULL,
            liker_id TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            UNIQUE(moment_id, liker_id)
        );

        CREATE TABLE IF NOT EXISTS moment_comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            moment_id INTEGER NOT NULL,
            author_id TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS character_friends (
            char1_id TEXT NOT NULL,
            char2_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (char1_id, char2_id),
            FOREIGN KEY (char1_id) REFERENCES characters(id) ON DELETE CASCADE,
            FOREIGN KEY (char2_id) REFERENCES characters(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS group_chats (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            avatar TEXT,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS group_members (
            group_id TEXT NOT NULL,
            member_id TEXT NOT NULL,
            role TEXT DEFAULT 'member',
            PRIMARY KEY (group_id, member_id)
        );

        CREATE TABLE IF NOT EXISTS group_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id TEXT NOT NULL,
            sender_id TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS char_relationships (
            source_id TEXT NOT NULL,
            target_id TEXT NOT NULL,
            affinity INTEGER DEFAULT 50,
            impression TEXT DEFAULT '',
            source TEXT DEFAULT 'recommend',
            PRIMARY KEY (source_id, target_id, source)
        );

        CREATE TABLE IF NOT EXISTS group_red_packets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id TEXT NOT NULL,
            sender_id TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'lucky',
            total_amount REAL NOT NULL,
            per_amount REAL,
            count INTEGER NOT NULL,
            remaining_count INTEGER NOT NULL,
            amounts TEXT NOT NULL,
            note TEXT DEFAULT '',
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS group_red_packet_claims (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            packet_id INTEGER NOT NULL,
            claimer_id TEXT NOT NULL,
            amount REAL NOT NULL,
            claimed_at INTEGER NOT NULL,
            UNIQUE(packet_id, claimer_id)
        );

        CREATE TABLE IF NOT EXISTS private_transfers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            char_id TEXT NOT NULL,
            sender_id TEXT NOT NULL,
            recipient_id TEXT NOT NULL,
            amount REAL NOT NULL,
            note TEXT DEFAULT '',
            claimed INTEGER DEFAULT 0,
            claimed_at INTEGER,
            message_id INTEGER,
            created_at INTEGER NOT NULL
        );
    `);

    // Add system_prompt for existing DBs (Migration)
    try {
        db.prepare('ALTER TABLE characters ADD COLUMN system_prompt TEXT').run();
    } catch (e) {
        // Ignore error if column already exists
    }

    // Add banner for existing DBs
    try {
        db.prepare('ALTER TABLE user_profile ADD COLUMN banner TEXT').run();
    } catch (e) { }

    // Add max_tokens for existing DBs
    try {
        db.prepare('ALTER TABLE characters ADD COLUMN max_tokens INTEGER DEFAULT 800').run();
    } catch (e) {
    }

    // Add master toggles for systems
    try {
        db.prepare('ALTER TABLE characters ADD COLUMN sys_proactive INTEGER DEFAULT 1').run();
        db.prepare('ALTER TABLE characters ADD COLUMN sys_timer INTEGER DEFAULT 1').run();
        db.prepare('ALTER TABLE characters ADD COLUMN sys_pressure INTEGER DEFAULT 1').run();
        db.prepare('ALTER TABLE characters ADD COLUMN sys_jealousy INTEGER DEFAULT 1').run();
    } catch (e) {
    }

    // Add is_diary_unlocked to characters
    try {
        db.prepare('ALTER TABLE characters ADD COLUMN is_diary_unlocked INTEGER DEFAULT 0').run();
    } catch (e) {
    }

    // Add diary_password to characters (password-lock mechanic)
    try {
        db.prepare('ALTER TABLE characters ADD COLUMN diary_password TEXT').run();
    } catch (e) {
    }

    // Add hidden column to messages (context hide mechanic)
    try {
        db.prepare('ALTER TABLE messages ADD COLUMN hidden INTEGER DEFAULT 0').run();
    } catch (e) {
    }

    // Add sender_name and sender_avatar to group_messages (so deleted chars still display)
    try {
        db.prepare('ALTER TABLE group_messages ADD COLUMN sender_name TEXT').run();
        db.prepare('ALTER TABLE group_messages ADD COLUMN sender_avatar TEXT').run();
        // Backfill existing records
        const msgs = db.prepare('SELECT DISTINCT sender_id FROM group_messages WHERE sender_name IS NULL').all();
        for (const m of msgs) {
            if (m.sender_id === 'user') {
                const profile = db.prepare('SELECT name, avatar FROM user_profile WHERE id = ?').get('default');
                if (profile) {
                    db.prepare('UPDATE group_messages SET sender_name = ?, sender_avatar = ? WHERE sender_id = ? AND sender_name IS NULL')
                        .run(profile.name || 'User', profile.avatar || '', 'user');
                }
            } else {
                const char = db.prepare('SELECT name, avatar FROM characters WHERE id = ?').get(m.sender_id);
                if (char) {
                    db.prepare('UPDATE group_messages SET sender_name = ?, sender_avatar = ? WHERE sender_id = ? AND sender_name IS NULL')
                        .run(char.name, char.avatar || '', m.sender_id);
                }
            }
        }
    } catch (e) {
    }

    ensureAllDiaryPasswords();

    // Migrate old max_tokens=800 (old default) to 2000
    try {
        db.prepare("UPDATE characters SET max_tokens = 2000 WHERE max_tokens IS NULL OR max_tokens <= 800").run();
    } catch (e) { }

    // Add group_id to memories (tracks which group a memory came from)
    try {
        db.prepare('ALTER TABLE memories ADD COLUMN group_id TEXT DEFAULT NULL').run();
    } catch (e) { }

    // Add hidden column to group_messages (context hide mechanic)
    try {
        db.prepare('ALTER TABLE group_messages ADD COLUMN hidden INTEGER DEFAULT 0').run();
    } catch (e) { }

    // Add group_msg_limit to user_profile for controlling group context injection
    try {
        db.prepare('ALTER TABLE user_profile ADD COLUMN group_msg_limit INTEGER DEFAULT 20').run();
    } catch (e) { }

    // Add group_skip_rate to user_profile (% chance a char skips reply in group chat)
    try {
        db.prepare('ALTER TABLE user_profile ADD COLUMN group_skip_rate INTEGER DEFAULT 10').run();
    } catch (e) { }

    // Add jealousy_chance to user_profile (% chance a char gets jealous when user talks to someone else)
    try {
        db.prepare('ALTER TABLE user_profile ADD COLUMN jealousy_chance INTEGER DEFAULT 5').run();
    } catch (e) { }

    // Add group proactive settings
    try { db.prepare('ALTER TABLE user_profile ADD COLUMN group_proactive_enabled INTEGER DEFAULT 0').run(); } catch (e) { }
    try { db.prepare('ALTER TABLE user_profile ADD COLUMN group_interval_min INTEGER DEFAULT 10').run(); } catch (e) { }
    try { db.prepare('ALTER TABLE user_profile ADD COLUMN group_interval_max INTEGER DEFAULT 60').run(); } catch (e) { }

    // Add wallet fields
    try { db.prepare('ALTER TABLE characters ADD COLUMN wallet REAL DEFAULT 200').run(); } catch (e) { }
    try { db.prepare('ALTER TABLE user_profile ADD COLUMN wallet REAL DEFAULT 520').run(); } catch (e) { }
    // Ensure existing users start at 520 if null
    try { db.prepare("UPDATE user_profile SET wallet = 520 WHERE wallet IS NULL").run(); } catch (e) { }

    // Add refunded column to private_transfers (for refund feature)
    try { db.prepare('ALTER TABLE private_transfers ADD COLUMN refunded INTEGER DEFAULT 0').run(); } catch (e) { }

    // Add theme and custom_css for UI skinning
    try { db.prepare('ALTER TABLE user_profile ADD COLUMN theme TEXT DEFAULT "default"').run(); } catch (e) { }
    try { db.prepare('ALTER TABLE user_profile ADD COLUMN custom_css TEXT DEFAULT ""').run(); } catch (e) { }
    try { db.prepare('ALTER TABLE user_profile ADD COLUMN theme_config TEXT DEFAULT "{}"').run(); } catch (e) { }

    console.log('[DB] Database initialized successfully.');
}

// ─── Character Queries ──────────────────────────────────────────────────

function getCharacters() {
    return db.prepare('SELECT * FROM characters').all();
}

function getCharacter(id) {
    return db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
}

const characterColumns = [
    'id', 'name', 'avatar', 'persona', 'world_info', 'api_endpoint',
    'api_key', 'model_name', 'memory_api_endpoint', 'memory_api_key',
    'memory_model_name', 'interval_min', 'interval_max', 'affinity',
    'status', 'pressure_level', 'last_user_msg_time', 'is_blocked', 'system_prompt', 'max_tokens',
    'sys_proactive', 'sys_timer', 'sys_pressure', 'sys_jealousy', 'is_diary_unlocked', 'diary_password', 'wallet'
];

// Generates a memorable random diary password (4-digit number)
function generateDiaryPassword() {
    return String(Math.floor(1000 + Math.random() * 9000));
}

function updateCharacter(id, data) {
    // Filter out 'id' from data keys — it's always passed as a separate parameter
    const fields = Object.keys(data).filter(k => characterColumns.includes(k) && k !== 'id');
    if (fields.length === 0) return;

    const values = fields.map(f => data[f]);

    // Insert if not exists, else update
    const existing = getCharacter(id);
    if (!existing) {
        // Auto-assign a diary password for new characters
        if (!data.diary_password) {
            const pw = generateDiaryPassword();
            fields.push('diary_password');
            values.push(pw);
        }
        const placeholders = fields.map(() => '?').join(', ');
        db.prepare(`INSERT INTO characters (id, ${fields.join(', ')}) VALUES (?, ${placeholders})`)
            .run(id, ...values);
    } else {
        const setClause = fields.map(f => `${f} = ?`).join(', ');
        db.prepare(`UPDATE characters SET ${setClause} WHERE id = ?`)
            .run(...values, id);
    }
}

// Backfill diary passwords for existing characters that don't have one
function ensureAllDiaryPasswords() {
    const chars = db.prepare("SELECT id FROM characters WHERE diary_password IS NULL OR diary_password = ''").all();
    for (const c of chars) {
        db.prepare('UPDATE characters SET diary_password = ? WHERE id = ?').run(generateDiaryPassword(), c.id);
    }
    if (chars.length > 0) console.log(`[DB] Auto-assigned diary passwords to ${chars.length} character(s).`);
}

// ─── Message Queries ────────────────────────────────────────────────────

function getMessages(characterId, limit = 100) {
    return db.prepare('SELECT * FROM messages WHERE character_id = ? ORDER BY id DESC LIMIT ?')
        .all(characterId, limit)
        .reverse();
}

function getMessagesBefore(characterId, beforeId, limit = 100) {
    return db.prepare('SELECT * FROM messages WHERE character_id = ? AND id < ? ORDER BY id DESC LIMIT ?')
        .all(characterId, beforeId, limit)
        .reverse();
}

// Returns messages excluding hidden ones — used for LLM context
function getVisibleMessages(characterId, limit = 50) {
    return db.prepare('SELECT * FROM messages WHERE character_id = ? AND hidden = 0 ORDER BY id DESC LIMIT ?')
        .all(characterId, limit)
        .reverse();
}

// Hide a range of messages by index (0-based from oldest)
function hideMessagesByRange(characterId, startIdx, endIdx) {
    const allMsgs = db.prepare('SELECT id FROM messages WHERE character_id = ? ORDER BY timestamp ASC').all(characterId);
    const toHide = allMsgs.slice(startIdx, endIdx + 1).map(m => m.id);
    if (toHide.length === 0) return 0;
    const placeholders = toHide.map(() => '?').join(', ');
    const info = db.prepare(`UPDATE messages SET hidden = 1 WHERE id IN (${placeholders})`).run(...toHide);
    return info.changes;
}

// Unhide all messages for a character
function unhideMessages(characterId) {
    const info = db.prepare('UPDATE messages SET hidden = 0 WHERE character_id = ?').run(characterId);
    return info.changes;
}

function addMessage(characterId, role, content) {
    const ts = Date.now();
    const info = db.prepare('INSERT INTO messages (character_id, role, content, timestamp) VALUES (?, ?, ?, ?)')
        .run(characterId, role, content, ts);
    return { id: info.lastInsertRowid, timestamp: ts };
}

function markMessagesRead(characterId) {
    db.prepare('UPDATE messages SET read = 1 WHERE character_id = ? AND read = 0 AND role = ?')
        .run(characterId, 'character');
}

function getUnreadCount(characterId) {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM messages WHERE character_id = ? AND role = ? AND read = 0').get(characterId, 'character');
    return row?.cnt || 0;
}

function clearMessages(characterId) {
    db.prepare('DELETE FROM messages WHERE character_id = ?').run(characterId);
}

function clearMemories(characterId) {
    db.prepare('DELETE FROM memories WHERE character_id = ?').run(characterId);
}

function clearMoments(characterId) {
    db.prepare('DELETE FROM moments WHERE character_id = ?').run(characterId);
}

function clearDiaries(characterId) {
    db.prepare('DELETE FROM diaries WHERE character_id = ?').run(characterId);
}

function exportCharacterData(characterId) {
    const character = getCharacter(characterId);
    if (!character) return null;
    const messages = db.prepare('SELECT * FROM messages WHERE character_id = ? ORDER BY timestamp ASC').all(characterId);
    const memories = db.prepare('SELECT * FROM memories WHERE character_id = ? ORDER BY created_at ASC').all(characterId);
    const moments = db.prepare('SELECT * FROM moments WHERE character_id = ? ORDER BY timestamp ASC').all(characterId);
    return { character, messages, memories, moments };
}

// ─── Memory Queries ─────────────────────────────────────────────────────

function getMemories(characterId) {
    return db.prepare('SELECT * FROM memories WHERE character_id = ? ORDER BY created_at DESC').all(characterId);
}

function getMemory(id) {
    return db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
}

function addMemory(characterId, memoryData, groupId = null) {
    const { time, location, people, event, relationships, items, importance, embedding } = memoryData;
    const info = db.prepare(`
        INSERT INTO memories 
        (character_id, time, location, people, event, relationships, items, importance, embedding, created_at, group_id) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(characterId, time, location, people, event, relationships, items, importance, embedding, Date.now(), groupId);
    return info.lastInsertRowid;
}

function updateMemory(id, memoryData) {
    const fields = Object.keys(memoryData);
    const setClause = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => memoryData[f]);
    db.prepare(`UPDATE memories SET ${setClause} WHERE id = ?`).run(...values, id);
}

function deleteMemory(id) {
    db.prepare('DELETE FROM memories WHERE id = ?').run(id);
}

// ─── Phase 3: Moments & Diaries ──────────────────────────────────────────

function getMoments() {
    return db.prepare('SELECT * FROM moments ORDER BY timestamp DESC LIMIT 100').all();
}

function getCharacterMoments(characterId) {
    return db.prepare('SELECT * FROM moments WHERE character_id = ? ORDER BY timestamp DESC').all(characterId);
}

function deleteMoment(momentId) {
    db.prepare('DELETE FROM moment_likes WHERE moment_id = ?').run(momentId);
    db.prepare('DELETE FROM moment_comments WHERE moment_id = ?').run(momentId);
    db.prepare('DELETE FROM moments WHERE id = ?').run(momentId);
}

function addMoment(characterId, content, imageUrl = null, visibility = 'all') {
    const info = db.prepare(`
        INSERT INTO moments (character_id, content, image_url, visibility, timestamp) 
        VALUES (?, ?, ?, ?, ?)
    `).run(characterId, content, imageUrl, visibility, Date.now());
    return info.lastInsertRowid;
}

function getDiaries(characterId) {
    return db.prepare('SELECT * FROM diaries WHERE character_id = ? ORDER BY timestamp DESC').all(characterId);
}

function addDiary(characterId, content, emotion = null) {
    const info = db.prepare(`
        INSERT INTO diaries (character_id, content, emotion, timestamp) 
        VALUES (?, ?, ?, ?)
    `).run(characterId, content, emotion, Date.now());
    return info.lastInsertRowid;
}

function unlockDiaries(characterId) {
    db.prepare('UPDATE characters SET is_diary_unlocked = 1 WHERE id = ?').run(characterId);
}

// Set the diary password (called when AI generates [DIARY_PASSWORD:xxxx] tag)
function setDiaryPassword(characterId, password) {
    db.prepare('UPDATE characters SET diary_password = ? WHERE id = ?').run(password, characterId);
}

// Verify and unlock the diary if password matches. Returns true on success.
function verifyAndUnlockDiary(characterId, inputPassword) {
    const char = db.prepare('SELECT diary_password, is_diary_unlocked FROM characters WHERE id = ?').get(characterId);
    if (!char) return { success: false, reason: 'Character not found.' };
    if (char.is_diary_unlocked) return { success: true, alreadyUnlocked: true };
    if (!char.diary_password) return { success: false, reason: 'No password has been set yet. Keep building your bond.' };
    if (char.diary_password.trim().toLowerCase() === inputPassword.trim().toLowerCase()) {
        db.prepare('UPDATE characters SET is_diary_unlocked = 1 WHERE id = ?').run(characterId);
        return { success: true };
    }
    return { success: false, reason: 'Wrong password.' };
}

// Toggle like: user_id = 'user' for the human user, or char id
function toggleLike(momentId, likerId) {
    const existing = db.prepare('SELECT id FROM moment_likes WHERE moment_id=? AND liker_id=?').get(momentId, likerId);
    if (existing) {
        db.prepare('DELETE FROM moment_likes WHERE id=?').run(existing.id);
        return false; // unliked
    } else {
        db.prepare('INSERT INTO moment_likes(moment_id,liker_id,timestamp) VALUES(?,?,?)').run(momentId, likerId, Date.now());
        return true; // liked
    }
}

function getLikesForMoment(momentId) {
    return db.prepare('SELECT liker_id FROM moment_likes WHERE moment_id=?').all(momentId);
}

function addComment(momentId, authorId, content) {
    const info = db.prepare('INSERT INTO moment_comments(moment_id,author_id,content,timestamp) VALUES(?,?,?,?)').run(momentId, authorId, content, Date.now());
    return info.lastInsertRowid;
}

function getComments(momentId) {
    return db.prepare('SELECT * FROM moment_comments WHERE moment_id=? ORDER BY timestamp ASC').all(momentId);
}


// ─── User Profile ───────────────────────────────────────────────────────

function getUserProfile() {
    let profile = db.prepare('SELECT * FROM user_profile WHERE id = ?').get('default');
    if (!profile) {
        db.prepare(`INSERT INTO user_profile (id, name, avatar) VALUES (?, ?, ?)`)
            .run('default', 'User', 'https://api.dicebear.com/7.x/notionists/svg?seed=User');
        profile = db.prepare('SELECT * FROM user_profile WHERE id = ?').get('default');
    }
    return profile;
}

function updateUserProfile(data) {
    const allowedFields = ['name', 'avatar', 'banner', 'bio', 'theme', 'custom_css', 'theme_config', 'group_msg_limit', 'group_skip_rate', 'group_proactive_enabled', 'group_interval_min', 'group_interval_max', 'jealousy_chance', 'wallet'];
    const fields = Object.keys(data).filter(k => allowedFields.includes(k));
    if (fields.length === 0) return;
    const setClause = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => data[f]);
    db.prepare(`UPDATE user_profile SET ${setClause} WHERE id = ?`).run(...values, 'default');
}

// ─── Friendship Management ──────────────────────────────────────────────
function addFriend(char1Id, char2Id) {
    if (char1Id === char2Id) return false;
    const stmt = db.prepare('INSERT OR IGNORE INTO character_friends (char1_id, char2_id, created_at) VALUES (?, ?, ?)');
    const now = Date.now();
    const info1 = stmt.run(char1Id, char2Id, now);
    const info2 = stmt.run(char2Id, char1Id, now);
    return info1.changes > 0 || info2.changes > 0;
}

function clearFriends(charId) {
    db.prepare('DELETE FROM character_friends WHERE char1_id = ? OR char2_id = ?').run(charId, charId);
}

// Clear all char-to-char relationships involving this character (both directions)
function clearCharRelationships(charId) {
    db.prepare('DELETE FROM char_relationships WHERE source_id = ? OR target_id = ?').run(charId, charId);
}

function getFriends(charId) {
    // Return list of character objects that are friends with charId
    return db.prepare(`
        SELECT c.* FROM characters c
        JOIN character_friends f ON c.id = f.char2_id
        WHERE f.char1_id = ?
    `).all(charId);
}

function isFriend(charId, targetId) {
    if (charId === targetId) return true;
    const relation = db.prepare('SELECT 1 FROM character_friends WHERE char1_id = ? AND char2_id = ?').get(charId, targetId);
    return !!relation;
}

// ─── Group Chat Management ──────────────────────────────────────────────
function createGroup(id, name, memberIds, avatar = null) {
    db.prepare('INSERT INTO group_chats (id, name, avatar, created_at) VALUES (?, ?, ?, ?)').run(id, name, avatar, Date.now());
    const stmt = db.prepare('INSERT OR IGNORE INTO group_members (group_id, member_id, role) VALUES (?, ?, ?)');
    stmt.run(id, 'user', 'owner');
    for (const mid of memberIds) {
        stmt.run(id, mid, 'member');
    }
    return id;
}

function getGroups() {
    const groups = db.prepare('SELECT * FROM group_chats ORDER BY created_at DESC').all();
    return groups.map(g => ({
        ...g,
        members: db.prepare('SELECT member_id, role FROM group_members WHERE group_id = ?').all(g.id)
    }));
}

function getGroup(id) {
    const group = db.prepare('SELECT * FROM group_chats WHERE id = ?').get(id);
    if (!group) return null;
    group.members = db.prepare('SELECT member_id, role FROM group_members WHERE group_id = ?').all(id);
    return group;
}

function deleteGroup(id) {
    db.prepare('DELETE FROM group_messages WHERE group_id = ?').run(id);
    db.prepare('DELETE FROM group_members WHERE group_id = ?').run(id);
    db.prepare('DELETE FROM char_relationships WHERE source = ?').run(`group:${id}`);
    db.prepare('DELETE FROM memories WHERE group_id = ?').run(id);
    db.prepare('DELETE FROM group_chats WHERE id = ?').run(id);
}

function getGroupMessages(groupId, limit = 100) {
    return db.prepare('SELECT * FROM group_messages WHERE group_id = ? ORDER BY timestamp DESC LIMIT ?').all(groupId, limit).reverse();
}

function getVisibleGroupMessages(groupId, limit = 50) {
    return db.prepare('SELECT * FROM group_messages WHERE group_id = ? AND hidden = 0 ORDER BY timestamp DESC LIMIT ?').all(groupId, limit).reverse();
}

function addGroupMessage(groupId, senderId, content, senderName = null, senderAvatar = null) {
    const info = db.prepare('INSERT INTO group_messages (group_id, sender_id, content, timestamp, sender_name, sender_avatar) VALUES (?, ?, ?, ?, ?, ?)')
        .run(groupId, senderId, content, Date.now(), senderName, senderAvatar);
    return info.lastInsertRowid;
}

function clearGroupMessages(groupId) {
    db.prepare('DELETE FROM group_messages WHERE group_id = ?').run(groupId);
    db.prepare('DELETE FROM char_relationships WHERE source = ?').run(`group:${groupId}`);
    db.prepare('DELETE FROM memories WHERE group_id = ?').run(groupId);
}

function addGroupMember(groupId, memberId, role = 'member') {
    db.prepare('INSERT OR IGNORE INTO group_members (group_id, member_id, role) VALUES (?, ?, ?)').run(groupId, memberId, role);
}

function removeGroupMember(groupId, memberId) {
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND member_id = ?').run(groupId, memberId);
}

function hideGroupMessagesByRange(groupId, startIdx, endIdx) {
    const allMsgs = db.prepare('SELECT id FROM group_messages WHERE group_id = ? ORDER BY timestamp ASC').all(groupId);
    const toHide = allMsgs.slice(startIdx, endIdx + 1).map(m => m.id);
    if (toHide.length === 0) return 0;
    const placeholders = toHide.map(() => '?').join(', ');
    const info = db.prepare(`UPDATE group_messages SET hidden = 1 WHERE id IN (${placeholders})`).run(...toHide);
    return info.changes;
}

function unhideGroupMessages(groupId) {
    const info = db.prepare('UPDATE group_messages SET hidden = 0 WHERE group_id = ?').run(groupId);
    return info.changes;
}

// ─── Character Management ───────────────────────────────────────────────

function deleteCharacter(id) {
    db.prepare('DELETE FROM messages WHERE character_id = ?').run(id);
    db.prepare('DELETE FROM memories WHERE character_id = ?').run(id);
    // clean up moment interactions authored by this character
    const charMoments = db.prepare('SELECT id FROM moments WHERE character_id=?').all(id);
    for (const m of charMoments) {
        db.prepare('DELETE FROM moment_likes WHERE moment_id=?').run(m.id);
        db.prepare('DELETE FROM moment_comments WHERE moment_id=?').run(m.id);
    }
    db.prepare('DELETE FROM moment_likes WHERE liker_id=?').run(id);
    db.prepare('DELETE FROM moment_comments WHERE author_id=?').run(id);
    db.prepare('DELETE FROM moments WHERE character_id = ?').run(id);
    db.prepare('DELETE FROM diaries WHERE character_id = ?').run(id);
    db.prepare('DELETE FROM character_friends WHERE char1_id = ? OR char2_id = ?').run(id, id);
    db.prepare('DELETE FROM char_relationships WHERE source_id = ? OR target_id = ?').run(id, id);
    db.prepare('DELETE FROM group_members WHERE member_id = ?').run(id); // Auto-kick from groups
    db.prepare('DELETE FROM characters WHERE id = ?').run(id);
}

// ─── Character Relationships (Inter-char Social System) ────────────────

function initCharRelationship(sourceId, targetId, affinity, impression, source = 'recommend') {
    db.prepare(`INSERT OR REPLACE INTO char_relationships (source_id, target_id, affinity, impression, source) VALUES (?, ?, ?, ?, ?)`)
        .run(sourceId, targetId, affinity, impression || '', source);
}

function getCharRelationship(sourceId, targetId) {
    // Returns all relationship records between source→target (may have multiple sources)
    const rows = db.prepare('SELECT * FROM char_relationships WHERE source_id = ? AND target_id = ?').all(sourceId, targetId);
    if (rows.length === 0) return null;
    // Merge: total affinity = recommend base + sum of group deltas; impression from recommend takes priority
    const recommend = rows.find(r => r.source === 'recommend');
    const groupRows = rows.filter(r => r.source !== 'recommend');
    const totalAffinity = (recommend?.affinity || 50) + groupRows.reduce((sum, r) => sum + (r.affinity - 50), 0);
    return {
        sourceId, targetId,
        affinity: Math.max(0, Math.min(100, totalAffinity)),
        impression: recommend?.impression || groupRows[0]?.impression || '',
        isAcquainted: !!recommend,
        sources: rows
    };
}

function getCharRelationships(charId) {
    // Get all unique targets this char has a relationship with
    const rows = db.prepare('SELECT DISTINCT target_id FROM char_relationships WHERE source_id = ?').all(charId);
    return rows.map(r => getCharRelationship(charId, r.target_id)).filter(Boolean);
}

function updateCharRelationship(sourceId, targetId, source, data) {
    const existing = db.prepare('SELECT * FROM char_relationships WHERE source_id = ? AND target_id = ? AND source = ?').get(sourceId, targetId, source);
    if (existing) {
        const fields = [];
        const values = [];
        if (data.affinity !== undefined) { fields.push('affinity = ?'); values.push(data.affinity); }
        if (data.impression !== undefined) { fields.push('impression = ?'); values.push(data.impression); }
        if (fields.length > 0) {
            values.push(sourceId, targetId, source);
            db.prepare(`UPDATE char_relationships SET ${fields.join(', ')} WHERE source_id = ? AND target_id = ? AND source = ?`).run(...values);
        }
    } else {
        // Auto-create if doesn't exist
        initCharRelationship(sourceId, targetId, data.affinity || 50, data.impression || '', source);
    }
}

function deleteGroupRelationships(groupId) {
    db.prepare('DELETE FROM char_relationships WHERE source = ?').run(`group:${groupId}`);
}

// ─── Private Transfer System ──────────────────────────────────────

function createTransfer({ charId, senderId, recipientId, amount, note, messageId }) {
    // Deduct from sender wallet
    if (senderId === 'user') {
        const profile = db.prepare('SELECT wallet FROM user_profile WHERE id = ?').get('default');
        const bal = profile?.wallet ?? 520;
        if (bal < amount) throw new Error('余额不足');
        db.prepare('UPDATE user_profile SET wallet = ? WHERE id = ?').run(+(bal - amount).toFixed(2), 'default');
    } else {
        const char = db.prepare('SELECT wallet FROM characters WHERE id = ?').get(senderId);
        const bal = char?.wallet ?? 0;
        if (bal < amount) throw new Error('余额不足');
        db.prepare('UPDATE characters SET wallet = ? WHERE id = ?').run(+(bal - amount).toFixed(2), senderId);
    }
    const info = db.prepare(
        'INSERT INTO private_transfers (char_id, sender_id, recipient_id, amount, note, claimed, message_id, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)'
    ).run(charId, senderId, recipientId, amount, note || '', messageId ?? null, Date.now());
    return info.lastInsertRowid;
}

function getTransfer(transferId) {
    return db.prepare('SELECT * FROM private_transfers WHERE id = ?').get(transferId);
}

function claimTransfer(transferId, claimerId) {
    const t = db.prepare('SELECT * FROM private_transfers WHERE id = ?').get(transferId);
    if (!t) return { success: false, error: '转账不存在' };
    if (t.claimed) return { success: false, error: '已经领取过了' };
    if (t.refunded) return { success: false, error: '已退还' };
    if (t.recipient_id !== claimerId) return { success: false, error: '不是这笔转账的收款方' };

    db.prepare('UPDATE private_transfers SET claimed = 1, claimed_at = ? WHERE id = ?').run(Date.now(), transferId);

    // Credit to recipient
    if (claimerId === 'user') {
        const profile = db.prepare('SELECT wallet FROM user_profile WHERE id = ?').get('default');
        const bal = profile?.wallet ?? 520;
        db.prepare('UPDATE user_profile SET wallet = ? WHERE id = ?').run(+(bal + t.amount).toFixed(2), 'default');
    } else {
        const char = db.prepare('SELECT wallet FROM characters WHERE id = ?').get(claimerId);
        const bal = char?.wallet ?? 0;
        db.prepare('UPDATE characters SET wallet = ? WHERE id = ?').run(+(bal + t.amount).toFixed(2), claimerId);
    }
    return { success: true, amount: t.amount };
}

function getUnclaimedTransfersFrom(senderId, charId) {
    return db.prepare(
        'SELECT * FROM private_transfers WHERE sender_id = ? AND char_id = ? AND claimed = 0 AND refunded = 0 AND created_at > ? ORDER BY created_at DESC'
    ).all(senderId, charId, Date.now() - 24 * 60 * 60 * 1000); // last 24h
}

function refundTransfer(transferId, refunderId) {
    const t = db.prepare('SELECT * FROM private_transfers WHERE id = ?').get(transferId);
    if (!t) return { success: false, error: '转账不存在' };
    if (t.refunded) return { success: false, error: '已经退还过了' };
    // Allow sender to refund anytime if still pending, allow recipient to refund anytime
    const canRefund = (refunderId === t.sender_id && !t.claimed) || (refunderId === t.recipient_id);
    if (!canRefund) return { success: false, error: '无权退还' };

    db.prepare('UPDATE private_transfers SET refunded = 1, claimed = 0 WHERE id = ?').run(transferId);

    // Return money to original sender
    if (t.sender_id === 'user') {
        const profile = db.prepare('SELECT wallet FROM user_profile WHERE id = ?').get('default');
        const bal = profile?.wallet ?? 520;
        db.prepare('UPDATE user_profile SET wallet = ? WHERE id = ?').run(+(bal + t.amount).toFixed(2), 'default');
    } else {
        const char = db.prepare('SELECT wallet FROM characters WHERE id = ?').get(t.sender_id);
        const bal = char?.wallet ?? 0;
        db.prepare('UPDATE characters SET wallet = ? WHERE id = ?').run(+(bal + t.amount).toFixed(2), t.sender_id);
    }
    // If the recipient had already claimed, also deduct from their wallet
    if (t.claimed) {
        if (t.recipient_id === 'user') {
            const profile = db.prepare('SELECT wallet FROM user_profile WHERE id = ?').get('default');
            const bal = profile?.wallet ?? 0;
            db.prepare('UPDATE user_profile SET wallet = ? WHERE id = ?').run(Math.max(0, +(bal - t.amount).toFixed(2)), 'default');
        } else {
            const char = db.prepare('SELECT wallet FROM characters WHERE id = ?').get(t.recipient_id);
            const bal = char?.wallet ?? 0;
            db.prepare('UPDATE characters SET wallet = ? WHERE id = ?').run(Math.max(0, +(bal - t.amount).toFixed(2)), t.recipient_id);
        }
    }
    return { success: true, amount: t.amount, senderId: t.sender_id };
}

// ─── Red Packet System ──────────────────────────────────────────────────

// Generates lucky (拼手气) amounts: random splits of total into N pieces, min 0.01 each
function generateLuckyAmounts(total, count) {
    const amounts = [];
    let remaining = Math.round(total * 100); // work in cents to avoid float issues
    for (let i = 0; i < count - 1; i++) {
        const maxCents = Math.floor(remaining * 2 / (count - i));
        const cents = Math.max(1, Math.floor(Math.random() * maxCents) + 1);
        const safe = Math.min(cents, remaining - (count - i - 1));
        amounts.push(safe);
        remaining -= safe;
    }
    amounts.push(remaining);
    // Fisher-Yates shuffle
    for (let i = amounts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [amounts[i], amounts[j]] = [amounts[j], amounts[i]];
    }
    return amounts.map(c => +(c / 100).toFixed(2));
}

function createRedPacket({ groupId, senderId, type, totalAmount, perAmount, count, note }) {
    // Deduct from sender wallet
    if (senderId === 'user') {
        const profile = db.prepare('SELECT wallet FROM user_profile WHERE id = ?').get('default');
        const bal = profile?.wallet ?? 520;
        if (bal < totalAmount) throw new Error('余额不足');
        db.prepare('UPDATE user_profile SET wallet = ? WHERE id = ?').run(+(bal - totalAmount).toFixed(2), 'default');
    } else {
        const char = db.prepare('SELECT wallet FROM characters WHERE id = ?').get(senderId);
        const bal = char?.wallet ?? 0;
        if (bal < totalAmount) throw new Error('余额不足');
        db.prepare('UPDATE characters SET wallet = ? WHERE id = ?').run(+(bal - totalAmount).toFixed(2), senderId);
    }

    // Pre-generate amounts
    let amounts;
    if (type === 'lucky') {
        amounts = generateLuckyAmounts(totalAmount, count);
    } else {
        const each = perAmount ?? +(totalAmount / count).toFixed(2);
        amounts = Array(count).fill(each);
    }

    const info = db.prepare(
        'INSERT INTO group_red_packets (group_id, sender_id, type, total_amount, per_amount, count, remaining_count, amounts, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(groupId, senderId, type, totalAmount, perAmount ?? null, count, count, JSON.stringify(amounts), note || '', Date.now());
    return info.lastInsertRowid;
}

function getRedPacket(packetId) {
    const pkt = db.prepare('SELECT * FROM group_red_packets WHERE id = ?').get(packetId);
    if (!pkt) return null;
    pkt.amounts = JSON.parse(pkt.amounts);
    pkt.claims = db.prepare('SELECT * FROM group_red_packet_claims WHERE packet_id = ? ORDER BY claimed_at ASC').all(packetId);
    return pkt;
}

// Returns { success, amount, error }
function claimRedPacket(packetId, claimerId) {
    const pkt = db.prepare('SELECT * FROM group_red_packets WHERE id = ?').get(packetId);
    if (!pkt) return { success: false, error: '红包不存在' };
    if (pkt.remaining_count <= 0) return { success: false, error: '红包已被抢光' };

    const already = db.prepare('SELECT id FROM group_red_packet_claims WHERE packet_id = ? AND claimer_id = ?').get(packetId, claimerId);
    if (already) return { success: false, error: '你已经领过了' };

    // Pick next available amount (in order, pre-shuffled)
    const claimedCount = pkt.count - pkt.remaining_count;
    const amounts = JSON.parse(pkt.amounts);
    const amount = amounts[claimedCount];

    // Atomic update
    db.prepare('UPDATE group_red_packets SET remaining_count = remaining_count - 1 WHERE id = ?').run(packetId);
    db.prepare('INSERT INTO group_red_packet_claims (packet_id, claimer_id, amount, claimed_at) VALUES (?, ?, ?, ?)').run(packetId, claimerId, amount, Date.now());

    // Credit to claimer wallet
    if (claimerId === 'user') {
        const profile = db.prepare('SELECT wallet FROM user_profile WHERE id = ?').get('default');
        const bal = profile?.wallet ?? 520;
        db.prepare('UPDATE user_profile SET wallet = ? WHERE id = ?').run(+(bal + amount).toFixed(2), 'default');
    } else {
        const char = db.prepare('SELECT wallet FROM characters WHERE id = ?').get(claimerId);
        const bal = char?.wallet ?? 0;
        db.prepare('UPDATE characters SET wallet = ? WHERE id = ?').run(+(bal + amount).toFixed(2), claimerId);
    }

    return { success: true, amount };
}

function getWallet(id) {
    if (id === 'user') {
        const p = db.prepare('SELECT wallet FROM user_profile WHERE id = ?').get('default');
        return +(p?.wallet ?? 520).toFixed(2);
    }
    const c = db.prepare('SELECT wallet FROM characters WHERE id = ?').get(id);
    return +(c?.wallet ?? 0).toFixed(2);
}

function isCharAcquainted(charId, targetId) {
    const row = db.prepare("SELECT 1 FROM char_relationships WHERE source_id = ? AND target_id = ? AND source = 'recommend'").get(charId, targetId);
    return !!row;
}

module.exports = {
    initDb,
    getCharacters,
    getCharacter,
    updateCharacter,
    deleteCharacter,
    getMessages,
    getMessagesBefore,
    getVisibleMessages,
    hideMessagesByRange,
    unhideMessages,
    addMessage,
    markMessagesRead,
    getUnreadCount,
    clearMessages,
    clearMemories,
    clearMoments,
    clearDiaries,
    exportCharacterData,
    getMemories,
    getMemory,
    addMemory,
    updateMemory,
    deleteMemory,
    getMoments,
    getCharacterMoments,
    addMoment,
    deleteMoment,
    toggleLike,
    getLikesForMoment,
    addComment,
    getComments,
    getDiaries,
    addDiary,
    unlockDiaries,
    setDiaryPassword,
    verifyAndUnlockDiary,
    getUserProfile,
    updateUserProfile,
    addFriend,
    clearFriends,
    clearCharRelationships,
    getFriends,
    isFriend,
    createGroup,
    getGroups,
    getGroup,
    deleteGroup,
    getGroupMessages,
    addGroupMessage,
    clearGroupMessages,
    addGroupMember,
    removeGroupMember,
    getVisibleGroupMessages,
    hideGroupMessagesByRange,
    unhideGroupMessages,
    initCharRelationship,
    getCharRelationship,
    getCharRelationships,
    updateCharRelationship,
    deleteGroupRelationships,
    isCharAcquainted,
    // Private Transfer
    createTransfer,
    getTransfer,
    claimTransfer,
    refundTransfer,
    getUnclaimedTransfersFrom,
    // Red Packet
    createRedPacket,
    getRedPacket,
    claimRedPacket,
    getWallet
};
