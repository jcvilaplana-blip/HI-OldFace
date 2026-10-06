/**
 * HomePage — Pantalla principal OldFace (dark mode nativo)
 */
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import { useContacts } from '../hooks/useContacts';
import { useThemeStore, DARK, LIGHT } from '../store/themeStore';
import { useCallStore } from '../store/callStore';
import PopupMenu from '../components/PopupMenu.jsx';
import ChatList from '../components/ChatList.jsx';
import BottomNav from '../components/BottomNav.jsx';
import Avatar from '../components/Avatar.jsx';

const BRAND   = '#3D5A80';
const APP_URL = 'https://oldface.app';

async function inviteContact(contact) {
  const text = `¡Hola ${contact.name}! Te invito a OldFace, la app para conectar con quienes más quieres. Descárgala aquí: ${APP_URL}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'OldFace', text, url: APP_URL });
    } else {
      const phone = contact.phone.replace(/\D/g, '');
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    }
  } catch { /* usuario canceló */ }
}

export default function HomePage() {
  const navigate = useNavigate();
  const { user }  = useAuthStore();
  const { chats, fetchChats } = useChatStore();
  const { isDark } = useThemeStore();
  const { sendVoiceCall, sendVideoCall } = useCallStore();
  const T = isDark ? DARK : LIGHT;

  const [searchParams] = useSearchParams();
  const [showMenu,        setShowMenu]        = useState(false);
  const [showGroupCreate, setShowGroupCreate] = useState(false);
  const [showSearch,      setShowSearch]      = useState(false);
  const [searchQuery,     setSearchQuery]     = useState('');
  const searchInputRef = React.useRef(null);
  const [activeTab,       setActiveTab]       = useState(() => {
    const t = searchParams.get('tab');
    return ['chats','estados','llamadas','contactos'].includes(t) ? t : 'chats';
  });

  // Reaccionar cuando el popup navega a /?tab=estados
  useEffect(() => {
    const t = searchParams.get('tab');
    if (t && ['chats','estados','llamadas','contactos'].includes(t)) {
      setActiveTab(t);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!user?.id) return;
    fetchChats(user.id);
    // Polling cada 5s para detectar chats y mensajes nuevos aunque se pierda la conexión en tiempo real
    const interval = setInterval(() => fetchChats(user.id), 5000);
    return () => clearInterval(interval);
  }, [user?.id]);

  const tabs = [
    { key: 'chats',     label: 'CHATS' },
    { key: 'estados',   label: 'ESTADOS' },
    { key: 'llamadas',  label: 'LLAMADAS' },
    { key: 'contactos', label: 'CONTACTOS' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: T.bgMain, overflow: 'hidden' }}>

      {/* ══ HEADER ══════════════════════════════════════════════════════════ */}
      <div
        style={{
          backgroundColor: T.bgSurface,
          flexShrink: 0,
          borderBottom: `1px solid ${T.border}`,
          paddingTop: 'var(--sat)',
        }}
      >
        {/* Fila superior */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar name={user?.name} src={user?.avatar || null} size="sm" />
            <div>
              <h1 style={{ fontSize: 17, fontWeight: 900, color: T.textPrimary, lineHeight: 1.1, margin: 0 }}>OldFace</h1>
              <p style={{ fontSize: 11, color: T.textSecondary, fontWeight: 600, margin: 0 }}>{user?.name}</p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => {
                setShowSearch(v => !v);
                setSearchQuery('');
                if (!showSearch) setTimeout(() => searchInputRef.current?.focus(), 80);
              }}
              style={{
                width: 34, height: 34, borderRadius: '50%',
                background: showSearch ? BRAND : (isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'),
                border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={showSearch ? 'white' : T.textSecondary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>

            <button
              onClick={() => navigate('/settings')}
              style={{
                width: 34, height: 34, borderRadius: '50%',
                background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)',
                border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Barra de búsqueda */}
        {showSearch && (
          <div style={{ padding: '8px 12px 10px', borderTop: `1px solid ${T.border}`, background: T.bgSurface }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.bgInput, borderRadius: 20, padding: '8px 14px', border: `1px solid ${T.border}` }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Buscar conversación..."
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 14, color: T.textPrimary, fontWeight: 500 }}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', borderTop: `1px solid ${T.border}` }}>
          {tabs.map(tab => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  flex: 1,
                  padding: '9px 0',
                  fontSize: '9.5px',
                  fontWeight: 800,
                  letterSpacing: '0.5px',
                  color: active ? BRAND : T.textMuted,
                  background: 'transparent',
                  border: 'none',
                  borderBottom: active ? `2.5px solid ${BRAND}` : '2.5px solid transparent',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  transition: 'color 0.15s',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ══ CONTENIDO ════════════════════════════════════════════════════════ */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: T.bgMain }}>
        {activeTab === 'chats'     && <>
          <StoriesBar user={user} T={T} isDark={isDark} />
          <ChatList chats={searchQuery.trim()
            ? chats.filter(c => c.name?.toLowerCase().includes(searchQuery.toLowerCase()) || c.lastMessage?.toLowerCase().includes(searchQuery.toLowerCase()))
            : chats
          } />
        </>}
        {activeTab === 'estados'   && <StoriesBar user={user} T={T} isDark={isDark} fullPage />}
        {activeTab === 'llamadas'  && <CallsTab T={T} user={user} isDark={isDark} />}
        {activeTab === 'contactos' && <ContactosTab T={T} isDark={isDark} />}
      </div>

      {/* ══ FAB "+" centrado: abre el menú emergente hacia arriba ══════════════ */}
      <button
        onClick={() => setShowMenu(true)}
        aria-label="Abrir menú"
        style={{
          position: 'fixed',
          bottom: 'calc(var(--sab) + 76px)',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 58, height: 58,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #4E7D96 0%, #3D5A80 100%)',
          border: '3px solid white',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 6px 20px rgba(61,90,128,0.45)',
          zIndex: 30,
        }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <BottomNav />
      {showMenu && (
        <PopupMenu
          onClose={() => setShowMenu(false)}
          onGroups={() => { setShowMenu(false); setShowGroupCreate(true); }}
        />
      )}
      {showGroupCreate && (
        <GroupCreateModal
          user={user}
          T={T}
          isDark={isDark}
          onClose={() => setShowGroupCreate(false)}
          onCreated={(chatId, groupName) => {
            setShowGroupCreate(false);
            fetchChats(user.id);
            navigate(`/chat/${chatId}`, { state: { chat: { id: chatId, name: groupName, isGroup: true } } });
          }}
        />
      )}
    </div>
  );
}

const BACKEND_HOME = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

// Misma lógica que el backend — genera el userId correcto desde cualquier formato de teléfono
function toUserId(phone) {
  const p = String(phone).trim().replace(/[\s-]/g, '');
  let digits;
  if (p.startsWith('+')) {
    digits = p.slice(1).replace(/\D/g, '');
  } else if (p.startsWith('0034')) {
    digits = '34' + p.slice(4).replace(/\D/g, '');
  } else {
    digits = p.replace(/\D/g, '');
    if (digits.length === 9) digits = '34' + digits;
  }
  return `user_${digits}`;
}

// ══ Tab CONTACTOS ════════════════════════════════════════════════════════════
function ContactosTab({ T, isDark }) {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { contacts, loading, error, loadContacts, openSettings } = useContacts();
  const { sendVoiceCall, sendVideoCall } = useCallStore();
  const [searchPhone, setSearchPhone] = React.useState('');
  const [searchResult, setSearchResult] = React.useState(null);

  const handlePhoneSearch = async () => {
    const raw = searchPhone.trim();
    if (!raw) return;
    setSearchResult('searching');
    try {
      const phone = raw.startsWith('+') ? raw : `+34${raw.replace(/\D/g, '')}`;
      const res = await fetch(`${BACKEND_HOME}/find-user?phone=${encodeURIComponent(phone)}`);
      if (res.ok) {
        const data = await res.json();
        setSearchResult({ found: true, name: data.name, userId: data.userId, phone: data.phone });
      } else {
        setSearchResult({ found: false });
      }
    } catch {
      setSearchResult({ found: false });
    }
  };

  useEffect(() => { loadContacts(); }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', border: `3px solid ${T.border}`, borderTopColor: BRAND, animation: 'spin 0.8s linear infinite' }} />
        <p style={{ fontSize: 13, color: T.textSecondary, fontWeight: 600 }}>Cargando contactos...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  if (error === 'denied') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 32px', gap: 16, textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(239,68,68,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <line x1="17" y1="11" x2="23" y2="11"/>
          </svg>
        </div>
        <p style={{ fontSize: 15, fontWeight: 800, color: T.textPrimary, margin: 0 }}>Permiso de contactos denegado</p>
        <p style={{ fontSize: 12, color: T.textSecondary, margin: 0, lineHeight: 1.6 }}>
          Ve a <strong>Ajustes → Aplicaciones → OldFace → Permisos → Contactos</strong> y actívalo.
        </p>
        <button onClick={openSettings} style={{ background: BRAND, color: 'white', border: 'none', borderRadius: 14, padding: '12px 28px', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
          Abrir Ajustes
        </button>
        <button onClick={loadContacts} style={{ background: 'transparent', color: BRAND, border: `1.5px solid ${BRAND}`, borderRadius: 14, padding: '10px 24px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
          Ya lo activé — Reintentar
        </button>
      </div>
    );
  }

  // JSX inline — NO definir como componente dentro del render (causa remount en cada render → cierra el teclado)
  const phoneSearchBlock = (
    <div style={{ background: T.bgSurface, padding: '14px 16px', borderBottom: `1px solid ${T.border}` }}>
      <p style={{ fontSize: 11, fontWeight: 800, color: BRAND, letterSpacing: '0.5px', margin: '0 0 8px' }}>BUSCAR POR TELÉFONO</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={searchPhone}
          onChange={e => { setSearchPhone(e.target.value); setSearchResult(null); }}
          onKeyDown={e => e.key === 'Enter' && handlePhoneSearch()}
          placeholder="+34 600 000 000"
          type="tel"
          style={{
            flex: 1, padding: '10px 12px', borderRadius: 12,
            border: `1.5px solid ${T.borderStrong}`,
            fontSize: 14, outline: 'none',
            background: T.bgInput, color: T.textPrimary,
          }}
        />
        <button onClick={handlePhoneSearch} style={{ background: BRAND, color: 'white', border: 'none', borderRadius: 12, padding: '10px 18px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
          Buscar
        </button>
      </div>
      {searchResult === 'searching' && <p style={{ fontSize: 12, color: T.textSecondary, margin: '8px 0 0' }}>Buscando...</p>}
      {searchResult?.found && (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12, background: T.accentDim, borderRadius: 12, padding: '10px 14px' }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: BRAND, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 900, fontSize: 16, flexShrink: 0 }}>
            {searchResult.name[0].toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 800, color: T.textPrimary, margin: 0 }}>{searchResult.name}</p>
            <p style={{ fontSize: 11, color: BRAND, margin: 0, fontWeight: 600 }}>● En OldFace</p>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => navigate(`/chat/${searchResult.userId}`, { state: { chat: { id: searchResult.userId, name: searchResult.name, participantId: searchResult.userId } } })}
              style={{ background: BRAND, color: 'white', border: 'none', borderRadius: 20, padding: '7px 14px', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>Chat</button>
            <ActionBtn onClick={() => sendVideoCall(searchResult.userId, searchResult.name)} T={T}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 10l4.553-2.069A1 1 0 0121 8.868v6.264a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
            </ActionBtn>
            <ActionBtn onClick={() => sendVoiceCall(searchResult.userId, searchResult.name)} T={T}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 7V5z"/></svg>
            </ActionBtn>
          </div>
        </div>
      )}
      {searchResult?.found === false && (
        <p style={{ fontSize: 12, color: '#ef4444', margin: '8px 0 0', fontWeight: 600 }}>Este número no está registrado en OldFace</p>
      )}
    </div>
  );

  if (error === 'web') {
    return (
      <div style={{ paddingBottom: 16 }}>
        {phoneSearchBlock}
        <div style={{ textAlign: 'center', padding: '32px 24px', color: T.textSecondary }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 12px', display: 'block' }}>
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
          </svg>
          <p style={{ fontSize: 14, fontWeight: 700, color: T.textSecondary, margin: '0 0 6px' }}>Contactos solo disponibles en la app</p>
          <p style={{ fontSize: 12, color: T.textMuted, margin: 0, lineHeight: 1.6 }}>
            Usa el buscador para encontrar usuarios.<br/>
            Para ver tus contactos del móvil, instala la app nativa.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ paddingBottom: 16 }}>
        {phoneSearchBlock}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 24px', gap: 14, textAlign: 'center' }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: '#ef4444', margin: 0 }}>No se pudieron cargar los contactos</p>
          <p style={{ fontSize: 11, color: T.textMuted, margin: 0, fontFamily: 'monospace', background: T.bgHover, padding: '6px 12px', borderRadius: 8 }}>{error}</p>
          <button onClick={loadContacts} style={{ background: BRAND, color: 'white', border: 'none', borderRadius: 14, padding: '11px 28px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>Reintentar</button>
          <button onClick={openSettings} style={{ background: 'transparent', color: T.textSecondary, border: `1.5px solid ${T.borderStrong}`, borderRadius: 14, padding: '9px 20px', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>Abrir Ajustes del sistema</button>
        </div>
      </div>
    );
  }

  const oldFaceContacts = contacts.filter(c => c.usesOldFace);
  const others          = contacts.filter(c => !c.usesOldFace);

  return (
    <div style={{ paddingBottom: 16 }}>
      {phoneSearchBlock}

      <button
        onClick={() => navigate('/contacts')}
        style={{ width: '100%', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, background: T.bgSurface, border: 'none', borderBottom: `1px solid ${T.border}`, cursor: 'pointer' }}
      >
        <div style={{ width: 44, height: 44, borderRadius: '50%', background: BRAND, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4v16M4 12h16" />
          </svg>
        </div>
        <p style={{ fontSize: 14, fontWeight: 800, color: BRAND, margin: 0 }}>Ver todos los contactos</p>
      </button>

      {oldFaceContacts.length > 0 && (
        <>
          <div style={{ padding: '10px 16px 6px', background: T.bgSection }}>
            <p style={{ fontSize: 11, fontWeight: 800, color: BRAND, letterSpacing: '0.5px', margin: 0 }}>EN OLDFACE</p>
          </div>
          {oldFaceContacts.map(c => {
            const participantId = toUserId(c.phone);
            return (
              <ContactRow key={c.id} contact={c} T={T}
                onChat={() => navigate(`/chat/${participantId}`, { state: { chat: { id: participantId, name: c.name, participantId, online: true } } })}
                onCall={() => sendVoiceCall(participantId, c.name)}
                onVideo={() => sendVideoCall(participantId, c.name)}
              />
            );
          })}
        </>
      )}

      {others.length > 0 && (
        <>
          <div style={{ padding: '10px 16px 6px', background: T.bgSection }}>
            <p style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: '0.5px', margin: 0 }}>INVITAR A OLDFACE</p>
          </div>
          {others.slice(0, 6).map(c => (
            <ContactRow key={c.id} contact={c} T={T} isInvite />
          ))}
        </>
      )}

      {contacts.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: T.textSecondary }}>
          <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px' }}>No se encontraron contactos</p>
          <button onClick={loadContacts} style={{ background: 'transparent', color: BRAND, border: `1.5px solid ${BRAND}`, borderRadius: 14, padding: '8px 20px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            Reintentar
          </button>
        </div>
      )}
    </div>
  );
}

// ══ STORIES BAR ══════════════════════════════════════════════════════════════
function StoriesBar({ user, T, isDark }) {
  const [stories,       setStories]       = React.useState([]);
  const [viewerUserId,  setViewerUserId]  = React.useState(null); // userId cuyas stories vemos
  const [viewerIdx,     setViewerIdx]     = React.useState(0);    // índice dentro de sus stories
  const [creating,      setCreating]      = React.useState(false);
  const [storyText,     setStoryText]     = React.useState('');
  const [storyColor,    setStoryColor]    = React.useState('#3D5A80');
  const [mediaQueue,    setMediaQueue]    = React.useState([]); // hasta 10 medios {type,dataUrl,name}
  const [publishing,    setPublishing]    = React.useState(false);
  const [replyText,     setReplyText]     = React.useState('');
  const [replySent,     setReplySent]     = React.useState(false);
  const fileRef              = React.useRef(null);
  const videoRef             = React.useRef(null);
  const autoAdvRef           = React.useRef(null);
  const viewerHistoryPushed  = React.useRef(false);

  const navigate = useNavigate();
  const { persistMessage, createOrGetChat } = useChatStore();

  const fetchStories = () => {
    fetch(`${BACKEND_HOME}/stories`)
      .then(r => r.ok ? r.json() : { stories: [] })
      .then(d => setStories(d.stories || []))
      .catch(() => {});
  };

  React.useEffect(() => {
    fetchStories();
    const iv = setInterval(fetchStories, 30_000);
    return () => clearInterval(iv);
  }, []);

  // Agrupamos stories por usuario
  const myStories = stories.filter(s => s.userId === user?.id);
  const otherUsers = [...new Map(
    stories.filter(s => s.userId !== user?.id).map(s => [s.userId, s])
  ).values()];

  const COLORS = ['#3D5A80','#e11d48','#059669','#d97706','#7c3aed','#0284c7','#db2777'];

  const timeLeft = (s) => {
    const rem = s.expiresAt - Date.now();
    if (rem <= 0) return 'Expirado';
    const h = Math.floor(rem / 3_600_000);
    return h > 0 ? `${h}h` : `${Math.floor(rem / 60_000)}m`;
  };

  // Stories activas del usuario que estamos viendo
  const viewerStories = viewerUserId
    ? stories.filter(s => s.userId === viewerUserId)
    : [];
  const viewerStory = viewerStories[viewerIdx] || null;

  // Auto-avance cada 5 segundos en stories de imagen/texto
  React.useEffect(() => {
    clearTimeout(autoAdvRef.current);
    if (!viewerStory) return;
    if (viewerStory.mediaType !== 'video') {
      autoAdvRef.current = setTimeout(() => {
        if (viewerIdx < viewerStories.length - 1) {
          setViewerIdx(i => i + 1);
        } else {
          // Fin de estados → cerrar con cleanup de historial
          setViewerUserId(null); setViewerIdx(0); setReplyText(''); setReplySent(false);
          if (viewerHistoryPushed.current) { viewerHistoryPushed.current = false; window.history.back(); }
        }
      }, 5000);
    }
    return () => clearTimeout(autoAdvRef.current);
  }, [viewerStory?.id]);

  // Cierra el visor y limpia el estado de historial para que el botón atrás funcione
  const closeViewer = React.useCallback(() => {
    setViewerUserId(null);
    setViewerIdx(0);
    setReplyText('');
    setReplySent(false);
    if (viewerHistoryPushed.current) {
      viewerHistoryPushed.current = false;
      window.history.back(); // eliminar el estado que pusimos al abrir
    }
  }, []);

  // popstate: botón atrás de Android cierra el visor sin salir de la app
  React.useEffect(() => {
    const onPop = () => {
      if (viewerHistoryPushed.current) {
        viewerHistoryPushed.current = false;
        setViewerUserId(null);
        setViewerIdx(0);
        setReplyText('');
        setReplySent(false);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const openViewer = async (uid, idx = 0) => {
    // Empujar estado al historial → el botón atrás podrá cerrar el visor
    window.history.pushState({ storyViewer: true }, '');
    viewerHistoryPushed.current = true;
    setViewerUserId(uid);
    setViewerIdx(idx);
    setReplyText('');
    setReplySent(false);
    const userStories = stories.filter(s => s.userId === uid);
    // Marcar como vistas
    for (const s of userStories) {
      if (!s.viewers?.includes(user?.id)) {
        await fetch(`${BACKEND_HOME}/stories/${s.id}/view`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ viewerId: user?.id }),
        }).catch(() => {});
      }
    }
    fetchStories();
  };

  // Enviar respuesta a un estado
  const sendReply = async () => {
    const text = replyText.trim();
    if (!text || !viewerStory) return;
    clearTimeout(autoAdvRef.current); // pausar auto-avance mientras se responde
    const msgChatId = `chat_${[user?.id, viewerStory.userId].sort().join('_')}`;

    // Contexto del estado al que se responde (imagen/video/texto + autor)
    const statusReplyTo = {
      senderName: viewerStory.userName,
      type: viewerStory.mediaType === 'image' ? 'image'
          : viewerStory.mediaType === 'video' ? 'video'
          : 'text',
      url: (viewerStory.mediaType === 'image' || viewerStory.mediaType === 'video')
          ? viewerStory.content
          : null,
      text: viewerStory.mediaType === 'text'
          ? viewerStory.content
          : `Estado de ${viewerStory.userName}`,
    };

    try {
      await createOrGetChat(user?.id, viewerStory.userId, viewerStory.userName);
      await persistMessage(msgChatId, user?.id, text, 'text', null, statusReplyTo); // el backend lo entrega al instante
    } catch { /* silencioso */ }
    setReplyText('');
    setReplySent(true);
    setTimeout(() => setReplySent(false), 2500);
  };

  const deleteStory = async (storyId) => {
    await fetch(`${BACKEND_HOME}/stories/${storyId}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user?.id }),
    }).catch(() => {});
    fetchStories();
    // Si ya no hay más stories de ese usuario, cerrar visor
    const remaining = stories.filter(s => s.userId === viewerUserId && s.id !== storyId);
    if (remaining.length === 0) { closeViewer(); }
    else if (viewerIdx >= remaining.length) setViewerIdx(remaining.length - 1);
  };

  // Añadir imagen/video a la cola
  const addMediaToQueue = (file) => {
    if (!file || mediaQueue.length >= 10) return;
    const isVideo = file.type.startsWith('video/');
    const reader = new FileReader();
    reader.onload = async (ev) => {
      if (isVideo) {
        setMediaQueue(q => [...q, { type: 'video', dataUrl: ev.target.result, name: file.name }]);
        return;
      }
      // Redimensionar imagen
      const img = new Image();
      img.onload = () => {
        const MAX = 800;
        let w = img.width, h = img.height;
        const side = Math.min(w, h, MAX);
        const ratio = side / Math.min(w, h);
        w = Math.round(w * ratio); h = Math.round(h * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        setMediaQueue(q => [...q, { type: 'image', dataUrl: canvas.toDataURL('image/jpeg', 0.75), name: file.name }]);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const publishStories = async () => {
    setPublishing(true);
    // Publicar texto si hay
    if (storyText.trim()) {
      await fetch(`${BACKEND_HOME}/stories`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user?.id, userName: user?.name, mediaType: 'text', content: storyText.trim(), bgColor: storyColor }),
      }).catch(() => {});
    }
    // Publicar cada media
    for (const item of mediaQueue) {
      await fetch(`${BACKEND_HOME}/stories`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user?.id, userName: user?.name, mediaType: item.type, content: item.dataUrl }),
      }).catch(() => {});
    }
    setStoryText(''); setMediaQueue([]); setCreating(false); setPublishing(false);
    fetchStories();
  };

  return (
    <>
      {/* Barra horizontal de stories */}
      <div style={{ background: T.bgSurface, borderBottom: `1px solid ${T.border}`, padding: '10px 0 10px 12px', display: 'flex', gap: 12, overflowX: 'auto' }} className="scroll-hide">

        {/* Mi estado */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0, cursor: 'pointer' }}
          onClick={() => myStories.length ? openViewer(user?.id) : setCreating(true)}>
          <div style={{ position: 'relative', width: 56, height: 56 }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              border: myStories.length ? `2.5px solid ${BRAND}` : `2.5px dashed ${T.textMuted}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: user?.avatar ? 'transparent' : BRAND, overflow: 'hidden',
            }}>
              {user?.avatar
                ? <img src={user.avatar} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ color: 'white', fontWeight: 900, fontSize: 22 }}>{user?.name?.[0]?.toUpperCase()}</span>}
            </div>
            {!myStories.length && (
              <div style={{ position: 'absolute', bottom: 0, right: 0, width: 20, height: 20, borderRadius: '50%', background: BRAND, border: `2px solid ${T.bgSurface}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: 'white', fontSize: 14, fontWeight: 900, lineHeight: 1 }}>+</span>
              </div>
            )}
            {myStories.length > 1 && (
              <div style={{ position: 'absolute', bottom: 0, right: 0, width: 18, height: 18, borderRadius: '50%', background: '#e11d48', border: `2px solid ${T.bgSurface}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: 'white', fontSize: 9, fontWeight: 900, lineHeight: 1 }}>{myStories.length}</span>
              </div>
            )}
          </div>
          <span style={{ fontSize: 10, color: T.textSecondary, fontWeight: 600, maxWidth: 56, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {myStories.length ? timeLeft(myStories[0]) : 'Mi estado'}
          </span>
        </div>

        {/* Estados de otros */}
        {otherUsers.map(s => {
          const userStories = stories.filter(st => st.userId === s.userId);
          const allSeen = userStories.every(st => st.viewers?.includes(user?.id));
          const firstStory = userStories[0];
          return (
            <div key={s.userId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0, cursor: 'pointer' }}
              onClick={() => openViewer(s.userId)}>
              <div style={{ position: 'relative', width: 56, height: 56 }}>
                <div style={{
                  width: 56, height: 56, borderRadius: '50%',
                  border: `2.5px solid ${allSeen ? T.textMuted : BRAND}`,
                  background: firstStory?.mediaType === 'image' || firstStory?.mediaType === 'video' ? 'transparent' : (firstStory?.bgColor || BRAND),
                  display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                }}>
                  {firstStory?.mediaType === 'image'
                    ? <img src={firstStory.content} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : firstStory?.mediaType === 'video'
                      ? <video src={firstStory.content} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted />
                      : <span style={{ color: 'white', fontWeight: 900, fontSize: 22 }}>{s.userName?.[0]?.toUpperCase()}</span>}
                </div>
                {userStories.length > 1 && (
                  <div style={{ position: 'absolute', bottom: 0, right: 0, width: 18, height: 18, borderRadius: '50%', background: allSeen ? T.textMuted : BRAND, border: `2px solid ${T.bgSurface}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ color: 'white', fontSize: 9, fontWeight: 900 }}>{userStories.length}</span>
                  </div>
                )}
              </div>
              <span style={{ fontSize: 10, color: T.textSecondary, fontWeight: 600, maxWidth: 56, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.userName?.split(' ')[0] || '?'}
              </span>
            </div>
          );
        })}

        {/* Inputs ocultos */}
        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
          onChange={e => { [...(e.target.files || [])].slice(0, 10 - mediaQueue.length).forEach(addMediaToQueue); e.target.value = ''; }} />
        <input ref={videoRef} type="file" accept="video/*" style={{ display: 'none' }}
          onChange={e => { addMediaToQueue(e.target.files?.[0]); e.target.value = ''; }} />
      </div>

      {/* Modal creador de estado */}
      {creating && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.75)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: isDark ? '#293241' : 'white', borderRadius: 24, padding: 20, width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p style={{ fontSize: 17, fontWeight: 900, color: isDark ? '#E0FBFC' : '#293241', margin: 0 }}>Nuevo estado</p>
              <button onClick={() => { setCreating(false); setMediaQueue([]); setStoryText(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: isDark ? '#98C1D9' : '#9ca3af' }}>×</button>
            </div>

            {/* Texto */}
            <textarea
              value={storyText}
              onChange={e => setStoryText(e.target.value)}
              placeholder="Escribe tu estado (opcional)..."
              maxLength={200}
              rows={3}
              style={{ width: '100%', padding: 12, borderRadius: 12, border: `1.5px solid ${isDark ? 'rgba(255,255,255,0.12)' : '#e2e8f0'}`, background: isDark ? 'rgba(255,255,255,0.05)' : '#f8fafc', color: isDark ? '#E0FBFC' : '#293241', fontSize: 14, resize: 'none', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />

            {/* Selector de color (solo para texto) */}
            {storyText.trim() && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {COLORS.map(c => (
                  <button key={c} onClick={() => setStoryColor(c)}
                    style={{ width: 26, height: 26, borderRadius: '50%', background: c, border: storyColor === c ? '3px solid white' : '2px solid transparent', cursor: 'pointer', outline: storyColor === c ? `2px solid ${c}` : 'none', flexShrink: 0 }} />
                ))}
              </div>
            )}

            {/* Cola de medios */}
            {mediaQueue.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {mediaQueue.map((item, i) => (
                  <div key={i} style={{ position: 'relative', width: 72, height: 72, borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
                    {item.type === 'video'
                      ? <video src={item.dataUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted />
                      : <img src={item.dataUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                    <button onClick={() => setMediaQueue(q => q.filter((_, idx) => idx !== i))}
                      style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', border: 'none', cursor: 'pointer', color: 'white', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>×</button>
                    {item.type === 'video' && (
                      <div style={{ position: 'absolute', bottom: 2, left: 2, background: 'rgba(0,0,0,0.6)', borderRadius: 4, padding: '1px 4px' }}>
                        <span style={{ color: 'white', fontSize: 9, fontWeight: 700 }}>▶ Video</span>
                      </div>
                    )}
                  </div>
                ))}
                {mediaQueue.length < 10 && (
                  <button onClick={() => fileRef.current?.click()}
                    style={{ width: 72, height: 72, borderRadius: 10, border: `2px dashed ${isDark ? 'rgba(255,255,255,0.2)' : '#cbd5e1'}`, background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: isDark ? '#98C1D9' : '#64748b', fontSize: 22 }}>+</button>
                )}
              </div>
            )}

            {/* Botones de acción */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => fileRef.current?.click()} disabled={mediaQueue.length >= 10}
                style={{ flex: 1, padding: '11px 6px', borderRadius: 12, background: isDark ? 'rgba(255,255,255,0.06)' : '#f1f5f9', border: 'none', cursor: mediaQueue.length >= 10 ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 12, color: isDark ? '#E0FBFC' : '#293241', opacity: mediaQueue.length >= 10 ? 0.4 : 1 }}>
                🖼️ Foto
              </button>
              <button onClick={() => videoRef.current?.click()} disabled={mediaQueue.length >= 10}
                style={{ flex: 1, padding: '11px 6px', borderRadius: 12, background: isDark ? 'rgba(255,255,255,0.06)' : '#f1f5f9', border: 'none', cursor: mediaQueue.length >= 10 ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 12, color: isDark ? '#E0FBFC' : '#293241', opacity: mediaQueue.length >= 10 ? 0.4 : 1 }}>
                🎥 Video
              </button>
              <button onClick={publishStories} disabled={publishing || (!storyText.trim() && mediaQueue.length === 0)}
                style={{ flex: 2, padding: '11px 6px', borderRadius: 12, background: BRAND, border: 'none', cursor: 'pointer', color: 'white', fontWeight: 800, fontSize: 13, opacity: (publishing || (!storyText.trim() && mediaQueue.length === 0)) ? 0.5 : 1 }}>
                {publishing ? 'Publicando...' : 'Publicar'}
              </button>
            </div>

            <p style={{ fontSize: 10, color: isDark ? '#98C1D9' : '#94a3b8', textAlign: 'center', margin: 0 }}>
              Hasta 10 fotos/videos · Expira en 24 h
            </p>
          </div>
        </div>
      )}

      {/* Visor de estado full-screen (con navegación entre stories) */}
      {viewerStory && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 600, background: viewerStory.mediaType === 'image' || viewerStory.mediaType === 'video' ? 'black' : (viewerStory.bgColor || '#3D5A80'), display: 'flex', flexDirection: 'column' }}>
          {/* Barras de progreso */}
          <div style={{ position: 'absolute', top: 'env(safe-area-inset-top, 12px)', left: 0, right: 0, display: 'flex', gap: 4, padding: '12px 12px 0', zIndex: 10 }}>
            {viewerStories.map((_, i) => (
              <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i < viewerIdx ? 'white' : (i === viewerIdx ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)'), cursor: 'pointer' }}
                onClick={() => setViewerIdx(i)} />
            ))}
          </div>

          {/* Barra superior */}
          <div style={{ padding: '36px 20px 12px', paddingTop: 'calc(env(safe-area-inset-top, 12px) + 28px)', display: 'flex', alignItems: 'center', gap: 12, background: 'linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, transparent 100%)', zIndex: 5 }}>
            <button onClick={closeViewer} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 15, fontWeight: 800, color: 'white', margin: 0 }}>{viewerStory.userName}</p>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', margin: 0 }}>
                {timeLeft(viewerStory)} · {viewerStory.viewers?.length || 0} vista{viewerStory.viewers?.length !== 1 ? 's' : ''}
                {viewerStories.length > 1 && ` · ${viewerIdx + 1}/${viewerStories.length}`}
              </p>
            </div>
            {viewerStory.userId === user?.id && (
              <button onClick={() => deleteStory(viewerStory.id)} style={{ background: 'rgba(239,68,68,0.8)', border: 'none', borderRadius: 20, padding: '6px 14px', color: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                Eliminar
              </button>
            )}
          </div>

          {/* Contenido */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
            onClick={() => {
              if (viewerIdx < viewerStories.length - 1) setViewerIdx(i => i + 1);
              else closeViewer();
            }}>
            {viewerStory.mediaType === 'image'
              ? <img src={viewerStory.content} style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 16, objectFit: 'contain' }} />
              : viewerStory.mediaType === 'video'
                ? <video src={viewerStory.content} autoPlay controls playsInline style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 16 }} />
                : <p style={{ color: 'white', fontSize: 24, fontWeight: 700, textAlign: 'center', lineHeight: 1.4, maxWidth: 340, textShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
                    {viewerStory.content}
                  </p>}
          </div>

          {/* Navegación anterior / siguiente */}
          {viewerStories.length > 1 && (
            <>
              <button onClick={(e) => { e.stopPropagation(); if (viewerIdx > 0) setViewerIdx(i => i - 1); }}
                style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', width: 36, height: 36, borderRadius: '50%', background: 'rgba(0,0,0,0.35)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: viewerIdx > 0 ? 1 : 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 19l-7-7 7-7"/></svg>
              </button>
              <button onClick={(e) => { e.stopPropagation(); if (viewerIdx < viewerStories.length - 1) setViewerIdx(i => i + 1); else closeViewer(); }}
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 36, height: 36, borderRadius: '50%', background: 'rgba(0,0,0,0.35)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7"/></svg>
              </button>
            </>
          )}

          {/* Barra de respuesta (solo para estados de otros) */}
          {viewerStory.userId !== user?.id && (
            <div style={{
              padding: '10px 14px',
              paddingBottom: 'max(14px, env(safe-area-inset-bottom, 14px))',
              background: 'rgba(0,0,0,0.45)',
              display: 'flex', alignItems: 'center', gap: 8,
              zIndex: 6, position: 'relative',
            }} onClick={e => e.stopPropagation()}>
              {replySent ? (
                <div style={{ flex: 1, textAlign: 'center', color: 'rgba(255,255,255,0.9)', fontWeight: 700, fontSize: 14, padding: '10px 0' }}>
                  ✓ Respuesta enviada
                </div>
              ) : (
                <>
                  <input
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    onFocus={() => clearTimeout(autoAdvRef.current)}
                    onKeyDown={e => { if (e.key === 'Enter') sendReply(); }}
                    placeholder={`Responder a ${viewerStory.userName?.split(' ')[0] || ''}...`}
                    style={{
                      flex: 1, background: 'rgba(255,255,255,0.15)',
                      border: '1px solid rgba(255,255,255,0.3)',
                      borderRadius: 24, padding: '10px 16px',
                      color: 'white', fontSize: 14, outline: 'none',
                      fontFamily: 'inherit',
                    }}
                  />
                  <button
                    onClick={sendReply}
                    disabled={!replyText.trim()}
                    style={{
                      width: 42, height: 42, borderRadius: '50%',
                      background: replyText.trim() ? '#3D5A80' : 'rgba(255,255,255,0.2)',
                      border: 'none', cursor: replyText.trim() ? 'pointer' : 'default',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      transition: 'background 0.2s',
                    }}>
                    <svg width="18" height="18" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" style={{ transform: 'translateX(1px)' }}>
                      <path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function ContactRow({ contact, onChat, onCall, onVideo, isInvite, T }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: T.bgSurface, borderBottom: `1px solid ${T.border}` }}>
      <button onClick={onChat} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, position: 'relative', flexShrink: 0 }}>
        <Avatar name={contact.name} size="md" />
        <span style={{ position: 'absolute', bottom: 1, right: 1, width: 10, height: 10, borderRadius: '50%', background: isInvite ? T.textMuted : '#4ade80', border: `2px solid ${T.bgSurface}` }} />
      </button>

      <button onClick={onChat} style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', minWidth: 0, padding: 0 }}>
        <p style={{ fontSize: 14, fontWeight: 800, color: T.textPrimary, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contact.name}</p>
        <p style={{ fontSize: 11, color: isInvite ? T.textMuted : BRAND, margin: 0, fontWeight: isInvite ? 400 : 600 }}>
          {isInvite ? contact.phone : '● En OldFace'}
        </p>
      </button>

      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {isInvite ? (
          <button
            onClick={() => inviteContact(contact)}
            style={{ background: T.accentDim, color: BRAND, border: `1px solid ${BRAND}30`, borderRadius: 20, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/>
            </svg>
            Invitar
          </button>
        ) : (
          <>
            <ActionBtn onClick={onVideo} T={T}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 10l4.553-2.069A1 1 0 0121 8.868v6.264a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </ActionBtn>
            <ActionBtn onClick={onCall} T={T}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 7V5z" />
              </svg>
            </ActionBtn>
          </>
        )}
      </div>
    </div>
  );
}

function ActionBtn({ onClick, children, T }) {
  return (
    <button onClick={onClick} style={{ width: 34, height: 34, borderRadius: '50%', background: T.accentDim, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {children}
    </button>
  );
}

// ══ Modal CREAR GRUPO ════════════════════════════════════════════════════════
function GroupCreateModal({ user, T, isDark, onClose, onCreated }) {
  const { contacts, loading: contactsLoading, loadContacts } = useContacts();
  const [groupName,  setGroupName]  = React.useState('');
  const [selected,   setSelected]   = React.useState(new Set());
  const [creating,   setCreating]   = React.useState(false);
  const [error,      setError]      = React.useState('');

  React.useEffect(() => { loadContacts(); }, []);

  const oldFaceContacts = contacts.filter(c => c.usesOldFace && toUserId(c.phone) !== user?.id);

  const toggle = (contactId) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(contactId) ? next.delete(contactId) : next.add(contactId);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!groupName.trim()) { setError('El nombre del grupo es obligatorio'); return; }
    if (selected.size === 0) { setError('Selecciona al menos un participante'); return; }
    setError('');
    setCreating(true);
    try {
      const res = await fetch(`${BACKEND_HOME}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminId: user.id,
          name: groupName.trim(),
          members: [...selected],
        }),
      });
      if (res.ok) {
        const group = await res.json();
        onCreated(`group_${group.id}`, group.name);
      } else {
        setError('No se pudo crear el grupo. Inténtalo de nuevo.');
      }
    } catch {
      setError('Error de conexión. Inténtalo de nuevo.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.65)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end' }}>
      <div style={{
        background: isDark ? '#0a1929' : 'white',
        borderRadius: '24px 24px 0 0',
        width: '100%',
        maxHeight: '88vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 20px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <div>
            <p style={{ fontSize: 18, fontWeight: 900, color: T.textPrimary, margin: 0 }}>Nuevo grupo</p>
            <p style={{ fontSize: 12, color: T.textSecondary, margin: '2px 0 0', fontWeight: 500 }}>
              {selected.size > 0 ? `${selected.size} participante${selected.size !== 1 ? 's' : ''} seleccionado${selected.size !== 1 ? 's' : ''}` : 'Selecciona participantes'}
            </p>
          </div>
          <button onClick={onClose} style={{ background: isDark ? 'rgba(255,255,255,0.08)' : '#f1f5f9', border: 'none', borderRadius: '50%', width: 34, height: 34, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: T.textSecondary }}>
            ×
          </button>
        </div>

        {/* Nombre del grupo */}
        <div style={{ padding: '14px 20px 8px', flexShrink: 0 }}>
          <input
            value={groupName}
            onChange={e => { setGroupName(e.target.value); setError(''); }}
            placeholder="Nombre del grupo"
            maxLength={50}
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 14,
              border: `1.5px solid ${error && !groupName.trim() ? '#ef4444' : T.borderStrong}`,
              fontSize: 15, fontWeight: 600, outline: 'none',
              background: T.bgInput, color: T.textPrimary, boxSizing: 'border-box',
              fontFamily: 'inherit',
            }}
          />
        </div>

        {/* Lista de contactos */}
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {contactsLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120, gap: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', border: `3px solid ${T.border}`, borderTopColor: BRAND, animation: 'spin 0.8s linear infinite' }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
              <span style={{ fontSize: 13, color: T.textSecondary }}>Cargando contactos...</span>
            </div>
          ) : oldFaceContacts.length === 0 ? (
            <div style={{ padding: '32px 24px', textAlign: 'center' }}>
              <p style={{ fontSize: 14, color: T.textSecondary, margin: 0 }}>No hay contactos en OldFace para añadir al grupo</p>
            </div>
          ) : (
            <>
              <div style={{ padding: '8px 20px 4px' }}>
                <p style={{ fontSize: 11, fontWeight: 800, color: BRAND, letterSpacing: '0.5px', margin: 0 }}>CONTACTOS EN OLDFACE</p>
              </div>
              {oldFaceContacts.map(c => {
                const cId = toUserId(c.phone);
                const isSelected = selected.has(cId);
                return (
                  <button
                    key={c.id}
                    onClick={() => toggle(cId)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 14,
                      padding: '11px 20px', background: isSelected ? (isDark ? 'rgba(61,90,128,0.2)' : '#E3EDF2') : 'transparent',
                      border: 'none', cursor: 'pointer', textAlign: 'left',
                      borderBottom: `1px solid ${T.border}`,
                    }}
                  >
                    {/* Checkbox circle */}
                    <div style={{
                      width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                      border: `2px solid ${isSelected ? BRAND : T.borderStrong}`,
                      background: isSelected ? BRAND : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.15s',
                    }}>
                      {isSelected && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6L9 17l-5-5"/>
                        </svg>
                      )}
                    </div>
                    {/* Avatar */}
                    <div style={{ width: 42, height: 42, borderRadius: '50%', background: BRAND, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ color: 'white', fontWeight: 900, fontSize: 17 }}>{c.name[0]?.toUpperCase()}</span>
                    </div>
                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 14, fontWeight: 700, color: T.textPrimary, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</p>
                      <p style={{ fontSize: 11, color: BRAND, margin: 0, fontWeight: 600 }}>● En OldFace</p>
                    </div>
                  </button>
                );
              })}
            </>
          )}
        </div>

        {/* Error */}
        {error && (
          <p style={{ fontSize: 12, color: '#ef4444', margin: 0, padding: '6px 20px', flexShrink: 0, fontWeight: 600 }}>{error}</p>
        )}

        {/* Botón crear */}
        <div style={{ padding: '14px 20px', paddingBottom: 'max(14px, env(safe-area-inset-bottom, 14px))', flexShrink: 0, borderTop: `1px solid ${T.border}` }}>
          <button
            onClick={handleCreate}
            disabled={creating || !groupName.trim() || selected.size === 0}
            style={{
              width: '100%', padding: '14px', borderRadius: 16,
              background: BRAND, border: 'none', cursor: 'pointer',
              color: 'white', fontWeight: 800, fontSize: 15,
              opacity: (creating || !groupName.trim() || selected.size === 0) ? 0.5 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {creating ? 'Creando grupo...' : `Crear grupo${selected.size > 0 ? ` (${selected.size + 1})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══ Tab LLAMADAS ═════════════════════════════════════════════════════════════
function CallsTab({ T, user, isDark }) {
  const navigate = useNavigate();
  const { sendVoiceCall, sendVideoCall } = useCallStore();
  const [calls,        setCalls]        = React.useState([]);
  const [loading,      setLoading]      = React.useState(true);
  const [pressedId,    setPressedId]    = React.useState(null); // long-press para mostrar delete
  const pressTimerRef = React.useRef(null);

  const fetchLog = React.useCallback(() => {
    if (!user?.id) return;
    fetch(`${BACKEND_HOME}/call-log?userId=${encodeURIComponent(user.id)}`)
      .then(r => r.ok ? r.json() : { calls: [] })
      .then(d => { setCalls(d.calls || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [user?.id]);

  React.useEffect(() => {
    fetchLog();
    const interval = setInterval(fetchLog, 10000);
    return () => clearInterval(interval);
  }, [fetchLog]);

  const deleteCall = async (callId) => {
    setCalls(prev => prev.filter(c => c.id !== callId));
    setPressedId(null);
    await fetch(`${BACKEND_HOME}/call-log/${encodeURIComponent(callId)}?userId=${encodeURIComponent(user.id)}`, {
      method: 'DELETE',
    }).catch(() => {});
  };

  const clearAll = async () => {
    if (!window.confirm('¿Borrar todo el historial de llamadas?')) return;
    setCalls([]);
    await fetch(`${BACKEND_HOME}/call-log?userId=${encodeURIComponent(user.id)}`, {
      method: 'DELETE',
    }).catch(() => {});
  };

  const fmtDuration = (s) => {
    if (!s || s < 1) return 'No contestada';
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const fmtTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diffDays = Math.floor((now - d) / 86400000);
    if (diffDays === 0) return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return 'Ayer';
    if (diffDays < 7) return d.toLocaleDateString('es', { weekday: 'short' });
    return d.toLocaleDateString('es', { day: '2-digit', month: '2-digit' });
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', border: `3px solid ${T.border}`, borderTopColor: BRAND, animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  if (!calls.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 12, padding: 24 }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 7V5z" />
        </svg>
        <p style={{ fontSize: 15, fontWeight: 700, color: T.textSecondary, margin: 0 }}>Sin llamadas recientes</p>
        <p style={{ fontSize: 12, color: T.textMuted, margin: 0, textAlign: 'center' }}>Tus llamadas aparecerán aquí cuando realices o recibas alguna</p>
      </div>
    );
  }

  return (
    <div onClick={() => setPressedId(null)}>
      {/* Botón borrar historial */}
      <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'flex-end', background: T.bgSection }}>
        <button onClick={clearAll}
          style={{ background: 'none', border: `1px solid #ef4444`, borderRadius: 20, padding: '5px 14px', fontSize: 12, fontWeight: 700, color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>
          </svg>
          Borrar historial
        </button>
      </div>

      {calls.map((call) => {
        const isIncoming  = call.direction === 'incoming';
        const isVideo     = call.type === 'video';
        const missed      = !call.duration || call.duration < 1;
        const arrowColor  = missed ? '#ef4444' : isIncoming ? '#22c55e' : BRAND;
        const isPressed   = pressedId === call.id;

        return (
          <div key={call.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '13px 16px', background: isPressed ? (isDark ? 'rgba(239,68,68,0.1)' : '#fff5f5') : T.bgSurface,
              borderBottom: `1px solid ${T.border}`,
              position: 'relative', transition: 'background 0.15s',
            }}
            onTouchStart={() => { pressTimerRef.current = setTimeout(() => setPressedId(call.id), 500); }}
            onTouchEnd={() => clearTimeout(pressTimerRef.current)}
            onMouseDown={() => { pressTimerRef.current = setTimeout(() => setPressedId(call.id), 500); }}
            onMouseUp={() => clearTimeout(pressTimerRef.current)}
            onMouseLeave={() => clearTimeout(pressTimerRef.current)}
          >
            {/* Avatar */}
            <button
              onClick={() => navigate(`/chat/${call.contactId}`, { state: { chat: { id: call.contactId, name: call.contactName } } })}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0 }}
            >
              <div style={{
                width: 48, height: 48, borderRadius: '50%', background: BRAND,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'white', fontWeight: 900, fontSize: 19,
              }}>
                {call.contactName?.[0]?.toUpperCase() || '?'}
              </div>
            </button>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 15, fontWeight: 700, color: T.textPrimary, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {call.contactName}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={arrowColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  {isIncoming
                    ? <path d="M7 17L17 7M17 7H7M17 7v10"/>
                    : <path d="M17 7L7 17M7 17h10M7 17V7"/>}
                </svg>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {isVideo
                    ? <path d="M15 10l4.553-2.069A1 1 0 0121 8.868v6.264a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                    : <path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 7V5z"/>}
                </svg>
                <span style={{ fontSize: 12, color: missed ? '#ef4444' : T.textMuted, fontWeight: missed ? 700 : 400 }}>
                  {fmtDuration(call.duration)}
                </span>
              </div>
            </div>

            {/* Hora + acciones */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
              <span style={{ fontSize: 11, color: T.textMuted }}>{fmtTime(call.timestamp)}</span>
              <div style={{ display: 'flex', gap: 5 }}>
                {/* Botón eliminar (aparece con long-press) */}
                {isPressed && (
                  <button onClick={(e) => { e.stopPropagation(); deleteCall(call.id); }}
                    style={{ width: 32, height: 32, borderRadius: '50%', background: '#ef4444', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
                    </svg>
                  </button>
                )}
                {isVideo ? (
                  <button onClick={() => sendVideoCall(call.contactId, call.contactName)}
                    style={{ width: 32, height: 32, borderRadius: '50%', background: isDark ? 'rgba(61,90,128,0.25)' : '#E3EDF2', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M15 10l4.553-2.069A1 1 0 0121 8.868v6.264a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                    </svg>
                  </button>
                ) : (
                  <button onClick={() => sendVoiceCall(call.contactId, call.contactName)}
                    style={{ width: 32, height: 32, borderRadius: '50%', background: isDark ? 'rgba(61,90,128,0.25)' : '#E3EDF2', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 7V5z"/>
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
