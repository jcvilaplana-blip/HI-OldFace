/**
 * ContactsPage - Lista de contactos del dispositivo
 * - Contactos con OldFace: chat, llamada, videollamada
 * - Contactos sin OldFace: invitar con enlace de descarga
 * - Permiso denegado: botón para abrir ajustes
 */
import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useContacts } from '../hooks/useContacts';
import { useCallStore } from '../store/callStore';
import Avatar from '../components/Avatar.jsx';
import { tr } from '../i18n';

const BRAND       = '#3D5A80';
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
  const { contacts, loading, error, permDenied, loadContacts, openSettings } = useContacts();
  const { sendVoiceCall, sendVideoCall } = useCallStore();

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: '#f8fafc' }}>

      {/* Header */}
      <div style={{
        background: BRAND, color: 'white', flexShrink: 0,
        paddingTop: 'var(--sat)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px 14px' }}>
          <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 19l-7-7 7-7"/>
            </svg>
          </button>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 17, fontWeight: 900, margin: 0 }}>
              {action === 'call' ? tr('Llamar a...') : action === 'video' ? tr('Videollamar a...') : tr('Contactos')}
            </h1>
            <p style={{ fontSize: 11, margin: 0, opacity: 0.8 }}>
              {contacts.length > 0 ? `${contacts.length} contactos` : tr('Cargando...')}
            </p>
          </div>
          {/* Botón reintentar */}
          {!loading && (
            <button onClick={loadContacts} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 20, padding: '6px 14px', color: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>{tr('↺ Actualizar')}</button>
          )}
        </div>
      </div>

      {/* Contenido */}
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* ── Cargando ── */}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 250, gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', border: `3px solid #e5e7eb`, borderTopColor: BRAND, animation: 'spin 0.8s linear infinite' }} />
            <p style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600, margin: 0 }}>{tr('Cargando contactos...')}</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}

        {/* ── Permiso denegado ── */}
        {!loading && error === 'denied' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 28px', gap: 16, textAlign: 'center' }}>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
                <line x1="17" y1="11" x2="23" y2="11"/>
              </svg>
            </div>
            <p style={{ fontSize: 16, fontWeight: 900, color: '#293241', margin: 0 }}>{tr('Permiso de contactos denegado')}</p>
            <p style={{ fontSize: 13, color: '#64748b', margin: 0, lineHeight: 1.7 }}>{tr('Para ver y chatear con tus contactos, OldFace necesita acceso a tu lista de contactos.')}</p>
            <div style={{ background: '#f8fafc', borderRadius: 14, padding: '14px 16px', textAlign: 'left', width: '100%' }}>
              <p style={{ fontSize: 12, fontWeight: 800, color: '#475569', margin: '0 0 8px' }}>{tr('Cómo activarlo:')}</p>
              <p style={{ fontSize: 12, color: '#64748b', margin: 0, lineHeight: 1.8 }}>{tr('1. Pulsa')}{' '}<strong>{tr('"Abrir Ajustes"')}</strong><br/>{tr('2. Ve a')}{' '}<strong>{tr('Aplicaciones → OldFace')}</strong><br/>{tr('3. Toca')}{' '}<strong>{tr('Permisos → Contactos')}</strong><br/>{tr('4. Selecciona')}{' '}<strong>{tr('"Permitir"')}</strong><br/>{tr('5. Vuelve a OldFace y pulsa')}{' '}<strong>{tr('"Reintentar"')}</strong>
              </p>
            </div>
            <button onClick={openSettings} style={{ width: '100%', background: BRAND, color: 'white', border: 'none', borderRadius: 14, padding: '14px', fontWeight: 800, fontSize: 15, cursor: 'pointer', boxShadow: '0 4px 14px rgba(119,189,148,0.4)' }}>{tr('Abrir Ajustes del móvil')}</button>
            <button onClick={loadContacts} style={{ width: '100%', background: 'white', color: BRAND, border: `2px solid ${BRAND}`, borderRadius: 14, padding: '13px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>{tr('Ya lo activé — Reintentar')}</button>
          </div>
        )}

        {/* ── Error web ── */}
        {!loading && error === 'web' && (
          <div style={{ textAlign: 'center', padding: '48px 24px', color: '#94a3b8' }}>
            <p style={{ fontSize: 15, fontWeight: 800, color: '#64748b', margin: '0 0 8px' }}>{tr('Solo disponible en la app')}</p>
            <p style={{ fontSize: 13, margin: 0 }}>{tr('Instala OldFace en tu Android o iPhone para acceder a tus contactos.')}</p>
          </div>
        )}

        {/* ── Otro error ── */}
        {!loading && error && error !== 'denied' && error !== 'web' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 24px', gap: 14, textAlign: 'center' }}>
            <p style={{ fontSize: 14, fontWeight: 800, color: '#ef4444', margin: 0 }}>{tr('No se pudieron cargar los contactos')}</p>
            <p style={{ fontSize: 11, color: '#94a3b8', margin: 0, fontFamily: 'monospace', background: '#f8fafc', padding: '6px 12px', borderRadius: 8, maxWidth: '100%', wordBreak: 'break-all' }}>{error}</p>
            <button onClick={loadContacts} style={{ background: BRAND, color: 'white', border: 'none', borderRadius: 14, padding: '12px 32px', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>{tr('Reintentar')}</button>
            <button onClick={openSettings} style={{ background: 'transparent', color: '#64748b', border: '1.5px solid #e2e8f0', borderRadius: 14, padding: '10px 24px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>{tr('Abrir Ajustes del sistema')}</button>
          </div>
        )}

        {/* ── Lista de contactos ── */}
        {!loading && !error && (
          <>
            {/* En OldFace */}
            {oldFaceContacts.length > 0 && (
              <>
                <SectionHeader label={tr('EN OLDFACE')} color={BRAND} count={oldFaceContacts.length} />
                {oldFaceContacts.map(contact => (
                  <ContactRow
                    key={contact.id}
                    contact={contact}
                    action={action}
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
                <SectionHeader label={tr('INVITAR A OLDFACE')} color="#94a3b8" count={otherContacts.length} />
                {otherContacts.map(contact => (
                  <ContactRow
                    key={contact.id}
                    contact={contact}
                    action={action}
                    isInvite
                    onPress={() => handleContact(contact)}
                    onInvite={() => inviteContact(contact)}
                  />
                ))}
              </>
            )}

            {contacts.length === 0 && (
              <div style={{ textAlign: 'center', padding: '48px 24px', color: '#94a3b8' }}>
                <p style={{ fontSize: 15, fontWeight: 700, color: '#64748b', margin: '0 0 8px' }}>{tr('No se encontraron contactos')}</p>
                <p style={{ fontSize: 13, margin: '0 0 20px' }}>{tr('Asegúrate de tener contactos guardados en el móvil.')}</p>
                <button onClick={loadContacts} style={{ background: BRAND, color: 'white', border: 'none', borderRadius: 14, padding: '11px 28px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>{tr('Reintentar')}</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Cabecera de sección ───────────────────────────────────────────────────────
function SectionHeader({ label, color, count }) {
  return (
    <div style={{ padding: '10px 16px 6px', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <p style={{ fontSize: 10, fontWeight: 800, color, letterSpacing: '0.5px', margin: 0 }}>{label}</p>
      <p style={{ fontSize: 10, fontWeight: 600, color: '#cbd5e1', margin: 0 }}>{count}</p>
    </div>
  );
}

// ── Fila de contacto ──────────────────────────────────────────────────────────
function ContactRow({ contact, action, isInvite, onPress, onCall, onVideo, onInvite }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', background: 'white', borderBottom: '0.5px solid #f1f5f9' }}>

      {/* Avatar — pulsar abre chat */}
      <button onClick={onPress} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, position: 'relative', flexShrink: 0 }}>
        <Avatar name={contact.name} size="md" />
        {!isInvite && (
          <span style={{ position: 'absolute', bottom: 1, right: 1, width: 10, height: 10, borderRadius: '50%', background: '#4ade80', border: '2px solid white' }} />
        )}
        {isInvite && (
          <span style={{ position: 'absolute', bottom: 1, right: 1, width: 10, height: 10, borderRadius: '50%', background: '#e2e8f0', border: '2px solid white' }} />
        )}
      </button>

      {/* Info — pulsar abre chat */}
      <button onClick={onPress} style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', minWidth: 0, padding: 0 }}>
        <p style={{ fontSize: 14, fontWeight: 800, color: '#293241', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contact.name}</p>
        <p style={{ fontSize: 11, color: isInvite ? '#94a3b8' : BRAND, margin: 0, fontWeight: isInvite ? 400 : 600 }}>
          {isInvite ? contact.phone : '● En OldFace'}
        </p>
      </button>

      {/* Acciones */}
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {isInvite ? (
          /* Invitar: botón compartir enlace */
          <button
            onClick={onInvite}
            style={{ background: BRAND, color: 'white', border: 'none', borderRadius: 20, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/>
            </svg>{tr('Invitar')}</button>
        ) : (
          /* Contacto con OldFace: videollamada + llamada */
          <>
            {(!action || action === 'video') && (
              <IconBtn onClick={onVideo} title={tr('Videollamada')}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M15 10l4.553-2.069A1 1 0 0121 8.868v6.264a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </IconBtn>
            )}
            {(!action || action === 'call') && (
              <IconBtn onClick={onCall} title={tr('Llamada')}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 7V5z" />
              </IconBtn>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function IconBtn({ onClick, children }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(); }}
      style={{ width: 36, height: 36, borderRadius: '50%', background: '#E3EDF2', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}
