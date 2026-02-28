import React, { useState, useEffect } from 'react';
import { BookOpen, X, Lock, KeyRound, Eye } from 'lucide-react';
import { useLanguage } from '../LanguageContext';

function DiaryTable({ contact, apiUrl, onClose }) {
    const { t, lang } = useLanguage();
    const [diaries, setDiaries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isUnlocked, setIsUnlocked] = useState(false);
    const [passwordInput, setPasswordInput] = useState('');
    const [pwError, setPwError] = useState('');
    const [pwLoading, setPwLoading] = useState(false);

    useEffect(() => {
        if (!contact) return;
        fetch(`${apiUrl}/diaries/${contact.id}`)
            .then(res => res.json())
            .then(data => {
                if (data.entries !== undefined) {
                    setDiaries(data.entries);
                    setIsUnlocked(data.isUnlocked);
                } else {
                    setDiaries(data);
                    setIsUnlocked(data.length > 0 && data[0].is_unlocked === 1);
                }
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to load diaries:', err);
                setLoading(false);
            });
    }, [apiUrl, contact, contact?.id]);

    const handlePasswordSubmit = async (e) => {
        e.preventDefault();
        if (!passwordInput.trim()) return;
        setPwLoading(true);
        setPwError('');
        try {
            const res = await fetch(`${apiUrl}/diaries/${contact.id}/unlock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: passwordInput.trim() })
            });
            const data = await res.json();
            if (data.success) {
                setIsUnlocked(true);
                setDiaries(prev => prev.map(d => ({ ...d, is_unlocked: 1 })));
            } else {
                setPwError(data.reason || 'Wrong password.');
            }
        } catch {
            setPwError('Network error. Try again.');
        }
        setPwLoading(false);
    };

    return (
        <div className="memory-drawer" style={{ width: '380px', backgroundColor: '#fffdf5' }}>
            <div className="memory-header" style={{ backgroundColor: '#f6f1e3', borderBottomColor: '#e0d8c3' }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#5a4d3c' }}>
                    <BookOpen size={18} />
                    {contact.name} {lang === 'en' ? "'s Diary" : "的日记"}
                </h3>
                <button className="icon-btn" onClick={onClose}>
                    <X size={20} />
                </button>
            </div>

            <div className="memory-list" style={{ padding: '20px' }}>
                {loading ? (
                    <div className="placeholder-text">{t('Loading')}</div>
                ) : !isUnlocked ? (
                    <div style={{ textAlign: 'center', marginTop: '30px' }}>
                        <Lock size={48} color="#d4a96a" style={{ marginBottom: '12px' }} />
                        <div style={{ color: '#5a4d3c', fontWeight: 'bold', fontSize: '16px', marginBottom: '6px' }}>
                            {t('Diary Locked')}
                        </div>
                        <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '24px', padding: '0 20px' }}>
                            {lang === 'en' ? `Build your bond with ${contact.name} and get them to reveal their password.` : `与 ${contact.name} 培养亲密度，并试着让对方告诉你密码吧。`}
                        </div>

                        <form onSubmit={handlePasswordSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' }}>
                            <div style={{ position: 'relative', width: '100%', maxWidth: '240px' }}>
                                <KeyRound size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#bbb' }} />
                                <input
                                    type="text"
                                    value={passwordInput}
                                    onChange={e => { setPasswordInput(e.target.value); setPwError(''); }}
                                    placeholder={lang === 'en' ? "Enter diary password..." : "输入日记密码..."}
                                    style={{
                                        width: '100%', boxSizing: 'border-box',
                                        padding: '9px 12px 9px 32px', borderRadius: '8px',
                                        border: pwError ? '1.5px solid var(--danger)' : '1.5px solid #e0d8c3',
                                        background: '#fff', fontSize: '14px', outline: 'none',
                                        color: '#333', letterSpacing: '1px'
                                    }}
                                />
                            </div>
                            {pwError && (
                                <div style={{ color: 'var(--danger)', fontSize: '12px' }}>{pwError}</div>
                            )}
                            <button
                                type="submit"
                                disabled={pwLoading || !passwordInput.trim()}
                                style={{
                                    padding: '8px 24px', borderRadius: '8px', border: 'none',
                                    background: '#d4a96a', color: '#fff', fontWeight: '600',
                                    fontSize: '14px', cursor: 'pointer', opacity: pwLoading ? 0.6 : 1
                                }}
                            >
                                {pwLoading ? (lang === 'en' ? 'Checking...' : '验证中...') : t('Unlock Diary')}
                            </button>
                        </form>

                        <div style={{ marginTop: '20px', fontSize: '11px', color: '#ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
                            <Eye size={11} /> {lang === 'en' ? `Hint: Ask ${contact.name} directly in chat.` : `提示：试着在聊天中直接询问 ${contact.name}。`}
                        </div>
                    </div>
                ) : diaries.length === 0 ? (
                    <div className="empty-text">{t('No entries yet')}</div>
                ) : (
                    diaries.map(diary => {
                        const dateObj = new Date(diary.timestamp);
                        const dateStr = dateObj.toLocaleDateString();
                        const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                        return (
                            <div key={diary.id} className="diary-entry" style={{
                                backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '8px',
                                padding: '15px', marginBottom: '15px', boxShadow: '0 2px 5px rgba(0,0,0,0.02)'
                            }}>
                                <div className="diary-meta" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', color: '#999', fontSize: '13px' }}>
                                    <span>{dateStr} {timeStr}</span>
                                    {diary.emotion && <span style={{ textTransform: 'capitalize' }}>{diary.emotion}</span>}
                                </div>
                                <div className="diary-content" style={{ color: '#333', lineHeight: '1.6', fontSize: '15px', whiteSpace: 'pre-wrap' }}>
                                    {diary.content}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}

export default DiaryTable;
