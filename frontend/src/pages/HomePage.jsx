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
import GroupsSheet from '../components/GroupsSheet.jsx';
import StatusList from '../components/StatusList.jsx';
import { GroupCreateSheet } from '../components/GroupSheets.jsx';
import { tr, LOCALE } from '../i18n';
import { useBackClose } from '../utils/backHandler';

const BRAND   = '#3D5A80';
const APP_URL = 'https://oldface.app';

async function inviteContact(contact) {
  const text = tr('¡Hola {name}! Te invito a OldFace, la app para conectar con quienes más quieres. Descárgala aquí: {APP_URL}', { name: contact.name, APP_URL });
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
  const [showGroups,      setShowGroups]      = useState(false);   // hoja del botón "Grupos" de la barra inferior
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

  // Atrás de Android cierra la hoja o el menú abiertos y vuelve a la pantalla principal
  useBackClose(showMenu,        () => setShowMenu(false));
  useBackClose(showGroups,      () => setShowGroups(false));
  useBackClose(showGroupCreate, () => setShowGroupCreate(false));

  // Los grupos salen en la lista de chats y también en el botón "Grupos" de la barra inferior
  const isGroupChat  = (c) => c.isGroup || String(c.id).startsWith('group_');
  const groupsUnread = chats.reduce((n, c) => n + (isGroupChat(c) ? (c.unread || 0) : 0), 0);

  const tabs = [
    { key: 'chats',     label: tr('CHATS') },
    { key: 'estados',   label: tr('ESTADOS') },
    { key: 'llamadas',  label: tr('LLAMADAS') },
    { key: 'contactos', label: tr('CONTACTOS') },
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
              <h1 style={{ fontSize: 17, fontWeight: 900, color: T.textPrimary, lineHeight: 1.1, margin: 0 }}>{tr('OldFace')}</h1>
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
                placeholder={tr('Buscar conversación...')}
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
          <ChatList chats={searchQuery.trim()
            ? chats.filter(c => c.name?.toLowerCase().includes(searchQuery.toLowerCase()) || c.lastMessage?.toLowerCase().includes(searchQuery.toLowerCase()))
            : chats
          } />
        </>}
        {activeTab === 'estados'   && <StatusList user={user} T={T} isDark={isDark} />}
        {activeTab === 'llamadas'  && <CallsTab T={T} user={user} isDark={isDark} />}
        {activeTab === 'contactos' && <ContactosTab T={T} isDark={isDark} />}
      </div>

      {/* ══ FAB "+" centrado: abre el menú emergente hacia arriba ══════════════ */}
      <button
        onClick={() => setShowMenu(true)}
        aria-label={tr('Abrir menú')}
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

      <BottomNav onGroups={() => setShowGroups(true)} groupsUnread={groupsUnread} />
      {showGroups && (
        <GroupsSheet user={user} T={T} isDark={isDark} onClose={() => setShowGroups(false)} />
      )}
      {showMenu && (
        <PopupMenu
          onClose={() => setShowMenu(false)}
          onGroups={() => { setShowMenu(false); setShowGroupCreate(true); }}
        />
      )}
      {showGroupCreate && (
        <GroupCreateSheet
          user={user}
          T={T}
          isDark={isDark}
          onClose={() => setShowGroupCreate(false)}
          onCreated={(g) => {
            setShowGroupCreate(false);
            fetchChats(user.id);
            navigate(`/chat/${g.chatId}`, { state: { chat: { id: g.chatId, name: g.name, avatar: g.avatar || null, isGroup: true, groupId: g.id } } });
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
        <p style={{ fontSize: 13, color: T.textSecondary, fontWeight: 600 }}>{tr('Cargando contactos...')}</p>
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
        <p style={{ fontSize: 15, fontWeight: 800, color: T.textPrimary, margin: 0 }}>{tr('Permiso de contactos denegado')}</p>
        <p style={{ fontSize: 12, color: T.textSecondary, margin: 0, lineHeight: 1.6 }}>{tr('Ve a')}{' '}<strong>{tr('Ajustes → Aplicaciones → OldFace → Permisos → Contactos')}</strong>{' '}{tr('y actívalo.')}</p>
        <button onClick={openSettings} style={{ background: BRAND, color: 'white', border: 'none', borderRadius: 14, padding: '12px 28px', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>{tr('Abrir Ajustes')}</button>
        <button onClick={loadContacts} style={{ background: 'transparent', color: BRAND, border: `1.5px solid ${BRAND}`, borderRadius: 14, padding: '10px 24px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>{tr('Ya lo activé — Reintentar')}</button>
      </div>
    );
  }

  // JSX inline — NO definir como componente dentro del render (causa remount en cada render → cierra el teclado)
  const phoneSearchBlock = (
    <div style={{ background: T.bgSurface, padding: '14px 16px', borderBottom: `1px solid ${T.border}` }}>
      <p style={{ fontSize: 11, fontWeight: 800, color: BRAND, letterSpacing: '0.5px', margin: '0 0 8px' }}>{tr('BUSCAR POR TELÉFONO')}</p>
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
        <button onClick={handlePhoneSearch} style={{ background: BRAND, color: 'white', border: 'none', borderRadius: 12, padding: '10px 18px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>{tr('Buscar')}</button>
      </div>
      {searchResult === 'searching' && <p style={{ fontSize: 12, color: T.textSecondary, margin: '8px 0 0' }}>{tr('Buscando...')}</p>}
      {searchResult?.found && (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12, background: T.accentDim, borderRadius: 12, padding: '10px 14px' }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: BRAND, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 900, fontSize: 16, flexShrink: 0 }}>
            {searchResult.name[0].toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 800, color: T.textPrimary, margin: 0 }}>{searchResult.name}</p>
            <p style={{ fontSize: 11, color: BRAND, margin: 0, fontWeight: 600 }}>{tr('● En OldFace')}</p>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => navigate(`/chat/${searchResult.userId}`, { state: { chat: { id: searchResult.userId, name: searchResult.name, participantId: searchResult.userId } } })}
              style={{ background: BRAND, color: 'white', border: 'none', borderRadius: 20, padding: '7px 14px', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>{tr('Chat')}</button>
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
        <p style={{ fontSize: 12, color: '#ef4444', margin: '8px 0 0', fontWeight: 600 }}>{tr('Este número no está registrado en OldFace')}</p>
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
          <p style={{ fontSize: 14, fontWeight: 700, color: T.textSecondary, margin: '0 0 6px' }}>{tr('Contactos solo disponibles en la app')}</p>
          <p style={{ fontSize: 12, color: T.textMuted, margin: 0, lineHeight: 1.6 }}>{tr('Usa el buscador para encontrar usuarios.')}<br/>{tr('Para ver tus contactos del móvil, instala la app nativa.')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ paddingBottom: 16 }}>
        {phoneSearchBlock}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 24px', gap: 14, textAlign: 'center' }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: '#ef4444', margin: 0 }}>{tr('No se pudieron cargar los contactos')}</p>
          <p style={{ fontSize: 11, color: T.textMuted, margin: 0, fontFamily: 'monospace', background: T.bgHover, padding: '6px 12px', borderRadius: 8 }}>{error}</p>
          <button onClick={loadContacts} style={{ background: BRAND, color: 'white', border: 'none', borderRadius: 14, padding: '11px 28px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>{tr('Reintentar')}</button>
          <button onClick={openSettings} style={{ background: 'transparent', color: T.textSecondary, border: `1.5px solid ${T.borderStrong}`, borderRadius: 14, padding: '9px 20px', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>{tr('Abrir Ajustes del sistema')}</button>
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
        <p style={{ fontSize: 14, fontWeight: 800, color: BRAND, margin: 0 }}>{tr('Ver todos los contactos')}</p>
      </button>

      {oldFaceContacts.length > 0 && (
        <>
          <div style={{ padding: '10px 16px 6px', background: T.bgSection }}>
            <p style={{ fontSize: 11, fontWeight: 800, color: BRAND, letterSpacing: '0.5px', margin: 0 }}>{tr('EN OLDFACE')}</p>
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
            <p style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: '0.5px', margin: 0 }}>{tr('INVITAR A OLDFACE')}</p>
          </div>
          {others.slice(0, 6).map(c => (
            <ContactRow key={c.id} contact={c} T={T} isInvite />
          ))}
        </>
      )}

      {contacts.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: T.textSecondary }}>
          <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px' }}>{tr('No se encontraron contactos')}</p>
          <button onClick={loadContacts} style={{ background: 'transparent', color: BRAND, border: `1.5px solid ${BRAND}`, borderRadius: 14, padding: '8px 20px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>{tr('Reintentar')}</button>
        </div>
      )}
    </div>
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
            </svg>{tr('Invitar')}</button>
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
    if (!window.confirm(tr('¿Borrar todo el historial de llamadas?'))) return;
    setCalls([]);
    await fetch(`${BACKEND_HOME}/call-log?userId=${encodeURIComponent(user.id)}`, {
      method: 'DELETE',
    }).catch(() => {});
  };

  const fmtDuration = (s) => {
    if (!s || s < 1) return tr('No contestada');
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const fmtTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diffDays = Math.floor((now - d) / 86400000);
    if (diffDays === 0) return d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return tr('Ayer');
    if (diffDays < 7) return d.toLocaleDateString(LOCALE, { weekday: 'short' });
    return d.toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit' });
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
        <p style={{ fontSize: 15, fontWeight: 700, color: T.textSecondary, margin: 0 }}>{tr('Sin llamadas recientes')}</p>
        <p style={{ fontSize: 12, color: T.textMuted, margin: 0, textAlign: 'center' }}>{tr('Tus llamadas aparecerán aquí cuando realices o recibas alguna')}</p>
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
          </svg>{tr('Borrar historial')}</button>
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
