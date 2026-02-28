import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Users, Smile, Paperclip, X, Settings, Trash2, UserMinus, ArrowRightLeft, Gift, ChevronLeft } from 'lucide-react';
import { useLanguage } from '../LanguageContext';

const quickEmojis = ['😀', '😂', '🥺', '😡', '🥰', '👍', '🙏', '💔', '🔥', '✨', '🥳', '😭', '😎', '🙄', '🤔'];

/* ─── Red Packet Send Modal ─── */
function RedPacketModal({ group, apiUrl, onClose, userWallet }) {
    const { lang } = useLanguage();
    const [type, setType] = useState('lucky');
    const [amount, setAmount] = useState('');
    const [count, setCount] = useState(group?.members?.length || 3);
    const [note, setNote] = useState('');
    const isFixed = type === 'fixed';
    const cnt = Math.max(1, parseInt(count) || 1);
    const amt = Math.max(0, parseFloat(amount) || 0);
    const totalCost = isFixed ? amt * cnt : amt;
    const overBudget = totalCost > (userWallet ?? 100);
    const isValid = amt > 0 && cnt > 0 && !overBudget;

    const onSend = async () => {
        if (!isValid) return;
        try {
            const payload = isFixed
                ? { type, count: cnt, per_amount: amt, total_amount: totalCost, note: note.trim() }
                : { type, count: cnt, total_amount: totalCost, note: note.trim() };

            await fetch(`${apiUrl}/groups/${group.id}/redpackets`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            onClose();
        } catch (e) { console.error(e); }
    };

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div style={{ width: '340px', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,0.3)', background: '#fff' }}>
                <div style={{ background: 'linear-gradient(135deg,#d63031,#c0392b)', padding: '18px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ color: '#fff', fontWeight: '700', fontSize: '17px' }}>🧧 {lang === 'en' ? 'Send Red Packet' : '发送红包'}</span>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#ffcccb', cursor: 'pointer', fontSize: '20px', lineHeight: 1 }}>×</button>
                </div>
                <div style={{ display: 'flex', borderBottom: '1px solid #f0f0f0' }}>
                    {[['lucky', lang === 'en' ? '🎲 Lucky' : '🎲 拼手气'], ['fixed', lang === 'en' ? '📦 Regular' : '📦 普通']].map(([t, label]) => (
                        <button key={t} onClick={() => setType(t)}
                            style={{
                                flex: 1, padding: '10px', border: 'none', cursor: 'pointer', fontWeight: type === t ? '700' : '400',
                                background: type === t ? '#fff5f5' : '#fff', color: type === t ? '#c0392b' : '#666', borderBottom: type === t ? '2px solid #c0392b' : '2px solid transparent'
                            }}>
                            {label}
                        </button>
                    ))}
                </div>
                <div style={{ padding: '16px 20px' }}>
                    <div style={{ marginBottom: '14px' }}>
                        <label style={{ fontSize: '12px', color: '#999', display: 'block', marginBottom: '5px' }}>{lang === 'en' ? 'Number of packets' : '红包个数'}</label>
                        <input type="number" min="1" value={count} onChange={e => setCount(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #eee', fontSize: '16px', boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ marginBottom: '14px' }}>
                        <label style={{ fontSize: '12px', color: '#999', display: 'block', marginBottom: '5px' }}>
                            {isFixed ? (lang === 'en' ? 'Amount per person (¥)' : '每人金额（元）') : (lang === 'en' ? 'Total amount (¥)' : '总金额（元）')}
                        </label>
                        <input type="number" min="0.01" step="0.01" placeholder="¥" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #eee', fontSize: '16px', boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ fontSize: '12px', color: '#999', display: 'block', marginBottom: '5px' }}>{lang === 'en' ? 'Message (optional)' : '留言（可选）'}</label>
                        <input type="text" placeholder={lang === 'en' ? 'Leave a message...' : '写点什么...'} value={note} onChange={e => setNote(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #eee', fontSize: '14px', boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ background: '#fafafa', borderRadius: '8px', padding: '10px 12px', marginBottom: '16px', fontSize: '13px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#555' }}>
                            <span>{lang === 'en' ? 'Total cost:' : '合计：'}</span>
                            <span style={{ fontWeight: '600', color: totalCost > 0 ? '#c0392b' : '#aaa' }}>¥{totalCost > 0 ? totalCost.toFixed(2) : '0.00'}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#aaa', marginTop: '4px' }}>
                            <span>{lang === 'en' ? 'My wallet:' : '我的余额：'}</span>
                            <span style={{ color: overBudget ? '#e53935' : 'var(--accent-color)' }}>¥{(userWallet ?? 0).toFixed(2)}</span>
                        </div>
                        {overBudget && <div style={{ color: '#e53935', fontSize: '12px', marginTop: '6px' }}>⚠️ {lang === 'en' ? 'Insufficient balance' : '余额不足'}</div>}
                    </div>
                    <button onClick={onSend} disabled={!isValid}
                        style={{ width: '100%', padding: '13px', background: isValid ? 'linear-gradient(135deg,#d63031,#c0392b)' : '#ccc', color: '#fff', border: 'none', borderRadius: '10px', cursor: isValid ? 'pointer' : 'not-allowed', fontSize: '15px', fontWeight: '700' }}>
                        {lang === 'en' ? '🧧 Send' : '🧧 塞钱进红包'}
                    </button>
                </div>
            </div>
        </div>
    );
}

/* ─── Red Packet Card (parsed from [REDPACKET:id] in content) ─── */
function RedPacketCard({ packetId, apiUrl, groupId, isUser, resolveSender }) {
    const { lang } = useLanguage();
    const [pkt, setPkt] = useState(null);
    const [showDetail, setShowDetail] = useState(false);

    const loadPkt = useCallback(async () => {
        try { const r = await fetch(`${apiUrl}/groups/${groupId}/redpackets/${packetId}`); setPkt(await r.json()); } catch (e) { console.error(e); }
    }, [apiUrl, groupId, packetId]);
    useEffect(() => { if (packetId) loadPkt(); }, [packetId, loadPkt]);

    const handleClaim = async () => {
        try {
            await fetch(`${apiUrl}/groups/${groupId}/redpackets/${packetId}/claim`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ claimer_id: 'user' })
            });
            loadPkt();
        } catch (e) { console.error(e); }
    };

    if (!pkt) return <div style={{ padding: '8px', color: '#aaa', fontSize: '13px' }}>🧧 Loading...</div>;
    const isExpired = pkt.claims?.length >= pkt.count;
    const userClaimed = pkt.claims?.some(c => c.claimer_id === 'user');

    return (
        <div style={{ background: 'linear-gradient(135deg, #fff5f5 0%, #ffe8e8 100%)', borderRadius: '12px', padding: '12px 15px', width: '220px', boxSizing: 'border-box', border: '1px solid #ffccbc', cursor: 'pointer' }}
            onClick={() => setShowDetail(!showDetail)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <span style={{ fontSize: '24px' }}>🧧</span>
                <div>
                    <div style={{ fontWeight: '600', fontSize: '14px', color: '#c0392b' }}>{pkt.note || (lang === 'en' ? 'Red Packet' : '红包')}</div>
                    <div style={{ fontSize: '11px', color: '#999' }}>
                        {pkt.type === 'fixed' ? (lang === 'en' ? 'Regular' : '普通红包') : (lang === 'en' ? 'Lucky' : '拼手气红包')}
                        {' · '}{pkt.claims?.length || 0}/{pkt.count}
                    </div>
                </div>
            </div>
            {!isExpired && !userClaimed && (
                <button onClick={e => { e.stopPropagation(); handleClaim(); }}
                    style={{ width: '100%', padding: '8px', background: '#fff0eb', color: '#e67e22', border: '1px solid #ffd4a8', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '13px' }}>
                    {lang === 'en' ? '🧧 Open' : '🧧 拆红包'}
                </button>
            )}
            {(isExpired || userClaimed) && (
                <div style={{ fontSize: '12px', color: '#999', textAlign: 'center' }}>
                    {userClaimed ? (lang === 'en' ? '✅ Claimed' : '✅ 已领取') : (lang === 'en' ? 'All claimed' : '已抢完')}
                </div>
            )}
            {showDetail && (
                <div style={{ background: '#fff8f0', borderRadius: '10px', padding: '10px 12px', marginTop: '6px', border: '1px solid #ffe0b2' }}>
                    <div style={{ fontSize: '12px', color: '#888', marginBottom: '6px', display: 'flex', justifyContent: 'space-between' }}>
                        <span>{lang === 'en' ? 'Claims:' : '领取记录'}</span>
                        <span>¥{pkt.total_amount?.toFixed(2)} {lang === 'en' ? 'total' : '总计'}</span>
                    </div>
                    {(!pkt.claims || pkt.claims.length === 0) && <div style={{ fontSize: '12px', color: '#bbb' }}>{lang === 'en' ? 'No one yet' : '暂无人领取'}</div>}
                    {pkt.claims?.map((c, i) => {
                        const s = resolveSender(c.claimer_id);
                        return (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                <img src={s.avatar} alt="" style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover' }} />
                                <span style={{ fontSize: '13px', flex: 1 }}>{s.name}</span>
                                <span style={{ fontSize: '13px', color: '#c0392b', fontWeight: '600' }}>¥{c.amount?.toFixed(2)}</span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

/* ─── Right-side Group Management Drawer ─── */
function GroupManageDrawer({ group, apiUrl, resolveSender, onClose, lang }) {
    const [noChain, setNoChain] = useState(false);

    useEffect(() => {
        if (!group) return;
        fetch(`${apiUrl}/groups/${group.id}/no-chain`).then(r => r.json()).then(d => setNoChain(!!d.no_chain)).catch(() => { });
    }, [group, apiUrl]);


    const toggleNoChain = async () => {
        const v = !noChain; setNoChain(v);
        fetch(`${apiUrl}/groups/${group.id}/no-chain`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ no_chain: v }) });
    };
    const clearMessages = () => { if (window.confirm(lang === 'en' ? 'Clear all messages?' : '清空所有消息？')) fetch(`${apiUrl}/groups/${group.id}/messages`, { method: 'DELETE' }).then(() => window.location.reload()); };
    const dissolveGroup = () => { if (window.confirm(lang === 'en' ? 'Dissolve this group?' : '解散此群？')) fetch(`${apiUrl}/groups/${group.id}`, { method: 'DELETE' }).then(() => window.location.reload()); };
    const kickMember = (mid) => { if (window.confirm(lang === 'en' ? 'Remove this member?' : '移除此成员？')) fetch(`${apiUrl}/groups/${group.id}/members/${mid}`, { method: 'DELETE' }).then(() => window.location.reload()); };


    return (
        <div style={{ width: '280px', minWidth: '280px', backgroundColor: '#f7f7f7', borderLeft: '1px solid #eee', display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
            {/* Header */}
            <div style={{ padding: '12px 15px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff' }}>
                <h3 style={{ margin: 0, fontSize: '15px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Settings size={16} /> {lang === 'en' ? 'Group Management' : '群管理'}
                </h3>
                <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}><X size={18} /></button>
            </div>

            {/* Members */}
            <div style={{ backgroundColor: '#fff', padding: '12px 15px', borderBottom: '1px solid #eee' }}>
                <div style={{ fontSize: '12px', color: '#999', marginBottom: '10px', textTransform: 'uppercase' }}>
                    {lang === 'en' ? 'Members' : '群成员'} ({group.members?.length || 0})
                </div>
                {group.members?.map(memberObj => {
                    const mid = memberObj.member_id || memberObj;
                    const m = resolveSender(mid);
                    return (
                        <div key={mid} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 0' }}>
                            <img src={m.avatar} alt="" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover' }} />
                            <span style={{ flex: 1, fontSize: '13px' }}>{m.name}</span>
                            {mid !== 'user' && (
                                <button onClick={() => kickMember(mid)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '2px' }} title={lang === 'en' ? 'Remove member from group' : '将该成员踢出群聊'}>
                                    <UserMinus size={14} />
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* AI Controls */}
            <div style={{ backgroundColor: '#fff', padding: '12px 15px', borderBottom: '1px solid #eee', marginTop: '8px' }}>
                <div style={{ fontSize: '12px', color: '#999', marginBottom: '10px', textTransform: 'uppercase' }}>
                    {lang === 'en' ? 'AI Controls' : 'AI 控制'}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '14px' }}>
                    <span>{lang === 'en' ? '⚡ Prevent AI Chaining' : '⚡ 禁止AI互相接话'}</span>
                    <label style={{ position: 'relative', display: 'inline-block', width: '44px', height: '24px' }}>
                        <input type="checkbox" checked={noChain} onChange={toggleNoChain} style={{ opacity: 0, width: 0, height: 0 }} />
                        <span style={{ position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: noChain ? 'var(--accent-color)' : '#ccc', borderRadius: '24px', transition: '0.3s' }}>
                            <span style={{ position: 'absolute', height: '18px', width: '18px', left: noChain ? '23px' : '3px', bottom: '3px', backgroundColor: 'white', borderRadius: '50%', transition: '0.3s' }} />
                        </span>
                    </label>
                </div>
            </div>

            {/* Danger Zone */}
            <div style={{ backgroundColor: '#fff', padding: '12px 15px', marginTop: '8px' }}>
                <div style={{ fontSize: '12px', color: '#999', marginBottom: '10px', textTransform: 'uppercase' }}>
                    {lang === 'en' ? 'Danger Zone' : '危险操作'}
                </div>
                <button onClick={clearMessages} title={lang === 'en' ? 'Delete all messages in this group' : '清空群聊中的所有消息'} style={{ width: '100%', padding: '10px', background: '#fff', border: '1px solid #ddd', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                    <Trash2 size={14} /> {lang === 'en' ? 'Clear Messages' : '清空消息'}
                </button>
                <button onClick={dissolveGroup} title={lang === 'en' ? 'Permanently dissolve this group chat' : '永久解散此群聊'} style={{ width: '100%', padding: '10px', background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                    💥 {lang === 'en' ? 'Dissolve Group' : '解散群聊'}
                </button>
            </div>
        </div>
    );
}

/* ─── Main GroupChatWindow ─── */
function GroupChatWindow({ group, apiUrl, allContacts, userProfile, newGroupMessage, typingIndicators, onBack }) {
    const { lang } = useLanguage();
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [showRedPacketModal, setShowRedPacketModal] = useState(false);
    const [showManageDrawer, setShowManageDrawer] = useState(false);
    const messagesEndRef = useRef(null);
    const fileInputRef = useRef(null);
    const textareaRef = useRef(null);

    // Mentions logic
    const [showMentionMenu, setShowMentionMenu] = useState(false);
    const [mentionFilter, setMentionFilter] = useState('');
    const [mentionIndex, setMentionIndex] = useState(0);

    useEffect(() => {
        if (!group?.id) return;
        setMessages([]); setShowManageDrawer(false);
        fetch(`${apiUrl}/groups/${group.id}/messages`).then(r => r.json()).then(setMessages).catch(console.error);
    }, [group?.id, apiUrl]);

    useEffect(() => {
        if (newGroupMessage && group?.id && newGroupMessage.group_id === group.id) {
            setMessages(prev => prev.find(m => m.id === newGroupMessage.id) ? prev : [...prev, newGroupMessage]);
        }
    }, [newGroupMessage, group?.id]);

    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }, [messages]);

    const handleSend = async () => {
        if (!input.trim() || !group) return;
        const text = input.trim(); setInput('');
        try { await fetch(`${apiUrl}/groups/${group.id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text }) }); } catch (e) { console.error(e); }
    };

    const handleFileChange = (e) => {
        const file = e.target.files[0]; if (!file) return;
        e.target.value = '';
        if (file.size > 100 * 1024) { alert(lang === 'en' ? `File too large (${(file.size / 1024).toFixed(1)} KB). Max 100 KB.` : `文件太大。最大 100 KB。`); return; }
        const reader = new FileReader();
        reader.onload = (ev) => { const snippet = `📄 [${file.name}]\n${ev.target.result}`; setInput(prev => prev ? prev + '\n' + snippet : snippet); };
        reader.onerror = () => alert(lang === 'en' ? 'Failed to read file' : '读取文件失败');
        reader.readAsText(file, 'utf-8');
    };

    const resolveSender = (senderId) => {
        if (senderId === 'user') return { name: userProfile?.name || 'User', avatar: userProfile?.avatar || 'https://api.dicebear.com/7.x/notionists/svg?seed=User' };
        const char = allContacts?.find(c => String(c.id) === String(senderId));
        return char || { name: senderId, avatar: `https://api.dicebear.com/7.x/pixel-art/svg?seed=${senderId}` };
    };

    const addEmoji = (emoji) => { setInput(prev => prev + emoji); setShowEmojiPicker(false); };

    // --- MENTION HANDLERS ---
    const availableMentions = React.useMemo(() => {
        if (!group) return [];
        const base = [{ id: 'all', name: lang === 'en' ? 'All' : '全体成员', avatar: 'https://api.dicebear.com/7.x/shapes/svg?seed=All' }];
        if (group.members) {
            group.members.forEach(memberObj => {
                const mid = typeof memberObj === 'object' ? memberObj.member_id : memberObj;
                if (mid !== 'user') base.push(resolveSender(mid));
            });
        }
        return base.filter(m => m.name.toLowerCase().includes(mentionFilter.toLowerCase()));
    }, [group, mentionFilter, allContacts, lang]);

    const handleInputChange = (e) => {
        const val = e.target.value;
        setInput(val);
        const cursor = e.target.selectionStart;
        const textBeforeCursor = val.substring(0, cursor);
        const lastAtIndex = textBeforeCursor.lastIndexOf('@');
        if (lastAtIndex !== -1 && (lastAtIndex === 0 || /[\\s\\n]/.test(textBeforeCursor[lastAtIndex - 1]))) {
            const query = textBeforeCursor.substring(lastAtIndex + 1);
            if (!/\\s/.test(query)) {
                setMentionFilter(query);
                setShowMentionMenu(true);
                setMentionIndex(0);
                return;
            }
        }
        setShowMentionMenu(false);
    };

    const handleMentionSelect = (member) => {
        const cursor = textareaRef.current?.selectionStart || input.length;
        const textBeforeCursor = input.substring(0, cursor);
        const lastAtIndex = textBeforeCursor.lastIndexOf('@');
        if (lastAtIndex !== -1) {
            const beforeMention = input.substring(0, lastAtIndex);
            const afterMention = input.substring(cursor);
            const newText = beforeMention + `@${member.name} ` + afterMention;
            setInput(newText);
            setTimeout(() => {
                if (textareaRef.current) {
                    const newPos = lastAtIndex + member.name.length + 2;
                    textareaRef.current.setSelectionRange(newPos, newPos);
                    textareaRef.current.focus();
                }
            }, 0);
        }
        setShowMentionMenu(false);
    };

    const handleKeyDown = (e) => {
        if (showMentionMenu && availableMentions.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(p => Math.min(p + 1, availableMentions.length - 1)); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(p => Math.max(p - 1, 0)); return; }
            if (e.key === 'Enter') { e.preventDefault(); handleMentionSelect(availableMentions[mentionIndex]); return; }
            if (e.key === 'Escape') { setShowMentionMenu(false); return; }
        }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    };
    // ------------------------


    // Parse message content to detect special types
    const parseContent = (content) => {
        if (!content) return { type: 'text', text: '' };
        // Red packet: [REDPACKET:123]
        const rpMatch = content.trim().match(/^\[REDPACKET:(\d+)\]\s*$/);
        if (rpMatch) return { type: 'redpacket', packetId: parseInt(rpMatch[1]) };
        // Transfer: [TRANSFER] amount | note
        if (content.startsWith('[TRANSFER]')) return { type: 'transfer', content };
        // System
        if (content.startsWith('[System]')) return { type: 'system', text: content.replace('[System] ', '') };
        return { type: 'text', text: content };
    };

    if (!group) return null;

    return (
        <>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', minWidth: 0 }}>
                {/* Header */}
                <div className="chat-header">
                    <div className="chat-header-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button className="mobile-back-btn" onClick={onBack} title="Back">
                            <ChevronLeft size={24} />
                        </button>
                        <Users size={20} />
                        {group.name}
                        <span style={{ fontSize: '12px', color: '#999' }}>({group.members?.length || 0})</span>
                    </div>
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <button onClick={() => setShowManageDrawer(!showManageDrawer)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: showManageDrawer ? 'var(--danger)' : 'var(--accent-color)' }}
                            title={lang === 'en' ? 'Group management — members, AI controls, danger zone' : '群管理 — 成员、AI 控制、危险操作'}>
                            <Settings size={20} />
                        </button>
                    </div>
                </div>

                {/* Messages */}
                <div className="chat-history">
                    {messages.map(msg => {
                        const sender = resolveSender(msg.sender_id);
                        const isUser = msg.sender_id === 'user';
                        const parsed = parseContent(msg.content);

                        // System message
                        if (msg.sender_id === 'system' || parsed.type === 'system') {
                            return (
                                <div key={msg.id} style={{ textAlign: 'center', margin: '8px 0' }}>
                                    <span style={{ fontSize: '12px', color: '#aaa', backgroundColor: '#f0f0f0', padding: '3px 10px', borderRadius: '10px' }}>
                                        {parsed.text || (msg.content || '').replace('[System] ', '')}
                                    </span>
                                </div>
                            );
                        }

                        // Red packet
                        if (parsed.type === 'redpacket') {
                            return (
                                <div key={msg.id} className={`message-wrapper ${isUser ? 'user' : 'character'}`}>
                                    <div className="message-avatar"><img src={sender.avatar} alt="" /></div>
                                    <div className="message-content">
                                        {!isUser && <div style={{ fontSize: '12px', color: 'var(--accent-color)', marginBottom: '2px', fontWeight: '500' }}>{sender.name}</div>}
                                        <RedPacketCard packetId={parsed.packetId} apiUrl={apiUrl} groupId={group.id} isUser={isUser} resolveSender={resolveSender} />
                                        {msg.timestamp && (
                                            <div style={{
                                                fontSize: '11px', color: '#bbb', marginTop: '4px',
                                                display: 'flex', gap: '6px', alignItems: 'center',
                                                justifyContent: isUser ? 'flex-end' : 'flex-start'
                                            }}>
                                                <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        }

                        // Transfer
                        if (parsed.type === 'transfer') {
                            const raw = parsed.content.replace('[TRANSFER]', '').trim();
                            const parts = raw.split('|');
                            const amount = parts[0].trim();
                            const note = parts.length > 1 ? parts.slice(1).join('|').trim() : 'Transfer';
                            return (
                                <div key={msg.id} className={`message-wrapper ${isUser ? 'user' : 'character'}`}>
                                    <div className="message-avatar"><img src={sender.avatar} alt="" /></div>
                                    <div className="message-content">
                                        {!isUser && <div style={{ fontSize: '12px', color: 'var(--accent-color)', marginBottom: '2px', fontWeight: '500' }}>{sender.name}</div>}
                                        <div className="message-bubble transfer-bubble">
                                            <div className="transfer-icon-area"><ArrowRightLeft size={24} color="#fff" /></div>
                                            <div className="transfer-text-area">
                                                <div className="transfer-amount">¥{amount}</div>
                                                <div className="transfer-note">{note}</div>
                                            </div>
                                        </div>
                                        {msg.timestamp && (
                                            <div style={{
                                                fontSize: '11px', color: '#bbb', marginTop: '4px',
                                                display: 'flex', gap: '6px', alignItems: 'center',
                                                justifyContent: isUser ? 'flex-end' : 'flex-start'
                                            }}>
                                                <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        }

                        // Normal message
                        return (
                            <div key={msg.id} className={`message-wrapper ${isUser ? 'user' : 'character'}`}>
                                <div className="message-avatar"><img src={sender.avatar} alt="" /></div>
                                <div className="message-content">
                                    {!isUser && <div style={{ fontSize: '12px', color: 'var(--accent-color)', marginBottom: '2px', fontWeight: '500' }}>{sender.name}</div>}
                                    <div className="message-bubble">{msg.content}</div>
                                    {msg.timestamp && (
                                        <div style={{
                                            fontSize: '11px', color: '#bbb', marginTop: '4px',
                                            display: 'flex', gap: '6px', alignItems: 'center',
                                            justifyContent: isUser ? 'flex-end' : 'flex-start'
                                        }}>
                                            <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    <div ref={messagesEndRef} />
                </div>

                {/* Typing indicators and Interrupt Button */}
                {(typingIndicators.length > 0) && (
                    <div style={{ padding: '4px 15px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ color: '#999', fontSize: '13px', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ display: 'inline-block', animation: 'pulse 1.5s infinite' }}>✨</span>
                            {typingIndicators.map(t => t.name).join(', ')} {lang === 'en' ? 'typing...' : '正在输入中...'}
                        </div>
                        <button
                            onClick={async () => {
                                // Instantly interrupt AIs
                                await fetch(`${apiUrl}/groups/${group.id}/ai-pause`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: true }) });
                                // Automatically unpause after 10 seconds or when user sends a message
                                setTimeout(() => {
                                    fetch(`${apiUrl}/groups/${group.id}/ai-pause`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: false }) });
                                }, 10000);
                            }}
                            title={lang === 'en' ? 'Interrupt AIs and stop them from chaining texts' : '打断 AI 的连续发言'}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '4px', background: '#fff0f0', border: '1px solid #ffcccc', color: 'var(--danger)',
                                padding: '4px 10px', borderRadius: '14px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 2px 5px rgba(240,107,142,0.1)'
                            }}
                        >
                            ✋ {lang === 'en' ? 'Interrupt' : '打断'}
                        </button>
                    </div>
                )}

                {/* Input area — matches private chat InputBar style */}
                <div className="input-area">
                    <div className="input-toolbar" style={{ position: 'relative' }}>
                        <button onClick={() => setShowEmojiPicker(!showEmojiPicker)} title={lang === 'en' ? 'Insert emoji' : '插入表情'}><Smile size={20} /></button>
                        <button onClick={() => fileInputRef.current?.click()} title={lang === 'en' ? 'Send file' : '发送文件'}><Paperclip size={20} /></button>
                        <input ref={fileInputRef} type="file" accept=".txt,.md,.csv,.json,.log,.py,.js,.ts,.html,.css,.xml,.yaml,.yml" style={{ display: 'none' }} onChange={handleFileChange} />
                        <button onClick={() => setShowRedPacketModal(true)} title={lang === 'en' ? 'Send red packet — lucky money for group' : '发红包 — 给群友发财运'}>
                            <Gift size={20} color="var(--danger)" />
                        </button>

                        {showEmojiPicker && (
                            <div className="emoji-picker" style={{ position: 'absolute', bottom: '50px', left: '10px', backgroundColor: '#fff', border: '1px solid #ddd', borderRadius: '8px', padding: '10px', display: 'flex', flexWrap: 'wrap', gap: '5px', width: '220px', boxShadow: '0 -4px 12px rgba(0,0,0,0.1)', zIndex: 100 }}>
                                <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-end', marginBottom: '5px' }}>
                                    <button onClick={() => setShowEmojiPicker(false)} style={{ padding: '2px' }}><X size={14} /></button>
                                </div>
                                {quickEmojis.map(e => (
                                    <span key={e} onClick={() => addEmoji(e)} style={{ fontSize: '20px', cursor: 'pointer', padding: '4px', borderRadius: '4px' }}>{e}</span>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="input-textarea-wrapper" style={{ position: 'relative' }}>
                        {showMentionMenu && availableMentions.length > 0 && (
                            <div className="mention-menu" style={{ position: 'absolute', bottom: '100%', left: 0, backgroundColor: '#fff', border: '1px solid #ddd', borderRadius: '8px', padding: '6px 0', width: '240px', maxHeight: '200px', overflowY: 'auto', boxShadow: '0 -4px 12px rgba(0,0,0,0.1)', zIndex: 100, marginBottom: '8px' }}>
                                {availableMentions.map((m, i) => (
                                    <div key={m.id} onClick={() => handleMentionSelect(m)} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 15px', cursor: 'pointer', backgroundColor: i === mentionIndex ? '#f0f9eb' : 'transparent' }} onMouseEnter={() => setMentionIndex(i)}>
                                        <img src={m.avatar} alt="" style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }} />
                                        <span style={{ fontSize: '14px', fontWeight: '500', color: i === mentionIndex ? 'var(--accent-color)' : '#333' }}>{m.name}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        <textarea
                            ref={textareaRef}
                            className="input-textarea"
                            value={input}
                            onChange={handleInputChange}
                            onKeyDown={handleKeyDown}
                            placeholder={lang === 'en' ? 'Type a message...' : '输入消息...'}
                        />
                    </div>
                    <div className="input-actions">
                        <button className="send-button" onClick={handleSend}>{lang === 'en' ? 'Send' : '发送'}</button>
                    </div>
                </div>
            </div>

            {showManageDrawer && (
                <GroupManageDrawer group={group} apiUrl={apiUrl} resolveSender={resolveSender}
                    onClose={() => setShowManageDrawer(false)} lang={lang} />
            )}

            {/* Red Packet Modal */}
            {showRedPacketModal && (
                <RedPacketModal group={group} apiUrl={apiUrl} onClose={() => setShowRedPacketModal(false)} userWallet={userProfile?.wallet ?? 100} />
            )}
        </>
    );
}

export default GroupChatWindow;
