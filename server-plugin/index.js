/**
 * ST-AutoPulse Server Plugin
 * Manages timers and queues for character auto-messaging.
 * Runs in Node.js - persists even when the browser is closed.
 */

const path = require('path');
const fs = require('fs');

const PLUGIN_ID = 'autopulse';
const DATA_DIR = path.join(__dirname);
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const QUEUE_FILE = path.join(DATA_DIR, 'queue.json');

/** @type {Map<string, NodeJS.Timeout>} Active interval timers */
const activeTimers = new Map();

/** @type {Set<import('express').Response>} Connected SSE clients */
const sseClients = new Set();

/** @type {Array<object>} Pending events for polling clients */
const pendingEvents = [];

function createEventId() {
    return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Data Persistence ────────────────────────────────────────────────

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
        }
    } catch (e) {
        console.error('[AutoPulse] Failed to load data:', e);
    }
    return { timers: {}, scheduledTasks: {} };
}

function saveData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        console.error('[AutoPulse] Failed to save data:', e);
    }
}

function loadQueue() {
    try {
        if (fs.existsSync(QUEUE_FILE)) {
            return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8'));
        }
    } catch (e) {
        console.error('[AutoPulse] Failed to load queue:', e);
    }
    return [];
}

function saveQueue(queue) {
    try {
        fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2), 'utf-8');
    } catch (e) {
        console.error('[AutoPulse] Failed to save queue:', e);
    }
}

function acknowledgeQueueEvents(eventIds) {
    if (!Array.isArray(eventIds) || eventIds.length === 0) {
        return 0;
    }

    const ids = new Set(eventIds.map(String));
    const queue = loadQueue();
    const nextQueue = queue.filter(event => !ids.has(String(event.id)));
    const removed = queue.length - nextQueue.length;

    if (removed > 0) {
        saveQueue(nextQueue);
    }

    return removed;
}

// ─── SSE Broadcasting ────────────────────────────────────────────────

/**
 * Send an event to all connected SSE clients, or queue it if none connected.
 * @param {string} eventType
 * @param {object} data
 */
function broadcastOrQueue(eventType, data) {
    const event = {
        id: createEventId(),
        type: eventType,
        data: data,
        timestamp: Date.now(),
    };

    if (sseClients.size > 0) {
        const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
        for (const client of sseClients) {
            try {
                client.write(message);
            } catch (e) {
                sseClients.delete(client);
            }
        }
        console.log(`[AutoPulse] Broadcasted "${eventType}" to ${sseClients.size} client(s)`);
    } else {
        // No SSE clients connected, check pending events for polling
        pendingEvents.push(event);
        console.log(`[AutoPulse] Event pushed to pending queue for polling (size: ${pendingEvents.length})`);
    }

    // Always persist to offline queue as backup
    const queue = loadQueue();
    queue.push(event);
    saveQueue(queue);
    console.log(`[AutoPulse] Event persisted to offline queue (size: ${queue.length})`);
}

// ─── Timer Management ────────────────────────────────────────────────

/**
 * Start a timer with the given configuration.
 * @param {string} id Timer ID
 * @param {object} config Timer configuration
 */
const DEFAULT_PRESSURE_MULTIPLIERS = [1.0, 0.7, 0.5, 0.3, 0.2];

function updateTimerState(id, patch) {
    const data = loadData();
    if (!data.timers || !data.timers[id]) return;
    data.timers[id] = {
        ...data.timers[id],
        ...patch,
        updatedAt: Date.now(),
    };
    saveData(data);
}

