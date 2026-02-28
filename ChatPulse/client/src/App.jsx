import React, { useState, useEffect, useCallback, useRef } from 'react';
import ContactList from './components/ContactList';
import ChatWindow from './components/ChatWindow';
import GroupChatWindow from './components/GroupChatWindow';
import CreateGroupModal from './components/CreateGroupModal';
import MemoTable from './components/MemoTable';
import DiaryTable from './components/DiaryTable';
import MomentsFeed from './components/MomentsFeed';
import SettingsPanel from './components/SettingsPanel';
import ChatSettingsDrawer from './components/ChatSettingsDrawer';
import AddCharacterModal from './components/AddCharacterModal';
import './App.css';
import { MessageSquare, Users, Compass, Settings, UserPlus, Globe, UsersRound } from 'lucide-react';
import { useLanguage } from './LanguageContext';

// Allow VITE config if available, otherwise dynamically use the current host IP/Domain
const PROTOCOL = window.location.protocol;
const HOST = window.location.hostname;
const API_URL = import.meta.env.VITE_API_URL || `${PROTOCOL}//${HOST}:8001/api`;
const WS_URL = import.meta.env.VITE_WS_URL || `ws://${HOST}:8001`;

function App() {
  const { t, lang, toggleLanguage } = useLanguage();
  const [activeTab, setActiveTab] = useState('chats'); // 'chats', 'contacts', 'settings'
  const [activeContactId, setActiveContactId] = useState(null);
  const [contacts, setContacts] = useState([]);

  const [newIncomingMessage, setNewIncomingMessage] = useState(null);
  const [activeDrawer, setActiveDrawer] = useState(null); // 'memo', 'diary', or null
  const [userProfile, setUserProfile] = useState(null);
  const [engineState, setEngineState] = useState({});
  const [showAddCharModal, setShowAddCharModal] = useState(false);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [groups, setGroups] = useState([]);
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [newGroupMessage, setNewGroupMessage] = useState(null);
  const [groupTyping, setGroupTyping] = useState({}); // { groupId: [{ sender_id, name }, ...] }

  // Use a ref to track the active contact ID without causing useEffect re-renders when it changes.
  const activeContactRef = useRef(activeContactId);
  useEffect(() => { activeContactRef.current = activeContactId; }, [activeContactId]);

  // Use a ref to track which incoming messages we've already processed for unread badges and sounds
  const processedMessagesRef = useRef(new Set());

  const fetchContacts = useCallback(() => {
    fetch(`${API_URL}/characters`)
      .then(res => res.json())
      .then(data => {
        setContacts(prev => data.map(newContact => {
          const existing = prev.find(p => p.id === newContact.id);
          if (existing) {
            return {
              ...newContact,
              unread: existing.unread || 0,
              lastMessage: existing.lastMessage || newContact.lastMessage,
              time: existing.time || newContact.time
            };
          }
          return newContact;
        }));
        if (activeContactId && !data.find(c => c.id === activeContactId)) {
          setActiveContactId(null);
        }
      })
      .catch(err => console.error('Failed to load contacts:', err));
  }, [activeContactId]);

  // 1. Fetch Contacts (Characters) and Profile on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetchContacts();
    fetch(`${API_URL}/user`)
      .then(res => res.json())
      .then(data => setUserProfile(data));
    fetch(`${API_URL}/groups`)
      .then(res => res.json())
      .then(data => setGroups(data))
      .catch(err => console.error('Failed to load groups:', err));
  }, []);

  // Listen for iframe postMessage from SillyTavern parent
  useEffect(() => {
    const handleMessage = (event) => {
      if (event.data?.type === 'st_chat_changed') {
        const { characterId } = event.data;
        if (characterId) {
          fetchContacts(); // Ensure we have the latest list in case ST auto-created them
          setActiveTab('chats');
          setActiveContactId(characterId);
          setActiveGroupId(null);
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [fetchContacts, setActiveContactId, setActiveGroupId, setActiveTab]);

  // 2. Setup WebSocket for real-time messages
  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'new_message') {
          setNewIncomingMessage(msg.data);
        } else if (msg.type === 'engine_state') {
          setEngineState(msg.data);
        } else if (msg.type === 'group_message') {
          setNewGroupMessage(msg.data);
        } else if (msg.type === 'group_typing') {
          setGroupTyping(prev => {
            const key = msg.data.group_id;
            const current = prev[key] || [];
            if (current.find(t => t.sender_id === msg.data.sender_id)) return prev;
            return { ...prev, [key]: [...current, msg.data] };
          });
        } else if (msg.type === 'group_typing_stop') {
          setGroupTyping(prev => {
            const key = msg.data.group_id;
            return { ...prev, [key]: (prev[key] || []).filter(t => t.sender_id !== msg.data.sender_id) };
          });
        } else if (msg.type === 'wallet_sync') {
          const { characterId, characterWallet, userWallet } = msg.data;
          if (characterId && characterWallet !== null && characterWallet !== undefined) {
            setContacts(prev => prev.map(c => c.id === characterId ? { ...c, wallet: characterWallet } : c));
          }
          if (userWallet !== null && userWallet !== undefined) {
            setUserProfile(prev => prev ? { ...prev, wallet: userWallet } : prev);
          }
        } else if (msg.type === 'refresh_contacts') {
          fetchContacts();
        }
      } catch (e) {
        console.error('WS Parse Error', e);
      }
    };
    return () => ws.close();
  }, []);

  // Update contact last message preview on new incoming message
  useEffect(() => {
    if (newIncomingMessage) {
      // Prevent double-processing the exact same message if React re-renders for other reasons
      if (processedMessagesRef.current.has(newIncomingMessage.id)) {
        return;
      }
      processedMessagesRef.current.add(newIncomingMessage.id);

      // Play notification sound
      if (newIncomingMessage.role !== 'user' && newIncomingMessage.character_id !== activeContactRef.current) {
        try {
          const audio = new Audio('/pop.wav');
          audio.play().catch(e => console.error("Audio play blocked:", e));
        } catch (e) { console.error(e); }
      }

      setContacts(prev => prev.map(c => {
        if (c.id === newIncomingMessage.character_id) {
          const newUnread = c.id === activeContactRef.current ? 0 : (c.unread || 0) + 1;
          return {
            ...c,
            lastMessage: newIncomingMessage.content,
            time: new Date(newIncomingMessage.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            unread: newUnread
          };
        }
        return c;
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newIncomingMessage]);

  // Apply Dynamic Theme & Custom CSS
  useEffect(() => {
    if (userProfile) {
      if (userProfile.theme) {
        document.documentElement.setAttribute('data-theme', userProfile.theme);
      }

      // Apply theme_config JSON mapping to CSS variables
      if (userProfile.theme_config) {
        try {
          const themeObj = typeof userProfile.theme_config === 'string' ? JSON.parse(userProfile.theme_config) : userProfile.theme_config;
          for (const [key, value] of Object.entries(themeObj)) {
            if (key.startsWith('--')) {
              document.documentElement.style.setProperty(key, value);
            }
          }
        } catch (e) {
          console.error("Failed to parse theme_config", e);
        }
      }

      // Apply custom raw CSS
      if (userProfile.custom_css) {
        let styleTag = document.getElementById('chatpulse-custom-css');
        if (!styleTag) {
          styleTag = document.createElement('style');
          styleTag.id = 'chatpulse-custom-css';
          document.head.appendChild(styleTag);
        }
        styleTag.innerHTML = userProfile.custom_css;
      } else {
        const styleTag = document.getElementById('chatpulse-custom-css');
        if (styleTag) styleTag.innerHTML = '';
      }
    }
  }, [userProfile]);

  const isViewingList = (activeTab === 'contacts' || (activeTab === 'chats' && !activeContactId && !activeGroupId));

  return (
    <div className={`app-container tab-${activeTab} ${activeContactId || activeGroupId ? 'has-active-chat' : 'no-active-chat'} ${isViewingList ? 'viewing-list' : 'viewing-content'}`}>
      {/* 1. Very Left Sidebar (Navigation) */}
      <nav className="sidebar-nav">
        <div className="my-avatar" onClick={() => setActiveTab('settings')} style={{ cursor: 'pointer' }}>
          <img src={userProfile?.avatar || "https://api.dicebear.com/7.x/notionists/svg?seed=User"} alt="Me" />
        </div>
        <div className="nav-icons">
          <button className={`nav-icon ${activeTab === 'chats' ? 'active' : ''}`} onClick={() => setActiveTab('chats')} title={lang === 'en' ? 'Chats — View conversations' : '聊天 — 查看会话列表'}>
            <MessageSquare size={24} />
          </button>
          <button className={`nav-icon ${activeTab === 'contacts' ? 'active' : ''}`} onClick={() => setActiveTab('contacts')} title={lang === 'en' ? 'Contacts — Manage characters & groups' : '通讯录 — 管理角色和群聊'}>
            <Users size={24} />
          </button>
          <button className={`nav-icon ${activeTab === 'discover' ? 'active' : ''}`} onClick={() => setActiveTab('discover')} title={lang === 'en' ? 'Discover — Moments feed' : '发现 — 朋友圈动态'}>
            <Compass size={24} />
          </button>
        </div>
        <div className="nav-icons-bottom">
          <button className="nav-icon" onClick={toggleLanguage} title={t('Toggle Language')}>
            <Globe size={24} />
            <span style={{ fontSize: '10px', marginTop: '4px', fontWeight: 'bold' }}>{lang === 'en' ? '中' : 'EN'}</span>
          </button>
          <button className={`nav-icon ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')} title={lang === 'en' ? 'Settings — Global configuration' : '设置 — 全局设置'}>
            <Settings size={24} />
          </button>
        </div>
      </nav>

      {/* 2. Middle Column (List) */}
      <div className="middle-column" style={activeTab === 'contacts' ? { width: 'auto', flex: 1, borderRight: 'none' } : {}}>
        <div className="search-bar-container">
          <input type="text" className="search-bar" placeholder={t('Search') || 'Search'} />
        </div>
        <div className="list-container">
          {activeTab === 'chats' && (
            <ContactList
              contacts={contacts}
              activeId={activeContactId}
              engineState={engineState}
              onSelect={(id) => {
                setActiveContactId(id);
                activeContactRef.current = id;
                setActiveGroupId(null);
                // Clear unread badge
                setContacts(prev => prev.map(c => c.id === id ? { ...c, unread: 0 } : c));
              }}
            />
          )}
          {activeTab === 'chats' && groups.length > 0 && (
            <div style={{ borderTop: '1px solid #eee' }}>
              <div style={{ padding: '5px 15px', color: '#999', fontSize: '11px' }}>
                {lang === 'en' ? 'Group Chats' : '群聊'}
              </div>
              {groups.map(g => (
                <div
                  key={g.id}
                  className={`contact-item ${activeGroupId === g.id ? 'active' : ''}`}
                  onClick={() => { setActiveGroupId(g.id); setActiveContactId(null); activeContactRef.current = null; }}
                >
                  <div className="contact-avatar" style={{ width: 'auto', minWidth: '42px', height: '42px', display: 'flex', alignItems: 'center' }}>
                    {g.members?.slice(0, 3).map((memberObj, idx) => {
                      const memberId = typeof memberObj === 'object' ? memberObj.member_id : memberObj;
                      const memberAvatar = contacts.find(c => String(c.id) === String(memberId))?.avatar || `https://api.dicebear.com/7.x/pixel-art/svg?seed=${memberId}`;
                      return <img key={idx} src={memberAvatar} alt="" style={{ width: g.members.length === 1 ? '42px' : '32px', height: g.members.length === 1 ? '42px' : '32px', borderRadius: '50%', marginLeft: idx > 0 ? '-12px' : '0', border: g.members.length === 1 ? 'none' : '2px solid #fff', zIndex: 10 - idx, objectFit: 'cover', backgroundColor: '#fff' }} />;
                    })}
                    {g.members?.length > 3 && (
                      <div style={{ width: '32px', height: '32px', borderRadius: '50%', marginLeft: '-12px', border: '2px solid #fff', zIndex: 6, backgroundColor: '#f0f0f0', color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 'bold', flexShrink: 0 }}>
                        +{g.members.length - 3}
                      </div>
                    )}
                    {(!g.members || g.members.length === 0) && <div style={{ width: '42px', height: '42px', backgroundColor: '#e1e1e1', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><UsersRound size={20} style={{ color: '#fff' }} /></div>}
                  </div>
                  <div className="contact-info">
                    <div className="contact-name">{g.name}</div>
                    <div className="contact-preview" style={{ fontSize: '12px', color: '#999' }}>({g.members?.length || 0})</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {activeTab === 'contacts' && (
            <div style={{ paddingTop: '10px' }}>
              <div style={{ padding: '5px 15px', color: '#999', fontSize: '13px', backgroundColor: '#ebebeb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{t('All Contacts') || 'All Contacts'}</span>
                <button
                  onClick={() => setShowAddCharModal(true)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-color)', padding: 0 }}
                  title={lang === 'en' ? 'Add new AI character' : '添加新的 AI 角色'}
                >
                  <UserPlus size={16} />
                </button>
              </div>
              {contacts.map(c => (
                <div key={c.id} className="contact-item" onClick={() => { setActiveContactId(c.id); setActiveTab('chats'); }}>
                  <div className="contact-avatar">
                    <img src={c.avatar} alt={c.name} />
                  </div>
                  <div className="contact-info" style={{ display: 'flex', alignItems: 'center' }}>
                    <span className="contact-name" style={{ fontSize: '16px' }}>{c.name}</span>
                  </div>
                </div>
              ))}
              <div style={{ padding: '5px 15px', color: '#999', fontSize: '13px', backgroundColor: '#ebebeb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
                <span>{lang === 'en' ? 'Group Chats' : '群聊'}</span>
                <button
                  onClick={() => setShowCreateGroupModal(true)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-color)', padding: 0 }}
                  title={lang === 'en' ? 'Create Group' : '创建群聊'}
                >
                  <UsersRound size={16} />
                </button>
              </div>
              {groups.map(g => (
                <div key={g.id} className="contact-item" onClick={() => { setActiveGroupId(g.id); setActiveContactId(null); setActiveTab('chats'); }}>
                  <div className="contact-avatar" style={{ width: 'auto', minWidth: '42px', height: '42px', display: 'flex', alignItems: 'center' }}>
                    {g.members?.slice(0, 3).map((memberObj, idx) => {
                      const memberId = typeof memberObj === 'object' ? memberObj.member_id : memberObj;
                      const memberAvatar = contacts.find(c => String(c.id) === String(memberId))?.avatar || `https://api.dicebear.com/7.x/pixel-art/svg?seed=${memberId}`;
                      return <img key={idx} src={memberAvatar} alt="" style={{ width: g.members.length === 1 ? '42px' : '32px', height: g.members.length === 1 ? '42px' : '32px', borderRadius: '50%', marginLeft: idx > 0 ? '-12px' : '0', border: g.members.length === 1 ? 'none' : '2px solid #fff', zIndex: 10 - idx, objectFit: 'cover', backgroundColor: '#fff' }} />;
                    })}
                    {g.members?.length > 3 && (
                      <div style={{ width: '32px', height: '32px', borderRadius: '50%', marginLeft: '-12px', border: '2px solid #fff', zIndex: 6, backgroundColor: '#f0f0f0', color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 'bold', flexShrink: 0 }}>
                        +{g.members.length - 3}
                      </div>
                    )}
                    {(!g.members || g.members.length === 0) && <div style={{ width: '42px', height: '42px', backgroundColor: '#e1e1e1', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><UsersRound size={20} style={{ color: '#fff' }} /></div>}
                  </div>
                  <div className="contact-info" style={{ display: 'flex', alignItems: 'center' }}>
                    <span className="contact-name" style={{ fontSize: '16px' }}>{g.name}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {activeTab === 'discover' && (
            <div className="contact-item active">
              <Compass size={24} style={{ marginRight: '10px', color: 'var(--accent-color)' }} />
              <div className="contact-info">
                <div className="contact-name">{t('Moments')}</div>
              </div>
            </div>
          )}
          {activeTab === 'settings' && (
            <div className="contact-item active">
              <Settings size={24} style={{ marginRight: '10px', color: 'var(--accent-color)' }} />
              <div className="contact-info">
                <div className="contact-name">{t('Settings')}</div>
              </div>
            </div>
          )}
        </div>
      </div>



      {/* 3. Right Column (Chat Area / Content) — hidden on contacts tab */}
      {activeTab !== 'contacts' && (
        <div className="right-column" style={{ flexDirection: 'row', backgroundColor: activeTab === 'settings' ? '#f5f5f5' : '#fff' }}>
          {activeTab === 'settings' ? (
            <div style={{ flex: 1, height: '100%', overflowY: 'auto', minWidth: 0, minHeight: 0 }}>
              <SettingsPanel
                apiUrl={API_URL}
                contacts={contacts}
                onCharactersUpdate={() => {
                  fetchContacts(); // Refetch if deleted
                }}
                onProfileUpdate={setUserProfile}
                onBack={() => setActiveTab('chats')}
              />
            </div>
          ) : activeTab === 'discover' ? (
            <div style={{ flex: 1, height: '100%', overflowY: 'auto', minWidth: 0, minHeight: 0 }}>
              <MomentsFeed apiUrl={API_URL} userProfile={userProfile} onBack={() => setActiveTab('chats')} />
            </div>
          ) : activeContactId && activeTab === 'chats' ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'row', height: '100%', minWidth: 0 }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <ChatWindow
                  contact={contacts.find(c => c.id === activeContactId)}
                  allContacts={contacts}
                  userAvatar={userProfile?.avatar}
                  apiUrl={API_URL}
                  newIncomingMessage={newIncomingMessage}
                  engineState={engineState}
                  onToggleMemo={() => setActiveDrawer(activeDrawer === 'memo' ? null : 'memo')}
                  onToggleDiary={() => setActiveDrawer(activeDrawer === 'diary' ? null : 'diary')}
                  onToggleSettings={() => setActiveDrawer(activeDrawer === 'settings' ? null : 'settings')}
                  onBack={() => { setActiveContactId(null); activeContactRef.current = null; }}
                />
              </div>
              {activeDrawer === 'memo' && (
                <MemoTable
                  contact={contacts.find(c => c.id === activeContactId)}
                  apiUrl={API_URL}
                  onClose={() => setActiveDrawer(null)}
                />
              )}
              {activeDrawer === 'diary' && (
                <DiaryTable
                  contact={contacts.find(c => c.id === activeContactId)}
                  apiUrl={API_URL}
                  onClose={() => setActiveDrawer(null)}
                />
              )}
              {activeDrawer === 'settings' && (
                <ChatSettingsDrawer
                  contact={contacts.find(c => c.id === activeContactId)}
                  apiUrl={API_URL}
                  onClose={() => setActiveDrawer(null)}
                  onClearHistory={() => {
                    setActiveDrawer(null);
                    setActiveContactId(null);
                    fetchContacts(); // Re-pull character data so stats show as reset immediately
                  }}
                />
              )}
            </div>
          ) : activeGroupId && activeTab === 'chats' ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'row', height: '100%', minWidth: 0 }}>
              <GroupChatWindow
                group={groups.find(g => g.id === activeGroupId)}
                apiUrl={API_URL}
                allContacts={contacts}
                userProfile={userProfile}
                newGroupMessage={newGroupMessage}
                typingIndicators={groupTyping[activeGroupId] || []}
                onBack={() => setActiveGroupId(null)}
              />
            </div>
          ) : (
            <div className="empty-chat-state">
              <MessageSquare size={64} className="empty-icon" />
              <p>ChatPulse</p>
            </div>
          )}
        </div>
      )}

      <AddCharacterModal
        isOpen={showAddCharModal}
        onClose={() => setShowAddCharModal(false)}
        apiUrl={API_URL}
        onAdd={(newChar) => {
          setContacts(prev => [...prev, newChar]);
        }}
      />

      {showCreateGroupModal && (
        <CreateGroupModal
          apiUrl={API_URL}
          contacts={contacts}
          onClose={() => setShowCreateGroupModal(false)}
          onCreate={(group) => {
            setGroups(prev => [group, ...prev]);
            setShowCreateGroupModal(false);
            setActiveGroupId(group.id);
            setActiveContactId(null);
            setActiveTab('chats');
          }}
        />
      )}
    </div>
  );
}

export default App;
