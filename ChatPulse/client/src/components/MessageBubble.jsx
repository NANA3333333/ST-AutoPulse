import React, { useState, useEffect } from 'react';
import { AlertCircle, ArrowRightLeft } from 'lucide-react';
import { useLanguage } from '../LanguageContext';

function BlockedSystemMessage({ name }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '20px 0', gap: '8px' }}>
            <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                backgroundColor: '#fff1f1', border: '1px solid #ffc0c0',
                borderRadius: '10px', padding: '10px 18px',
                color: '#c0392b', fontSize: '13px', fontWeight: '500'
            }}>
                🚫 {name} 已将你拉黑。消息已发出，但对方不会收到。
            </div>
            <div style={{ fontSize: '11px', color: '#bbb' }}>
                尝试转账来解锁对话。
            </div>
        </div>
    );
}

/* Interactive Transfer Card — handles both old and new formats */
function TransferCardInteractive({ content, isUser, apiUrl }) {
    const { lang } = useLanguage();
    const raw = content.replace('[TRANSFER]', '').trim();
    const parts = raw.split('|');

    // Detect format: new has tid|amount|note (tid is numeric), old has amount|note
    let tid = null, amount = '0', note = 'Transfer';
    if (parts.length >= 3 && /^\d+$/.test(parts[0].trim())) {
        tid = parseInt(parts[0].trim());
        amount = parts[1].trim();
        note = parts.slice(2).join('|').trim() || 'Transfer';
    } else if (parts.length >= 1) {
        amount = parts[0].trim();
        note = parts.length > 1 ? parts.slice(1).join('|').trim() : 'Transfer';
    }

    const [transferInfo, setTransferInfo] = useState(null);
    const [actionDone, setActionDone] = useState(false);

    useEffect(() => {
        if (!tid || !apiUrl) return;
        let cancelled = false;
        let pollCount = 0;
        const fetchStatus = () => {
            fetch(`${apiUrl}/transfers/${tid}`)
                .then(r => r.ok ? r.json() : null)
                .then(d => { if (d && !cancelled) setTransferInfo(d); })
                .catch(() => { });
        };
        fetchStatus();
        // Poll every 5s up to 30 times (~2.5 min) to catch AI's claim/refund decision
        const interval = setInterval(() => {
            pollCount++;
            if (pollCount > 30) { clearInterval(interval); return; }
            fetchStatus();
        }, 5000);
        return () => { cancelled = true; clearInterval(interval); };
    }, [tid, apiUrl]);

    // Auto-update UI when status resolves
    // DB returns: claimed (0/1), refunded (0/1) — NOT a 'status' string
    const isClaimed = !!(transferInfo?.claimed);
    const isRefunded = !!(transferInfo?.refunded);
    const isPending = transferInfo ? (!isClaimed && !isRefunded) : true;

    useEffect(() => {
        if (isClaimed || isRefunded) setActionDone(true);
    }, [isClaimed, isRefunded]);

    const handleClaim = async () => {
        if (!tid) return;
        try {
            await fetch(`${apiUrl}/transfers/${tid}/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
            setActionDone(true);
            const r = await fetch(`${apiUrl}/transfers/${tid}`);
            if (r.ok) setTransferInfo(await r.json());
        } catch (e) { console.error(e); }
    };

    const handleRefund = async () => {
        if (!tid) return;
        try {
            await fetch(`${apiUrl}/transfers/${tid}/refund`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
            setActionDone(true);
            const r = await fetch(`${apiUrl}/transfers/${tid}`);
            if (r.ok) setTransferInfo(await r.json());
        } catch (e) { console.error(e); }
    };

    return (
        <div style={{ background: 'linear-gradient(135deg, #fff5f0 0%, #ffe8d8 100%)', borderRadius: '12px', padding: '12px 15px', width: '220px', boxSizing: 'border-box', border: '1px solid #ffd4a8' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <span style={{ fontSize: '24px' }}>💰</span>
                <div>
                    <div style={{ fontWeight: '600', fontSize: '15px', color: '#e67e22' }}>¥{amount}</div>
                    <div style={{ fontSize: '12px', color: '#999' }}>{note}</div>
                </div>
            </div>
            {/* Status badge — shown when claimed or refunded */}
            {(isClaimed || isRefunded) && (
                <div style={{ fontSize: '12px', color: '#999', textAlign: 'center', padding: '4px 0' }}>
                    {isClaimed
                        ? (lang === 'en' ? '✅ Claimed' : '✅ 已领取')
                        : (lang === 'en' ? '↩️ Refunded' : '↩️ 已退回')}
                </div>
            )}
            {/* Buttons: only for recipient (not sender) when still pending */}
            {tid && isPending && !actionDone && !isUser && (
                <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                    <button onClick={handleClaim}
                        title={lang === 'en' ? 'Accept this transfer and add to your wallet' : '接受转账，入账到你的钱包'}
                        style={{ flex: 1, padding: '7px', fontSize: '12px', background: '#e67e22', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }}>
                        {lang === 'en' ? '💰 Claim' : '💰 领取'}
                    </button>
                    <button onClick={handleRefund}
                        title={lang === 'en' ? 'Return this transfer back to the sender' : '将转账退回给发送者'}
                        style={{ flex: 1, padding: '7px', fontSize: '12px', background: '#fff', color: '#e67e22', border: '1px solid #e67e22', borderRadius: '8px', cursor: 'pointer', fontWeight: '500' }}>
                        {lang === 'en' ? '↩️ Refund' : '↩️ 退回'}
                    </button>
                </div>
            )}
            {/* Sender sees waiting status when still pending */}
            {tid && isPending && !actionDone && isUser && (
                <div style={{ fontSize: '11px', color: '#bbb', textAlign: 'center', marginTop: '4px', fontStyle: 'italic' }}>
                    {lang === 'en' ? '⏳ Waiting for response...' : '⏳ 等待对方回应...'}
                </div>
            )}
        </div>
    );
}

function MessageBubble({ message, avatar, characterName, apiUrl }) {
    const isUser = message.role === 'user';
    const content = message.content || '';  // null-safe: old DB records may have null content
    const { lang } = useLanguage();

    if (message.role === 'system') {
        return (
            <div style={{ textAlign: 'center', margin: '8px 0' }}>
                <span style={{ fontSize: '12px', color: '#aaa', backgroundColor: '#f0f0f0', padding: '3px 10px', borderRadius: '10px' }}>
                    {content.replace('[System] ', '')}
                </span>
            </div>
        );
    }

    return (
        <>
            <div className={`message-wrapper ${isUser ? 'user' : 'character'}`}>
                <div className="message-avatar">
                    <img src={avatar} alt="Avatar" />
                </div>
                <div className="message-content">
                    {content.startsWith('[TRANSFER]') ? (
                        <TransferCardInteractive content={content} isUser={isUser} apiUrl={apiUrl} />
                    ) : content.startsWith('[CONTACT_CARD:') ? (
                        (() => {
                            const parts = content.split(':');
                            if (parts.length >= 4) {
                                const cardName = parts[2];
                                const cardAvatar = parts.slice(3).join(':');
                                return (
                                    <div className="message-bubble" style={{ padding: 0, overflow: 'hidden', backgroundColor: '#fff', color: '#333', textAlign: 'left', width: '220px', boxSizing: 'border-box', border: '1px solid #eaeaea' }}>
                                        <div style={{ padding: '12px 15px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid #f0f0f0' }}>
                                            <img src={cardAvatar.replace(']', '')} alt={cardName} style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' }} />
                                            <div style={{ fontSize: '16px', fontWeight: '400' }}>{cardName}</div>
                                        </div>
                                        <div style={{ padding: '4px 15px 6px', fontSize: '12px', color: '#999' }}>
                                            个人名片
                                        </div>
                                    </div>
                                );
                            }
                            return <div className="message-bubble">{content}</div>;
                        })()
                    ) : (
                        <div className="message-bubble">
                            {content}
                        </div>
                    )}
                    {message.timestamp && (
                        <div style={{
                            fontSize: '11px', color: '#bbb', marginTop: '4px',
                            display: 'flex', gap: '6px', alignItems: 'center',
                            justifyContent: isUser ? 'flex-end' : 'flex-start'
                        }}>
                            <span>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                    )}
                </div>
                {message.isBlocked && (
                    <div className="message-blocked-icon" title="消息已发出，但被对方拒收了。">
                        <AlertCircle size={20} color="var(--danger)" />
                    </div>
                )}
            </div>
            {message.isBlocked && isUser && (
                <BlockedSystemMessage name={characterName || '对方'} />
            )}
        </>
    );
}

export default MessageBubble;
