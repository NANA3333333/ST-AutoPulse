import React, { useState, useEffect } from 'react';
import { X, Trash2, Settings, RefreshCw } from 'lucide-react';
import { useLanguage } from '../LanguageContext';

function ChatSettingsDrawer({ contact, apiUrl, onClose, onClearHistory }) {
    const { t, lang } = useLanguage();
    const [relationships, setRelationships] = useState([]);
    const [regenLoading, setRegenLoading] = useState(null);
    const [regenError, setRegenError] = useState(null);

    useEffect(() => {
        if (!contact) return;
        fetch(`${apiUrl}/characters/${contact.id}/relationships`)
            .then(r => r.json())
            .then(data => setRelationships(Array.isArray(data) ? data : []))
            .catch(() => { });
    }, [contact, apiUrl]);

    const handleRegenerate = async (targetId) => {
        setRegenLoading(targetId);
        setRegenError(null);
        try {
            const r = await fetch(`${apiUrl}/characters/${contact.id}/relationships/regenerate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target_id: targetId })
            });
            const d = await r.json();
            if (!r.ok) {
                setRegenError(d.error || (lang === 'en' ? 'Generation failed' : '生成失败'));
            } else {
                setRelationships(prev => prev.map(rel =>
                    rel.targetId === targetId ? { ...rel, affinity: d.affinity ?? rel.affinity, impression: d.impression ?? rel.impression } : rel
                ));
            }
        } catch (e) {
            console.error(e);
            setRegenError(e.message || (lang === 'en' ? 'Network error' : '网络错误'));
        }
        setRegenLoading(null);
    };

    if (!contact) return null;

    const handleClearHistory = async () => {
        if (!window.confirm(lang === 'en' ?
            `Are you sure you want to completely wipe all history with ${contact.name}?\n\nThis deletes chats, memories, diaries, moments, vector indices, and resets affinity.\n\nThis cannot be undone.` :
            `确定要完全重置与 ${contact.name} 的关系吗？\n\n这将清除：聊天记录、长期记忆、日记、朋友圈、向量索引，并重置好感度。\n\n此操作不可撤销。`)) return;
        try {
            const res = await fetch(`${apiUrl}/data/${contact.id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                if (onClearHistory) onClearHistory();
            }
        } catch (e) {
            console.error('Failed to wipe character data:', e);
        }
    };

    return (
        <div className="memory-drawer" style={{ width: '320px', backgroundColor: '#f7f7f7' }}>
            <div className="memory-header">
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Settings size={18} /> {t('Chat Settings')}
                </h3>
                <button className="icon-btn" onClick={onClose}>
                    <X size={20} />
                </button>
            </div>
            <div className="memory-content" style={{ padding: '0' }}>
                {/* Contact Banner */}
                <div style={{ backgroundColor: '#fff', padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', borderBottom: '1px solid #eee' }}>
                    <img src={contact.avatar} alt={contact.name} style={{ width: '60px', height: '60px', borderRadius: '50%', marginBottom: '10px' }} />
                    <div style={{ fontSize: '18px', fontWeight: '500' }}>{contact.name}</div>
                    <div style={{ fontSize: '13px', color: '#999', marginTop: '5px', textAlign: 'center', padding: '0 10px' }}>
                        {contact.persona ? contact.persona.substring(0, 50) + '...' : (lang === 'en' ? 'No persona set.' : '未设置 Persona。')}
                    </div>
                </div>

                {/* AI Stats */}
                <div style={{ marginTop: '10px', backgroundColor: '#fff', padding: '15px', borderTop: '1px solid #eee', borderBottom: '1px solid #eee' }}>
                    <div style={{ fontSize: '12px', color: '#999', marginBottom: '15px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {lang === 'en' ? 'Hidden AI Stats' : 'AI 隐藏数据'}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '14px' }}>
                        <span>{lang === 'en' ? 'Affinity' : '好感度'}</span>
                        <span style={{ fontWeight: '500', color: contact.affinity >= 80 ? 'var(--accent-color)' : contact.affinity < 30 ? 'var(--danger)' : '#333' }}>
                            {contact.affinity} / 100
                        </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '14px' }}>
                        <span>{lang === 'en' ? 'Wallet' : '钱包余额'}</span>
                        <span style={{ fontWeight: '500', color: '#e67e22' }}>
                            💰 ¥{(contact.wallet ?? 0).toFixed(2)}
                        </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '14px' }}>
                        <span>{lang === 'en' ? 'Pressure' : '焦虑值'}</span>
                        <span style={{ fontWeight: '500', color: contact.pressure_level > 2 ? 'var(--danger)' : '#333' }}>
                            {contact.pressure_level}
                        </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
                        <span>Status</span>
                        <span style={{ fontWeight: '500', color: contact.is_blocked ? 'var(--danger)' : 'var(--accent-color)' }}>
                            {contact.is_blocked ? (lang === 'en' ? 'Blocked You' : '已拉黑') : (lang === 'en' ? 'Active' : '正常')}
                        </span>
                    </div>
                </div>

                {/* Inter-character Relationships (char-to-char impressions) */}
                <div style={{ marginTop: '10px', backgroundColor: '#fff', padding: '15px', borderTop: '1px solid #eee', borderBottom: '1px solid #eee' }}>
                    <div style={{ fontSize: '12px', color: '#999', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {lang === 'en' ? `${contact.name}'s Impressions of Others` : `${contact.name} 对其他角色的印象`}
                    </div>
                    {relationships.length === 0 ? (
                        <div style={{ fontSize: '13px', color: '#bbb', fontStyle: 'italic' }}>
                            {lang === 'en' ? 'No relationships yet.' : '还没有角色关系。'}
                        </div>
                    ) : (
                        relationships.map(rel => (
                            <div key={rel.targetId} style={{ marginBottom: '12px', padding: '10px', background: '#f8f9fa', borderRadius: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                    <img src={rel.targetAvatar || `https://api.dicebear.com/7.x/notionists/svg?seed=${rel.targetName}`} alt=""
                                        style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
                                    <div style={{ flex: 1 }}>
                                        <span style={{ fontWeight: '500', fontSize: '13px' }}>{rel.targetName}</span>
                                        <span style={{ fontSize: '11px', color: '#999', marginLeft: '6px' }}>
                                            ❤️ {rel.affinity ?? '?'}
                                        </span>
                                    </div>
                                    <button onClick={() => handleRegenerate(rel.targetId)} disabled={regenLoading === rel.targetId}
                                        title={lang === 'en' ? 'Regenerate this character\'s impression via AI' : '通过 AI 重新生成此角色的印象'}
                                        style={{ background: 'none', border: '1px solid #ddd', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer', fontSize: '11px', color: 'var(--accent-color)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                        <RefreshCw size={10} /> {regenLoading === rel.targetId ? '...' : (lang === 'en' ? 'Regen' : '刷新')}
                                    </button>
                                </div>
                                {rel.impression && (
                                    <div style={{ fontSize: '12px', color: '#666', lineHeight: '1.4', fontStyle: 'italic' }}>
                                        "{rel.impression}"
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                    {regenError && (
                        <div style={{ marginTop: '8px', padding: '6px 10px', background: '#fff1f1', border: '1px solid #ffc0c0', borderRadius: '6px', fontSize: '12px', color: '#c0392b' }}>
                            ⚠️ {regenError}
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div style={{ marginTop: '10px', backgroundColor: '#fff', borderTop: '1px solid #eee', borderBottom: '1px solid #eee' }}>
                    <div
                        style={{ padding: '15px', display: 'flex', justifyContent: 'center', color: 'var(--danger)', cursor: 'pointer', alignItems: 'center', gap: '8px', fontWeight: '500' }}
                        onClick={handleClearHistory}
                    >
                        <Trash2 size={18} /> {t('Deep Wipe')}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default ChatSettingsDrawer;
