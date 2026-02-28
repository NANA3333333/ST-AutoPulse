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
    contextSyncDepth: 10, // How many chat messages to sync to ChatPulse
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
        const ctx = SillyTavern.getContext();
        // Pause polling if no active chat to prevent consuming and losing events
        if (!ctx.characterId && !ctx.groupId) {
            return;
        }

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
        try {
            new Notification(`${characterName} 发来了消息`, {
                body: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
                icon: '/favicon.ico',
                tag: 'autopulse',
            });
        } catch (e) {
            console.warn('[AutoPulse] Failed to show desktop notification (mobile browser?):', e);
        }
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(perm => {
            if (perm === 'granted') {
                sendDesktopNotification(characterName, message);
            }
        });
    }
}


async function processOfflineQueue() {
    try {
        const ctx = SillyTavern.getContext();
        // Pause processing if no active chat
        if (!ctx.characterId && !ctx.groupId) {
            console.log('[AutoPulse] No active chat, deferring offline queue processing.');
            return;
        }

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
        let intervalMs = settings.intervalMinutes * 60 * 1000;
        // Apply pressure multiplier so the countdown matches actual timer interval
        if (settings.pressureEnabled) {
            const multiplier = PRESSURE_MULTIPLIERS[Math.min(pressureLevel, PRESSURE_MULTIPLIERS.length - 1)] || 1.0;
            intervalMs = Math.max(60000, Math.round(intervalMs * multiplier));
        }
        nextTriggerTime = Date.now() + intervalMs;
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

    // ChatPulse Sync Settings
    $('#autopulse_context_depth').val(settings.contextSyncDepth);
    $('#autopulse_context_depth_display').text(settings.contextSyncDepth);
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

    // ChatPulse Sync events
    $('#autopulse_context_depth').on('input', function () {
        const settings = getSettings();
        settings.contextSyncDepth = Number(this.value);
        $('#autopulse_context_depth_display').text(this.value);
        saveSettings();
        // Trigger an immediate sync so the new depth is applied
        syncChatPulseContext();
    });

    $('#autopulse_context_summarize_btn').on('click', onContextSummarize);

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

    // Load settings into UI
    loadSettingsUI();

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

        // Sync context to ChatPulse on every user message
        syncChatPulseContext();
    });

    // Listen for AI responses to keep ChatPulse context up to date
    if (ctx.eventTypes.MESSAGE_RECEIVED) {
        ctx.eventSource.on(ctx.eventTypes.MESSAGE_RECEIVED, () => {
            syncChatPulseContext();
        });
    }

    // Listen for chat changes — jealousy system + timer update
    ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, () => {
        const ctx = SillyTavern.getContext();
        const currentCharId = ctx.characterId;

        // Sync context to ChatPulse on chat change
        syncChatPulseContext();

        if (currentCharId !== undefined) {
            // Attempt to process offline queue now that a chat is open
            setTimeout(() => processOfflineQueue(), 1000);
        }

        // Reset pressure when switching chats
        pressureLevel = 0;
        updatePressureDisplay();

        updateNextTriggerTime();
    });

    initChatPulseUI();
    console.log(`[AutoPulse] UI Extension initialized! (mode: ${useFallbackMode ? 'frontend' : 'server'})`);
}

// ─── ChatPulse Phone UI ──────────────────────────────────────────────

