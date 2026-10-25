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
import NeonAvatar, { BRAND, BRAND_LIGHT, cardStyle, ringColorOf } from './NeonAvatar.jsx';
import { tr } from '../i18n';

// Último mensaje de foto, vídeo, audio…: icono en vez del emoji que pone el servidor ("📷 Foto" → [cámara] Foto)
const MEDIA_LABEL = {
  image: 'Foto', video: 'Vídeo', audio: 'Nota de voz', location: 'Ubicación',
  live_location: 'Ubicación en tiempo real', sticker: 'Sticker',
};
const MEDIA_ICON = {
  image: <><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></>,
  video: <><rect x="1" y="6" width="15" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3"/></>,
  audio: <><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0014 0M12 17v5"/></>,
  location: <><path d="M12 22s7-6.2 7-12a7 7 0 10-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></>,
  sticker: <><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></>,
};
MEDIA_ICON.live_location = MEDIA_ICON.location;

/** Línea del último mensaje: ✓✓ si es mío (azul si ya lo han leído) + icono del tipo + texto */
function LastLine({ chat, T, unread }) {
  const type = chat.lastType;
  const media = MEDIA_LABEL[type];
  const color = unread ? T.textPrimary : T.textSecondary;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flex: 1 }}>
      {chat.lastFromMe && (
        <svg width="17" height="12" viewBox="0 0 26 16" fill="none" stroke={chat.lastRead ? '#4FA3F7' : T.textMuted} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <path d="M1.5 8.5l4.5 4.5L15 3M10 12.5l1 .5L24.5 3" />
        </svg>
      )}
      {media && (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          {MEDIA_ICON[type]}
        </svg>
      )}
      <p style={{ fontSize: 14, color, fontWeight: unread ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
        {media ? tr(media) : chat.lastMessage}
      </p>
    </div>
  );
}

export default function ChatList({ chats }) {
  const navigate = useNavigate();
  const { isDark } = useThemeStore();
  const T = isDark ? DARK : LIGHT;
  const { deleteChat } = useChatStore();

  const [expandedPhoto, setExpandedPhoto]   = useState(null);
  const [selectedChat,  setSelectedChat]    = useState(null); // chat a eliminar
  const [deleting,      setDeleting]        = useState(false);
  const [lit,           setLit]             = useState(null);   // chat pulsado: su aro se enciende

  const longPressRef  = useRef(null);
  const pressingIdRef = useRef(null);

  // ── Long-press handlers ───────────────────────────────────────────
  const startPress = (chat) => {
    pressingIdRef.current = chat.id;
    longPressRef.current = setTimeout(() => {
      if (pressingIdRef.current === chat.id) {
        setLit(null);
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

  // Al pulsar: el aro del contacto se enciende (neón) y se abre el chat un instante después para que se vea
  const openChat = (chat) => {
    if (selectedChat) return;   // la pulsación larga ya abrió "Eliminar chat"
    setLit(chat.id);
    setTimeout(() => { setLit(null); navigate(`/chat/${chat.id}`, { state: { chat } }); }, 180);
  };

  return (
    <>
      <div style={{ padding: '4px 12px 0' }}>
        {chats.map((chat) => {
          const unread = chat.unread > 0;
          const timeColor = unread ? (isDark ? BRAND_LIGHT : BRAND) : T.textMuted;
          return (
          <div
            key={chat.id}
            style={{
              ...cardStyle(T, isDark),
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '12px 14px',
              marginBottom: 10,
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
              userSelect: 'none',
              transform: lit === chat.id ? 'scale(0.985)' : 'none',
              transition: 'transform 0.15s',
            }}
            onClick={() => openChat(chat)}
            onTouchStart={() => { setLit(chat.id); startPress(chat); }}
            onTouchEnd={cancelPress}
            onTouchMove={() => { setLit(null); cancelPress(); }}
            onMouseDown={() => { setLit(chat.id); startPress(chat); }}
            onMouseUp={cancelPress}
            onMouseLeave={() => { if (lit === chat.id) setLit(null); cancelPress(); }}
          >
            {/* Avatar con aro neón — click para ver foto */}
            <div
              style={{ position: 'relative', flexShrink: 0 }}
              onClick={(e) => {
                if (chat.avatar) {
                  e.stopPropagation();
                  setLit(null);
                  setExpandedPhoto(chat.avatar);
                }
              }}
            >
              <NeonAvatar name={chat.name} src={chat.avatar || null} size={54} color={ringColorOf(chat.id)}
                active={lit === chat.id} online={chat.online} T={T} />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <p style={{ fontWeight: 600, fontSize: 16, color: T.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0, paddingRight: 8 }}>
                  {chat.name}
                </p>
                <span style={{ fontSize: 12, color: timeColor, flexShrink: 0, fontWeight: unread ? 800 : 600 }}>{chat.lastTime}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <LastLine chat={chat} T={T} unread={unread} />
                {unread && (
                  <span style={{ flexShrink: 0, background: isDark ? '#4F7CC4' : BRAND, color: 'white', fontSize: 11, fontWeight: 800,
                                 minWidth: 22, height: 22, padding: '0 6px', boxSizing: 'border-box', borderRadius: 11,
                                 display: 'flex', alignItems: 'center', justifyContent: 'center',
                                 boxShadow: `0 0 10px ${isDark ? 'rgba(79,124,196,0.6)' : 'rgba(61,90,128,0.35)'}` }}>
                    {chat.unread > 99 ? '99+' : chat.unread}
                  </span>
                )}
              </div>
            </div>
          </div>
          );
        })}
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
