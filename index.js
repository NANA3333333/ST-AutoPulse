/**
 * ST-AutoPulse - UI Extension
 * Connects to the AutoPulse server plugin to receive timer events
 * and generate character messages in the chat.
 */

const MODULE_NAME = 'ST-AutoPulse';
const PLUGIN_ID = 'autopulse';
const API_BASE = `/api/plugins/${PLUGIN_ID}`;

// ─── Default Settings ────────────────────────────────────────────────

const DEFAULT_SETTINGS = Object.freeze({
    enabled: false,
    intervalMinutes: 30,
    prompt: '',
    notifyDesktop: true,
    lastTimerId: 'default',
    // Pressure system
    pressureEnabled: false,
    pressureMaxLevel: 4,
    pressureReturnEnabled: true,
    // Jealousy system
    jealousyEnabled: false,
    jealousyChance: 50,
    jealousyDelayMin: 30,
    jealousyDelayMax: 120,
    jealousyCharacters: [], // Array of character IDs that can get jealous (empty = none)
    jealousyPrompt: '', // Custom jealousy prompt (empty = use default)
});

const DEFAULT_PROMPT = '一段时间过去了。请根据当前的对话上下文、角色性格和背景设定，以角色的身份主动向用户发送一条自然的消息。这条消息应该像是角色在想到用户时自然地发出的，可以是问候、分享日常、表达关心、或延续之前的话题。请保持角色的语气和风格一致。';

// ─── Pressure System Prompts ─────────────────────────────────────────

const PRESSURE_MULTIPLIERS = [1.0, 0.7, 0.5, 0.3, 0.2];

const PRESSURE_PROMPTS = [
    '', // Level 0: normal
    '（[情绪背景：你开始有些想念对方了，有一小段时间没有收到回复。]）\n',
    '（[情绪背景：你已经有一段时间没收到对方回复了，心里开始担心，想知道对方是否还好。]）\n',
    '（[情绪背景：你已经等了很久很久，焦虑不安，忍不住想要再次联系对方。]）\n',
    '（[情绪背景：你几乎无法忍受这漫长的等待，情绪已经到达极限，急切地想得到回应。]）\n',
];

const RETURN_PROMPTS = [
    '', // Level 0: no special reaction
    '（[情绪背景：对方终于回复了！你感到开心和轻松，被安抚了。]）\n',
    '（[情绪背景：对方终于回复了，你松了口气，但心里有些小小的抱怨，带着轻微的撒娇语气。]）\n',
    '（[情绪背景：对方终于回复了！你又高兴又有些生气，觉得自己被冷落了，想要更多的关注和安慰。]）\n',
    '（[情绪背景：对方终于回复了，但你很生气被冷落了这么久。你的情绪复杂——想要原谅但又忍不住表达不满。]）\n',
];

const JEALOUSY_PROMPT = '[OOC指令：暂时中断当前RP格式。你现在需要发送一条简短的即时消息（像微信/QQ/短信），不是写小说，不是RP。禁止使用动作描写、心理描写、环境描写、括号动作。只输出角色说的话，1-2句以内，口语化，像真人发消息一样。情境：你发现对方在和别人聊天，你感到嫉妒。]\n';

// ─── State Variables ─────────────────────────────────────────────────

let pollingInterval = null;
let pollWorker = null;
let isConnected = false;
let isGenerating = false;
let nextTriggerTime = null;
let countdownInterval = null;
let useFallbackMode = false;
let fallbackTimerInterval = null;
const POLL_INTERVAL_MS = 5000;

// Pressure system state
let pressureLevel = 0;
let lastUserMessageTime = Date.now();
let pendingReturnReaction = false;
let returnReactionLevel = 0;

// Jealousy system state
let previousCharacterId = null;
let jealousyTimeout = null;

// ─── Helpers ─────────────────────────────────────────────────────────

function getSettings() {
    const ctx = SillyTavern.getContext();
    if (!ctx.extensionSettings[MODULE_NAME]) {
        ctx.extensionSettings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
    }
    const settings = ctx.extensionSettings[MODULE_NAME];
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (!Object.hasOwn(settings, key)) {
            settings[key] = DEFAULT_SETTINGS[key];
        }
    }
    return settings;
}

function saveSettings() {
    const ctx = SillyTavern.getContext();
    ctx.saveSettingsDebounced();
}

/**
 * Make an API request to the server plugin.
 */
