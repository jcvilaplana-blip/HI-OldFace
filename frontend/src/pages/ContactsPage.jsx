/**
 * ContactsPage - Lista de contactos del dispositivo
 * - Contactos con OldFace: chat, llamada, videollamada
 * - Contactos sin OldFace: invitar con enlace de descarga
 * - Permiso denegado: botón para abrir ajustes
 * Mismo aspecto que la pantalla principal: tarjetas, aros de color (NeonAvatar) y modo claro/oscuro.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useContacts } from '../hooks/useContacts';
import { useCallStore } from '../store/callStore';
import NeonAvatar, { cardStyle, ringColorOf, RoundBtn, SectionLabel, BRAND } from '../components/NeonAvatar.jsx';
import { useThemeStore, DARK, LIGHT } from '../store/themeStore';
import { tr } from '../i18n';

const APP_URL     = 'https://oldface.app';
const APP_NAME    = 'OldFace';

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

// ── Función de invitación ────────────────────────────────────────────────────
async function inviteContact(contact) {
  const text = tr('¡Hola {name}! Te invito a unirte a {APP_NAME}, la app para conectar con quienes más quieres. Descárgala aquí: {APP_URL}', { name: contact.name, APP_NAME, APP_URL });
  try {
    if (navigator.share) {
      await navigator.share({ title: APP_NAME, text, url: APP_URL });
    } else {
      // Fallback: abrir WhatsApp con el número
      const phone = contact.phone.replace(/\D/g, '');
      const wa = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
      window.open(wa, '_blank', 'noopener');
    }
  } catch { /* usuario canceló */ }
}

