/**
 * TripChat — mensajes entre cliente y conductor durante el viaje, sin salir de la pantalla del mapa.
 *   <TripChatButton code role /> botón con globo y número de mensajes sin leer (abre el panel)
 *   El panel ocupa la parte de abajo: el mapa sigue a la vista arriba.
 * API: GET/POST /trip-chat/:code · GET /trip-chat/:code/unread · tiempo real 'trip:message'
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { taxiApi, taxiSocket, tx } from '../../utils/taxiApi';
import { BRAND, C } from './ui.jsx';

const QUICK = {
  customer: ['Ya bajo', 'Estoy en la puerta', 'Espérame un momento, por favor', '¿Dónde estás?'],
  driver: ['Estoy llegando', 'Ya estoy aquí', 'Hay mucho tráfico, llego en unos minutos', '¿Dónde estás exactamente?'],
};

/** Escucha los mensajes nuevos de este viaje */
function useTripMessages(code, onMsg) {
  const cb = useRef(onMsg); cb.current = onMsg;
  useEffect(() => {
    if (!code) return;
    let s, alive = true;
    const h = (p) => { if (p.code === code) cb.current(p.message, p); };
    taxiSocket().then(sock => { if (!alive) return; s = sock; s.on('trip:message', h); }).catch(() => {});
    return () => { alive = false; s?.off('trip:message', h); };
  }, [code]);
}

export function TripChatButton({ code, role, otherName, style }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const openRef = useRef(open); openRef.current = open;

  useEffect(() => {
    if (!code) return;
    taxiApi(`/trip-chat/${code}/unread`).then(d => setUnread(d.unread || 0)).catch(() => {});
  }, [code]);
  useTripMessages(code, (m) => {
    if (openRef.current || m.sender_type === role) return;
    setUnread(n => n + 1);
    try { navigator.vibrate?.(150); } catch { /* sin vibración */ }
  });

  return (
    <>
      <button onClick={() => { setOpen(true); setUnread(0); }} aria-label={tx('Mensajes')} title={tx('Mensajes')}
        style={{ position: 'relative', width: 44, height: 44, borderRadius: '50%', border: 'none', background: '#D5E6F0', cursor: 'pointer', flexShrink: 0,
                 display: 'flex', alignItems: 'center', justifyContent: 'center', ...style }}>
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a8 8 0 01-11.6 7.1L4 20.5l1.4-4.7A8 8 0 1121 12z" />
        </svg>
        {unread > 0 && (
          <span style={{ position: 'absolute', top: -3, right: -3, minWidth: 20, height: 20, borderRadius: 10, background: C.danger, color: 'white',
                         fontSize: 11, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', border: '2px solid white' }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && createPortal(<TripChatPanel code={code} role={role} otherName={otherName} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function TripChatPanel({ code, role, otherName, onClose }) {
  const [msgs, setMsgs] = useState(null);
  const [chatOpen, setChatOpen] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef(null);
  const inputRef = useRef(null);

  const load = useCallback(() => taxiApi(`/trip-chat/${code}`)
    .then(d => { setMsgs(d.messages || []); setChatOpen(d.open !== false); })
    .catch(e => { setMsgs([]); setError(e.message); }), [code]);
  useEffect(() => { load(); }, [load]);
  useTripMessages(code, (m) => {
    setMsgs(list => (list || []).some(x => x.id === m.id) ? list : [...(list || []), m]);
    if (m.sender_type !== role) taxiApi(`/trip-chat/${code}`).catch(() => {});   // queda leído
  });
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs?.length]);

  const send = async (body) => {
    const message = String(body ?? text).trim();
    if (!message || sending) return;
    setSending(true); setError('');
    try {
      const { message: m } = await taxiApi(`/trip-chat/${code}`, { method: 'POST', body: { message } });
      setMsgs(list => (list || []).some(x => x.id === m.id) ? list : [...(list || []), m]);
      if (body === undefined) setText('');
    } catch (e) { setError(e.message); }
    setSending(false);
    inputRef.current?.focus();
  };

  const time = (ms) => new Date(ms).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, height: '62dvh', zIndex: 900, background: 'white', borderRadius: '22px 22px 0 0',
                  boxShadow: '0 -8px 30px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 10px', borderBottom: `1px solid ${C.line}` }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontWeight: 900, fontSize: 17, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{otherName || tx(role === 'customer' ? 'Tu conductor' : 'Cliente')}</p>
          <p style={{ margin: 0, fontSize: 12, color: C.muted }}>{tx('Mensajes del viaje')}</p>
        </div>
        <button onClick={onClose} aria-label={tx('Cerrar')} style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', background: C.bg, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2.6" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>

      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', background: '#E3EDF2', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {msgs === null && <p style={{ textAlign: 'center', color: C.muted, fontSize: 13 }}>{tx('Cargando…')}</p>}
        {msgs?.length === 0 && (
          <p style={{ textAlign: 'center', color: C.muted, fontSize: 13, margin: 'auto 20px' }}>
            {tx(role === 'customer' ? 'Escribe a tu conductor sin salir del viaje.' : 'Escribe al cliente sin salir del viaje.')}
          </p>
        )}
        {(msgs || []).map(m => {
          const mine = m.sender_type === role;
          return (
            <div key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '80%', background: mine ? '#D5E6F0' : 'white', color: C.text,
                                     borderRadius: mine ? '16px 16px 4px 16px' : '16px 16px 16px 4px', padding: '8px 12px', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }}>
              <span style={{ fontSize: 15, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.message}</span>
              <span style={{ display: 'block', textAlign: 'right', fontSize: 11, color: C.muted, marginTop: 2 }}>
                {time(m.created_at)}{mine ? (m.read_at ? ' ✓✓' : ' ✓') : ''}
              </span>
            </div>
          );
        })}
      </div>

      {chatOpen ? (
        <>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '8px 12px 2px' }}>
            {QUICK[role].map(q => (
              <button key={q} onClick={() => send(tx(q))} disabled={sending}
                style={{ flexShrink: 0, border: `1px solid ${C.line}`, background: 'white', color: BRAND, borderRadius: 16, padding: '6px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {tx(q)}
              </button>
            ))}
          </div>
          {error && <p style={{ margin: '4px 14px 0', color: C.danger, fontSize: 12, fontWeight: 700 }}>{error}</p>}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: '8px 12px 12px' }}>
            <textarea ref={inputRef} value={text} onChange={e => setText(e.target.value)} rows={1} maxLength={1000} placeholder={tx('Escribe un mensaje…')}
              style={{ flex: 1, resize: 'none', border: `1.5px solid ${C.line}`, borderRadius: 20, padding: '10px 14px', fontSize: 15, outline: 'none', maxHeight: 96, fontFamily: 'inherit', color: C.text }} />
            <button onMouseDown={e => e.preventDefault()} onClick={() => send()} disabled={!text.trim() || sending} aria-label={tx('Enviar')}
              style={{ width: 44, height: 44, borderRadius: '50%', border: 'none', background: BRAND, opacity: !text.trim() || sending ? 0.5 : 1, cursor: 'pointer', flexShrink: 0,
                       display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" style={{ transform: 'translateX(1px)' }}>
                <path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </>
      ) : (
        <p style={{ textAlign: 'center', color: C.muted, fontSize: 13, padding: '12px 16px 16px', margin: 0 }}>{tx('El viaje ha terminado: ya no se pueden enviar mensajes.')}</p>
      )}
    </div>
  );
}
