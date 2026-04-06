/**
 * HomePage — Pantalla principal OldFace (dark mode nativo)
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import { useContacts } from '../hooks/useContacts';
import { useThemeStore, DARK, LIGHT } from '../store/themeStore';
import { useZegoStore } from '../store/zegoStore';
import PopupMenu from '../components/PopupMenu.jsx';
import ChatList from '../components/ChatList.jsx';
import BottomNav from '../components/BottomNav.jsx';
import Avatar from '../components/Avatar.jsx';

const BRAND   = '#000080';
const APP_URL = 'https://oldface.fullstark.es';

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
  const { sendVoiceCall, sendVideoCall } = useZegoStore();
  const T = isDark ? DARK : LIGHT;

  const [showMenu,  setShowMenu]  = useState(false);
  const [activeTab, setActiveTab] = useState('chats');

  useEffect(() => {
    if (user?.id) fetchChats(user.id);
  }, [user?.id]);

  const tabs = [
    { key: 'chats',     label: 'CHATS' },
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
          paddingTop: 'env(safe-area-inset-top, 40px)',
        }}
      >
        {/* Fila superior */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar name={user?.name} size="sm" />
            <div>
              <h1 style={{ fontSize: 17, fontWeight: 900, color: T.textPrimary, lineHeight: 1.1, margin: 0 }}>OldFace</h1>
              <p style={{ fontSize: 11, color: T.textSecondary, fontWeight: 600, margin: 0 }}>{user?.name}</p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              style={{
                width: 34, height: 34, borderRadius: '50%',
                background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)',
                border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.textSecondary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
        {activeTab === 'chats'     && <ChatList chats={chats} />}
        {activeTab === 'llamadas'  && <CallsTab T={T} />}
        {activeTab === 'contactos' && <ContactosTab T={T} isDark={isDark} />}
      </div>

      {/* ══ FAB ══════════════════════════════════════════════════════════════ */}
      <button
        onClick={() => setShowMenu(true)}
        style={{
          position: 'absolute',
          bottom: 72, right: 18,
          width: 54, height: 54,
          borderRadius: '50%',
          backgroundColor: BRAND,
          border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 6px 22px rgba(37,99,235,0.35)',
          zIndex: 10,
        }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </button>

      <BottomNav />
      {showMenu && <PopupMenu onClose={() => setShowMenu(false)} />}
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

  const PhoneSearch = () => (
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
        <PhoneSearch />
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
        <PhoneSearch />
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
      <PhoneSearch />

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

// ══ Tab LLAMADAS ═════════════════════════════════════════════════════════════
function CallsTab({ T }) {
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
