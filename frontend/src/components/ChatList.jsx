/**
 * ChatList - Lista de conversaciones con dark mode
 * Feature: click en avatar para ver foto ampliada
 * Feature: pulsación larga → ventana con las opciones del chat (ChatOptionsSheet: archivos, silenciar, guardar
 *          fotos, compartir contacto, vaciar, bloquear, eliminar)
 * El chat "Tú" (contigo mismo) va siempre el primero.
 */
import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useThemeStore, DARK, LIGHT } from '../store/themeStore';
import { useChatStore } from '../store/chatStore';
import { useAuthStore } from '../store/authStore';
import NeonAvatar, { BRAND, BRAND_LIGHT, cardStyle, ringColorOf } from './NeonAvatar.jsx';
import ChatOptionsSheet from './ChatOptionsSheet.jsx';
import { isSelfChatId } from '../utils/chatOptions';
import { tr } from '../i18n';

/** Nombre que se ve del chat: el chat contigo mismo se llama "Tú" en el idioma de la app */
export const chatDisplayName = (chat, myId) => (chat?.self || isSelfChatId(chat?.id, myId) ? tr('Tú (mensajes para ti)') : chat?.name);

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
  const myId = useAuthStore(s => s.user?.id);
  const fetchChats = useChatStore(s => s.fetchChats);

  const [expandedPhoto, setExpandedPhoto]   = useState(null);
  const [selectedChat,  setSelectedChat]    = useState(null); // chat con la ventana de opciones abierta
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
    }, 600);
  };

  const cancelPress = () => {
    clearTimeout(longPressRef.current);
    pressingIdRef.current = null;
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
    if (selectedChat) return;   // la pulsación larga ya abrió la ventana de opciones
    setLit(chat.id);
    setTimeout(() => { setLit(null); navigate(`/chat/${chat.id}`, { state: { chat: { ...chat, name: chatDisplayName(chat, myId) } } }); }, 180);
  };

  // El chat "Tú" siempre arriba
  const ordered = [...chats.filter(c => c.self || isSelfChatId(c.id, myId)), ...chats.filter(c => !(c.self || isSelfChatId(c.id, myId)))];

  return (
    <>
      <div style={{ padding: '4px 12px 0' }}>
        {ordered.map((chat) => {
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
                  {chatDisplayName(chat, myId)}
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

      {/* ── Ventana de opciones del chat (pulsación larga) ── */}
      {selectedChat && (
        <ChatOptionsSheet chat={selectedChat} showDelete
          onClose={() => setSelectedChat(null)}
          onChanged={() => { if (myId) fetchChats(myId); }} />
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