async function pluginRequest(endpoint, method = 'GET', body = null) {
    const ctx = SillyTavern.getContext();
    const options = {
        method,
        headers: ctx.getRequestHeaders(),
    };
    if (body) {
        options.body = JSON.stringify(body);
    }
    const response = await fetch(`${API_BASE}${endpoint}`, options);
    if (!response.ok) {
        throw new Error(`Plugin request failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
}

// ─── Polling Connection (Web Worker) ─────────────────────────────────

/**
 * Start polling using a Web Worker (immune to background tab throttling).
 * Falls back to setInterval if Worker is not available.
 */
function startPolling() {
    stopPolling();

    // Initial connection check
    checkServerConnection();

    // Try Web Worker first
    try {
        const workerUrl = new URL(`scripts/extensions/third-party/${MODULE_NAME}/poll-worker.js`, window.location.origin);
        pollWorker = new Worker(workerUrl);

        pollWorker.onmessage = async (e) => {
            if (e.data.type === 'tick') {
                await pollForEvents();
            }
        };

        pollWorker.onerror = (e) => {
            console.warn('[AutoPulse] Web Worker error, falling back to setInterval:', e.message);
            stopPolling();
            startPollingFallback();
        };

        pollWorker.postMessage({ command: 'start', interval: POLL_INTERVAL_MS });
        console.log(`[AutoPulse] Polling started via Web Worker (every ${POLL_INTERVAL_MS / 1000}s) — background-safe!`);
    } catch (e) {
        console.warn('[AutoPulse] Web Worker not available, using setInterval fallback:', e.message);
        startPollingFallback();
    }
}

/**
 * Fallback polling with setInterval (throttled in background tabs).
 */
function startPollingFallback() {
    stopPolling();
    pollingInterval = setInterval(async () => {
        await pollForEvents();
    }, POLL_INTERVAL_MS);
    console.log(`[AutoPulse] Polling started via setInterval fallback (every ${POLL_INTERVAL_MS / 1000}s)`);
}

function stopPolling() {
    if (pollWorker) {
        pollWorker.postMessage({ command: 'stop' });
        pollWorker.terminate();
        pollWorker = null;
    }
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
}

/**
 * Check if the server plugin is reachable.
 */
async function checkServerConnection() {
    try {
        await pluginRequest('/status');
        if (!isConnected) {
            isConnected = true;
            updateStatusUI('connected');
            console.log('[AutoPulse] Server plugin connected');
        }
    } catch (e) {
        if (isConnected) {
            isConnected = false;
            updateStatusUI('disconnected');
            console.warn('[AutoPulse] Server plugin disconnected');
        }
    }
}

/**
 * Poll for pending events from the server plugin.
 */
async function pollForEvents() {
    try {
        const response = await pluginRequest('/pending');

        if (!isConnected) {
            isConnected = true;
            updateStatusUI('connected');
        }

        if (response.events && response.events.length > 0) {
            console.log(`[AutoPulse] Received ${response.events.length} event(s) from server`);

            for (const event of response.events) {
                if (event.type === 'timer_trigger') {
                    const data = event.data;
                    console.log('[AutoPulse] Timer triggered:', data);
                    await handleTrigger(data.prompt, `定时消息 (每${data.intervalMinutes}分钟)`);
                } else if (event.type === 'scheduled_task_trigger') {
                    const data = event.data;
                    console.log('[AutoPulse] Scheduled task triggered:', data);
                    await handleTrigger(data.prompt, `定时任务: ${data.taskName}`);
                }
            }
        }
    } catch (e) {
        if (isConnected) {
            isConnected = false;
            updateStatusUI('disconnected');
            console.warn('[AutoPulse] Polling failed:', e.message);
        }
    }
}

// ─── API Compatibility ───────────────────────────────────────────────

/**
 * Wrapper for generateQuietPrompt that handles different ST versions.
 * New versions use object args, old versions may use string args.
 */
async function callGenerateQuietPrompt(prompt, options = {}) {
    const ctx = SillyTavern.getContext();

    if (typeof ctx.generateQuietPrompt === 'function') {
        try {
            // New API: object arguments (ST 1.13.2+)
            return await ctx.generateQuietPrompt({
                quietPrompt: prompt,
                skipWIAN: options.skipWIAN ?? false,
                quietImage: options.quietImage ?? null,
                forceChId: options.forceChId ?? null,
                ...options,
            });
        } catch (e) {
            // Fallback: try string argument (older ST versions)
            console.warn('[AutoPulse] Object args failed, trying string args:', e.message);
            try {
                return await ctx.generateQuietPrompt(prompt);
            } catch (e2) {
                throw new Error(`generateQuietPrompt failed: ${e2.message}`);
            }
        }
    }

    throw new Error('generateQuietPrompt is not available in this ST version');
}

// ─── Message Generation ──────────────────────────────────────────────

/**
 * Handle a trigger event: generate a message from the character.
 * Integrates pressure system for emotional context.
 * @param {string} customPrompt Custom prompt override
 * @param {string} source Description of what triggered this
 */
async function handleTrigger(customPrompt, source = '自动消息') {
    if (isGenerating) {
        console.log('[AutoPulse] Already generating, skipping trigger');
        return;
    }

    const ctx = SillyTavern.getContext();

    // Check if there's an active chat
    if (!ctx.characterId && !ctx.groupId) {
        console.log('[AutoPulse] No active chat, skipping trigger');
        return;
    }

    // Check if chat exists
    if (!ctx.chat || ctx.chat.length === 0) {
        console.log('[AutoPulse] Empty chat, skipping trigger');
        return;
    }

    const settings = getSettings();
    let prompt = customPrompt || settings.prompt || DEFAULT_PROMPT;

    // Inject pressure emotion into prompt if pressure system is enabled
    if (settings.pressureEnabled && pressureLevel > 0) {
        const pressurePrompt = PRESSURE_PROMPTS[Math.min(pressureLevel, PRESSURE_PROMPTS.length - 1)] || '';
        prompt = pressurePrompt + prompt;
        console.log(`[AutoPulse] Pressure level ${pressureLevel}, injecting emotional context`);
    }

    isGenerating = true;
    console.log(`[AutoPulse] Generating message (source: ${source}, pressure: ${pressureLevel})...`);

    try {
        const result = await callGenerateQuietPrompt(prompt);

        if (!result || result.trim().length === 0) {
            console.warn('[AutoPulse] Generated empty response, skipping');
            return;
        }

        // Build the message object
        const messageText = result.trim();
        const message = {
            name: ctx.name2,
            is_user: false,
            mes: messageText,
            force_avatar: ctx.getThumbnailUrl('avatar', ctx.characters[ctx.characterId]?.avatar),
            extra: {
                autopulse: true,
                autopulse_source: source,
                autopulse_timestamp: Date.now(),
                autopulse_pressure: pressureLevel,
            },
        };

        // Add the message to the chat
        ctx.chat.push(message);
        const messageId = ctx.chat.length - 1;
        ctx.addOneMessage(message, { insertAfter: messageId - 1 });

        // Save the chat
        await ctx.saveChat();

        console.log(`[AutoPulse] Message generated and added to chat: "${messageText.substring(0, 50)}..."`);

        // Show toast notification
        toastr.info(`${ctx.name2} 主动发了消息`, 'AutoPulse', { timeOut: 3000 });

        // Desktop notification
        if (settings.notifyDesktop) {
            sendDesktopNotification(ctx.name2, messageText);
        }

        // Escalate pressure if enabled (user still hasn't replied)
        if (settings.pressureEnabled) {
            const maxLevel = settings.pressureMaxLevel || 4;
            if (pressureLevel < maxLevel) {
                pressureLevel++;
                console.log(`[AutoPulse] Pressure escalated to level ${pressureLevel}`);
                updatePressureDisplay();
            }
            // Sync updated pressure to server for dynamic interval
            syncTimerToServer();
        }

        // Reset the timer countdown
        updateNextTriggerTime();

    } catch (e) {
        console.error('[AutoPulse] Failed to generate message:', e);
        toastr.error(`消息生成失败: ${e.message}`, 'AutoPulse');
    } finally {
        isGenerating = false;
    }
}

/**
 * Handle return reaction when user replies after being away.
 * Triggered once after user sends a message while pressure > 0.
 */
async function handleReturnReaction() {
    if (!pendingReturnReaction) return;
    if (isGenerating) {
        // Wait and retry if already generating a message
        setTimeout(handleReturnReaction, 1000);
        return;
    }

    const ctx = SillyTavern.getContext();
    const settings = getSettings();

    if (!settings.pressureEnabled || !settings.pressureReturnEnabled) {
        pendingReturnReaction = false;
        return;
    }

    if (!ctx.characterId && !ctx.groupId) return;
    if (!ctx.chat || ctx.chat.length === 0) return;

    const returnPrompt = RETURN_PROMPTS[Math.min(returnReactionLevel, RETURN_PROMPTS.length - 1)] || '';
    if (!returnPrompt) {
        pendingReturnReaction = false;
        return;
    }

    const basePrompt = settings.prompt || DEFAULT_PROMPT;
    const prompt = returnPrompt + basePrompt;

    pendingReturnReaction = false;
    console.log(`[AutoPulse] Generating return reaction (was pressure level ${returnReactionLevel})`);

    isGenerating = true;
    try {
        const result = await callGenerateQuietPrompt(prompt);

        if (!result || result.trim().length === 0) return;

        const messageText = result.trim();
        const message = {
            name: ctx.name2,
            is_user: false,
            mes: messageText,
            force_avatar: ctx.getThumbnailUrl('avatar', ctx.characters[ctx.characterId]?.avatar),
            extra: {
                autopulse: true,
                autopulse_source: `回归反应 (压力等级${returnReactionLevel})`,
                autopulse_timestamp: Date.now(),
            },
        };

        ctx.chat.push(message);
        const messageId = ctx.chat.length - 1;
        ctx.addOneMessage(message, { insertAfter: messageId - 1 });
        await ctx.saveChat();

        console.log(`[AutoPulse] Return reaction sent: "${messageText.substring(0, 50)}..."`);
        toastr.info(`${ctx.name2} 对你的回归做出了反应`, 'AutoPulse', { timeOut: 3000 });

    } catch (e) {
        console.error('[AutoPulse] Failed to generate return reaction:', e);
    } finally {
        isGenerating = false;
    }
}

/**
 * Update the pressure level display in settings UI.
 */
function updatePressureDisplay() {
    const settings = getSettings();
    const max = settings.pressureMaxLevel || 4;

    let emoji = '😊';
    if (pressureLevel >= max) emoji = '💢';
    else if (pressureLevel >= max - 1) emoji = '😠';
    else if (pressureLevel >= 2) emoji = '😰';
    else if (pressureLevel >= 1) emoji = '🥺';

    $('#autopulse_pressure_display').text(`${emoji} 等级 ${pressureLevel}`);

    // Color logic
    if (pressureLevel === 0) $('#autopulse_pressure_display').css('color', '');
    else if (pressureLevel === 1) $('#autopulse_pressure_display').css('color', '#ffb74d'); // Orange
    else if (pressureLevel === 2) $('#autopulse_pressure_display').css('color', '#ff9800'); // Dark orange
    else if (pressureLevel === 3) $('#autopulse_pressure_display').css('color', '#f44336'); // Red
    else $('#autopulse_pressure_display').css('color', '#d32f2f'); // Dark red
}

// ─── Desktop Notifications ───────────────────────────────────────────

function sendDesktopNotification(characterName, message) {
    if (!('Notification' in window)) return;

    if (Notification.permission === 'granted') {
        new Notification(`${characterName} 发来了消息`, {
            body: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
            icon: '/favicon.ico',
            tag: 'autopulse',
        });
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(perm => {
            if (perm === 'granted') {
                sendDesktopNotification(characterName, message);
            }
        });
    }
}

// ─── Jealousy Floating Window ────────────────────────────────────────

/**
 * Try to trigger a jealousy message from the previous character.
 * Called when user switches to a different chat.
 * @param {string} prevCharId The character ID that was left
 */
function tryTriggerJealousy(prevCharId) {
    const settings = getSettings();
    if (!settings.jealousyEnabled || !prevCharId) return;

    // Check if this character is in the jealousy whitelist
    const allowedChars = settings.jealousyCharacters || [];
    if (allowedChars.length === 0) {
        console.log('[AutoPulse] Jealousy: no characters selected, skipping');
        return;
    }
    if (!allowedChars.includes(String(prevCharId))) {
        console.log(`[AutoPulse] Jealousy: character ${prevCharId} not in whitelist, skipping`);
        return;
    }

    // Cancel any existing jealousy timeout
    if (jealousyTimeout) {
        clearTimeout(jealousyTimeout);
        jealousyTimeout = null;
    }

    // Roll the dice
    const chance = (settings.jealousyChance || 50) / 100;
    if (Math.random() > chance) {
        console.log('[AutoPulse] Jealousy roll failed, skipping');
        return;
    }

    // Random delay
    const minDelay = (settings.jealousyDelayMin || 30) * 1000;
    const maxDelay = (settings.jealousyDelayMax || 120) * 1000;
    const delay = minDelay + Math.random() * (maxDelay - minDelay);

    console.log(`[AutoPulse] Jealousy triggered for character ${prevCharId}, firing in ${Math.round(delay / 1000)}s`);

    jealousyTimeout = setTimeout(async () => {
        await generateJealousyMessage(prevCharId);
    }, delay);
}

/**
 * Generate and display a jealousy message from a specific character.
 * @param {string} characterId The jealous character's ID
 */
async function generateJealousyMessage(characterId) {
    if (isGenerating) {
        console.log('[AutoPulse] Already generating, skipping jealousy');
        toastr.warning('正在生成中，请稍候再试', 'AutoPulse');
        return;
    }

    const ctx = SillyTavern.getContext();
    const character = ctx.characters[characterId];
    if (!character) {
        console.warn('[AutoPulse] Character not found for jealousy:', characterId);
        toastr.error('找不到角色', 'AutoPulse');
        return;
    }

    const settings = getSettings();
    const prompt = settings.jealousyPrompt?.trim() || JEALOUSY_PROMPT;
    console.log('[AutoPulse] Using jealousy prompt:', prompt.substring(0, 60) + '...');

    console.log(`[AutoPulse] Generating jealousy message from ${character.name} (id: ${characterId})...`);

    isGenerating = true;
    try {
        // Use forceChId only if the character is NOT the current one
        const options = { responseLength: 150, removeReasoning: true, trimToSentence: true };
        if (String(characterId) !== String(ctx.characterId)) {
            options.forceChId = characterId;
        }

        let result = await callGenerateQuietPrompt(prompt, options);
        console.log('[AutoPulse] Jealousy raw result:', result);

        if (!result || result.trim().length === 0) {
            console.warn('[AutoPulse] Jealousy message empty, skipping');
            toastr.warning('嫉妒消息生成为空', 'AutoPulse');
            return;
        }

        // Post-process: strip CoT / thinking tags that some presets inject
        let cleaned = result
            .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
            .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
            .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
            .replace(/<chain_of_thought>[\s\S]*?<\/chain_of_thought>/gi, '')
            .replace(/<内心[\s\S]*?>[\s\S]*?<\/内心[\s\S]*?>/gi, '')
            .replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi, '')
            .trim();

        // If still contains asterisk actions like *blushes*, strip them
        cleaned = cleaned.replace(/\*[^*]+\*/g, '').trim();

        // Take only the last meaningful line if there are multiple lines (CoT often before the actual reply)
        const lines = cleaned.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length > 2) {
            // Likely has CoT remnants, take last 1-2 lines
            cleaned = lines.slice(-2).join('\n');
        }

        // Strip quotes if the whole thing is wrapped in quotes
        cleaned = cleaned.replace(/^["「『"]([\s\S]+)["」』"]$/, '$1').trim();

        if (!cleaned) {
            console.warn('[AutoPulse] Jealousy message empty after cleanup');
            toastr.warning('嫉妒消息清理后为空', 'AutoPulse');
            return;
        }

        const messageText = cleaned;

        // Show floating notification
        try {
            const avatarUrl = ctx.getThumbnailUrl('avatar', character.avatar);
            console.log('[AutoPulse] Showing jealousy popup:', character.name, avatarUrl);
            showJealousyPopup(character.name, avatarUrl, messageText);
        } catch (popupErr) {
            console.error('[AutoPulse] Popup creation failed:', popupErr);
        }

        // Toast notification
        toastr.info(`${character.name} 看起来有点嫉妒...`, 'AutoPulse 💢', { timeOut: 5000 });

        // Desktop notification
        const settings = getSettings();
        if (settings.notifyDesktop) {
            sendDesktopNotification(character.name, messageText);
        }

        console.log(`[AutoPulse] Jealousy message sent: "${messageText.substring(0, 80)}"`);

    } catch (e) {
        console.error('[AutoPulse] Failed to generate jealousy message:', e);
        toastr.error(`嫉妒消息生成失败: ${e.message}`, 'AutoPulse');
    } finally {
        isGenerating = false;
    }
}

/**
 * Show a floating notification popup for jealousy messages.
 * @param {string} name Character name
 * @param {string} avatarUrl Character avatar URL
 * @param {string} message The jealousy message text
 */
function showJealousyPopup(name, avatarUrl, message) {
    // Create container if not exists
    let container = document.getElementById('autopulse_jealousy_container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'autopulse_jealousy_container';
        document.body.appendChild(container);
    }

    // Limit to 3 popups max
    while (container.children.length >= 3) {
        container.removeChild(container.firstChild);
    }

    const popup = document.createElement('div');
    popup.className = 'autopulse-jealousy-popup';
    popup.innerHTML = `
        <div class="autopulse-jealousy-header">
            <img class="autopulse-jealousy-avatar" src="${avatarUrl || '/favicon.ico'}" alt="${escapeHtml(name)}" />
            <span class="autopulse-jealousy-name">${escapeHtml(name)} 💢</span>
            <span class="autopulse-jealousy-close fa-solid fa-xmark"></span>
        </div>
        <div class="autopulse-jealousy-body">${escapeHtml(message).substring(0, 200)}${message.length > 200 ? '...' : ''}</div>
    `;

    // Close button
    popup.querySelector('.autopulse-jealousy-close').addEventListener('click', () => {
        popup.classList.add('autopulse-jealousy-exit');
        setTimeout(() => popup.remove(), 300);
    });

    // Auto-dismiss after 15 seconds
    setTimeout(() => {
        if (popup.parentNode) {
            popup.classList.add('autopulse-jealousy-exit');
            setTimeout(() => popup.remove(), 300);
        }
    }, 15000);

    container.appendChild(popup);
}



async function processOfflineQueue() {
    try {
        const queue = await pluginRequest('/queue');
        if (!queue || queue.length === 0) return;

        console.log(`[AutoPulse] Processing ${queue.length} queued event(s)...`);
        toastr.info(`有 ${queue.length} 条离线消息待处理`, 'AutoPulse');

        for (const event of queue) {
            const prompt = event.data?.prompt || '';
            const source = event.type === 'timer_trigger'
                ? `离线定时消息`
                : `离线定时任务: ${event.data?.taskName || '未知'}`;

            // Wait a bit between messages to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 2000));
            await handleTrigger(prompt, source);
        }

        // Clear the queue
        await pluginRequest('/queue', 'DELETE');
        console.log('[AutoPulse] Queue cleared');
    } catch (e) {
        console.error('[AutoPulse] Failed to process offline queue:', e);
    }
}

// ─── Timer Management ────────────────────────────────────────────────

async function syncTimerToServer() {
    const settings = getSettings();
    try {
        await pluginRequest('/timers', 'POST', {
            id: settings.lastTimerId || 'default',
            intervalMinutes: settings.intervalMinutes,
            prompt: settings.prompt,
            enabled: settings.enabled,
            pressureLevel: settings.pressureEnabled ? pressureLevel : 0,
        });
        console.log(`[AutoPulse] Timer synced to server: ${settings.enabled ? 'ON' : 'OFF'}, interval: ${settings.intervalMinutes}min, pressure: ${pressureLevel}`);
        updateNextTriggerTime();
    } catch (e) {
        console.error('[AutoPulse] Failed to sync timer:', e);
        toastr.error('无法连接到 AutoPulse 服务端插件。请确保已安装并启用 Server Plugin。', 'AutoPulse');
    }
}

async function resetServerTimer() {
    const settings = getSettings();
    try {
        await pluginRequest(`/timers/${settings.lastTimerId || 'default'}/reset`, 'POST');
        updateNextTriggerTime();
    } catch (e) {
        console.error('[AutoPulse] Failed to reset timer:', e);
    }
}

// ─── Countdown Display ──────────────────────────────────────────────

function updateNextTriggerTime() {
    const settings = getSettings();
    if (settings.enabled) {
        nextTriggerTime = Date.now() + (settings.intervalMinutes * 60 * 1000);
        startCountdown();
    } else {
        nextTriggerTime = null;
        stopCountdown();
    }
}

function startCountdown() {
    stopCountdown();
    updateCountdownDisplay();
    countdownInterval = setInterval(updateCountdownDisplay, 1000);
    $('#autopulse_timer_info').show();
}

function stopCountdown() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    $('#autopulse_timer_info').hide();
}

function updateCountdownDisplay() {
    if (!nextTriggerTime) {
        $('#autopulse_next_trigger').text('已停止');
        return;
    }

    const remaining = nextTriggerTime - Date.now();
    if (remaining <= 0) {
        $('#autopulse_next_trigger').text('即将触发...');
        return;
    }

    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    $('#autopulse_next_trigger').text(
        `下次触发：${minutes}分${String(seconds).padStart(2, '0')}秒`
    );
}

// ─── Scheduled Tasks UI ─────────────────────────────────────────────

async function loadTasksUI() {
    try {
        const tasks = await pluginRequest('/tasks');
        const container = $('#autopulse_tasks_list');
        container.empty();

        const taskEntries = Object.entries(tasks);
        if (taskEntries.length === 0) {
            container.append(`
                <div class="autopulse-empty-state" id="autopulse_no_tasks">
                    <span class="fa-regular fa-calendar-xmark"></span>
                    <span>暂无定时任务</span>
                </div>
            `);
            return;
        }

        for (const [id, task] of taskEntries) {
            const repeatLabel = {
                'daily': '每天',
                'weekly': `每周${'日一二三四五六'[task.weekday || 0]}`,
                'once': task.date || '一次性',
            }[task.repeatType] || task.repeatType;

            const item = $(`
                <div class="autopulse-task-item" data-task-id="${id}">
                    <label class="checkbox_label" style="margin:0;">
                        <input type="checkbox" class="autopulse-task-toggle" ${task.enabled ? 'checked' : ''} />
                    </label>
                    <div class="autopulse-task-info">
                        <div class="autopulse-task-name">${escapeHtml(task.name)}</div>
                        <div class="autopulse-task-schedule">${task.time} · ${repeatLabel}</div>
                    </div>
                    <div class="autopulse-task-actions">
                        <div class="menu_button autopulse-task-delete" title="删除">
                            <span class="fa-solid fa-trash-can"></span>
                        </div>
                    </div>
                </div>
            `);

            item.find('.autopulse-task-toggle').on('change', async function () {
                task.enabled = this.checked;
                await pluginRequest('/tasks', 'POST', { id, ...task });
                toastr.success(`任务 "${task.name}" 已${task.enabled ? '启用' : '禁用'}`, 'AutoPulse');
            });

            item.find('.autopulse-task-delete').on('click', async () => {
                await pluginRequest(`/tasks/${id}`, 'DELETE');
                toastr.success(`任务 "${task.name}" 已删除`, 'AutoPulse');
                loadTasksUI();
            });

            container.append(item);
        }
    } catch (e) {
        console.error('[AutoPulse] Failed to load tasks:', e);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Populate the jealousy character picker with checkboxes.
 */
function loadJealousyCharacterPicker() {
    const ctx = SillyTavern.getContext();
    const settings = getSettings();
    const container = $('#autopulse_jealousy_chars');
    container.empty();

    const characters = ctx.characters || [];
    if (characters.length === 0) {
        container.html('<span class="autopulse-hint">没有找到角色</span>');
        return;
    }

    const selectedIds = settings.jealousyCharacters || [];

    characters.forEach((char, idx) => {
        if (!char || !char.name) return;
        const charId = String(idx);
        const isChecked = selectedIds.includes(charId);
        const avatarUrl = ctx.getThumbnailUrl?.('avatar', char.avatar) || '/favicon.ico';

        const chip = $(`
            <label class="autopulse-char-chip ${isChecked ? 'selected' : ''}" title="${escapeHtml(char.name)}">
                <input type="checkbox" value="${charId}" ${isChecked ? 'checked' : ''} style="display:none" />
                <img class="autopulse-char-chip-avatar" src="${avatarUrl}" alt="" />
                <span class="autopulse-char-chip-name">${escapeHtml(char.name)}</span>
            </label>
        `);

        chip.find('input').on('change', function () {
            const checked = this.checked;
            const id = this.value;
            chip.toggleClass('selected', checked);

            if (checked && !settings.jealousyCharacters.includes(id)) {
                settings.jealousyCharacters.push(id);
            } else if (!checked) {
                settings.jealousyCharacters = settings.jealousyCharacters.filter(c => c !== id);
            }
            saveSettings();
            console.log('[AutoPulse] Jealousy characters:', settings.jealousyCharacters);
        });

        container.append(chip);
    });
}

// ─── UI Status ───────────────────────────────────────────────────────

function updateStatusUI(status) {
    const dot = $('#autopulse_status_dot');
    const text = $('#autopulse_status_text');

    dot.removeClass('connected disconnected fallback');

    if (status === 'connected') {
        dot.addClass('connected');
        text.text('已连接到服务端');
    } else if (status === 'fallback') {
        dot.addClass('fallback');
        text.text('前端模式（未检测到 Server Plugin，关闭页面后定时器会停止）');
    } else {
        dot.addClass('disconnected');
        text.text('未连接到服务端 (请确保已启用 Server Plugin)');
    }
}

// ─── UI Event Handlers ──────────────────────────────────────────────

function onEnabledChange() {
    const settings = getSettings();
    settings.enabled = $('#autopulse_enabled').prop('checked');
    saveSettings();
    if (useFallbackMode) {
        if (settings.enabled) {
            startFallbackTimer();
        } else {
            stopFallbackTimer();
            stopCountdown();
        }
    } else {
        syncTimerToServer();
    }
}

function onIntervalChange(value) {
    const settings = getSettings();
    const v = Math.max(1, Math.min(180, Number(value) || 30));
    settings.intervalMinutes = v;
    $('#autopulse_interval_range').val(v);
    $('#autopulse_interval_input').val(v);
    saveSettings();
    if (useFallbackMode) {
        if (settings.enabled) {
            startFallbackTimer();
        }
    } else {
        syncTimerToServer();
    }
}

function onPromptChange() {
    const settings = getSettings();
    settings.prompt = $('#autopulse_prompt').val().trim();
    saveSettings();
    // Sync prompt to server timer too
    syncTimerToServer();
}

function onNotifyChange() {
    const settings = getSettings();
    settings.notifyDesktop = $('#autopulse_notify').prop('checked');
    saveSettings();

    // Request notification permission if enabling
    if (settings.notifyDesktop && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

function onTriggerNow() {
    const settings = getSettings();
    handleTrigger(settings.prompt, '手动触发');
}

function onRepeatTypeChange() {
    const val = $('#autopulse_task_repeat').val();
    $('#autopulse_weekday_row').toggle(val === 'weekly');
    $('#autopulse_date_row').toggle(val === 'once');
}

async function onAddTask() {
    const name = $('#autopulse_task_name').val().trim();
    if (!name) {
        toastr.warning('请输入任务名称', 'AutoPulse');
        return;
    }

    const id = 'task_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
    const task = {
        id,
        name,
        time: $('#autopulse_task_time').val() || '09:00',
        repeatType: $('#autopulse_task_repeat').val() || 'daily',
        weekday: Number($('#autopulse_task_weekday').val()) || 1,
        date: $('#autopulse_task_date').val() || null,
        prompt: $('#autopulse_task_prompt').val().trim(),
        enabled: true,
    };

    try {
        await pluginRequest('/tasks', 'POST', task);
        toastr.success(`任务 "${name}" 已添加`, 'AutoPulse');
        // Clear form
        $('#autopulse_task_name').val('');
        $('#autopulse_task_prompt').val('');
        loadTasksUI();
    } catch (e) {
        toastr.error(`添加任务失败: ${e.message}`, 'AutoPulse');
    }
}

// ─── Slash Commands ──────────────────────────────────────────────────

function registerSlashCommands() {
    const ctx = SillyTavern.getContext();

    ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({
        name: 'autopulse',
        callback: async (namedArgs, unnamedArgs) => {
            const subcommand = String(unnamedArgs || '').trim().toLowerCase();
            const settings = getSettings();

            switch (subcommand) {
                case 'on':
                    settings.enabled = true;
                    $('#autopulse_enabled').prop('checked', true);
                    saveSettings();
                    await syncTimerToServer();
                    return '✅ AutoPulse 已启用';

                case 'off':
                    settings.enabled = false;
                    $('#autopulse_enabled').prop('checked', false);
                    saveSettings();
                    await syncTimerToServer();
                    return '⏹ AutoPulse 已禁用';

                case 'trigger':
                    await handleTrigger(settings.prompt, 'Slash 命令触发');
                    return '⚡ 已触发角色消息生成';

                case 'status': {
                    try {
                        const status = await pluginRequest('/status');
                        return `📊 AutoPulse 状态:\n` +
                            `- 启用: ${settings.enabled ? '是' : '否'}\n` +
                            `- 间隔: ${settings.intervalMinutes} 分钟\n` +
                            `- 服务端连接: ${isConnected ? '已连接' : '未连接'}\n` +
                            `- 活跃定时器: ${status.activeTimers?.length || 0}\n` +
                            `- 待处理队列: ${status.queueSize || 0}`;
                    } catch (e) {
                        return `⚠️ 无法获取状态: ${e.message}`;
                    }
                }

                default: {
                    // Check if it's an interval setting: /autopulse 30
                    const num = parseInt(subcommand);
                    if (!isNaN(num) && num >= 1 && num <= 180) {
                        settings.intervalMinutes = num;
                        onIntervalChange(num);
                        return `⏱ 间隔已设置为 ${num} 分钟`;
                    }
                    return '用法: /autopulse [on|off|trigger|status|<分钟数>]';
                }
            }
        },
        helpString: `
            <div>
                控制 AutoPulse 自动消息功能。
            </div>
            <div>
                <strong>用法：</strong>
                <ul>
                    <li><code>/autopulse on</code> — 启用自动消息</li>
                    <li><code>/autopulse off</code> — 禁用自动消息</li>
                    <li><code>/autopulse trigger</code> — 立即触发一次</li>
                    <li><code>/autopulse status</code> — 查看状态</li>
                    <li><code>/autopulse 30</code> — 设置间隔为30分钟</li>
                </ul>
            </div>
        `,
        unnamedArgumentList: [
            ctx.SlashCommandArgument.fromProps({
                description: 'on/off/trigger/status 或分钟数',
                typeList: [ctx.ARGUMENT_TYPE.STRING],
                isRequired: false,
                enumList: ['on', 'off', 'trigger', 'status'],
            }),
        ],
    }));

    console.log('[AutoPulse] Slash commands registered');
}

// ─── Initialization ─────────────────────────────────────────────────

function loadSettingsUI() {
    const settings = getSettings();

    $('#autopulse_enabled').prop('checked', settings.enabled);
    $('#autopulse_interval_range').val(settings.intervalMinutes);
    $('#autopulse_interval_input').val(settings.intervalMinutes);
    $('#autopulse_prompt').val(settings.prompt);
    $('#autopulse_notify').prop('checked', settings.notifyDesktop);

    // Pressure system
    $('#autopulse_pressure_enabled').prop('checked', settings.pressureEnabled);
    $('#autopulse_pressure_max').val(settings.pressureMaxLevel);
    $('#autopulse_pressure_max_display').text(settings.pressureMaxLevel);
    $('#autopulse_pressure_return').prop('checked', settings.pressureReturnEnabled);
    updatePressureDisplay();

    // Jealousy system
    $('#autopulse_jealousy_enabled').prop('checked', settings.jealousyEnabled);
    $('#autopulse_jealousy_chance').val(settings.jealousyChance);
    $('#autopulse_jealousy_chance_display').text(settings.jealousyChance + '%');
    $('#autopulse_jealousy_delay_min').val(settings.jealousyDelayMin);
    $('#autopulse_jealousy_delay_min_display').text(settings.jealousyDelayMin + 's');
    $('#autopulse_jealousy_delay_max').val(settings.jealousyDelayMax);
    $('#autopulse_jealousy_delay_max_display').text(settings.jealousyDelayMax + 's');
    $('#autopulse_jealousy_prompt').val(settings.jealousyPrompt || '');
}

async function initExtension() {
    const ctx = SillyTavern.getContext();

    // Load HTML template
    const settingsHtml = await $.get(`scripts/extensions/third-party/${MODULE_NAME}/settings.html`);
    $('#extensions_settings').append(settingsHtml);

    // Bind UI events
    $('#autopulse_enabled').on('change', onEnabledChange);
    $('#autopulse_interval_range').on('input', function () { onIntervalChange(this.value); });
    $('#autopulse_interval_input').on('change', function () { onIntervalChange(this.value); });
    $('#autopulse_prompt').on('change', onPromptChange);
    $('#autopulse_notify').on('change', onNotifyChange);
    $('#autopulse_trigger_now').on('click', onTriggerNow);
    $('#autopulse_task_repeat').on('change', onRepeatTypeChange);
    $('#autopulse_add_task_btn').on('click', onAddTask);

    // Pressure system UI events
    $('#autopulse_pressure_enabled').on('change', function () {
        const settings = getSettings();
        settings.pressureEnabled = this.checked;
        saveSettings();
        if (!this.checked) { pressureLevel = 0; updatePressureDisplay(); }
    });
    $('#autopulse_pressure_max').on('input', function () {
        const settings = getSettings();
        settings.pressureMaxLevel = Number(this.value);
        $('#autopulse_pressure_max_display').text(this.value);
        saveSettings();
    });
    $('#autopulse_pressure_return').on('change', function () {
        const settings = getSettings();
        settings.pressureReturnEnabled = this.checked;
        saveSettings();
    });

    // Jealousy system UI events
    $('#autopulse_jealousy_enabled').on('change', function () {
        const settings = getSettings();
        settings.jealousyEnabled = this.checked;
        saveSettings();
    });
    $('#autopulse_jealousy_chance').on('input', function () {
        const settings = getSettings();
        settings.jealousyChance = Number(this.value);
        $('#autopulse_jealousy_chance_display').text(this.value + '%');
        saveSettings();
    });
    $('#autopulse_jealousy_delay_min').on('input', function () {
        const settings = getSettings();
        settings.jealousyDelayMin = Number(this.value);
        $('#autopulse_jealousy_delay_min_display').text(this.value + 's');
        saveSettings();
    });
    $('#autopulse_jealousy_delay_max').on('input', function () {
        const settings = getSettings();
        settings.jealousyDelayMax = Number(this.value);
        $('#autopulse_jealousy_delay_max_display').text(this.value + 's');
        saveSettings();
    });
    $('#autopulse_jealousy_prompt').on('change', function () {
        const settings = getSettings();
        settings.jealousyPrompt = $(this).val().trim();
        saveSettings();
    });

    // ─── Test Buttons ───────────────────────────────────────
    $('#autopulse_test_pressure_up').on('click', () => {
        const settings = getSettings();
        const maxLevel = settings.pressureMaxLevel || 4;
        if (pressureLevel < maxLevel) {
            pressureLevel++;
            updatePressureDisplay();
            toastr.info(`压力等级已升至 ${pressureLevel}`, 'AutoPulse 测试');
        } else {
            toastr.warning(`已达最大压力等级 ${maxLevel}`, 'AutoPulse 测试');
        }
    });

    $('#autopulse_test_pressure_trigger').on('click', () => {
        const settings = getSettings();
        handleTrigger(settings.prompt, `压力测试触发 (等级${pressureLevel})`);
    });

    $('#autopulse_test_return').on('click', () => {
        if (pressureLevel === 0) {
            toastr.warning('当前压力为0，请先点"压力+1"升级压力再测试回归', 'AutoPulse 测试');
            return;
        }
        returnReactionLevel = pressureLevel;
        pendingReturnReaction = true;
        const savedLevel = pressureLevel;
        pressureLevel = 0;
        updatePressureDisplay();
        toastr.info(`模拟回归反应 (压力等级${savedLevel})`, 'AutoPulse 测试');
        handleReturnReaction();
    });

    $('#autopulse_test_jealousy').on('click', () => {
        const ctx = SillyTavern.getContext();
        if (!ctx.characterId) {
            toastr.warning('请先打开一个角色聊天', 'AutoPulse 测试');
            return;
        }
        toastr.info('正在生成嫉妒消息...', 'AutoPulse 测试');
        generateJealousyMessage(ctx.characterId);
    });

    // Load settings into UI
    loadSettingsUI();
    loadJealousyCharacterPicker();

    // Try to connect to server plugin, fall back to frontend mode
    let serverAvailable = false;
    try {
        await pluginRequest('/status');
        serverAvailable = true;
    } catch (e) {
        serverAvailable = false;
    }

    if (serverAvailable) {
        // ─── Server Mode ───
        useFallbackMode = false;
        isConnected = true;
        updateStatusUI('connected');
        console.log('[AutoPulse] Server Plugin detected, using server mode');

        startPolling();
        setTimeout(() => processOfflineQueue(), 3000);
        loadTasksUI();

        const settings = getSettings();
        if (settings.enabled) {
            syncTimerToServer();
        }
    } else {
        // ─── Fallback Frontend Mode ───
        useFallbackMode = true;
        isConnected = false;
        updateStatusUI('fallback');
        console.log('[AutoPulse] Server Plugin not found, using frontend fallback mode');
        toastr.info('未检测到 Server Plugin，已切换到前端模式。关闭页面后定时器会停止。', 'AutoPulse', { timeOut: 5000 });

        const settings = getSettings();
        if (settings.enabled) {
            startFallbackTimer();
        }
    }

    // Register slash commands
    registerSlashCommands();

    // Listen for user messages to reset the idle timer + pressure system
    ctx.eventSource.on(ctx.eventTypes.MESSAGE_SENT, () => {
        const settings = getSettings();

        // Handle pressure system: mark return reaction and reset
        if (settings.pressureEnabled && pressureLevel > 0) {
            returnReactionLevel = pressureLevel;
            pendingReturnReaction = true;
            pressureLevel = 0;
            updatePressureDisplay();
            console.log(`[AutoPulse] User replied! Pressure reset. Return reaction pending (level was ${returnReactionLevel})`);

            // Trigger return reaction after a short delay
            setTimeout(() => handleReturnReaction(), 1500);
        }

        lastUserMessageTime = Date.now();

        if (settings.enabled) {
            if (useFallbackMode) {
                startFallbackTimer();
            } else {
                syncTimerToServer(); // Re-sync with reset pressure
                resetServerTimer();
            }
        }
    });

    // Listen for chat changes — jealousy system + timer update
    ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, () => {
        const ctx = SillyTavern.getContext();
        const currentCharId = ctx.characterId;

        // Jealousy: if we switched away from a character, trigger jealousy
        if (previousCharacterId !== null && previousCharacterId !== currentCharId) {
            tryTriggerJealousy(previousCharacterId);
        }

        if (currentCharId !== undefined) {
            previousCharacterId = currentCharId;
        } else {
            previousCharacterId = null; // Group chats or no chat selected
        }

        // Reset pressure when switching chats
        pressureLevel = 0;
        updatePressureDisplay();

        updateNextTriggerTime();
    });

    console.log(`[AutoPulse] UI Extension initialized! (mode: ${useFallbackMode ? 'frontend' : 'server'})`);
}

// ─── Fallback Frontend Timer ─────────────────────────────────────────

/**
 * Start a browser-based timer as a fallback when Server Plugin is unavailable.
 * This timer will stop when the page is closed.
 */
function startFallbackTimer() {
    stopFallbackTimer();

    const settings = getSettings();
    if (!settings.enabled) return;

    const intervalMs = settings.intervalMinutes * 60 * 1000;

    fallbackTimerInterval = setInterval(() => {
        console.log('[AutoPulse] Fallback timer fired!');
        handleTrigger(settings.prompt, `定时消息 (前端模式, 每${settings.intervalMinutes}分钟)`);
    }, intervalMs);

    updateNextTriggerTime();
    console.log(`[AutoPulse] Fallback timer started, interval: ${settings.intervalMinutes} min`);
}

function stopFallbackTimer() {
    if (fallbackTimerInterval) {
        clearInterval(fallbackTimerInterval);
        fallbackTimerInterval = null;
    }
}

// ─── Entry Point ─────────────────────────────────────────────────────

jQuery(async () => {
    const ctx = SillyTavern.getContext();

    // Wait for app to be ready
    ctx.eventSource.on(ctx.eventTypes.APP_READY, async () => {
        await initExtension();
    });
});
