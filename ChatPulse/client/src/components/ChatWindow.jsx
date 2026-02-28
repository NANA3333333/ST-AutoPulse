import React, { useState, useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble';
import InputBar from './InputBar';
import TransferModal from './TransferModal';
import RecommendModal from './RecommendModal';
import { Send, Smile, Paperclip, Bell, Users, EyeOff, ShieldBan, Trash, BookOpen, Brain, MoreHorizontal, UserPlus, Gift, Heart, UserMinus, ShieldAlert, BadgeInfo, Eye, ChevronLeft } from 'lucide-react';
import { useLanguage } from '../LanguageContext';

// Parse /hide 0-xx, /hide xx, /unhide commands
function parseHideCommand(text) {
    const hideRangeMatch = text.match(/^\/hide\s+(\d+)\s*[-~]\s*(\d+)\s*$/i);
    if (hideRangeMatch) return { cmd: 'hide', start: parseInt(hideRangeMatch[1]), end: parseInt(hideRangeMatch[2]) };

    const hideSingleMatch = text.match(/^\/hide\s+(\d+)\s*$/i);
    if (hideSingleMatch) return { cmd: 'hide', start: 0, end: parseInt(hideSingleMatch[1]) };

    const unhideMatch = text.match(/^\/unhide\s*$/i);
    if (unhideMatch) return { cmd: 'unhide' };

    return null;
}

function SystemMessage({ text }) {
    return (
        <div style={{ textAlign: 'center', margin: '8px 0' }}>
            <span style={{ fontSize: '12px', color: '#aaa', backgroundColor: '#f0f0f0', padding: '3px 10px', borderRadius: '10px' }}>
                {text}
            </span>
        </div>
    );
}

function ChatWindow({ contact, allContacts, apiUrl, newIncomingMessage, engineState, onToggleMemo, onToggleDiary, onToggleSettings, userAvatar, onBack }) {
    const { t, lang } = useLanguage();
    const [messages, setMessages] = useState([]);
    const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
    const [isRecommendModalOpen, setIsRecommendModalOpen] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [showHidden, setShowHidden] = useState(false);
    const PAGE_SIZE = 100;
    const prevBlockedRef = useRef(false);
    const messagesEndRef = useRef(null);
    // contactRef keeps the current contact ID stable inside async callbacks
    const contactRef = useRef(contact);
    useEffect(() => { contactRef.current = contact; }, [contact]);

    const isCurrentlyBlocked = engineState?.[contact?.id]?.isBlocked === 1;

    // Fetch most recent messages when contact changes
    useEffect(() => {
        if (!contact?.id) return;
        setMessages([]);
        setHasMore(false);
        fetch(`${apiUrl} /messages/${contact.id}?limit = ${PAGE_SIZE} `)
            .then(res => res.json())
            .then(data => {
                setMessages(data);
                // If we got a full page, there are probably more older messages
                setHasMore(data.length >= PAGE_SIZE);
            })
            .catch(err => console.error('Failed to load messages:', err));
    }, [contact?.id, apiUrl]);

    const loadMore = async () => {
        if (loadingMore || messages.length === 0) return;
        setLoadingMore(true);
        const oldest = messages[0];
        try {
            const data = await fetch(
                `${apiUrl} /messages/${contactRef.current?.id}?limit = ${PAGE_SIZE}& before=${oldest.id} `
            ).then(r => r.json());
            if (data.length > 0) {
                setMessages(prev => [...data, ...prev]);
                setHasMore(data.length >= PAGE_SIZE);
            } else {
                setHasMore(false);
            }
        } catch (e) {
            console.error('Failed to load more:', e);
        }
        setLoadingMore(false);
    };

    // Handle new incoming WS messages
    useEffect(() => {
        if (newIncomingMessage && contact?.id && newIncomingMessage.character_id === contact.id) {
            setMessages(prev => {
                if (prev.some(m => m.id === newIncomingMessage.id)) return prev;
                return [...prev, newIncomingMessage];
            });
        }
    }, [newIncomingMessage, contact?.id]);

    // Detect when a character goes from unblocked -> blocked mid-session and inject a system message
    useEffect(() => {
        const isBlocked = engineState?.[contact?.id]?.isBlocked === 1;
        if (isBlocked && !prevBlockedRef.current) {
            setMessages(prev => [...prev, {
                id: `block - event - ${Date.now()} `,
                character_id: contact?.id,
                role: 'system',
                content: `[System] ${contact?.name} 将你拉黑了。`,
                timestamp: Date.now()
            }]);
        }
        prevBlockedRef.current = isBlocked;
    }, [engineState, contact?.id, contact?.name]);

    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }, [messages]);

    const handleSend = async (text) => {
        const currentContactId = contactRef.current?.id;
        if (!currentContactId) return;

        // Check for /hide or /unhide slash commands
        const hideCmd = parseHideCommand(text.trim());
        if (hideCmd) {
            if (hideCmd.cmd === 'hide') {
                const res = await fetch(`${apiUrl} /messages/${currentContactId}/hide`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ startIdx: hideCmd.start, endIdx: hideCmd.end })
                });
                const data = await res.json();
                if (data.success && contactRef.current?.id === currentContactId) {
                    const updated = await fetch(`${apiUrl}/messages/${currentContactId}`).then(r => r.json());
                    setMessages(updated);
                }
            } else if (hideCmd.cmd === 'unhide') {
                const res = await fetch(`${apiUrl}/messages/${currentContactId}/unhide`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                const data = await res.json();
                if (data.success && contactRef.current?.id === currentContactId) {
                    const updated = await fetch(`${apiUrl}/messages/${currentContactId}`).then(r => r.json());
                    setMessages(updated);
                }
            }
            return;
        }

        try {
            const res = await fetch(`${apiUrl}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ characterId: currentContactId, content: text })
            });
            const data = await res.json();
            // Only update state if we're still looking at the same contact
            if (contactRef.current?.id !== currentContactId) return;
            if (data.blocked && data.message) {
                setMessages(prev => [...prev, { ...data.message, isBlocked: true }]);
            }
        } catch (e) {
            console.error('Failed to send:', e);
        }
    };

    const handleTransfer = async (amount, note) => {
        const currentContactId = contactRef.current?.id;
        setIsTransferModalOpen(false);
        try {
            const res = await fetch(`${apiUrl}/characters/${currentContactId}/transfer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount, note })
            });
            const data = await res.json();
            if (data.success && contactRef.current?.id === currentContactId) {
                // Refresh messages to pick up the new transfer message with tid
                const updated = await fetch(`${apiUrl}/messages/${currentContactId}`).then(r => r.json());
                setMessages(updated);
            }
        } catch (e) {
            console.error('Transfer failed:', e);
        }
    };

    const handleRecommendContact = async (targetCharId) => {
        setIsRecommendModalOpen(false);
        try {
            const res = await fetch(`${apiUrl}/characters/${contactRef.current?.id}/friends`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target_id: targetCharId })
            });
            const data = await res.json();
            if (data.success) {
                const updated = await fetch(`${apiUrl}/messages/${contactRef.current?.id}`).then(r => r.json());
                setMessages(updated);
            } else {
                alert(lang === 'en' ? 'Failed to recommend contact: ' + data.error : '推荐联系人失败: ' + data.error);
            }
        } catch (e) {
            console.error('Failed to recommend contact:', e);
            alert(lang === 'en' ? 'Network error.' : '网络错误。');
        }
    };

    if (!contact) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', width: '100%' }}>
                <span className="fa-solid fa-spinner fa-spin" style={{ fontSize: '24px', color: 'var(--accent-color)' }}></span>
            </div>
        );
    }

    const hiddenCount = messages.filter(m => m.hidden).length;
    // Always show all messages to the user. Hidden = dimmed (AI won't see them).
    // showHidden controls whether the dim effect + badge are visible or not.

    return (
        <>
            <div className="chat-header">
                <div className="chat-header-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button className="mobile-back-btn" onClick={onBack} title="Back">
                        <ChevronLeft size={24} />
                    </button>
                    {contact.name}
                    {engineState?.[contact.id]?.isBlocked === 1 && <span style={{ color: 'var(--danger)', fontSize: '14px', fontWeight: 'bold' }}>(Blocked) 🚫</span>}
                </div>
                <div className="chat-header-actions">
                    <button onClick={() => setIsRecommendModalOpen(true)} title={lang === 'en' ? 'Recommend Contact' : '推荐联系人'}>
                        <UserPlus size={20} />
                    </button>
                    <button onClick={onToggleMemo} title={t('Memories')}>
                        <Brain size={20} />
                    </button>
                    <button onClick={onToggleDiary} title={t('Secret Diary')}>
                        <BookOpen size={20} />
                    </button>
                    <button onClick={onToggleSettings} title={t('Chat Settings')}>
                        <MoreHorizontal size={20} />
                    </button>
                </div>
            </div>

            {hiddenCount > 0 && (
                <div
                    style={{ display: 'flex', justifyContent: 'center', padding: '5px', background: '#fff9e0', cursor: 'pointer', fontSize: '12px', color: '#888', gap: '5px', alignItems: 'center', borderBottom: '1px solid #f0e8c0' }}
                    onClick={() => setShowHidden(h => !h)}
                >
                    {showHidden ? <Eye size={13} /> : <EyeOff size={13} />}
                    {hiddenCount} messages hidden from AI context (shown dimmed) — click to {showHidden ? 'show badges' : 'hide badges'}
                </div>
            )}

            {isCurrentlyBlocked && (
                <div style={{ textAlign: 'center', padding: '8px', background: '#ffebeb', color: 'var(--danger)', fontSize: '14px', fontWeight: 'bold', borderBottom: '1px solid #ffcccc' }}>
                    You are blocked by {contact.name}. You cannot send messages.
                </div>
            )}

            <div className="chat-history">
                {hasMore && (
                    <div style={{ textAlign: 'center', padding: '10px' }}>
                        <button
                            onClick={loadMore}
                            disabled={loadingMore}
                            style={{
                                fontSize: '12px', color: '#888', background: '#f5f5f5',
                                border: '1px solid #ddd', borderRadius: '12px',
                                padding: '5px 16px', cursor: 'pointer'
                            }}
                        >
                            {loadingMore ? t('Loading') : (lang === 'en' ? '↑ Load older messages' : '↑ 加载更早的消息')}
                        </button>
                    </div>
                )}
                {messages.map((msg, idx) => {
                    if (idx > 0 && messages[idx - 1].id === msg.id) return null;
                    return (
                        <div key={msg.id} style={msg.hidden ? {
                            opacity: 0.4, filter: 'grayscale(0.5)',
                            borderLeft: '3px solid #f0c060', paddingLeft: '4px',
                            marginBottom: '2px'
                        } : {}}>
                            <MessageBubble
                                message={msg}
                                characterName={contact.name}
                                avatar={msg.role === 'character' ? contact.avatar : (userAvatar || 'https://api.dicebear.com/7.x/notionists/svg?seed=User')}
                                apiUrl={apiUrl}
                            />
                        </div>
                    );
                })}
                {engineState?.[contact.id]?.countdownMs > 0 && engineState?.[contact.id]?.isBlocked !== 1 && (
                    <div className="message-wrapper character" style={{ marginTop: '10px' }}>
                        <div className="message-avatar" style={{ visibility: 'hidden' }}>
                            <img src={contact.avatar} alt="Avatar" />
                        </div>
                        <div className="message-content">
                            <div className="message-bubble" style={{ background: 'transparent', color: '#bbb', boxShadow: 'none', fontStyle: 'italic', padding: 0 }}>
                                {t('Thinking')} ⏱ {Math.ceil(engineState[contact.id].countdownMs / 1000)}s
                            </div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <InputBar
                onSend={handleSend}
                onTransfer={() => setIsTransferModalOpen(true)}
                onQuickHide={async () => {
                    const cid = contactRef.current?.id;
                    if (!cid) return;
                    const all = messages;
                    const half = Math.floor(all.length / 2);
                    if (half === 0) return;
                    const res = await fetch(`${apiUrl}/messages/${cid}/hide`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ startIdx: 0, endIdx: half - 1 })
                    });
                    if ((await res.json()).success && contactRef.current?.id === cid) {
                        const updated = await fetch(`${apiUrl}/messages/${cid}`).then(r => r.json());
                        setMessages(updated);
                    }
                }}
            />
            {isTransferModalOpen && (
                <TransferModal
                    contact={contact}
                    onClose={() => setIsTransferModalOpen(false)}
                    onConfirm={handleTransfer}
                />
            )}
            {isRecommendModalOpen && (
                <RecommendModal
                    apiUrl={apiUrl}
                    currentContact={contact}
                    allContacts={allContacts || []}
                    onClose={() => setIsRecommendModalOpen(false)}
                    onRecommend={handleRecommendContact}
                />
            )}
        </>
    );
}

export default ChatWindow;
