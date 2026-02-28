import React, { useState } from 'react';
import { X, Wand2, RefreshCw } from 'lucide-react';
import { useLanguage } from '../LanguageContext';

function AddCharacterModal({ isOpen, onClose, onAdd, apiUrl }) {
    const { t, lang } = useLanguage();
    const [formData, setFormData] = useState({
        id: '',
        name: '',
        avatar: '',
        persona: '',
        api_endpoint: '',
        api_key: '',
        model_name: '',
        affinity: 50
    });

    const [genQuery, setGenQuery] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [modelList, setModelList] = useState([]);
    const [fetchingModels, setFetchingModels] = useState(false);
    const [modelFetchError, setModelFetchError] = useState('');

    if (!isOpen) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();

        // Auto-generate ID if missing
        const characterId = formData.id.trim() || `char-${Date.now()}`;
        const payload = { ...formData, id: characterId };

        try {
            const res = await fetch(`${apiUrl}/characters`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data.success) {
                onAdd(data.character);
                onClose();
            } else {
                alert(lang === 'en' ? 'Add failed: ' + data.error : '添加失败: ' + data.error);
            }
        } catch (err) {
            console.error(err);
            alert(lang === 'en' ? 'Failed to connect to backend.' : '无法连接到后端服务器。');
        }
    };

    const handleGenerate = async () => {
        if (!genQuery || !formData.api_endpoint || !formData.api_key || !formData.model_name) {
            alert(t('Required fields missing'));
            return;
        }
        setIsGenerating(true);
        try {
            const res = await fetch(`${apiUrl}/characters/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: genQuery,
                    api_endpoint: formData.api_endpoint,
                    api_key: formData.api_key,
                    model_name: formData.model_name
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            // Auto-fill the form with generated data
            setFormData(prev => ({
                ...prev,
                name: data.character.name || prev.name,
                avatar: data.character.avatar || prev.avatar,
                persona: data.character.persona || prev.persona,
                affinity: data.character.affinity ?? prev.affinity
            }));
        } catch (e) {
            alert(lang === 'en' ? 'Generation Failed: ' + e.message : '生成角色失败: ' + e.message);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleFetchModels = async () => {
        if (!formData.api_endpoint || !formData.api_key) {
            setModelFetchError('请先填写 API Endpoint 和 API Key');
            return;
        }
        setFetchingModels(true);
        setModelFetchError('');
        setModelList([]);
        try {
            const res = await fetch(
                `${apiUrl}/models?endpoint=${encodeURIComponent(formData.api_endpoint)}&key=${encodeURIComponent(formData.api_key)}`
            );
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            setModelList(data.models || []);
            if ((data.models || []).length === 0) setModelFetchError('未找到可用模型');
        } catch (e) {
            setModelFetchError('拉取失败: ' + e.message);
        }
        setFetchingModels(false);
    };

    return (
        <div className="modal-overlay" style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
            justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>
            <div className="modal-content" style={{
                backgroundColor: '#fff', padding: '20px', borderRadius: '8px',
                width: '500px', maxWidth: '90%', maxHeight: '90vh', overflowY: 'auto'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
                    <h3 style={{ margin: 0, fontSize: '18px' }}>Add New Contact</h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
                </div>

                {/* AI Generator Box */}
                <div style={{ padding: '15px', backgroundColor: '#f9f9f9', border: '1px solid #ddd', borderRadius: '6px', marginBottom: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '10px', color: '#333', fontWeight: 'bold' }}>
                        <Wand2 size={16} color="var(--accent-color)" /> Auto-Generate Character
                    </div>
                    <textarea
                        value={genQuery}
                        onChange={(e) => setGenQuery(e.target.value)}
                        placeholder="Describe the persona... (Make sure to fill out API keys below first)"
                        style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box', minHeight: '60px', resize: 'vertical' }}
                    />
                    <button
                        type="button"
                        onClick={handleGenerate}
                        disabled={isGenerating}
                        style={{ marginTop: '10px', width: '100%', padding: '8px', backgroundColor: isGenerating ? '#ccc' : 'var(--accent-color)', color: '#fff', border: 'none', borderRadius: '4px', cursor: isGenerating ? 'not-allowed' : 'pointer' }}
                    >
                        {isGenerating ? '✨ Generating...' : 'Auto-Fill Form'}
                    </button>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', fontWeight: 'bold' }}>{t('Name')} (Required)</label>
                        <input type="text" required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })}
                            style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', fontWeight: 'bold' }}>{t('Avatar URL')}</label>
                        <input type="text" value={formData.avatar} onChange={e => setFormData({ ...formData, avatar: e.target.value })}
                            placeholder="https://..."
                            style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', fontWeight: 'bold' }}>{t('Persona')}</label>
                        <textarea value={formData.persona} onChange={e => setFormData({ ...formData, persona: e.target.value })}
                            rows={4}
                            style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', fontWeight: 'bold' }}>Initial Affinity (0-100)</label>
                        <input type="number" min="0" max="100" value={formData.affinity} onChange={e => setFormData({ ...formData, affinity: parseInt(e.target.value) || 0 })}
                            style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }} />
                    </div>

                    <hr style={{ borderTop: '1px dashed #ddd', margin: '5px 0' }} />

                    <div>
                        <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', fontWeight: 'bold', color: '#666' }}>{t('API Endpoint')}</label>
                        <input type="text" value={formData.api_endpoint} onChange={e => setFormData({ ...formData, api_endpoint: e.target.value })}
                            placeholder="https://api.openai.com/v1/chat/completions"
                            style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', fontWeight: 'bold' }}>{t('API Key')}</label>
                        <input type="password" value={formData.api_key} onChange={e => setFormData({ ...formData, api_key: e.target.value })}
                            style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', fontWeight: 'bold' }}>{t('Model Name')}</label>
                        <div style={{ display: 'flex', gap: '6px' }}>
                            <input type="text" value={formData.model_name} onChange={e => setFormData({ ...formData, model_name: e.target.value })}
                                placeholder="gpt-4o"
                                style={{ flex: 1, padding: '8px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }} />
                            <button type="button" onClick={handleFetchModels} disabled={fetchingModels}
                                style={{ padding: '8px 12px', background: 'var(--accent-color)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <RefreshCw size={14} className={fetchingModels ? 'spin' : ''} />
                                {fetchingModels ? '...' : t('Fetch Models')}
                            </button>
                        </div>
                        {modelFetchError && <p style={{ color: 'var(--danger)', fontSize: '12px', marginTop: '4px' }}>{modelFetchError}</p>}
                        {modelList.length > 0 && (
                            <select
                                onChange={e => setFormData({ ...formData, model_name: e.target.value })}
                                defaultValue=""
                                style={{ marginTop: '6px', width: '100%', padding: '7px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '13px' }}
                            >
                                <option value="" disabled>── 选择模型 ──</option>
                                {modelList.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                        )}
                    </div>

                    <button type="submit" style={{
                        marginTop: '10px', padding: '10px', backgroundColor: 'var(--accent-color)',
                        color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold'
                    }}>{t('Add Character')}</button>
                </form>
            </div>
        </div>
    );
}

export default AddCharacterModal;
