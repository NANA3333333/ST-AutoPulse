import React from 'react';

function ContactList({ contacts, activeId, onSelect, engineState = {} }) {
    return (
        <>
            {contacts.map((contact) => {
                const state = engineState[contact.id];
                const countdown = state?.countdownMs ? Math.ceil(state.countdownMs / 1000) : null;

                return (
                    <div
                        key={contact.id}
                        className={`contact-item ${activeId === contact.id ? 'active' : ''}`}
                        onClick={() => onSelect(contact.id)}
                    >
                        <div className="contact-avatar" style={{ position: 'relative' }}>
                            <img src={contact.avatar} alt={contact.name} />
                            <div className={`autopulse-status-dot ${state?.isThinking ? 'thinking' : 'connected'}`} />
                        </div>
                        <div className="contact-info">
                            <div className="contact-header">
                                <span className="contact-name">{contact.name}</span>
                                <span className="contact-time" style={{ color: countdown ? (state?.isThinking ? '#ff9800' : 'var(--accent-color)') : undefined, fontWeight: countdown ? 'bold' : 'normal' }}>
                                    {countdown ? (state?.isThinking ? '✍️...' : `⏱ ${countdown}s`) : contact.time}
                                </span>
                            </div>
                            <div className="contact-last-msg">
                                {contact.lastMessage}
                                {contact.unread > 0 && <span className="unread-badge">{contact.unread}</span>}
                                {state?.isBlocked === 1 && <span style={{ marginLeft: 5, color: 'var(--danger)' }} title="Blocked">🚫</span>}
                            </div>
                        </div>
                    </div>
                )
            })}
        </>
    );
}

export default ContactList;
