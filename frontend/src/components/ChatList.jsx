/**
 * ChatList - Lista de conversaciones con dark mode
 * Feature: click en avatar para ver foto ampliada
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useThemeStore, DARK, LIGHT } from '../store/themeStore';
import Avatar from './Avatar.jsx';

export default function ChatList({ chats }) {
  const navigate = useNavigate();
  const { isDark } = useThemeStore();
  const T = isDark ? DARK : LIGHT;
  const [expandedPhoto, setExpandedPhoto] = useState(null);

  if (!chats?.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 264, gap: 12, padding: 32 }}>
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <p style={{ fontSize: 14, fontWeight: 600, color: T.textSecondary, textAlign: 'center', margin: 0 }}>
          No hay conversaciones aún.<br />¡Empieza a chatear!
        </p>
      </div>
    );
  }

  return (
    <>
      <div>
        {chats.map((chat) => (
          <div
            key={chat.id}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '14px 16px',
              background: T.bgSurface,
              borderBottom: `1px solid ${T.border}`,
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
            onClick={() => navigate(`/chat/${chat.id}`, { state: { chat } })}
          >
            {/* Avatar — click para ver foto */}
            <div
              style={{ position: 'relative', flexShrink: 0 }}
              onClick={(e) => {
                if (chat.avatar) {
                  e.stopPropagation();
                  setExpandedPhoto(chat.avatar);
                }
              }}
            >
              <Avatar name={chat.name} src={chat.avatar || null} size="lg" />
              {chat.online && (
                <span style={{ position: 'absolute', bottom: 2, right: 2, width: 11, height: 11, borderRadius: '50%', background: '#4ade80', border: `2px solid ${T.bgSurface}` }} />
              )}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                <p style={{ fontWeight: 700, fontSize: 15, color: T.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0, paddingRight: 8 }}>
                  {chat.name}
                </p>
                <span style={{ fontSize: 11, color: T.textMuted, flexShrink: 0, fontWeight: 500 }}>{chat.lastTime}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <p style={{ fontSize: 13, color: T.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0, paddingRight: 8 }}>
                  {chat.lastMessage}
                </p>
                {chat.unread > 0 && (
                  <span style={{ flexShrink: 0, background: '#000080', color: 'white', fontSize: 11, fontWeight: 800, width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {chat.unread > 9 ? '9+' : chat.unread}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Visor de foto ampliada */}
      {expandedPhoto && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setExpandedPhoto(null)}
        >
          <img src={expandedPhoto} style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 16, objectFit: 'contain' }} />
          <button
            onClick={() => setExpandedPhoto(null)}
            style={{ position: 'absolute', top: 20, right: 20, width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      )}
    </>
  );
}
