import React, { useState, useEffect } from 'react';
import { Heart, MessageCircle, Send, Trash2, ChevronLeft } from 'lucide-react';
import { useLanguage } from '../LanguageContext';

function MomentsFeed({ apiUrl, userProfile, onBack }) {
    const { t } = useLanguage();
    const [moments, setMoments] = useState([]);
    const [characters, setCharacters] = useState({});
    const [loading, setLoading] = useState(true);

    // New Moment Post State
    const [newPostText, setNewPostText] = useState('');
    const [posting, setPosting] = useState(false);

    // Comment State (keyed by moment id)
    const [commentTexts, setCommentTexts] = useState({});
    const [activeCommentBox, setActiveCommentBox] = useState(null);

    const fetchMomentsData = React.useCallback(() => {
        // Fetch characters for mapping avatars/names
        fetch(`${apiUrl}/characters`)
            .then(res => res.json())
            .then(data => {
                const charMap = {};
                data.forEach(c => charMap[c.id] = c);
                setCharacters(charMap);
                return fetch(`${apiUrl}/moments`);
            })
            .then(res => res.json())
            .then(data => {
                setMoments(data);
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to load moments/characters:', err);
                setLoading(false);
            });
    }, [apiUrl]);

    useEffect(() => {
        fetchMomentsData();
    }, [fetchMomentsData]);

    const handlePostMoment = async () => {
        if (!newPostText.trim()) return;
        setPosting(true);
        try {
            const res = await fetch(`${apiUrl}/moments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: newPostText })
            });
            if (res.ok) {
                setNewPostText('');
                fetchMomentsData(); // refresh
            }
        } catch (e) {
            console.error('Failed to post moment', e);
        }
        setPosting(false);
    };

    const handleLikeToggle = async (id) => {
        try {
            const res = await fetch(`${apiUrl}/moments/${id}/like`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ liker_id: 'user' })
            });
            const data = await res.json();
            if (data.success) {
                // Optimistically update the moments array without a full refetch
                setMoments(prev => prev.map(m =>
                    m.id === id ? { ...m, likers: data.likers } : m
                ));
            }
        } catch (e) {
            console.error('Like toggle failed', e);
        }
    };

    const handlePostComment = async (momentId) => {
        const text = commentTexts[momentId];
        if (!text || !text.trim()) return;

        try {
            const res = await fetch(`${apiUrl}/moments/${momentId}/comment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ author_id: 'user', content: text })
            });
            const data = await res.json();
            if (data.success) {
                setCommentTexts(prev => ({ ...prev, [momentId]: '' }));
                setActiveCommentBox(null);
                fetchMomentsData(); // refresh to get comments
            }
        } catch (e) {
            console.error('Comment failed', e);
        }
    };

    const handleDeleteMoment = async (momentId) => {
        try {
            const res = await fetch(`${apiUrl}/moments/${momentId}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                setMoments(prev => prev.filter(m => m.id !== momentId));
            }
        } catch (e) {
            console.error('Delete moment failed', e);
        }
    };

    const formatTime = (ts) => {
        const timeAgo = Math.round((Date.now() - ts) / 60000);
        if (timeAgo < 1) return 'Just now';
        if (timeAgo < 60) return `${timeAgo} mins ago`;
        if (timeAgo < 1440) return `${Math.floor(timeAgo / 60)} hours ago`;
        return `${Math.floor(timeAgo / 1440)} days ago`;
    };

    const resolveAuthor = (id) => {
        if (id === 'user') return { name: userProfile?.name || 'User', avatar: userProfile?.avatar || 'https://api.dicebear.com/7.x/notionists/svg?seed=User' };
        return characters[id] || { name: 'Unknown', avatar: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=Unknown' };
    };

    if (loading) return <div className="placeholder-text">Loading Moments...</div>;

    return (
        <div className="moments-feed" style={{ paddingBottom: '80px' }}>
            {/* Cover Photo Area */}
            <div className="moments-cover" style={{ marginBottom: '20px', backgroundImage: userProfile?.banner ? `url(${userProfile.banner})` : undefined, position: 'relative' }}>
                {onBack && (
                    <button className="mobile-back-btn" onClick={onBack} title="Back" style={{ position: 'absolute', top: '15px', left: '15px', background: 'rgba(0,0,0,0.3)', color: 'white', display: 'flex' }}>
                        <ChevronLeft size={24} />
                    </button>
                )}
                <div className="moments-cover-user">
                    <span className="moments-cover-name">{userProfile?.name || 'User'}</span>
                    <img src={userProfile?.avatar || 'https://api.dicebear.com/7.x/notionists/svg?seed=User'} alt="Me" className="moments-cover-avatar" />
                </div>
            </div>

            <div className="moments-list">
                {/* Post New Moment Area */}
                <div style={{ backgroundColor: '#fff', padding: '15px', marginBottom: '20px', borderBottom: '1px solid #f0f0f0', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <img src={userProfile?.avatar || 'https://api.dicebear.com/7.x/notionists/svg?seed=User'} style={{ width: '44px', height: '44px', borderRadius: '50%' }} alt="" />
                        <div style={{ flex: 1 }}>
                            <textarea
                                placeholder={t('Share something new')}
                                value={newPostText}
                                onChange={(e) => setNewPostText(e.target.value)}
                                style={{ width: '100%', border: 'none', resize: 'none', minHeight: '60px', outline: 'none', fontSize: '15px' }}
                            />
                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                                <button
                                    onClick={handlePostMoment}
                                    disabled={posting || !newPostText.trim()}
                                    style={{ background: 'var(--accent-color)', color: '#fff', border: 'none', padding: '6px 16px', borderRadius: '4px', cursor: 'pointer', opacity: (!newPostText.trim() || posting) ? 0.5 : 1 }}
                                >
                                    {posting ? t('Loading') : t('Post')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>


                {moments.length === 0 ? (
                    <p className="empty-text" style={{ padding: '20px', textAlign: 'center' }}>{t('No moments yet')}</p>
                ) : (
                    moments.map(moment => {
                        const author = resolveAuthor(moment.character_id);
                        const isLikedByUser = (moment.likers || []).includes('user');

                        return (
                            <div key={moment.id} className="moment-post" style={{ paddingBottom: '15px', marginBottom: '15px', borderBottom: '1px solid #f0f0f0' }}>
                                <img src={author.avatar} alt={author.name} className="moment-avatar" />
                                <div className="moment-body" style={{ flex: 1, minWidth: 0 }}>
                                    <div className="moment-author">{author.name}</div>
                                    <div className="moment-content" style={{ marginTop: '5px' }}>{moment.content}</div>
                                    {moment.image_url && <img src={moment.image_url} alt="Attached" className="moment-image" />}

                                    <div className="moment-footer" style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span className="moment-time">{formatTime(moment.timestamp)}</span>
                                        <div className="moment-actions" style={{ display: 'flex', gap: '15px' }}>
                                            {moment.character_id === 'user' && (
                                                <button onClick={() => handleDeleteMoment(moment.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', display: 'flex', alignItems: 'center', gap: '4px' }} title="Delete">
                                                    <Trash2 size={16} />
                                                </button>
                                            )}
                                            <button onClick={() => handleLikeToggle(moment.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', color: isLikedByUser ? 'var(--danger)' : 'var(--accent-color)' }}>
                                                <Heart size={18} fill={isLikedByUser ? 'var(--danger)' : 'none'} color={isLikedByUser ? 'var(--danger)' : 'var(--accent-color)'} />
                                                <span>{(moment.likers || []).length > 0 ? moment.likers.length : ''}</span>
                                            </button>
                                            <button onClick={() => setActiveCommentBox(activeCommentBox === moment.id ? null : moment.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-color)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <MessageCircle size={18} />
                                                <span>{(moment.comments || []).length > 0 ? moment.comments.length : ''}</span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Interaction Display Area (Likes + Comments) */}
                                    {((moment.likers && moment.likers.length > 0) || (moment.comments && moment.comments.length > 0)) && (
                                        <div style={{ background: '#f8f8f8', marginTop: '10px', padding: '8px', borderRadius: '4px', fontSize: '13px' }}>

                                            {/* Likes Text */}
                                            {moment.likers && moment.likers.length > 0 && (
                                                <div style={{ color: 'var(--accent-color)', display: 'flex', alignItems: 'center', gap: '5px', paddingBottom: (moment.comments && moment.comments.length > 0) ? '5px' : '0', borderBottom: (moment.comments && moment.comments.length > 0) ? '1px solid #eaeaea' : 'none' }}>
                                                    <Heart size={12} fill="var(--accent-color)" />
                                                    {moment.likers.map(lId => resolveAuthor(lId).name).join(', ')}
                                                </div>
                                            )}

                                            {/* Comments List */}
                                            {moment.comments && moment.comments.length > 0 && (
                                                <div style={{ paddingTop: (moment.likers && moment.likers.length > 0) ? '5px' : '0' }}>
                                                    {moment.comments.map(c => {
                                                        const cAuthor = resolveAuthor(c.author_id);
                                                        return (
                                                            <div key={c.id} style={{ marginBottom: '3px', wordBreak: 'break-word' }}>
                                                                <span style={{ color: 'var(--accent-color)', fontWeight: '500' }}>{cAuthor.name}: </span>
                                                                <span style={{ color: '#333' }}>{c.content}</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Comment Input Box */}
                                    {activeCommentBox === moment.id && (
                                        <div style={{ display: 'flex', marginTop: '10px', gap: '5px' }}>
                                            <input
                                                type="text"
                                                value={commentTexts[moment.id] || ''}
                                                onChange={e => setCommentTexts({ ...commentTexts, [moment.id]: e.target.value })}
                                                placeholder="Comment..."
                                                style={{ flex: 1, padding: '6px 10px', border: '1px solid #ddd', borderRadius: '4px', outline: 'none' }}
                                                onKeyDown={e => e.key === 'Enter' && handlePostComment(moment.id)}
                                                autoFocus
                                            />
                                            <button onClick={() => handlePostComment(moment.id)} style={{ background: 'var(--accent-color)', color: '#fff', border: 'none', padding: '0 12px', borderRadius: '4px', cursor: 'pointer' }}>
                                                <Send size={16} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}

export default MomentsFeed;
