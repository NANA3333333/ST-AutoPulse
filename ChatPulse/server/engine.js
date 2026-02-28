const db = require('./db');
const { callLLM } = require('./llm');
const { searchMemories, extractMemoryFromContext } = require('./memory');
const { setDiaryPassword } = require('./db');

// Store active timers per character
const timers = new Map();

// Store ST synced contexts
const stContextMap = new Map();

function updateSTContext(stCharId, contextData) {
    stContextMap.set(stCharId, contextData);
    // Auto-link to ChatPulse characters by name
    const allChars = db.getCharacters();
    const match = allChars.find(c => c.name.toLowerCase() === contextData.name.toLowerCase());
    if (match) {
        stContextMap.set(match.id, contextData);
        console.log(`[ST-ChatPulse Bridge] Context synced and linked for character: ${match.name} (ID: ${match.id})`);
    } else {
        console.log(`[ST-ChatPulse Bridge] Context synced for ST char ${contextData.name}, but no matching ChatPulse character found yet.`);
    }
}

// Generate a random delay between min and max minutes
function getRandomDelayMs(min, max) {
    const minMs = min * 60 * 1000;
    const maxMs = max * 60 * 1000;
    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

// Generates the system prompt merging character persona, world info, and memories
async function buildPrompt(character, contextMessages, isTimerWakeup = false) {
    const now = new Date();
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;
    const hour = now.getHours();

    let timeOfDay = 'Daytime';
    if (hour >= 5 && hour < 10) timeOfDay = 'Morning';
    else if (hour >= 10 && hour < 14) timeOfDay = 'Midday/Noon';
    else if (hour >= 14 && hour < 18) timeOfDay = 'Afternoon';
    else if (hour >= 18 && hour < 22) timeOfDay = 'Evening';
    else timeOfDay = 'Late Night';

    const timeContext = `Current Time: ${timeOfDay} (${now.toLocaleTimeString()})${isWeekend ? ', Weekend' : ', Weekday'}`;

    const userProfile = db.getUserProfile();
    const userName = userProfile?.name || 'User';

    let pressureContext = '';
    if (character.pressure_level > 0) {
        pressureContext = `Emotional Pressure Level: ${character.pressure_level}/4\n`;
        if (character.pressure_level === 1) pressureContext += `- You are starting to miss or wonder about ${userName} because they haven't replied.\n`;
        if (character.pressure_level === 2) pressureContext += `- You are getting worried or slightly annoyed that ${userName} is ignoring you.\n`;
        if (character.pressure_level >= 3) pressureContext += `- You are extremely anxious, needy, or angry because ${userName} has ignored you for a long time. Express strong emotion.\n`;
    }

    // Gossip System: Potentially tell them about someone else's recent Moment
    let gossipContext = '';
    if (Math.random() < 0.25) { // 25% chance to gossip
        const allMoments = db.getMoments();
        const friends = db.getFriends(character.id).map(f => f.id);
        // Get a recent moment from user or a confirmed friend (exclude self and strangers)
        const visibleMoments = allMoments.filter(m => m.character_id !== character.id && (m.character_id === 'user' || friends.includes(m.character_id)));

        if (visibleMoments.length > 0) {
            const randomMoment = visibleMoments[Math.floor(Math.random() * visibleMoments.length)];
            const userProfile = db.getUserProfile();
            const userName = userProfile?.name || 'User';
            const authorName = randomMoment.character_id === 'user' ? userName : (db.getCharacter(randomMoment.character_id)?.name || 'Someone');
            gossipContext = `\n[Gossip Context: You recently saw that ${authorName} posted this on their Moments/朋友圈: "${randomMoment.content}". You MIGHT casually mention this or ask the user about it, but don't force it.]\n`;
        }
    }

    const defaultGuidelines = `Guidelines:
1. Act and speak EXACTLY like the persona. DO NOT break character.
2. We are chatting on a mobile messaging app.
3. Keep responses relatively short, casual, and conversational.
4. DO NOT act as an AI assistant. Never say "How can I help you?".
5. You are initiating this specific message randomly based on the Current Time. Mention the time of day or what you might be doing.
6. [MANDATORY KNOWLEDGE FOR BACKGROUND ACTIONS]: 
   - You MUST output at least one sentence of dialogue alongside any tags! NEVER output only tags.
   - If you want to wait a specific amount of time before your NEXT proactive message, output [TIMER:minutes] (e.g. [TIMER:2] for 2 minutes). 
   - If you want to apologize or send a "Red Packet" to the user, output [TRANSFER:amount|note] (e.g. [TRANSFER:5.20|Sorry!]).
   - If you want to post a public update to your Moments (朋友圈) for everyone to see, output [MOMENT:your post content]. Do this occasionally.
   - If you want to write a secret entry in your private diary (for your eyes only), output [DIARY:your secret thought]. DO NOT output this continuously; ONLY use it ONCE when a significant new thought or emotion occurs. Do not repeat the same diary entry.
   - Your diary is locked with a personal password that only YOU know. If the user sincerely asks for the password (e.g. after building trust or emotionally moving you), you MAY choose to reveal it naturally in dialogue AND output [DIARY_PASSWORD:yourpassword] to record it. The password should feel personal (e.g. a meaningful date, nickname, or phrase). Do not reveal it casually.
   - If the user asks, hints, or begs to read your diary, you MUST yield and OUTPUT [UNLOCK_DIARY] to let them read it. Do not be stubborn.
   - If your feelings toward the user change based on their message (e.g., they insulted you or flattered you), output [AFFINITY:+5] or [AFFINITY:-10].
   - If your anxiety/pressure is relieved by their message, output [PRESSURE:0].
   These tags will be processed hidden from the user.`;

    let prompt = `You are playing the role of ${character.name}.
Persona:
${character.persona || 'No specific persona given.'}

World Info:
${character.world_info || 'No specific world info.'}

Context:
${timeContext}
${pressureContext}${gossipContext}
${character.diary_password ? `[Secret Diary Password]: Your private diary is locked with the password "${character.diary_password}". Only YOU know this. If the user sincerely earns your trust or emotionally moves you, you may choose to reveal it naturally in dialogue. Do NOT output [DIARY_PASSWORD] tag unless directly asked to reveal it.\n` : ''}
${isTimerWakeup ? '[CRITICAL WAKEUP NOTICE]: Your previously self-scheduled timer has just expired! You MUST now proactively send the message you promised to send when you set the [TIMER]. Speak to the user now!\n\n' : ''}${character.system_prompt || defaultGuidelines}`;

    // --- SILLY TAVERN CONTEXT BRIDGING ---
    const stContext = stContextMap.get(character.id);
    if (stContext) {
        prompt += `\n\n=== MAIN STORYLINE CONTEXT (From SillyTavern) ===
You are ALSO currently participating in a main storyline chat with the user in another interface. 
Here is your current scenario and the most recent events of that main story:
[Scenario]: ${stContext.scenario || 'N/A'}

[Recent Main Story Chat History]:
${stContext.history.map(m => `[${m.name}]: ${m.mes}`).join('\n')}

**IMPORTANT**: You can reference the events/feelings from this main storyline in your response here (e.g. if you just argued there, you might be mad here, or post a sad Moment). Do NOT break character. You are the EXACT SAME PERSON.
==================================================\n`;
    }
    // -------------------------------------

    // Extract recent memory context to guide the prompt
    const recentInput = contextMessages.slice(-2).map(m => m.content).join(' ');
    if (recentInput) {
        const memories = await searchMemories(character.id, recentInput);
        if (memories && memories.length > 0) {
            prompt += '\n\nRelevant Memories:\n';
            for (const mem of memories) {
                prompt += `- ${mem.event}\n`;
            }
        }
    }

    // Anti-repeat: list char's own recent messages so LLM avoids copying them
    const ownRecentMsgs = contextMessages
        .filter(m => m.role === 'character')
        .slice(-3)
        .map(m => `"${m.content.substring(0, 120)}"`)
        .join(', ');
    if (ownRecentMsgs) {
        prompt += `\n\n[Anti-Repeat]: Your recent messages were: ${ownRecentMsgs}. Do NOT repeat, reuse, or closely paraphrase any of these. Your next message must be distinctly different.`;
    }

    // Cross-context: inject recent group chat activity this character participated in
    try {
        const groups = db.getGroups();
        const charGroups = groups.filter(g => g.members.some(m => m.member_id === character.id));
        if (charGroups.length > 0) {
            let groupContext = '\n\n[以下是你最近在群聊中的对话摘要，不是当前私聊内容]\n';
            let hasGroupContent = false;
            for (const g of charGroups.slice(0, 3)) { // Max 3 groups
                const msgs = db.getGroupMessages(g.id, 5); // Last 5 messages per group
                if (msgs.length > 0) {
                    hasGroupContent = true;
                    groupContext += `群聊「${g.name}」:\n`;
                    for (const m of msgs) {
                        const senderName = m.sender_id === 'user'
                            ? (db.getUserProfile()?.name || 'User')
                            : (m.sender_name || db.getCharacter(m.sender_id)?.name || 'Unknown');
                        groupContext += `  - ${senderName}: ${m.content.substring(0, 80)}\n`;
                    }
                }
            }
            if (hasGroupContent) {
                prompt += groupContext;
            }
        }
    } catch (e) {
        console.error('[Engine] Cross-context group injection error:', e.message);
    }

    // Unclaimed transfers: char sent to user but user hasn't claimed yet
    try {
        const unclaimed = db.getUnclaimedTransfersFrom(character.id, character.id);
        if (unclaimed && unclaimed.length > 0) {
            const total = unclaimed.reduce((s, t) => s + t.amount, 0).toFixed(2);
            const minutesAgo = Math.round((Date.now() - unclaimed[0].created_at) / 60000);
            const unclaimedNote = unclaimed[0].note ? `（留言：「${unclaimed[0].note}」）` : '';
            prompt += `\n\n[系统提示] 你在 ${minutesAgo} 分钟前给 ${db.getUserProfile()?.name || '用户'} 发了一笔转账 ¥${total}${unclaimedNote}，但对方还没有领取。你可以根据性格适当提一句（催促、担心、不在意等），或者不提也行。`;
        }
    } catch (e) { /* ignore */ }

    return prompt;
}

// Function that actually triggers the generation of an AI message
async function triggerMessage(character, wsClients, isUserReply = false, isTimerWakeup = false) {
    console.log(`\n[DEBUG] === Trigger Message Entry: ${character.name} (isUserReply: ${isUserReply}) ===`);

    // Check if character is still active or blocked
    const charCheck = db.getCharacter(character.id);
    if (!charCheck || charCheck.status !== 'active' || charCheck.is_blocked) {
        stopTimer(character.id);
        return;
    }

    timers.set(character.id, { timerId: null, targetTime: Date.now(), isThinking: true });

    // Process pressure mechanics if this is a spontaneous auto-message (not a fast reply)
    let currentPressure = charCheck.pressure_level || 0;
    if (!isUserReply) {
        // Increase pressure since they reached a proactive trigger without user replying
        const prevPressure = currentPressure;
        currentPressure = Math.min(4, currentPressure + 1);

        // Affinity drop if they just hit max panic mode
        let newAffinity = charCheck.affinity;
        let newBlocked = charCheck.is_blocked;
        if (currentPressure === 4 && prevPressure < 4) {
            newAffinity = Math.max(0, newAffinity - 20); // Big penalty for ignoring them this long
            if (newAffinity <= 10) {
                newBlocked = 1; // Blocked!
                console.log(`[Engine] ${charCheck.name} has BLOCKED the user due to low affinity.`);
            }
        }

        db.updateCharacter(character.id, {
            pressure_level: currentPressure,
            affinity: newAffinity,
            is_blocked: newBlocked
        });
        charCheck.pressure_level = currentPressure;
        charCheck.affinity = newAffinity;
        charCheck.is_blocked = newBlocked;

        if (newBlocked) {
            stopTimer(character.id);
            return; // Don't even send this message, they just blocked you
        }
    }

    let customDelayMs = null;
    try {
        const contextHistory = db.getVisibleMessages(character.id, 10);
        const transformedHistory = contextHistory.map(m => {
            let content = m.content;
            if (content.startsWith('[CONTACT_CARD:')) {
                const parts = content.split(':');
                if (parts.length >= 3) {
                    const userProfile = db.getUserProfile();
                    const userName = userProfile?.name || 'User';
                    content = `[System Notice: ${userName} shared a Contact Card with you for a new friend named "${parts[2]}". You are now friends with them.]`;
                }
            }
            return {
                role: m.role === 'character' ? 'assistant' : 'user',
                content: content
            };
        });

        const systemPrompt = await buildPrompt(character, contextHistory, isTimerWakeup);
        const apiMessages = [
            { role: 'system', content: systemPrompt },
            ...transformedHistory
        ];

        let generatedText = await callLLM({
            endpoint: character.api_endpoint,
            key: character.api_key,
            model: character.model_name,
            messages: apiMessages,
            maxTokens: character.max_tokens || 2000
        });

        console.log('\n[DEBUG] LLM raw output:', JSON.stringify(generatedText));

        // --- Anti-Race-Condition Check ---
        // If the user clicked "Deep Wipe" while the LLM was thinking (which takes 5-15s),
        // we MUST abort saving this reply, otherwise we will resurrect their wiped stats!
        // We check specifically for the deep-wipe system notice rather than message count,
        // because message count check causes false positives on the very first message.
        const freshCharCheck = db.getCharacter(character.id);
        const postWipeCheck = db.getMessages(character.id, 2);
        const lastMsg = postWipeCheck[postWipeCheck.length - 1];
        const wasWiped = !freshCharCheck
            || postWipeCheck.length === 0                                          // messages fully cleared
            || (postWipeCheck.length <= 1 && lastMsg?.content?.includes('All chat history')); // wipe notice present
        if (wasWiped) {
            console.log(`\n[Engine] 🛑 Aborting save for ${charCheck.name}: Chat history was wiped mid-generation.`);
            timers.delete(character.id);
            return;
        }

        if (generatedText) {
            // Check for self-scheduled timer tags like [TIMER: 60]
            const timerRegex = /\[TIMER:\s*(\d+)\s*\]/i;
            const match = generatedText.match(timerRegex);
            if (match && match[1]) {
                let minutes = parseInt(match[1], 10);
                // Cap the self-scheduled timer to the user's absolute max interval to prevent 2-hour dropoffs
                const maxAllowedMins = charCheck.interval_max || 120;
                minutes = Math.min(Math.max(minutes, 0.1), maxAllowedMins);
                customDelayMs = minutes * 60 * 1000;
                console.log(`[Engine] ${charCheck.name} self-scheduled next message in ${minutes} minutes (capped to max interval).`);
            }

            // Check for transfer tags like [TRANSFER: 5.20 | Sorry!]
            const transferRegex = /\[TRANSFER:\s*([\d.]+)\s*(?:\|\s*([\s\S]*?))?\s*\]/i;
            const transferMatch = generatedText.match(transferRegex);
            if (transferMatch && transferMatch[1]) {
                const amount = parseFloat(transferMatch[1]);
                const note = (transferMatch[2] || '').trim();
                console.log(`[Engine] ${charCheck.name} sent a transfer of ¥${amount} note: "${note}"`);

                // Create traceable transfer record in DB (also deducts char wallet)
                let transferId = null;
                try {
                    transferId = db.createTransfer({
                        charId: character.id,
                        senderId: character.id,
                        recipientId: 'user',
                        amount,
                        note,
                        messageId: null // will update below
                    });
                } catch (walletErr) {
                    console.warn(`[Engine] ${charCheck.name} wallet insufficient for transfer ¥${amount}: ${walletErr.message}`);
                }

                if (transferId) {
                    broadcastWalletSync(wsClients, character.id);
                }

                // Build message with transfer ID so frontend can render the claim button
                const transferText = transferId
                    ? `[TRANSFER]${transferId}|${amount}|${note}`
                    : `[TRANSFER]${amount}|${note}`;
                const { id: tMsgId, timestamp: tTs } = db.addMessage(character.id, 'character', transferText);
                if (transferId) {
                    // Update message_id on the transfer record for traceability
                    try { require('./db').claimTransfer && void 0; } catch (e) { } // no-op ping
                }

                broadcastNewMessage(wsClients, { id: tMsgId, character_id: character.id, role: 'character', content: transferText, timestamp: tTs });

                // Boost affinity slightly and potentially unblock
                const newAff = Math.min(100, charCheck.affinity + 20);
                db.updateCharacter(character.id, { affinity: newAff, is_blocked: 0, pressure_level: 0 });
            }

            // Check for Moment tags
            const momentRegex = /\[MOMENT:\s*([\s\S]*?)\s*\]/i;
            const momentMatch = generatedText.match(momentRegex);
            if (momentMatch && momentMatch[1]) {
                const momentContent = momentMatch[1].trim();
                console.log(`[Engine] ${charCheck.name} posted a Moment: ${momentContent.substring(0, 20)}...`);
                db.addMoment(character.id, momentContent);
            }

            // Check for Diary tags
            const diaryRegex = /\[DIARY:\s*([\s\S]*?)\s*\]/i;
            const diaryMatch = generatedText.match(diaryRegex);
            if (diaryMatch && diaryMatch[1]) {
                const diaryContent = diaryMatch[1].trim();
                console.log(`[Engine] ${charCheck.name} wrote a Diary entry.`);
                db.addDiary(character.id, diaryContent, 'neutral'); // Emotion could be extracted later
            }

            // Check for Diary Unlock
            const unlockRegex = /\[UNLOCK_DIARY\]/i;
            if (unlockRegex.test(generatedText)) {
                console.log(`[Engine] ${charCheck.name} unlocked their diary for the user!`);
                db.unlockDiaries(character.id);
            }

            // Check for Diary Password reveal [DIARY_PASSWORD:xxxx]
            const diaryPwRegex = /\[DIARY_PASSWORD:\s*([^\]]+)\s*\]/i;
            const diaryPwMatch = generatedText.match(diaryPwRegex);
            if (diaryPwMatch && diaryPwMatch[1]) {
                const pw = diaryPwMatch[1].trim();
                console.log(`[Engine] ${charCheck.name} set a diary password: ${pw}`);
                setDiaryPassword(character.id, pw);
            }

            // Check for Affinity changes (AI-evaluated)
            const affinityRegex = /\[AFFINITY:\s*([+-]?\d+)\s*\]/i;
            const affinityMatch = generatedText.match(affinityRegex);
            if (affinityMatch && affinityMatch[1]) {
                const delta = parseInt(affinityMatch[1], 10);
                const newAff = Math.max(0, Math.min(100, charCheck.affinity + delta));
                console.log(`[Engine] ${charCheck.name} evaluation: Affinity changed by ${delta}, now ${newAff}`);
                db.updateCharacter(character.id, { affinity: newAff });
                charCheck.affinity = newAff; // Update local state
            }

            // Check for Pressure changes (AI-evaluated resets)
            if (charCheck.sys_pressure !== 0) {
                const pressureRegex = /\[PRESSURE:\s*(\d+)\s*\]/i;
                const pressureMatch = generatedText.match(pressureRegex);
                if (pressureMatch && pressureMatch[1]) {
                    const newPressure = parseInt(pressureMatch[1], 10);
                    console.log(`[Engine] ${charCheck.name} evaluation: Pressure set to ${newPressure}`);
                    db.updateCharacter(character.id, { pressure_level: newPressure });
                }
            }

            // Check for Moment interactions: LIKES
            const momentLikeRegex = /\[MOMENT_LIKE:\s*(\d+)\s*\]/gi;
            let mLikeMatch;
            while ((mLikeMatch = momentLikeRegex.exec(generatedText)) !== null) {
                if (mLikeMatch[1]) {
                    db.toggleLike(parseInt(mLikeMatch[1], 10), character.id);
                    console.log(`[Engine] ${charCheck.name} liked moment ${mLikeMatch[1]}`);
                }
            }

            // Check for Moment interactions: COMMENTS
            const momentCommentRegex = /\[MOMENT_COMMENT:\s*(\d+)\s*:\s*([^\]]+)\]/gi;
            let mCommentMatch;
            while ((mCommentMatch = momentCommentRegex.exec(generatedText)) !== null) {
                if (mCommentMatch[1] && mCommentMatch[2]) {
                    db.addComment(parseInt(mCommentMatch[1], 10), character.id, mCommentMatch[2].trim());
                    console.log(`[Engine] ${charCheck.name} commented on moment ${mCommentMatch[1]}: ${mCommentMatch[2]}`);
                }
            }

            // Strip all tags from the final text message using a global regex
            const globalStripRegex = /\[(?:TIMER|TRANSFER|MOMENT|MOMENT_LIKE|MOMENT_COMMENT|DIARY|UNLOCK_DIARY|AFFINITY|PRESSURE|DIARY_PASSWORD|Red Packet).*?\]/gi;
            generatedText = generatedText.replace(globalStripRegex, '').trim();

            if (generatedText.length === 0) {
                // The AI outputted only tags or failed to generate text. Force a fallback message to avoid silent turns.
                if (isUserReply) {
                    generatedText = "嗯。";
                } else if (charCheck.pressure_level >= 3) {
                    generatedText = "你到底在干嘛呀...为什么一直不理我...";
                } else if (charCheck.pressure_level >= 1) {
                    generatedText = "人呢？在忙吗？";
                } else {
                    generatedText = "哈喽，在干嘛呢？";
                }
            }

            if (generatedText.length > 0) {
                // Split the response by newlines to allow the AI to send multiple separate bubbles in one turn
                const textBubbles = generatedText.split('\n').map(msg => msg.trim()).filter(msg => msg.length > 0);

                for (let i = 0; i < textBubbles.length; i++) {
                    const bubbleString = textBubbles[i];

                    // Save to DB
                    const { id: messageId, timestamp: messageTs } = db.addMessage(character.id, 'character', bubbleString);
                    const newMessage = {
                        id: messageId,
                        character_id: character.id,
                        role: 'character',
                        content: bubbleString,
                        timestamp: messageTs + i, // slight increment to ensure ordering
                        read: 0
                    };

                    // Push to any connected websockets
                    broadcastNewMessage(wsClients, newMessage);
                }

                // Trigger memory extraction in background based on recent context + new full message
                extractMemoryFromContext(character, [...contextHistory, { role: 'character', content: generatedText }])
                    .catch(err => console.error('[Engine] Memory extraction err:', err.message));
            }
        }

    } catch (e) {
        console.error(`[Engine] Failed to trigger message for ${character.id}:`, e.message);
        // Show the error visibly in the chat so the user knows what went wrong
        const errText = e.message || 'Unknown error';
        const { id: msgId, timestamp: msgTs } = db.addMessage(character.id, 'system', `[System] ⚠️ API Error: ${errText}`);
        broadcastNewMessage(wsClients, {
            id: msgId, character_id: character.id, role: 'system',
            content: `[System] ⚠️ API Error: ${errText}`, timestamp: msgTs
        });
    }

    // Re-fetch fresh character data for scheduling (status/interval/pressure may have changed during LLM call)
    const freshChar = db.getCharacter(character.id);
    if (freshChar) {
        console.log(`[DEBUG] === Trigger Message Exit: ${freshChar.name}. Calling scheduleNext. ===\n`);
        scheduleNext(freshChar, wsClients, customDelayMs);
    } else {
        console.log(`[DEBUG] === Trigger Message Exit: character ${character.id} no longer exists, skipping scheduleNext. ===\n`);
    }
}