// ── Componente principal ─────────────────────────────────────────────────────
export default function ContactsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const action = searchParams.get('action'); // call | video | null
  const { contacts, loading, error, loadContacts, openSettings } = useContacts();
  const { sendVoiceCall, sendVideoCall } = useCallStore();
  const { isDark } = useThemeStore();
  const T = isDark ? DARK : LIGHT;

  useEffect(() => { loadContacts(); }, []);

  const handleContact = (contact) => {
    const participantId = toUserId(contact.phone);
    if (action === 'call') {
      sendVoiceCall(participantId, contact.name);
    } else if (action === 'video') {
      sendVideoCall(participantId, contact.name);
    } else {
      navigate(`/chat/${participantId}`, {
        state: { chat: { id: participantId, name: contact.name, participantId } }
      });
    }
  };

  const oldFaceContacts = contacts.filter(c => c.usesOldFace);
  const otherContacts   = contacts.filter(c => !c.usesOldFace);

  // Botones redondos de la cabecera (como en la pantalla principal)
  const headBtn = (filled) => ({
    width: 44, height: 44, borderRadius: '50%', flexShrink: 0, cursor: 'pointer', padding: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: filled ? (isDark ? '#1B2230' : BRAND) : T.bgSurface,
    border: isDark ? '1px solid rgba(127,163,209,0.35)' : 'none',
    boxShadow: filled
      ? (isDark ? '0 0 14px rgba(61,90,128,0.55)' : '0 6px 16px rgba(61,90,128,0.35)')
      : (isDark ? 'none' : '0 2px 10px rgba(41,50,65,0.08)'),
  });
  const primaryBtn = { background: BRAND, color: 'white', border: 'none', borderRadius: 14, fontWeight: 800, cursor: 'pointer',
                       boxShadow: isDark ? '0 0 14px rgba(61,90,128,0.55)' : '0 6px 16px rgba(61,90,128,0.3)' };
  const outlineBtn = { background: 'transparent', color: isDark ? '#9FC0E6' : BRAND, border: `1.5px solid ${isDark ? '#4F7CC4' : BRAND}`,
                       borderRadius: 14, fontWeight: 700, cursor: 'pointer' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: T.bgMain }}>

      {/* Header: atrás, título con número de contactos y actualizar */}
      <div style={{ background: T.bgMain, flexShrink: 0, paddingTop: 'var(--sat)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px 10px' }}>
          <button onClick={() => navigate(-1)} aria-label={tr('Volver')} style={headBtn(false)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={T.textPrimary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 19l-7-7 7-7"/>
            </svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontSize: 19, fontWeight: 700, color: T.textPrimary, lineHeight: 1.1, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {action === 'call' ? tr('Llamar a...') : action === 'video' ? tr('Videollamar a...') : tr('Contactos')}
            </h1>
            <p style={{ fontSize: 13, color: T.textSecondary, fontWeight: 600, margin: '3px 0 0' }}>
              {contacts.length > 0 ? tr('{n} contactos', { n: contacts.length }) : tr('Cargando...')}
            </p>
          </div>
          {/* Botón actualizar */}
          {!loading && (
            <button onClick={loadContacts} aria-label={tr('Actualizar contactos')} style={headBtn(true)}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Contenido */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 'calc(var(--sab) + 16px)' }}>

        {/* ── Cargando ── */}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 250, gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', border: `3px solid ${T.borderStrong}`, borderTopColor: isDark ? '#4F7CC4' : BRAND, animation: 'spin 0.8s linear infinite' }} />
            <p style={{ fontSize: 13, color: T.textSecondary, fontWeight: 600, margin: 0 }}>{tr('Cargando contactos...')}</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}

        {/* ── Permiso denegado ── */}
        {!loading && error === 'denied' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px', gap: 16, textAlign: 'center' }}>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(239,68,68,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
                <line x1="17" y1="11" x2="23" y2="11"/>
              </svg>
            </div>
            <p style={{ fontSize: 16, fontWeight: 800, color: T.textPrimary, margin: 0 }}>{tr('Permiso de contactos denegado')}</p>
            <p style={{ fontSize: 13, color: T.textSecondary, margin: 0, lineHeight: 1.7 }}>{tr('Para ver y chatear con tus contactos, OldFace necesita acceso a tu lista de contactos.')}</p>
            <div style={{ ...cardStyle(T, isDark), padding: '14px 16px', textAlign: 'left', width: '100%', boxSizing: 'border-box' }}>
              <p style={{ fontSize: 12, fontWeight: 800, color: T.textPrimary, margin: '0 0 8px' }}>{tr('Cómo activarlo:')}</p>
              <p style={{ fontSize: 12, color: T.textSecondary, margin: 0, lineHeight: 1.8 }}>{tr('1. Pulsa')}{' '}<strong>{tr('"Abrir Ajustes"')}</strong><br/>{tr('2. Ve a')}{' '}<strong>{tr('Aplicaciones → OldFace')}</strong><br/>{tr('3. Toca')}{' '}<strong>{tr('Permisos → Contactos')}</strong><br/>{tr('4. Selecciona')}{' '}<strong>{tr('"Permitir"')}</strong><br/>{tr('5. Vuelve a OldFace y pulsa')}{' '}<strong>{tr('"Reintentar"')}</strong>
              </p>
            </div>
            <button onClick={openSettings} style={{ ...primaryBtn, width: '100%', padding: 14, fontSize: 15 }}>{tr('Abrir Ajustes del móvil')}</button>
            <button onClick={loadContacts} style={{ ...outlineBtn, width: '100%', padding: 13, fontSize: 14 }}>{tr('Ya lo activé — Reintentar')}</button>
          </div>
        )}

        {/* ── Error web ── */}
        {!loading && error === 'web' && (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <p style={{ fontSize: 15, fontWeight: 800, color: T.textSecondary, margin: '0 0 8px' }}>{tr('Solo disponible en la app')}</p>
            <p style={{ fontSize: 13, color: T.textMuted, margin: 0 }}>{tr('Instala OldFace en tu Android o iPhone para acceder a tus contactos.')}</p>
          </div>
        )}

        {/* ── Otro error ── */}
        {!loading && error && error !== 'denied' && error !== 'web' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 24px', gap: 14, textAlign: 'center' }}>
            <p style={{ fontSize: 14, fontWeight: 800, color: '#ef4444', margin: 0 }}>{tr('No se pudieron cargar los contactos')}</p>
            <p style={{ fontSize: 11, color: T.textMuted, margin: 0, fontFamily: 'monospace', background: T.bgHover, padding: '6px 12px', borderRadius: 8, maxWidth: '100%', wordBreak: 'break-all' }}>{error}</p>
            <button onClick={loadContacts} style={{ ...primaryBtn, padding: '12px 32px', fontSize: 14 }}>{tr('Reintentar')}</button>
            <button onClick={openSettings} style={{ background: 'transparent', color: T.textSecondary, border: `1.5px solid ${T.borderStrong}`, borderRadius: 14, padding: '10px 24px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>{tr('Abrir Ajustes del sistema')}</button>
          </div>
        )}

        {/* ── Lista de contactos ── */}
        {!loading && !error && (
          <>
            {/* En OldFace */}
            {oldFaceContacts.length > 0 && (
              <>
                <SectionHeader label={tr('EN OLDFACE')} count={oldFaceContacts.length} T={T} />
                {oldFaceContacts.map(contact => (
                  <ContactRow
                    key={contact.id}
                    contact={contact}
                    action={action}
                    T={T}
                    isDark={isDark}
                    onPress={() => handleContact(contact)}
                    onCall={() => sendVoiceCall(toUserId(contact.phone), contact.name)}
                    onVideo={() => sendVideoCall(toUserId(contact.phone), contact.name)}
                  />
                ))}
              </>
            )}

            {/* Sin OldFace — pueden chatear igualmente pero se les invita */}
            {otherContacts.length > 0 && (
              <>
                <SectionHeader label={tr('INVITAR A OLDFACE')} count={otherContacts.length} T={T} />
                {otherContacts.map(contact => (
                  <ContactRow
                    key={contact.id}
                    contact={contact}
                    action={action}
                    T={T}
                    isDark={isDark}
                    isInvite
                    onPress={() => handleContact(contact)}
                    onInvite={() => inviteContact(contact)}
                  />
                ))}
              </>
            )}

            {contacts.length === 0 && (
              <div style={{ textAlign: 'center', padding: '48px 24px' }}>
                <p style={{ fontSize: 15, fontWeight: 700, color: T.textSecondary, margin: '0 0 8px' }}>{tr('No se encontraron contactos')}</p>
                <p style={{ fontSize: 13, color: T.textMuted, margin: '0 0 20px' }}>{tr('Asegúrate de tener contactos guardados en el móvil.')}</p>
                <button onClick={loadContacts} style={{ ...primaryBtn, padding: '11px 28px', fontSize: 14 }}>{tr('Reintentar')}</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Cabecera de sección (título + número) ─────────────────────────────────────
function SectionHeader({ label, count, T }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', paddingRight: 18 }}>
      <SectionLabel T={T}>{label}</SectionLabel>
      <span style={{ fontSize: 12, fontWeight: 700, color: T.textMuted }}>{count}</span>
    </div>
  );
}

// ── Tarjeta de contacto ───────────────────────────────────────────────────────
function ContactRow({ contact, action, isInvite, onPress, onCall, onVideo, onInvite, T, isDark }) {
  const [lit, setLit] = useState(false);
  const icon = isDark ? '#9FC0E6' : BRAND;
  // Al pulsar se enciende el aro un instante y después abre el chat (o llama, según la acción)
  const open = () => { setLit(true); setTimeout(() => { setLit(false); onPress(); }, 180); };

  return (
    <div style={{ ...cardStyle(T, isDark), display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', margin: '0 12px 8px' }}>

      {/* Avatar con aro — pulsar abre chat */}
      <button onClick={open} onTouchStart={() => setLit(true)} onTouchMove={() => setLit(false)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, position: 'relative', flexShrink: 0 }}>
        <NeonAvatar name={contact.name} src={contact.avatar || null} size={50} color={ringColorOf(contact.phone || contact.name)}
          active={lit} T={T} />
        <span style={{ position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, borderRadius: '50%', background: isInvite ? T.textMuted : '#22C55E', border: `2px solid ${T.bgSurface}` }} />
      </button>

      {/* Nombre — pulsar abre chat */}
      <button onClick={open} style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', minWidth: 0, padding: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 600, color: T.textPrimary, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contact.name}</p>
        <p style={{ fontSize: 12, color: isInvite ? T.textMuted : T.textSecondary, margin: '2px 0 0', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 5 }}>
          {!isInvite && <span style={{ width: 7, height: 7, borderRadius: '50%', background: isDark ? '#4F7CC4' : BRAND }} />}
          {isInvite ? contact.phone : tr('En OldFace')}
        </p>
      </button>

      {/* Acciones */}
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        {isInvite ? (
          /* Invitar: botón compartir enlace */
          <button
            onClick={onInvite}
            style={{ background: isDark ? 'rgba(61,90,128,0.15)' : '#EDF3F8', color: icon, border: `1.5px solid ${isDark ? '#4F7CC4' : BRAND}`, borderRadius: 20, padding: '8px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                     boxShadow: isDark ? '0 0 10px rgba(61,90,128,0.5)' : 'none' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={icon} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/>
            </svg>{tr('Invitar')}</button>
        ) : (
          /* Contacto con OldFace: videollamada + llamada */
          <>
            {(!action || action === 'video') && (
              <RoundBtn onClick={e => { e.stopPropagation(); onVideo(); }} isDark={isDark} label={tr('Videollamada')}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={icon} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 10l4.553-2.069A1 1 0 0121 8.868v6.264a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </RoundBtn>
            )}
            {(!action || action === 'call') && (
              <RoundBtn onClick={e => { e.stopPropagation(); onCall(); }} isDark={isDark} label={tr('Llamada')}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={icon} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 7V5z" />
                </svg>
              </RoundBtn>
            )}
          </>
        )}
      </div>
    </div>
  );
}
