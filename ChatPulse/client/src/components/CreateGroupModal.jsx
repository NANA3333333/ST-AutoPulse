import React, { useState } from 'react';
import { X, CheckCircle2, Search } from 'lucide-react';
import { useLanguage } from '../LanguageContext';

function CreateGroupModal({ apiUrl, contacts, onClose, onCreate }) {
    const { lang } = useLanguage();
    const [groupName, setGroupName] = useState('');
    const [selectedIds, setSelectedIds] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [creating, setCreating] = useState(false);

    const toggleSelect = (id) => {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const handleCreate = async () => {
        if (!groupName.trim() || selectedIds.length === 0) return;
        setCreating(true);
        try {
            const res = await fetch(`${apiUrl}/groups`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: groupName.trim(), member_ids: selectedIds })
            });
            const data = await res.json();
            if (data.success) {
                onCreate(data.group);
            }
        } catch (e) {
            console.error('Failed to create group:', e);
        }
        setCreating(false);
    };

    const filtered = contacts.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()));

    return (
        <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '420px', padding: 0 }}>
                <div style={{ padding: '15px 20px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '16px', fontWeight: '500' }}>
                        {lang === 'en' ? 'Create Group Chat' : '发起群聊'}
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                        <X size={20} color="#999" />
                    </button>
                </div>

                <div style={{ padding: '15px 20px' }}>
                    <input
                        type="text"
                        placeholder={lang === 'en' ? 'Group Name' : '群聊名称'}
                        value={groupName}
                        onChange={e => setGroupName(e.target.value)}
                        style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', marginBottom: '12px' }}
                    />

                    <div style={{ position: 'relative', marginBottom: '12px' }}>
                        <Search size={16} color="#aaa" style={{ position: 'absolute', left: '10px', top: '10px' }} />
                        <input
                            type="text"
                            placeholder={lang === 'en' ? 'Search contacts...' : '搜索联系人...'}
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            style={{ width: '100%', padding: '8px 10px 8px 32px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' }}
                        />
                    </div>

                    <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
                        {filtered.map(c => (
                            <div
                                key={c.id}
                                onClick={() => toggleSelect(c.id)}
                                style={{
                                    display: 'flex', alignItems: 'center', padding: '8px',
                                    borderBottom: '1px solid #f5f5f5', cursor: 'pointer',
                                    backgroundColor: selectedIds.includes(c.id) ? '#f0f9eb' : 'transparent',
                                    borderRadius: '6px'
                                }}
                            >
                                <img src={c.avatar} alt={c.name} style={{ width: '36px', height: '36px', borderRadius: '50%', marginRight: '10px' }} />
                                <div style={{ flex: 1, fontWeight: '500', fontSize: '14px' }}>{c.name}</div>
                                {selectedIds.includes(c.id) && <CheckCircle2 size={18} color="var(--accent-color)" />}
                            </div>
                        ))}
                    </div>

                    <button
                        onClick={handleCreate}
                        disabled={!groupName.trim() || selectedIds.length === 0 || creating}
                        style={{
                            width: '100%', padding: '10px', borderRadius: '6px', border: 'none', marginTop: '15px',
                            backgroundColor: (groupName.trim() && selectedIds.length > 0) ? 'var(--accent-color)' : '#e0e0e0',
                            color: (groupName.trim() && selectedIds.length > 0) ? '#fff' : '#999',
                            fontWeight: '500', fontSize: '15px', cursor: (groupName.trim() && selectedIds.length > 0) ? 'pointer' : 'not-allowed'
                        }}
                    >
                        {creating ? '...' : (lang === 'en' ? `Create (${selectedIds.length} selected)` : `创建 (${selectedIds.length} 人)`)}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default CreateGroupModal;