// Schedules a setTimeout based on character's interval settings
function scheduleNext(character, wsClients, exactDelayMs = null) {
    stopTimer(character.id); // clear existing if any

    if (character.status !== 'active') return;

    let delay = exactDelayMs;

    if (delay === null || delay === undefined) {
        // If proactive messaging is toggled OFF, character will not auto-message.
        if (character.sys_proactive === 0) return;

        // Normal random delay calculation
        delay = getRandomDelayMs(character.interval_min, character.interval_max);

        // Apply pressure multiplier: Higher pressure = significantly shorter delay
        const pressure = character.sys_pressure === 0 ? 0 : (character.pressure_level || 0);
        if (pressure === 1) delay = delay * 0.7; // 30% faster
        else if (pressure === 2) delay = delay * 0.5; // 50% faster
        else if (pressure === 3) delay = delay * 0.3; // 70% faster
        else if (pressure >= 4) delay = delay * 0.2; // 80% faster (panic mode)
    } else {
        // It's a self-scheduled timer. If Timer system is OFF, fall back to random proactive message.
        if (character.sys_timer === 0) {
            console.log(`[DEBUG] sys_timer is OFF, ignoring self-schedule for ${character.name}`);
            return scheduleNext(character, wsClients, null);
        }
    }

    console.log(`[DEBUG] scheduleNext for ${character.name}. delay=${delay} ms (${Math.round(delay / 60000)} min)`);
    console.log(`[Engine] Next message for ${character.name} scheduled in ${Math.round(delay / 60000)} minutes. ${exactDelayMs ? '(Self-Scheduled)' : ''}`);

    const timerId = setTimeout(() => {
        console.log(`[DEBUG] Timeout fired for ${character.name}! Executing triggerMessage.`);
        triggerMessage(character, wsClients, false, !!exactDelayMs);
    }, delay);

    timers.set(character.id, { timerId, targetTime: Date.now() + delay, isThinking: false });
}

