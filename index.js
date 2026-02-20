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
});

const DEFAULT_PROMPT = '一段时间过去了。请根据当前的对话上下文、角色性格和背景设定，以角色的身份主动向用户发送一条自然的消息。这条消息应该像是角色在想到用户时自然地发出的，可以是问候、分享日常、表达关心、或延续之前的话题。请保持角色的语气和风格一致。';

let pollingInterval = null;
let isConnected = false;
let isGenerating = false;
let nextTriggerTime = null;
let countdownInterval = null;
const POLL_INTERVAL_MS = 5000; // Poll every 5 seconds

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

// ─── Polling Connection (replaces SSE) ───────────────────────────────

/**
 * Start polling the server plugin for pending trigger events.
 * Uses fetch with proper auth headers (unlike EventSource which can't send headers).
 */
function startPolling() {
    stopPolling();

    // Initial connection check
    checkServerConnection();

    pollingInterval = setInterval(async () => {
        await pollForEvents();
    }, POLL_INTERVAL_MS);

    console.log(`[AutoPulse] Polling started (every ${POLL_INTERVAL_MS / 1000}s)`);
}

function stopPolling() {
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
            updateStatusUI(true);
            console.log('[AutoPulse] Server plugin connected');
        }
    } catch (e) {
        if (isConnected) {
            isConnected = false;
            updateStatusUI(false);
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

        // Connection is alive
        if (!isConnected) {
            isConnected = true;
            updateStatusUI(true);
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
            updateStatusUI(false);
            console.warn('[AutoPulse] Polling failed:', e.message);
        }
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
    const prompt = customPrompt || settings.prompt || DEFAULT_PROMPT;

    isGenerating = true;
    console.log(`[AutoPulse] Generating message (source: ${source})...`);

    try {
        // Use generateQuietPrompt to generate text with chat context
        const result = await ctx.generateQuietPrompt({
            quietPrompt: prompt,
            quietImage: null,
            skipWIAN: false,
        });

        if (!result || result.trim().length === 0) {
            console.warn('[AutoPulse] Generated empty response, skipping');
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

        // Reset the timer countdown
        updateNextTriggerTime();

    } catch (e) {
        console.error('[AutoPulse] Failed to generate message:', e);
        toastr.error(`消息生成失败: ${e.message}`, 'AutoPulse');
    } finally {
        isGenerating = false;
    }
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

// ─── Offline Queue Processing ────────────────────────────────────────

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
        });
        console.log(`[AutoPulse] Timer synced to server: ${settings.enabled ? 'ON' : 'OFF'}, interval: ${settings.intervalMinutes}min`);
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

// ─── UI Status ───────────────────────────────────────────────────────

function updateStatusUI(connected) {
    const dot = $('#autopulse_status_dot');
    const text = $('#autopulse_status_text');

    dot.removeClass('connected disconnected');

    if (connected) {
        dot.addClass('connected');
        text.text('已连接到服务端');
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
    syncTimerToServer();
}

function onIntervalChange(value) {
    const settings = getSettings();
    const v = Math.max(1, Math.min(180, Number(value) || 30));
    settings.intervalMinutes = v;
    $('#autopulse_interval_range').val(v);
    $('#autopulse_interval_input').val(v);
    saveSettings();
    syncTimerToServer();
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

    // Load settings into UI
    loadSettingsUI();

    // Connect to server plugin via polling
    startPolling();

    // Process any queued offline events
    setTimeout(() => processOfflineQueue(), 3000);

    // Load scheduled tasks UI
    loadTasksUI();

    // Register slash commands
    registerSlashCommands();

    // Listen for user messages to reset the idle timer
    ctx.eventSource.on(ctx.eventTypes.MESSAGE_SENT, () => {
        const settings = getSettings();
        if (settings.enabled) {
            resetServerTimer();
        }
    });

    // Listen for chat changes
    ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, () => {
        updateNextTriggerTime();
    });

    // Sync timer state on load
    const settings = getSettings();
    if (settings.enabled) {
        syncTimerToServer();
    }

    console.log('[AutoPulse] UI Extension initialized!');
}

// ─── Entry Point ─────────────────────────────────────────────────────

jQuery(async () => {
    const ctx = SillyTavern.getContext();

    // Wait for app to be ready
    ctx.eventSource.on(ctx.eventTypes.APP_READY, async () => {
        await initExtension();
    });
});
