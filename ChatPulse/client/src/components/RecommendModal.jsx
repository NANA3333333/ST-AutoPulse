import React, { useState, useEffect } from 'react';
import { X, Search, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '../LanguageContext';

function RecommendModal({ apiUrl, currentContact, allContacts, onClose, onRecommend }) {
    const { t, lang } = useLanguage();
    const [friends, setFriends] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCharId, setSelectedCharId] = useState(null);

    useEffect(() => {
        if (!currentContact) return;
        fetch(`${apiUrl}/characters/${currentContact.id}/friends`)
            .then(res => res.json())
            .then(data => {
                setFriends(data.map(f => f.id));
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to load friends:', err);
                setLoading(false);
            });
    }, [apiUrl, currentContact]);

    const handleConfirm = () => {
        if (selectedCharId) {
            onRecommend(selectedCharId);
        }
    };

    // Filter out the current contact and already added friends
    const availableContacts = allContacts.filter(c =>
        c.id !== currentContact.id &&
        !friends.includes(c.id) &&
        c.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '400px', padding: '0' }}>
                <div style={{ padding: '15px 20px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '16px', fontWeight: '500' }}>
                        {lang === 'en' ? `Recommend Contact to ${currentContact.name}` : `将联系人推荐给 ${currentContact.name}`}
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                        <X size={20} color="#999" />
                    </button>
                </div>

                <div style={{ padding: '20px' }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '20px', color: '#888' }}>
                            {t('Loading')}
                        </div>
                    ) : (
                        <>
                            <div style={{ position: 'relative', marginBottom: '15px' }}>
                                <Search size={16} color="#aaa" style={{ position: 'absolute', left: '10px', top: '10px' }} />
                                <input
                                    type="text"
                                    placeholder={lang === 'en' ? 'Search contacts...' : '搜索联系人...'}
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    style={{ width: '100%', padding: '8px 10px 8px 32px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' }}
                                />
                            </div>

                            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                                {availableContacts.length === 0 ? (
                                    <div style={{ textAlign: 'center', padding: '20px', color: '#888', fontSize: '14px' }}>
                                        {lang === 'en' ? 'No contacts available to recommend.' : '没有可以推荐的联系人了。'}
                                    </div>
                                ) : (
                                    availableContacts.map(c => (
                                        <div
                                            key={c.id}
                                            onClick={() => setSelectedCharId(c.id)}
                                            style={{
                                                display: 'flex', alignItems: 'center', padding: '10px',
                                                borderBottom: '1px solid #f5f5f5', cursor: 'pointer',
                                                backgroundColor: selectedCharId === c.id ? '#f0f9eb' : 'transparent',
                                                borderRadius: '6px'
                                            }}
                                        >
                                            <img src={c.avatar} alt={c.name} style={{ width: '40px', height: '40px', borderRadius: '50%', marginRight: '12px' }} />
                                            <div style={{ flex: 1, fontWeight: '500', fontSize: '15px' }}>{c.name}</div>
                                            {selectedCharId === c.id && (
                                                <CheckCircle2 size={20} color="var(--accent-color)" />
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>

                            <div style={{ marginTop: '20px' }}>
                                <button
                                    onClick={handleConfirm}
                                    disabled={!selectedCharId}
                                    style={{
                                        width: '100%', padding: '10px', borderRadius: '6px', border: 'none',
                                        backgroundColor: selectedCharId ? 'var(--accent-color)' : '#e0e0e0',
                                        color: selectedCharId ? '#fff' : '#999',
                                        fontWeight: '500', fontSize: '15px', cursor: selectedCharId ? 'pointer' : 'not-allowed'
                                    }}
                                >
                                    {lang === 'en' ? 'Send Recommendation' : '发送名片推荐'}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export default RecommendModal;