function startTimer(id, config) {
    // Clear existing timer if any
    if (activeTimers.has(id)) {
        clearTimeout(activeTimers.get(id));
        activeTimers.delete(id);
    }

    if (!config.enabled) {
        console.log(`[AutoPulse] Timer "${id}" is disabled, not starting.`);
        return;
    }

    const baseMinutes = config.intervalMinutes || 30;
    const multipliers = config.pressureMultipliers || DEFAULT_PRESSURE_MULTIPLIERS;
    const maxPressureLevel = Number(config.pressureMaxLevel) || 4;
    let pressureLevel = Number(config.pressureLevel) || 0;

    const scheduleNext = () => {
        const multiplier = multipliers[Math.min(pressureLevel, multipliers.length - 1)] || 1.0;
        const actualMinutes = Math.max(1, Math.round(baseMinutes * multiplier));
        const intervalMs = actualMinutes * 60 * 1000;
        const nextTriggerAt = Date.now() + intervalMs;

        updateTimerState(id, {
            pressureLevel,
            pressureMaxLevel: maxPressureLevel,
            pressureMultipliers: multipliers,
            actualIntervalMinutes: actualMinutes,
            intervalMs,
            startedAt: Date.now(),
            nextTriggerAt,
        });

        const timer = setTimeout(() => {
            console.log(`[AutoPulse] Timer "${id}" fired! (pressure: ${pressureLevel}, interval: ${actualMinutes}min)`);
            const firedPressureLevel = pressureLevel;

            broadcastOrQueue('timer_trigger', {
                timerId: id,
                characterId: config.characterId ?? null,
                prompt: config.prompt || '',
                intervalMinutes: actualMinutes,
                pressureLevel: firedPressureLevel,
            });

            pressureLevel = Math.min(maxPressureLevel, pressureLevel + 1);
            updateTimerState(id, {
                lastTriggeredAt: Date.now(),
                pressureLevel,
                actualIntervalMinutes: actualMinutes,
                intervalMs,
            });

            scheduleNext();
        }, intervalMs);

        activeTimers.set(id, timer);
        console.log(`[AutoPulse] Timer "${id}" scheduled, base: ${baseMinutes}min, pressure: ${pressureLevel}, actual: ${actualMinutes}min`);
    };

    scheduleNext();
}

/**
 * Stop a specific timer.
 * @param {string} id Timer ID
 */
function stopTimer(id) {
    if (activeTimers.has(id)) {
        clearInterval(activeTimers.get(id));
        activeTimers.delete(id);
        console.log(`[AutoPulse] Timer "${id}" stopped.`);
    }
}

/**
 * Reset a timer (restart the countdown).
 * @param {string} id Timer ID
 */
function resetTimer(id) {
    const data = loadData();
    if (data.timers[id]) {
        startTimer(id, data.timers[id]);
    }
}

// ─── Scheduled Tasks ─────────────────────────────────────────────────

/** @type {NodeJS.Timeout|null} */
let scheduledTaskChecker = null;

/**
 * Check scheduled tasks every minute and fire if the time matches.
 */
function startScheduledTaskChecker() {
    if (scheduledTaskChecker) {
        clearInterval(scheduledTaskChecker);
    }

    scheduledTaskChecker = setInterval(() => {
        const data = loadData();
        const now = new Date();
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const currentDay = now.getDay(); // 0=Sun, 1=Mon, ...

        for (const [id, task] of Object.entries(data.scheduledTasks || {})) {
            if (!task.enabled) continue;

            let shouldFire = false;

            if (task.time === currentTime) {
                switch (task.repeatType) {
                    case 'daily':
                        shouldFire = true;
                        break;
                    case 'weekly':
                        shouldFire = (task.weekday === currentDay);
                        break;
                    case 'once':
                        if (task.date) {
                            const taskDate = new Date(task.date);
                            shouldFire = (
                                taskDate.getFullYear() === now.getFullYear() &&
                                taskDate.getMonth() === now.getMonth() &&
                                taskDate.getDate() === now.getDate()
                            );
                        }
                        break;
                }
            }

            if (shouldFire) {
                // Check if we already fired this minute (avoid duplicate fires)
                const lastFiredKey = `_lastFired_${id}`;
                const lastFired = data[lastFiredKey];
                const nowMinuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;

                if (lastFired === nowMinuteKey) continue;

                data[lastFiredKey] = nowMinuteKey;
                saveData(data);

                console.log(`[AutoPulse] Scheduled task "${task.name}" (${id}) fired!`);
                broadcastOrQueue('scheduled_task_trigger', {
                    taskId: id,
                    taskName: task.name,
                    characterId: task.characterId ?? null,
                    prompt: task.prompt || '',
                });

                // Disable one-time tasks after firing
                if (task.repeatType === 'once') {
                    data.scheduledTasks[id].enabled = false;
                    saveData(data);
                }
            }
        }
    }, 60 * 1000); // Check every minute

    console.log('[AutoPulse] Scheduled task checker started (checking every 60s)');
}