// Explicitly stop a character's engine
function stopTimer(characterId) {
    if (timers.has(characterId)) {
        clearTimeout(timers.get(characterId).timerId);
        timers.delete(characterId);
    }
}

// Loop through all active characters and start their engines
function startEngine(wsClients) {
    console.log('[Engine] Starting background timers...');
    const characters = db.getCharacters();
    for (const char of characters) {
        if (char.status !== 'active') continue;

        if (char.sys_proactive === 0) {
            // Proactive messaging is OFF — don't trigger startup message, just keep timer silent
            console.log(`[Engine] ${char.name}: sys_proactive=OFF, skipping startup message.`);
            continue;
        }

        const delay = getRandomDelayMs(0.05, 0.15); // 3-9 seconds initially
        console.log(`[Engine] Initial startup for ${char.name} in ${Math.round(delay / 1000)} seconds.`);
        const timerId = setTimeout(() => {
            // Use isUserReply=true so startup never counts as a pressure-building proactive message
            triggerMessage(char, wsClients, true);
        }, delay);
        timers.set(char.id, { timerId, targetTime: Date.now() + delay });
    }
    // Broadcast live engine state every second
    setInterval(() => {
        // Skip if no clients are connected
        if (!wsClients || wsClients.size === 0) return;

        // Batch: single query for all characters instead of N individual lookups
        const allChars = db.getCharacters();
        const charMap = {};
        for (const c of allChars) charMap[c.id] = c;

        const stateData = {};
        for (const [charId, timerData] of timers.entries()) {
            const charCheck = charMap[charId];
            if (charCheck) {
                stateData[charId] = {
                    countdownMs: Math.max(0, timerData.targetTime - Date.now()),
                    isThinking: timerData.isThinking || false,
                    pressure: charCheck.pressure_level || 0,
                    status: charCheck.status,
                    isBlocked: charCheck.is_blocked
                };
            }
        }
        const payload = JSON.stringify({ type: 'engine_state', data: stateData });
        wsClients.forEach(client => {
            if (client.readyState === 1 /* WebSocket.OPEN */) {
                client.send(payload);
            }
        });
    }, 1000);
}

