/**
 * ChatList - Lista de conversaciones con dark mode
 * Feature: click en avatar para ver foto ampliada
 * Feature: long-press 3s → opción "Eliminar chat"
 */
import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useThemeStore, DARK, LIGHT } from '../store/themeStore';
import { useChatStore } from '../store/chatStore';
import Avatar from './Avatar.jsx';
import { tr } from '../i18n';

export default function ChatList({ chats }) {
  const navigate = useNavigate();
  const { isDark } = useThemeStore();
  const T = isDark ? DARK : LIGHT;
  const { deleteChat } = useChatStore();

  const [expandedPhoto, setExpandedPhoto]   = useState(null);
  const [selectedChat,  setSelectedChat]    = useState(null); // chat a eliminar
  const [deleting,      setDeleting]        = useState(false);

  const longPressRef  = useRef(null);
  const pressingIdRef = useRef(null);

  // ── Long-press handlers ───────────────────────────────────────────
  const startPress = (chat) => {
    pressingIdRef.current = chat.id;
    longPressRef.current = setTimeout(() => {
      if (pressingIdRef.current === chat.id) {
        setSelectedChat(chat);
      }
    }, 1500);
  };

  const cancelPress = () => {
    clearTimeout(longPressRef.current);
    pressingIdRef.current = null;
  };

  // ── Confirmar eliminación ─────────────────────────────────────────
  const handleDelete = async () => {
    if (!selectedChat) return;
    setDeleting(true);
    await deleteChat(selectedChat.id);
    setDeleting(false);
    setSelectedChat(null);
  };

  if (!chats?.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 264, gap: 12, padding: 32 }}>
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <p style={{ fontSize: 14, fontWeight: 600, color: T.textSecondary, textAlign: 'center', margin: 0 }}>{tr('No hay conversaciones aún.')}<br />{tr('¡Empieza a chatear!')}</p>
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
              userSelect: 'none',
            }}
            onClick={() => navigate(`/chat/${chat.id}`, { state: { chat } })}
            onTouchStart={() => startPress(chat)}
            onTouchEnd={cancelPress}
            onTouchMove={cancelPress}
            onMouseDown={() => startPress(chat)}
            onMouseUp={cancelPress}
            onMouseLeave={cancelPress}
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
                  <span style={{ flexShrink: 0, background: '#3D5A80', color: 'white', fontSize: 11, fontWeight: 800, width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {chat.unread > 9 ? '9+' : chat.unread}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Modal de confirmación: eliminar chat ── */}
      {selectedChat && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1100,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          }}
          onClick={() => setSelectedChat(null)}
        >
          <div
            style={{
              width: '100%', maxWidth: 480,
              background: isDark ? '#0f1f3a' : 'white',
              borderRadius: '20px 20px 0 0',
              padding: '20px 20px 36px',
              boxShadow: '0 -4px 32px rgba(0,0,0,0.25)',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Tirador */}
            <div style={{ width: 40, height: 4, borderRadius: 2, background: isDark ? 'rgba(255,255,255,0.2)' : '#d1d5db', margin: '0 auto 20px' }} />

            {/* Avatar + nombre del chat */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <Avatar name={selectedChat.name} src={selectedChat.avatar || null} size="lg" />
              <div>
                <p style={{ fontWeight: 800, fontSize: 16, color: isDark ? '#E0FBFC' : '#111827', margin: 0 }}>
                  {selectedChat.name}
                </p>
                <p style={{ fontSize: 12, color: isDark ? '#6b8ab0' : '#6b7280', margin: '2px 0 0' }}>
                  {selectedChat.lastMessage
                    ? (selectedChat.lastMessage.length > 40 ? selectedChat.lastMessage.slice(0, 40) + '…' : selectedChat.lastMessage)
                    : tr('Sin mensajes')}
                </p>
              </div>
            </div>

            {/* Botón eliminar */}
            <button
              onClick={handleDelete}
              disabled={deleting}
              style={{
                width: '100%', padding: '14px 0',
                background: deleting ? '#fca5a5' : '#ef4444',
                color: 'white', border: 'none', borderRadius: 14,
                fontSize: 15, fontWeight: 800, cursor: deleting ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                marginBottom: 10,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
                <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
              </svg>
              {deleting ? tr('Eliminando…') : tr('Eliminar chat')}
            </button>

            {/* Botón cancelar */}
            <button
              onClick={() => setSelectedChat(null)}
              style={{
                width: '100%', padding: '13px 0',
                background: 'none',
                color: isDark ? '#6b8ab0' : '#6b7280',
                border: `1.5px solid ${isDark ? 'rgba(255,255,255,0.1)' : '#e5e7eb'}`,
                borderRadius: 14, fontSize: 15, fontWeight: 700, cursor: 'pointer',
              }}
            >{tr('Cancelar')}</button>
          </div>
        </div>
      )}

      {/* Visor de foto ampliada */}
      {expandedPhoto && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setExpandedPhoto(null)}
        >
          <img src={expandedPhoto} style={{ width: '100vw', maxHeight: '100vh', objectFit: 'contain' }} />
          <button
            onClick={() => setExpandedPhoto(null)}
            style={{ position: 'absolute', top: 20, right: 20, width: 40, height: 40, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', border: '1.5px solid rgba(255,255,255,0.3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      )}
    </>
  );
}
