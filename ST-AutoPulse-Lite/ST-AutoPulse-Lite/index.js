/**
 * ST-AutoPulse Lite - 纯前端版本
 * 不需要 Server Plugin，所有定时器在浏览器中运行。
 * 关闭页面后定时器会停止。
 */

const MODULE_NAME = 'ST-AutoPulse-Lite';
const PLUGIN_ID = 'autopulse-lite';

// ─── Default Settings ────────────────────────────────────────────────

const DEFAULT_SETTINGS = Object.freeze({
    enabled: false,
    intervalMinutes: 30,
    prompt: '',
    notifyDesktop: true,
    // Pressure system
    pressureEnabled: false,
    pressureMaxLevel: 4,
    pressureReturnEnabled: true,
    // Jealousy system
    jealousyEnabled: false,
    jealousyChance: 50,
    jealousyDelayMin: 30,
    jealousyDelayMax: 120,
    jealousyCharacters: [],
    jealousyPrompt: '',
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

// ─── State ───────────────────────────────────────────────────────────

let isGenerating = false;
let nextTriggerTime = null;
let countdownInterval = null;
let autoTimerInterval = null;

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

// ─── Timer Management ────────────────────────────────────────────────

function startTimer() {
    stopTimer();

    const settings = getSettings();
    if (!settings.enabled) return;

    let intervalMs = settings.intervalMinutes * 60 * 1000;

    // Apply pressure multiplier
    if (settings.pressureEnabled) {
        const multiplier = PRESSURE_MULTIPLIERS[Math.min(pressureLevel, PRESSURE_MULTIPLIERS.length - 1)] || 1.0;
        intervalMs = Math.max(60000, Math.round(intervalMs * multiplier)); // Min 1 min
    }

    autoTimerInterval = setInterval(() => {
        console.log(`[AutoPulse Lite] Timer fired! (Pressure: ${pressureLevel})`);
        handleTrigger(settings.prompt, `定时消息 (基础${settings.intervalMinutes}分, 压力${pressureLevel})`);
    }, intervalMs);

    nextTriggerTime = Date.now() + intervalMs;
    startCountdown();

    console.log(`[AutoPulse Lite] Timer started, base: ${settings.intervalMinutes}m, pressure: ${pressureLevel}, actual: ${Math.round(intervalMs / 60000)}m`);
}

function stopTimer() {
    if (autoTimerInterval) {
        clearInterval(autoTimerInterval);
        autoTimerInterval = null;
    }
    nextTriggerTime = null;
    stopCountdown();
}

function resetTimer() {
    const settings = getSettings();
    if (settings.enabled) {
        startTimer();
    }
}

// ─── Message Generation ──────────────────────────────────────────────

/**
 * Handle a trigger event: generate a message from the character.
 * @param {string} customPrompt Custom prompt override
 * @param {string} source Description of what triggered this
 */
async function handleTrigger(customPrompt, source = '自动消息') {
    if (isGenerating) {
        console.log('[AutoPulse Lite] Already generating, skipping trigger');
        return;
    }

    const ctx = SillyTavern.getContext();

    // Check if there's an active chat
    if (!ctx.characterId && !ctx.groupId) {
        console.log('[AutoPulse Lite] No active chat, skipping trigger');
        return;
    }

    // Check if chat exists
    if (!ctx.chat || ctx.chat.length === 0) {
        console.log('[AutoPulse Lite] Empty chat, skipping trigger');
        return;
    }

    const settings = getSettings();
    let prompt = customPrompt || settings.prompt || DEFAULT_PROMPT;

    // Inject pressure emotion into prompt if pressure system is enabled
    if (settings.pressureEnabled && pressureLevel > 0) {
        const pressurePrompt = PRESSURE_PROMPTS[Math.min(pressureLevel, PRESSURE_PROMPTS.length - 1)] || '';
        prompt = pressurePrompt + prompt;
        console.log(`[AutoPulse Lite] Pressure level ${pressureLevel}, injecting emotional context`);
    }

    isGenerating = true;
    console.log(`[AutoPulse Lite] Generating message (source: ${source}, pressure: ${pressureLevel})...`);

    try {
        // Use generateQuietPrompt to generate text with chat context
        const result = await ctx.generateQuietPrompt({
            quietPrompt: prompt,
            quietImage: null,
            skipWIAN: false,
        });

        if (!result || result.trim().length === 0) {
            console.warn('[AutoPulse Lite] Generated empty response, skipping');
            return;
        }

        // Build the message object
        const messageText = result.trim();
        const message = {
            name: ctx.name2, // Character name
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

        console.log(`[AutoPulse Lite] Message generated and added to chat: "${messageText.substring(0, 50)}..."`);

        // Show toast notification
        toastr.info(`${ctx.name2} 主动发了消息`, 'AutoPulse Lite', { timeOut: 3000 });

        // Desktop notification
        if (settings.notifyDesktop) {
            sendDesktopNotification(ctx.name2, messageText);
        }

        // Escalate pressure if enabled
        if (settings.pressureEnabled) {
            const maxLevel = settings.pressureMaxLevel || 4;
            if (pressureLevel < maxLevel) {
                pressureLevel++;
                console.log(`[AutoPulse Lite] Pressure escalated to level ${pressureLevel}`);
                updatePressureDisplay();
            }
        }

        // Reset the timer countdown (which will now use the new shorter interval)
        resetTimer();

    } catch (e) {
        console.error('[AutoPulse Lite] Failed to generate message:', e);
        toastr.error(`消息生成失败: ${e.message}`, 'AutoPulse Lite');
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
    console.log(`[AutoPulse Lite] Generating return reaction (was pressure level ${returnReactionLevel})`);

    isGenerating = true;
    try {
        const result = await ctx.generateQuietPrompt({
            quietPrompt: prompt,
            quietImage: null,
            skipWIAN: false,
        });

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

        console.log(`[AutoPulse Lite] Return reaction sent: "${messageText.substring(0, 50)}..."`);
        toastr.info(`${ctx.name2} 对你的回归做出了反应`, 'AutoPulse Lite', { timeOut: 3000 });

    } catch (e) {
        console.error('[AutoPulse Lite] Failed to generate return reaction:', e);
    } finally {
        isGenerating = false;
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
        console.log('[AutoPulse Lite] Jealousy: no characters selected, skipping');
        return;
    }
    if (!allowedChars.includes(String(prevCharId))) {
        console.log(`[AutoPulse Lite] Jealousy: character ${prevCharId} not in whitelist, skipping`);
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
        console.log('[AutoPulse Lite] Jealousy roll failed, skipping');
        return;
    }

    // Random delay
    const minDelay = (settings.jealousyDelayMin || 30) * 1000;
    const maxDelay = (settings.jealousyDelayMax || 120) * 1000;
    const delay = minDelay + Math.random() * (maxDelay - minDelay);

    console.log(`[AutoPulse Lite] Jealousy triggered for character ${prevCharId}, firing in ${Math.round(delay / 1000)}s`);

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
        console.log('[AutoPulse Lite] Already generating, skipping jealousy');
        toastr.warning('正在生成中，请稍候再试', 'AutoPulse Lite');
        return;
    }

    const ctx = SillyTavern.getContext();
    const character = ctx.characters[characterId];
    if (!character) {
        console.warn('[AutoPulse Lite] Character not found for jealousy:', characterId);
        return;
    }

    const settings = getSettings();
    const prompt = settings.jealousyPrompt?.trim() || JEALOUSY_PROMPT;
    console.log('[AutoPulse Lite] Using jealousy prompt:', prompt.substring(0, 60) + '...');

    console.log(`[AutoPulse Lite] Generating jealousy message from ${character.name} (id: ${characterId})...`);

    isGenerating = true;
    try {
        const result = await ctx.generateQuietPrompt({
            quietPrompt: prompt,
            quietImage: null,
            skipWIAN: false,
            responseLength: 150,
            removeReasoning: true,
            trimToSentence: true,
            forceChId: characterId,
        });

        console.log('[AutoPulse Lite] Jealousy raw result:', result);

        if (!result || result.trim().length === 0) {
            console.warn('[AutoPulse Lite] Jealousy message empty, skipping');
            toastr.warning('嫉妒消息生成为空', 'AutoPulse Lite');
            return;
        }

        // Post-process string
        let cleaned = result
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
            .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
            .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
            .replace(/<chain_of_thought>[\s\S]*?<\/chain_of_thought>/gi, '')
            .replace(/<内心[\s\S]*?>[\s\S]*?<\/内心[\s\S]*?>/gi, '')
            .replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi, '')
            .trim();

        cleaned = cleaned.replace(/\*[^*]+\*/g, '').trim();

        const lines = cleaned.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length > 2) {
            cleaned = lines.slice(-2).join('\n');
        }

        cleaned = cleaned.replace(/^["「『"]([\s\S]+)["」』"]$/, '$1').trim();

        if (!cleaned) {
            console.warn('[AutoPulse Lite] Jealousy message empty after cleanup');
            toastr.warning('嫉妒消息清理后为空', 'AutoPulse Lite');
            return;
        }

        const messageText = cleaned;

        // Show floating notification
        try {
            const avatarUrl = ctx.getThumbnailUrl('avatar', character.avatar);
            console.log('[AutoPulse Lite] Showing jealousy popup:', character.name, avatarUrl);
            showJealousyPopup(character.name, avatarUrl, messageText);
        } catch (popupErr) {
            console.error('[AutoPulse Lite] Popup creation failed:', popupErr);
        }

        // Toast notification
        toastr.info(`${character.name} 看起来有点嫉妒...`, 'AutoPulse Lite 💢', { timeOut: 5000 });

        // Desktop notification
        if (settings.notifyDesktop) {
            sendDesktopNotification(character.name, messageText);
        }

        console.log(`[AutoPulse Lite] Jealousy message sent: "${messageText.substring(0, 80)}"`);

    } catch (e) {
        console.error('[AutoPulse Lite] Failed to generate jealousy message:', e);
        toastr.error(`嫉妒消息生成失败: ${e.message}`, 'AutoPulse Lite');
    } finally {
        isGenerating = false;
    }
}

function escapeHtml(unsafe) {
    return (unsafe || '').toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
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

// ─── Desktop Notifications ───────────────────────────────────────────

function sendDesktopNotification(characterName, message) {
    if (!('Notification' in window)) return;

    if (Notification.permission === 'granted') {
        try {
            new Notification(`${characterName} 发来了消息`, {
                body: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
                icon: '/favicon.ico',
                tag: 'autopulse-lite',
            });
        } catch (e) {
            console.warn('[AutoPulse Lite] Failed to show desktop notification (mobile browser?):', e);
        }
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(perm => {
            if (perm === 'granted') {
                sendDesktopNotification(characterName, message);
            }
        });
    }
}

// ─── Countdown Display ──────────────────────────────────────────────

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

// ─── UI Status ───────────────────────────────────────────────────────

function updateStatusUI() {
    const dot = $('#autopulse_status_dot');
    const text = $('#autopulse_status_text');
    const settings = getSettings();

    dot.removeClass('connected disconnected active');

    if (settings.enabled) {
        dot.addClass('active');
        text.text('前端定时器运行中（关闭页面后停止）');
    } else {
        dot.addClass('disconnected');
        text.text('已停用');
    }
}

// ─── UI Event Handlers ──────────────────────────────────────────────

function onEnabledChange() {
    const settings = getSettings();
    settings.enabled = $('#autopulse_enabled').prop('checked');
    saveSettings();
    if (settings.enabled) {
        startTimer();
    } else {
        stopTimer();
    }
    updateStatusUI();
}

function onIntervalChange(value) {
    const settings = getSettings();
    const v = Math.max(1, Math.min(180, Number(value) || 30));
    settings.intervalMinutes = v;
    $('#autopulse_interval_range').val(v);
    $('#autopulse_interval_input').val(v);
    saveSettings();
    if (settings.enabled) {
        startTimer();
    }
}

function onPromptChange() {
    const settings = getSettings();
    settings.prompt = $('#autopulse_prompt').val().trim();
    saveSettings();
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

// ─── Pressure System UI Handlers ─────────────────────────────────────

function onPressureEnabledChange() {
    const settings = getSettings();
    settings.pressureEnabled = $('#autopulse_pressure_enabled').prop('checked');
    saveSettings();
    if (!settings.pressureEnabled) {
        pressureLevel = 0;
        updatePressureDisplay();
        if (settings.enabled) resetTimer(); // Reset back to normal interval
    }
}

function onPressureMaxLevelChange(value) {
    const settings = getSettings();
    const v = Math.max(1, Math.min(5, Number(value) || 4));
    settings.pressureMaxLevel = v;
    $('#autopulse_pressure_max').val(v);
    $('#autopulse_pressure_max_display').text(v);
    saveSettings();
    if (pressureLevel > v) {
        pressureLevel = v;
        updatePressureDisplay();
    }
}

function onPressureReturnChange() {
    const settings = getSettings();
    settings.pressureReturnEnabled = $('#autopulse_pressure_return').prop('checked');
    saveSettings();
}

function updatePressureDisplay() {
    const display = $('#autopulse_pressure_display');
    const settings = getSettings();
    const max = settings.pressureMaxLevel || 4;

    let emoji = '😊';
    if (pressureLevel >= max) emoji = '💢';
    else if (pressureLevel >= max - 1) emoji = '😠';
    else if (pressureLevel >= 2) emoji = '😰';
    else if (pressureLevel >= 1) emoji = '🥺';

    display.text(`${emoji} 等级 ${pressureLevel}`);

    // Color logic
    if (pressureLevel === 0) display.css('color', '');
    else if (pressureLevel === 1) display.css('color', '#ffb74d'); // Orange
    else if (pressureLevel === 2) display.css('color', '#ff9800'); // Dark orange
    else if (pressureLevel === 3) display.css('color', '#f44336'); // Red
    else display.css('color', '#d32f2f'); // Dark red
}

// ─── Jealousy System UI Handlers ─────────────────────────────────────

function onJealousyEnabledChange() {
    const settings = getSettings();
    settings.jealousyEnabled = $('#autopulse_jealousy_enabled').prop('checked');
    saveSettings();
}

function onJealousyChanceChange(value) {
    const settings = getSettings();
    const v = Math.max(0, Math.min(100, Number(value) || 50));
    settings.jealousyChance = v;
    $('#autopulse_jealousy_chance').val(v);
    $('#autopulse_jealousy_chance_display').text(`${v}%`);
    saveSettings();
}

function onJealousyDelayMinChange(value) {
    const settings = getSettings();
    const v = Math.max(1, Math.min(300, Number(value) || 30));
    settings.jealousyDelayMin = v;
    $('#autopulse_jealousy_delay_min').val(v);
    $('#autopulse_jealousy_delay_min_display').text(`${v}s`);
    if (settings.jealousyDelayMin > settings.jealousyDelayMax) {
        settings.jealousyDelayMax = settings.jealousyDelayMin;
        $('#autopulse_jealousy_delay_max').val(v);
        $('#autopulse_jealousy_delay_max_display').text(`${v}s`);
    }
    saveSettings();
}

function onJealousyDelayMaxChange(value) {
    const settings = getSettings();
    let v = Math.max(1, Math.min(600, Number(value) || 120));
    if (v < settings.jealousyDelayMin) {
        v = settings.jealousyDelayMin;
    }
    settings.jealousyDelayMax = v;
    $('#autopulse_jealousy_delay_max').val(v);
    $('#autopulse_jealousy_delay_max_display').text(`${v}s`);
    saveSettings();
}

function onJealousyPromptChange() {
    const settings = getSettings();
    settings.jealousyPrompt = $('#autopulse_jealousy_prompt').val().trim();
    saveSettings();
}

function updateJealousyCharPicker() {
    const settings = getSettings();
    const container = $('#autopulse_jealousy_chars');
    container.empty();

    const ctx = SillyTavern.getContext();
    const chars = ctx.characters || [];

    if (chars.length === 0) {
        container.html('<span class="autopulse-hint">没有找到角色。请先添加一些角色。</span>');
        return;
    }

    const selectedChars = settings.jealousyCharacters || [];

    chars.forEach((char, index) => {
        const isSelected = selectedChars.includes(String(index));
        const avatarUrl = ctx.getThumbnailUrl('avatar', char.avatar) || '/favicon.ico';

        const chip = $(`
            <div class="autopulse-char-chip ${isSelected ? 'selected' : ''}" data-id="${index}" title="${escapeHtml(char.name)}">
                <img class="autopulse-char-chip-avatar" src="${avatarUrl}" />
                <span class="autopulse-char-chip-name">${escapeHtml(char.name)}</span>
            </div>
        `);

        chip.on('click', function () {
            const id = $(this).data('id').toString();
            const currSettings = getSettings();
            currSettings.jealousyCharacters = currSettings.jealousyCharacters || [];

            const idx = currSettings.jealousyCharacters.indexOf(id);
            if (idx > -1) {
                currSettings.jealousyCharacters.splice(idx, 1);
                $(this).removeClass('selected');
            } else {
                currSettings.jealousyCharacters.push(id);
                $(this).addClass('selected');
            }
            saveSettings();
        });

        container.append(chip);
    });
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
                    startTimer();
                    updateStatusUI();
                    return '✅ AutoPulse Lite 已启用';

                case 'off':
                    settings.enabled = false;
                    $('#autopulse_enabled').prop('checked', false);
                    saveSettings();
                    stopTimer();
                    updateStatusUI();
                    return '⏹ AutoPulse Lite 已禁用';

                case 'trigger':
                    await handleTrigger(settings.prompt, 'Slash 命令触发');
                    return '⚡ 已触发角色消息生成';

                case 'status':
                    return `📊 AutoPulse Lite 状态:\n` +
                        `- 启用: ${settings.enabled ? '是' : '否'}\n` +
                        `- 间隔: ${settings.intervalMinutes} 分钟\n` +
                        `- 模式: 纯前端（关闭页面后停止）\n` +
                        `- 定时器: ${autoTimerInterval ? '运行中' : '已停止'}`;

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
                控制 AutoPulse Lite 自动消息功能（纯前端版本）。
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

    console.log('[AutoPulse Lite] Slash commands registered');
}

// ─── Initialization ─────────────────────────────────────────────────

function loadSettingsUI() {
    const settings = getSettings();

    $('#autopulse_enabled').prop('checked', settings.enabled);
    $('#autopulse_interval_range').val(settings.intervalMinutes);
    $('#autopulse_interval_input').val(settings.intervalMinutes);
    $('#autopulse_prompt').val(settings.prompt);
    $('#autopulse_notify').prop('checked', settings.notifyDesktop);

    // Pressure settings
    $('#autopulse_pressure_enabled').prop('checked', settings.pressureEnabled);
    $('#autopulse_pressure_max').val(settings.pressureMaxLevel || 4);
    $('#autopulse_pressure_max_display').text(settings.pressureMaxLevel || 4);
    $('#autopulse_pressure_return').prop('checked', settings.pressureReturnEnabled !== false);
    updatePressureDisplay();

    // Jealousy settings
    $('#autopulse_jealousy_enabled').prop('checked', settings.jealousyEnabled);
    $('#autopulse_jealousy_chance').val(settings.jealousyChance || 50);
    $('#autopulse_jealousy_chance_display').text(`${settings.jealousyChance || 50}%`);
    $('#autopulse_jealousy_delay_min').val(settings.jealousyDelayMin || 30);
    $('#autopulse_jealousy_delay_min_display').text(`${settings.jealousyDelayMin || 30}s`);
    $('#autopulse_jealousy_delay_max').val(settings.jealousyDelayMax || 120);
    $('#autopulse_jealousy_delay_max_display').text(`${settings.jealousyDelayMax || 120}s`);
    $('#autopulse_jealousy_prompt').val(settings.jealousyPrompt || JEALOUSY_PROMPT);
    updateJealousyCharPicker();
}

async function initExtension() {
    const ctx = SillyTavern.getContext();

    // Load HTML template
    const settingsHtml = await $.get(`scripts/extensions/third-party/${MODULE_NAME}/settings.html`);
    $('#extensions_settings').append(settingsHtml);

    // Bind UI events - Basic
    $('#autopulse_enabled').on('change', onEnabledChange);
    $('#autopulse_interval_range').on('input', function () { onIntervalChange(this.value); });
    $('#autopulse_interval_input').on('change', function () { onIntervalChange(this.value); });
    $('#autopulse_prompt').on('change', onPromptChange);
    $('#autopulse_notify').on('change', onNotifyChange);
    $('#autopulse_trigger_now').on('click', onTriggerNow);

    // Bind UI events - Pressure
    $('#autopulse_pressure_enabled').on('change', onPressureEnabledChange);
    $('#autopulse_pressure_max').on('input', function () { onPressureMaxLevelChange(this.value); });
    $('#autopulse_pressure_return').on('change', onPressureReturnChange);

    // Bind UI events - Jealousy
    $('#autopulse_jealousy_enabled').on('change', onJealousyEnabledChange);
    $('#autopulse_jealousy_chance').on('input', function () { onJealousyChanceChange(this.value); });
    $('#autopulse_jealousy_delay_min').on('input', function () { onJealousyDelayMinChange(this.value); });
    $('#autopulse_jealousy_delay_max').on('input', function () { onJealousyDelayMaxChange(this.value); });
    $('#autopulse_jealousy_prompt').on('change', onJealousyPromptChange);

    // Bind test buttons
    $('#autopulse_test_pressure_up').on('click', () => {
        const settings = getSettings();
        if (!settings.pressureEnabled) {
            toastr.warning('请先启用情绪压力系统', 'AutoPulse Lite');
            return;
        }
        const maxLevel = settings.pressureMaxLevel || 4;
        if (pressureLevel < maxLevel) {
            pressureLevel++;
            updatePressureDisplay();
            toastr.success(`压力已提升到 ${pressureLevel}`, '测试工具');
        } else {
            toastr.info('已经是最高压力等级了', '测试工具');
        }
    });

    $('#autopulse_test_pressure_trigger').on('click', () => {
        const settings = getSettings();
        handleTrigger(settings.prompt, `测试触发 (压力 ${pressureLevel})`);
    });

    $('#autopulse_test_return').on('click', () => {
        const settings = getSettings();
        if (!settings.pressureEnabled || !settings.pressureReturnEnabled) {
            toastr.warning('请先启用情绪压力系统和回归反应', 'AutoPulse Lite');
            return;
        }
        if (pressureLevel === 0) {
            toastr.info('当前没有累计压力', '测试工具');
            return;
        }
        returnReactionLevel = pressureLevel;
        pendingReturnReaction = true;
        pressureLevel = 0;
        updatePressureDisplay();
        toastr.success('已就绪，发送一条消息看看反应', '测试工具');
    });

    $('#autopulse_test_jealousy').on('click', () => {
        const charId = ctx.characterId;
        if (!charId) {
            toastr.warning('请先打开一个角色的聊天', 'AutoPulse Lite');
            return;
        }
        toastr.info('正在生成吃醋消息（无视概率和延时）...', '测试工具');
        generateJealousyMessage(charId);
    });

    // Refresh jealousy character picker when switching characters or updating chars
    ctx.eventSource.on(ctx.eventTypes.CHARACTER_EDITED, updateJealousyCharPicker);
    ctx.eventSource.on(ctx.eventTypes.CHARACTERS_LOADED, updateJealousyCharPicker);

    // Load settings into UI
    loadSettingsUI();
    updateStatusUI();

    // Register slash commands
    registerSlashCommands();

    // Start timer if enabled
    const settings = getSettings();
    if (settings.enabled) {
        startTimer();
    }

    // Listen for user messages to reset the idle timer and handle pressure
    ctx.eventSource.on(ctx.eventTypes.MESSAGE_SENT, () => {
        const settings = getSettings();

        // Handle Return Reaction if pressure is high
        if (settings.pressureEnabled && pressureLevel > 0) {
            console.log(`[AutoPulse Lite] User replied at pressure level ${pressureLevel}, scheduling return reaction`);
            returnReactionLevel = pressureLevel;
            pendingReturnReaction = true;
            pressureLevel = 0;
            updatePressureDisplay();

            // Allow SillyTavern to process the current message before generating reaction
            setTimeout(() => {
                handleReturnReaction();
            }, 3000); // 3 second delay for dramatic pacing
        } else if (settings.pressureEnabled) {
            pressureLevel = 0;
            updatePressureDisplay();
        }

        lastUserMessageTime = Date.now();

        if (settings.enabled) {
            resetTimer(); // Timer resets with normal interval (since pressure is 0)
        }
    });

    // Listen for chat changes for jealousy system
    ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, () => {
        const currentCharacterId = ctx.characterId;

        // Timer resets on chat switch
        if (getSettings().enabled) {
            resetTimer();
        }

        // Jealousy Logic
        if (previousCharacterId !== null && previousCharacterId !== currentCharacterId) {
            tryTriggerJealousy(previousCharacterId);
        }

        if (currentCharacterId !== undefined) {
            previousCharacterId = currentCharacterId;
        } else {
            previousCharacterId = null; // Group chats or no chat selected
        }
    });

    // Handle initial chat selection
    if (ctx.characterId) {
        previousCharacterId = ctx.characterId;
    }

    console.log('[AutoPulse Lite] UI Extension initialized! (frontend-only mode)');
}

// ─── Entry Point ─────────────────────────────────────────────────────

jQuery(async () => {
    const ctx = SillyTavern.getContext();

    // Wait for app to be ready
    ctx.eventSource.on(ctx.eventTypes.APP_READY, async () => {
        await initExtension();
    });
});