function initChatPulseUI() {
    // 1. Create the floating smartphone button
    const btn = document.createElement('div');
    btn.id = 'autopulse_chatpulse_btn';
    btn.innerHTML = '<i class="fa-solid fa-mobile-screen"></i>';
    btn.title = 'Open ChatPulse (AI Phone)';
    document.body.appendChild(btn);

    // 2. Create the glassmorphism overlay and iframe
    const overlay = document.createElement('div');
    overlay.id = 'autopulse_chatpulse_overlay';
    // Load the ChatPulse React App directly from its Express backend on 8001
    overlay.innerHTML = `
        <div class="autopulse-phone-container">
            <div class="autopulse-phone-header">
                <span class="autopulse-phone-title">ChatPulse - Digital Society</span>
                <i class="fa-solid fa-xmark" id="autopulse_chatpulse_close"></i>
            </div>
            <iframe id="autopulse_chatpulse_iframe" src="http://localhost:8001" frameborder="0"></iframe>
        </div>
    `;
    document.body.appendChild(overlay);

    // 3. Bind events to toggle the UI
    // To distinguish between a click and a drag
    let isDragging = false;
    let startX = 0, startY = 0;

    // Restore saved position
    const savedPos = localStorage.getItem('chatpulse_btn_pos');
    if (savedPos) {
        try {
            const { right, bottom } = JSON.parse(savedPos);
            btn.style.right = right;
            btn.style.bottom = bottom;
        } catch (e) { }
    }

    const initDrag = (e) => {
        isDragging = false;
        const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
        const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
        startX = clientX;
        startY = clientY;

        const onMove = (moveEvent) => {
            const mClientX = moveEvent.type.includes('touch') ? moveEvent.touches[0].clientX : moveEvent.clientX;
            const mClientY = moveEvent.type.includes('touch') ? moveEvent.touches[0].clientY : moveEvent.clientY;

            const dx = mClientX - startX;
            const dy = mClientY - startY;

            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                isDragging = true;
            }

            if (isDragging) {
                // Calculate new position relative to bottom/right
                const rect = btn.getBoundingClientRect();
                const newRight = window.innerWidth - (mClientX + rect.width / 2);
                const newBottom = window.innerHeight - (mClientY + rect.height / 2);

                btn.style.right = `${Math.max(10, Math.min(newRight, window.innerWidth - 60))}px`;
                btn.style.bottom = `${Math.max(10, Math.min(newBottom, window.innerHeight - 60))}px`;
            }
        };

        const onEnd = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onEnd);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onEnd);

            if (isDragging) {
                localStorage.setItem('chatpulse_btn_pos', JSON.stringify({
                    right: btn.style.right,
                    bottom: btn.style.bottom
                }));
            }
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onEnd);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onEnd);
    };

    btn.addEventListener('mousedown', initDrag);
    btn.addEventListener('touchstart', initDrag, { passive: false });

    btn.addEventListener('click', (e) => {
        if (!isDragging) {
            overlay.classList.add('visible');
        }
    });

    document.getElementById('autopulse_chatpulse_close').addEventListener('click', () => {
        overlay.classList.remove('visible');
    });
}

/**
 * Capture SillyTavern Context and send it to ChatPulse Backend
 */