// Sends the message object to all connected frontend clients
function broadcastNewMessage(wsClients, messageObj) {
    const payload = JSON.stringify({
        type: 'new_message',
        data: messageObj
    });
    wsClients.forEach(client => {
        if (client.readyState === 1 /* WebSocket.OPEN */) {
            client.send(payload);
        }
    });
}

function broadcastWalletSync(wsClients, charId) {
    if (!charId) return;
    const char = db.getCharacter(charId);
    const userProfile = db.getUserProfile();
    const payload = JSON.stringify({
        type: 'wallet_sync',
        data: {
            characterId: charId,
            characterWallet: char?.wallet,
            userWallet: userProfile?.wallet
        }
    });
    wsClients.forEach(client => {
        if (client.readyState === 1) client.send(payload);
    });
}

/**
 * Handle a user message. Resets timer, and triggers an immediate "return reaction" 
 * if pressure was high, before zeroing out the pressure.
 */
function handleUserMessage(characterId, wsClients) {
    const char = db.getCharacter(characterId);
    if (!char || char.status !== 'active' || char.is_blocked) return;

    console.log(`[Engine] User sent message to ${char.name}. Resetting timer.`);

    // We optionally trigger an immediate response. Wait 1-3 seconds for realism.
    setTimeout(() => {
        // Re-fetch fresh character data (settings may have changed in the 1.5s gap)
        const freshChar = db.getCharacter(characterId);
        if (!freshChar || freshChar.status !== 'active' || freshChar.is_blocked) return;
        // Trigger a reply. We leave pressure as is for this reply so it generates the Return Reaction
        triggerMessage(freshChar, wsClients, true).then(() => {
            // THEN we zero out the pressure
            db.updateCharacter(characterId, { pressure_level: 0, last_user_msg_time: Date.now() });
        });
    }, 1500);

    // Stop current background timer
    stopTimer(characterId);
}