// ─── Restore timers on startup ───────────────────────────────────────

function restoreTimers() {
    const data = loadData();
    for (const [id, config] of Object.entries(data.timers || {})) {
        startTimer(id, config);
    }
    console.log(`[AutoPulse] Restored ${Object.keys(data.timers || {}).length} timer(s) from saved data.`);
}



// ─── Plugin Init / Exit ──────────────────────────────────────────────

/**
 * @param {import('express').Router} router
 */
async function init(router) {
    console.log('[AutoPulse] Initializing server plugin...');

    // ─── SSE Stream ──────────────────────────────────────────
    router.get('/stream', (req, res) => {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        });

        // Send initial heartbeat
        res.write(`event: connected\ndata: ${JSON.stringify({ message: 'AutoPulse SSE connected' })}\n\n`);

        sseClients.add(res);
        console.log(`[AutoPulse] SSE client connected (total: ${sseClients.size})`);

        req.on('close', () => {
            sseClients.delete(res);
            console.log(`[AutoPulse] SSE client disconnected (total: ${sseClients.size})`);
        });
    });

    // ─── Timers ──────────────────────────────────────────────

    // GET /timers - list all timers
    router.get('/timers', (req, res) => {
        const data = loadData();
        res.json(data.timers || {});
    });

    // POST /timers - create or update a timer
    router.post('/timers', (req, res) => {
        const { id, intervalMinutes, prompt, enabled } = req.body;
        if (!id) {
            return res.status(400).json({ error: 'Timer ID is required' });
        }

        const data = loadData();
        data.timers = data.timers || {};
        data.timers[id] = {
            intervalMinutes: Number(intervalMinutes) || 30,
            prompt: prompt || '',
            enabled: enabled !== false,
            characterId: req.body.characterId ?? null,
            pressureLevel: Number(req.body.pressureLevel) || 0,
            pressureMaxLevel: Number(req.body.pressureMaxLevel) || 4,
            pressureMultipliers: req.body.pressureMultipliers || null,
            updatedAt: Date.now(),
        };
        saveData(data);

        if (data.timers[id].enabled) {
            startTimer(id, data.timers[id]);
        } else {
            stopTimer(id);
        }

        res.json({ success: true, timer: data.timers[id] });
    });

    // DELETE /timers/:id - delete a timer
    router.delete('/timers/:id', (req, res) => {
        const { id } = req.params;
        const data = loadData();

        stopTimer(id);

        if (data.timers && data.timers[id]) {
            delete data.timers[id];
            saveData(data);
        }

        res.json({ success: true });
    });

    // POST /timers/:id/reset - reset a timer's countdown
    router.post('/timers/:id/reset', (req, res) => {
        const { id } = req.params;
        resetTimer(id);
        res.json({ success: true });
    });

    // ─── Scheduled Tasks ─────────────────────────────────────

    // GET /tasks - list all scheduled tasks
    router.get('/tasks', (req, res) => {
        const data = loadData();
        res.json(data.scheduledTasks || {});
    });

    // POST /tasks - create or update a scheduled task
    router.post('/tasks', (req, res) => {
        const { id, name, time, repeatType, weekday, date, prompt, enabled } = req.body;
        if (!id) {
            return res.status(400).json({ error: 'Task ID is required' });
        }

        const data = loadData();
        data.scheduledTasks = data.scheduledTasks || {};
        data.scheduledTasks[id] = {
            name: name || 'Unnamed Task',
            time: time || '09:00',
            repeatType: repeatType || 'daily',
            weekday: weekday !== undefined ? Number(weekday) : 1,
            date: date || null,
            prompt: prompt || '',
            characterId: req.body.characterId ?? null,
            enabled: enabled !== false,
            updatedAt: Date.now(),
        };
        saveData(data);

        res.json({ success: true, task: data.scheduledTasks[id] });
    });

    // DELETE /tasks/:id - delete a scheduled task
    router.delete('/tasks/:id', (req, res) => {
        const { id } = req.params;
        const data = loadData();

        if (data.scheduledTasks && data.scheduledTasks[id]) {
            delete data.scheduledTasks[id];
            saveData(data);
        }

        res.json({ success: true });
    });

    // ─── Queue ───────────────────────────────────────────────

    // GET /queue - get pending events (offline queue from disk)
    router.get('/queue', (req, res) => {
        const queue = loadQueue();
        res.json(queue);
    });

    // DELETE /queue - clear the offline queue
    router.delete('/queue', (req, res) => {
        saveQueue([]);
        res.json({ success: true });
    });

    router.post('/queue/ack', (req, res) => {
        const removed = acknowledgeQueueEvents(req.body?.eventIds);
        res.json({ success: true, removed });
    });

    // ─── Polling Endpoint ────────────────────────────────────

    // GET /pending - get and clear pending events (for polling clients)
    router.get('/pending', (req, res) => {
        const events = pendingEvents.splice(0, pendingEvents.length);
        res.json({ events, serverTime: Date.now() });
    });

    // ─── Status ──────────────────────────────────────────────

    router.get('/status', (req, res) => {
        const data = loadData();
        res.json({
            activeTimers: Array.from(activeTimers.keys()),
            sseClients: sseClients.size,
            queueSize: loadQueue().length,
            timers: data.timers || {},
            scheduledTasks: data.scheduledTasks || {},
        });
    });
    // Restore saved timers and start task checker
    restoreTimers();
    startScheduledTaskChecker();

    // ─── Jealousy Per-Character Config ──────────────────────
    const JEALOUSY_CONFIG_DIR = path.join(DATA_DIR, 'jealousy-configs');
    if (!fs.existsSync(JEALOUSY_CONFIG_DIR)) {
        fs.mkdirSync(JEALOUSY_CONFIG_DIR, { recursive: true });
    }

    // GET /jealousy-configs - list all character configs
    router.get('/jealousy-configs', (req, res) => {
        try {
            const files = fs.readdirSync(JEALOUSY_CONFIG_DIR).filter(f => f.endsWith('.json'));
            const configs = {};
            for (const file of files) {
                const charId = path.basename(file, '.json');
                try {
                    configs[charId] = JSON.parse(fs.readFileSync(path.join(JEALOUSY_CONFIG_DIR, file), 'utf-8'));
                } catch (e) { /* skip malformed */ }
            }
            res.json({ success: true, configs });
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // GET /jealousy-config/:charId - read one character's config
    router.get('/jealousy-config/:charId', (req, res) => {
        const filePath = path.join(JEALOUSY_CONFIG_DIR, `${req.params.charId}.json`);
        if (!fs.existsSync(filePath)) {
            return res.json({ success: true, config: null });
        }
        try {
            const config = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            res.json({ success: true, config });
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // PUT /jealousy-config/:charId - save/update config
    router.put('/jealousy-config/:charId', (req, res) => {
        const filePath = path.join(JEALOUSY_CONFIG_DIR, `${req.params.charId}.json`);
        try {
            const config = req.body;
            fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
            console.log(`[AutoPulse] Saved jealousy config for char ${req.params.charId}`);
            res.json({ success: true });
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // DELETE /jealousy-config/:charId - remove config
    router.delete('/jealousy-config/:charId', (req, res) => {
        const filePath = path.join(JEALOUSY_CONFIG_DIR, `${req.params.charId}.json`);
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`[AutoPulse] Deleted jealousy config for char ${req.params.charId}`);
            }
            res.json({ success: true });
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    console.log('[AutoPulse] Server plugin initialized successfully!');
}

async function exit() {
    console.log('[AutoPulse] Shutting down...');

    // Clear all timers
    for (const [id, timer] of activeTimers) {
        clearInterval(timer);
    }
    activeTimers.clear();

    // Clear scheduled task checker
    if (scheduledTaskChecker) {
        clearInterval(scheduledTaskChecker);
        scheduledTaskChecker = null;
    }

    // Close all SSE connections
    for (const client of sseClients) {
        try { client.end(); } catch (e) { /* ignore */ }
    }
    sseClients.clear();



    console.log('[AutoPulse] Server plugin shut down.');
}

module.exports = {
    init,
    exit,
    info: {
        id: 'autopulse',
        name: 'ST-AutoPulse',
        description: 'Background timer management for character auto-messaging. Keeps timers running even when the browser is closed.',
    },
};