async function syncChatPulseContext() {
    const ctx = SillyTavern.getContext();
    if (!ctx.characterId) return; // Don't sync if no active 1-on-1 chat selected (groups could be supported later)

    const character = ctx.characters[ctx.characterId];
    if (!character) return;

    const settings = getSettings();
    const depth = settings.contextSyncDepth ?? 10;

    // Grab the last N messages for recent ST memory context, excluding system messages
    const chatHistory = (ctx.chat || []).filter(m => !m.is_system).slice(-depth).map(m => ({
        is_user: m.is_user,
        name: m.name || (m.is_user ? ctx.name1 : character.name),
        mes: m.mes
    }));

    // Get Avatar fully qualified URL
    let avatarUrl = '';
    if (typeof ctx.getThumbnailUrl === 'function') {
        avatarUrl = ctx.getThumbnailUrl('avatar', character.avatar);
    }
    // If it's a relative path, make it absolute (useful for ChatPulse backend that runs on 8001)
    if (avatarUrl && avatarUrl.startsWith('/')) {
        avatarUrl = window.location.origin + avatarUrl;
    }

    const payload = {
        st_character_id: ctx.characterId, // This is the ST unique ID (usually avatar filename or folder name)
        st_character_name: character.name,
        st_avatar: avatarUrl,
        st_user_name: ctx.name1 || 'User',
        st_persona: `${character.description || ''}\n${character.personality || ''}`,
        st_scenario: character.scenario || '',
        chat_history: chatHistory
    };

    try {
        const iframe = document.getElementById('autopulse_chatpulse_iframe');
        const baseUrl = iframe ? new URL(iframe.src).origin : 'http://localhost:8001';

        // Send payload to ChatPulse Express backend
        await fetch(`${baseUrl}/api/integrations/st/context`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        console.log('[ST-ChatPulse] Context bridged to ChatPulse subsystem successfully.');
    } catch (e) {
        console.warn('[ST-ChatPulse] Bridge sync failed. Is ChatPulse backend running on 8001? (Error:', e.message, ')');
    }
}

/**
 * Summarize ST Context and push it to ChatPulse Long-Term Memory
 */
async function onContextSummarize() {
    const ctx = SillyTavern.getContext();
    if (!ctx.characterId) {
        toastr.warning('请先在 SillyTavern 打开一个角色的聊天窗口', 'AutoPulse');
        return;
    }

    const character = ctx.characters[ctx.characterId];
    if (!character) return;

    const settings = getSettings();
    const depth = settings.contextSyncDepth ?? 10;

    // Grab messages
    const chatHistoryObjs = (ctx.chat || []).filter(m => !m.is_system).slice(-depth);
    const chatHistory = chatHistoryObjs.map(m => {
        const name = m.name || (m.is_user ? ctx.name1 : character.name);
        return `${name}: ${m.mes}`;
    });

    if (chatHistory.length === 0) {
        toastr.info('最近没有对话内容可以总结', 'AutoPulse');
        return;
    }

    const chatLog = chatHistory.join('\n');
    const prompt = `[系统指令] 请用一到两段话，客观地总结以下对话中的“核心事件”、“两人的关系进展”和“重要的既定事实”，提取为角色的“长期记忆”。不要描述细节，只需要提取关键记忆，以第三人称或角色的视角描述即可。\n\n对话原文:\n${chatLog}`;

    const btn = $('#autopulse_context_summarize_btn');
    const originalBtnHtml = btn.html();
    btn.html('<span class="fa-solid fa-spinner fa-spin"></span> 总结中...').css('pointer-events', 'none');
    toastr.info('正在由酒馆 LLM 提取长期记忆，请耐心等待...', 'AutoPulse');

    try {
        let summaryText = '';
        if (typeof ctx.generateQuietPrompt === 'function') {
            summaryText = await ctx.generateQuietPrompt(prompt, false, false, 'summary');
        } else {
            toastr.error('您的酒馆版本不支持静默生成API，请更新SillyTavern', 'AutoPulse');
            return;
        }

        if (!summaryText) {
            throw new Error('未生成任何总结结果');
        }

        // Get Avatar fully qualified URL
        let avatarUrl = '';
        if (typeof ctx.getThumbnailUrl === 'function') {
            avatarUrl = ctx.getThumbnailUrl('avatar', character.avatar);
        }
        if (avatarUrl && avatarUrl.startsWith('/')) {
            avatarUrl = window.location.origin + avatarUrl;
        }

        // Send to backend
        const iframe = document.getElementById('autopulse_chatpulse_iframe');
        const baseUrl = iframe ? new URL(iframe.src).origin : 'http://localhost:8001';

        const payload = {
            st_character_id: ctx.characterId,
            st_character_name: character.name,
            st_avatar: avatarUrl,
            memory_summary: summaryText
        };

        const res = await fetch(`${baseUrl}/api/integrations/st/sync_memory`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.success) {
            toastr.success('已成功提取并推送到 ChatPulse (手机) 的长期记忆中！', 'AutoPulse');
        } else {
            throw new Error(data.error || 'Server returned error');
        }
    } catch (e) {
        console.error('[ST-ChatPulse] Error summarizing context:', e);
        toastr.error(`提取记忆失败: ${e.message}`, 'AutoPulse');
    } finally {
        btn.html(originalBtnHtml).css('pointer-events', 'auto');
    }
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

    let intervalMs = settings.intervalMinutes * 60 * 1000;

    // Apply pressure multiplier in fallback mode too
    if (settings.pressureEnabled) {
        const multiplier = PRESSURE_MULTIPLIERS[Math.min(pressureLevel, PRESSURE_MULTIPLIERS.length - 1)] || 1.0;
        intervalMs = Math.max(60000, Math.round(intervalMs * multiplier));
    }

    const actualMinutes = Math.round(intervalMs / 60000);

    fallbackTimerInterval = setInterval(() => {
        console.log(`[AutoPulse] Fallback timer fired! (pressure: ${pressureLevel})`);
        handleTrigger(settings.prompt, `定时消息 (前端模式, 基础${settings.intervalMinutes}分, 压力${pressureLevel})`);
    }, intervalMs);

    updateNextTriggerTime();
    console.log(`[AutoPulse] Fallback timer started, base: ${settings.intervalMinutes}min, pressure: ${pressureLevel}, actual: ${actualMinutes}min`);
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
