/**
 * ChatList - Lista de conversaciones con dark mode
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useThemeStore, DARK, LIGHT } from '../store/themeStore';
import Avatar from './Avatar.jsx';

export default function ChatList({ chats }) {
  const navigate = useNavigate();
  const { isDark } = useThemeStore();
  const T = isDark ? DARK : LIGHT;

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
    <div>
      {chats.map((chat, i) => (
        <button
          key={chat.id}
          onClick={() => navigate(`/chat/${chat.id}`, { state: { chat } })}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '14px 16px',
            background: T.bgSurface,
            border: 'none',
            borderBottom: `1px solid ${T.border}`,
            cursor: 'pointer',
            textAlign: 'left',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <Avatar name={chat.name} size="lg" />
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
        </button>
      ))}
    </div>
  );
}