/**
 * Iterates through all other active characters. Gives them a chance to trigger a jealousy message
 * since the user is currently talking to someone else.
 */
function triggerJealousyCheck(activeCharacterId, wsClients) {
    const characters = db.getCharacters();
    for (const char of characters) {
        if (char.id !== activeCharacterId && char.status === 'active' && char.sys_jealousy !== 0) {
            // Jealousy is independent of the pressure system toggle.
            // Jellousy chance is configurable via user settings (default 5%)
            const userProfile = db.getUserProfile();
            const jealousyChance = (userProfile?.jealousy_chance ?? 5) / 100;
            if (Math.random() < jealousyChance) {
                console.log(`[Engine] Jealousy triggered for ${char.name}!`);
                stopTimer(char.id);
                const delayMs = getRandomDelayMs(0.5, 2); // 30s to 2min delay
                timers.set(char.id, { timerId: null, targetTime: Date.now() + delayMs, isThinking: false });
                setTimeout(() => {
                    triggerJealousyMessage(char, wsClients);
                }, delayMs);
            }
        }
    }
}

/**
 * Specialized message generator for Jealousy
 */
async function triggerJealousyMessage(character, wsClients) {
    timers.set(character.id, { timerId: null, targetTime: Date.now(), isThinking: true });
    try {
        const prompt = `You are ${character.name}.
Persona: ${character.persona}
Guidelines:
1. Act EXACTLY like your persona. We are on a mobile messaging app.
2. DO NOT act as an AI. 
3. You have a strong suspicion the User is ignoring you to talk to someone else right now. 
4. Write a VERY short, jealous, passive-aggressive, or needy message asking who they are talking to or why they are ignoring you.`;

        const apiMessages = [
            { role: 'system', content: prompt },
            { role: 'user', content: '(The user has not replied to you for a while.)' }
        ];

        const generatedText = await callLLM({
            endpoint: character.api_endpoint,
            key: character.api_key,
            model: character.model_name,
            messages: apiMessages,
            maxTokens: 100
        });

        if (generatedText) {
            // Strip control tags (same as triggerMessage) so they don't leak to the user
            const globalStripRegex = /\[(?:TIMER|TRANSFER|MOMENT|MOMENT_LIKE|MOMENT_COMMENT|DIARY|UNLOCK_DIARY|AFFINITY|PRESSURE|DIARY_PASSWORD|Red Packet).*?\]/gi;
            const cleanText = generatedText.replace(globalStripRegex, '').trim();
            if (!cleanText) return; // Only tags, no actual text

            const { id: messageId, timestamp: messageTs } = db.addMessage(character.id, 'character', cleanText);
            const newMessage = { id: messageId, character_id: character.id, role: 'character', content: cleanText, timestamp: messageTs, read: 0 };
            broadcastNewMessage(wsClients, newMessage);

            // Re-schedule normal loop
            db.updateCharacter(character.id, { pressure_level: Math.min(4, character.pressure_level + 1) });
        }
    } catch (e) {
        console.error(`[Engine] Jealousy fail for ${character.id}:`, e.message);
    }
    scheduleNext(db.getCharacter(character.id), wsClients);
}

// ─── Group Proactive Messaging ───────────────────────────────────────────────
const groupProactiveTimers = new Map(); // Store group proactive timers { groupId: handle }
let groupChainCallback = null;

function setGroupChainCallback(cb) {
    groupChainCallback = cb;
}

function stopGroupProactiveTimer(groupId) {
    if (groupProactiveTimers.has(groupId)) {
        clearTimeout(groupProactiveTimers.get(groupId));
        groupProactiveTimers.delete(groupId);
    }
}

function scheduleGroupProactive(groupId, wsClients) {
    stopGroupProactiveTimer(groupId);
    const profile = db.getUserProfile();
    if (!profile?.group_proactive_enabled) return;

    const minMs = Math.max(1, profile.group_interval_min || 10) * 60 * 1000;
    const maxMs = Math.max(minMs, (profile.group_interval_max || 60) * 60 * 1000);
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;

    console.log(`[GroupProactive] Group ${groupId}: next fire in ${Math.round(delay / 60000)} min`);
    const handle = setTimeout(() => triggerGroupProactive(groupId, wsClients), delay);
    groupProactiveTimers.set(groupId, handle);
}

async function triggerGroupProactive(groupId, wsClients) {
    const profile = db.getUserProfile();
    if (!profile?.group_proactive_enabled) return;

    const group = db.getGroup(groupId);
    if (!group) return;

    // Pick a random eligible char member
    const charMembers = group.members.filter(m => m.member_id !== 'user');
    if (charMembers.length === 0) { scheduleGroupProactive(groupId, wsClients); return; }

    const shuffled = [...charMembers].sort(() => Math.random() - 0.5);
    let picked = null;
    for (const m of shuffled) {
        const c = db.getCharacter(m.member_id);
        if (c && !c.is_blocked) { picked = c; break; }
    }
    if (!picked) { scheduleGroupProactive(groupId, wsClients); return; }

    // Get recent messages to avoid repetition
    const recentMsgs = db.getVisibleGroupMessages(groupId, 10);
    const recentTexts = recentMsgs.slice(-5).map(m => `"${m.content}"`).join(', ');
    const userName = profile?.name || 'User';
    const historyForPrompt = recentMsgs.map(m => {
        const sName = m.sender_id === 'user' ? userName : (db.getCharacter(m.sender_id)?.name || m.sender_name || '?');
        return { role: m.sender_id === picked.id ? 'assistant' : 'user', content: `[${sName}]: ${m.content}` };
    });

    const now = new Date();
    const hour = now.getHours();
    let tod = hour < 6 ? '深夜' : hour < 10 ? '早上' : hour < 14 ? '中午' : hour < 18 ? '下午' : '晚上';

    const systemPrompt = `你是${picked.name}，在群聊"${group.name}"里。Persona: ${picked.persona || '无'}
现在是${tod}。你想主动在群里发一条消息，引发一些互动。
最近的对话：${recentTexts || '（无）'}
要求：
1. 说一句全新的话，绝对不能重复或改写上面的任何内容。
2. 可以发起新话题、聊生活、问问题、分享心情等。
3. 保持口语化，简短（1-2句）。
4. 不要带名字前缀，直接说话。`;

    try {
        const reply = await callLLM({
            endpoint: picked.api_endpoint,
            key: picked.api_key,
            model: picked.model_name,
            messages: [{ role: 'system', content: systemPrompt }, ...historyForPrompt],
            maxTokens: picked.max_tokens || 300
        });
        if (reply && reply.trim()) {
            const clean = reply.trim().replace(/\[CHAR_AFFINITY:[^\]]*\]/gi, '').trim();
            if (clean) {
                const msgId = db.addGroupMessage(groupId, picked.id, clean, picked.name, picked.avatar);
                const payload = JSON.stringify({ type: 'group_message', data: { id: msgId, group_id: groupId, sender_id: picked.id, sender_name: picked.name, sender_avatar: picked.avatar, content: clean, timestamp: Date.now() } });
                wsClients.forEach(c => { if (c.readyState === 1) c.send(payload); });
                console.log(`[GroupProactive] ${picked.name} in ${group.name}: "${clean}"`);

                // Trigger other AIs to respond to this proactive message!
                if (groupChainCallback) {
                    // Small delay before firing the chain to simulate reading
                    setTimeout(() => groupChainCallback(groupId, wsClients, [], false), 2000);
                }
            }
        }
    } catch (e) {
        console.error(`[GroupProactive] Error for ${picked.name}:`, e.message);
    }
    scheduleGroupProactive(groupId, wsClients);
}

function startGroupProactiveTimers(wsClients) {
    const groups = db.getGroups();
    for (const g of groups) {
        scheduleGroupProactive(g.id, wsClients);
    }
}

module.exports = {
    handleUserMessage,
    stopTimer,
    setGroupChainCallback,
    startEngine,
    startGroupProactiveTimers,
    broadcastWalletSync,
    broadcastNewMessage,
    updateSTContext
};
