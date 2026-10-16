/**
 * WillyPage — conversación con Willy, el asistente con IA de OldFace (/willy).
 * La conversación se guarda solo en este móvil. Willy puede proponer abrir una pantalla, un chat, un mensaje
 * ("Ver mensaje") o el taxi con un destino ("Pedir taxi a …"): aparece un botón y es el usuario quien decide
 * pulsarlo (Willy nunca hace nada por su cuenta; el taxi lo pide el usuario en la pantalla del taxi).
 * Voz: al entrar Willy saluda en voz alta y lee sus respuestas (botón de altavoz para silenciarlo); con el botón de
 * micrófono el usuario le habla y lo dicho se envía al terminar la frase. Voz y reconocimiento del propio móvil.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useThemeStore } from '../store/themeStore';
import { willyStatus, askWilly, aboutTaxi, taxiLocation, loadChat, saveChat, confirmAction, cancelAction } from '../utils/willy';
import { speak, stopSpeaking, listen, canListen, voiceOn, setVoiceOn } from '../utils/voice';
import { tr } from '../i18n';

const BRAND = '#3D5A80';
const SUGGESTIONS = ['¿Tengo mensajes urgentes sin leer?', '¿Quién me ha llamado hoy?', '¿Hay taxis cerca?', '¿Qué puedes hacer?'];

/** Texto del botón de una propuesta de Willy */
const actionText = (a) => (a.kind === 'message' ? `${tr('Ver mensaje')}: ${a.label}`
  : a.kind === 'taxi' ? `${tr('Pedir taxi a')} ${a.label}`
  : `${tr('Abrir')}${a.label ? `: ${a.translate ? tr(a.label) : a.label}` : ''}`);
const GREETING = 'Hola, soy Willy, tu asistente personal en OldFace.\nDime qué necesitas que haga por ti.';

const CARD_TITLE = { send: 'Enviar mensaje', forward: 'Reenviar', mute: 'Avisos del chat', reminder: 'Recordatorio', call: 'Llamar' };
const DONE_TEXT = { send: '✓ Enviado', forward: '✓ Reenviado', mute: '✓ Hecho', reminder: '✓ Recordatorio guardado', call: '✓ Llamando…' };

/**
 * Propuesta de Willy (Fase 4): enviar, reenviar, silenciar o recordar. No se hace nada hasta pulsar Confirmar; el
 * servidor solo la acepta una vez, de este usuario y antes de que caduque (5 min).
 */
function ConfirmCard({ a, onChange, onOpenChat, T, isDark }) {
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (a.state) return undefined;
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, [a.state]);
  const expired = !a.state && a.expiresAt && now > a.expiresAt;
  const act = async (confirm) => {
    setBusy(true);
    try {
      if (confirm) { const r = await confirmAction(a.id); onChange({ state: 'done', chatId: r.chatId || null, error: null }); }
      else { await cancelAction(a.id); onChange({ state: 'cancelled', error: null }); }
    } catch (e) { onChange({ state: 'error', error: e.message }); }
    setBusy(false);
  };
  const line = (label, value) => value && (
    <p style={{ margin: '4px 0 0', fontSize: 14, color: T.textPrimary, wordBreak: 'break-word' }}>
      <span style={{ color: T.textMuted, fontWeight: 700 }}>{label}: </span>{value}
    </p>
  );
  return (
    <div style={{ marginTop: 8, maxWidth: 'min(82vw, 520px)', width: '100%', background: T.bgSurface, border: `1.5px solid ${BRAND}`, borderRadius: 16, padding: '10px 13px' }}>
      <p style={{ margin: 0, fontSize: 12, fontWeight: 900, letterSpacing: 0.3, color: isDark ? '#9db4d4' : BRAND, textTransform: 'uppercase' }}>{tr(CARD_TITLE[a.kind] || 'Acción')}</p>
      {line(a.kind === 'reminder' ? tr('Sobre') : tr('Para'), a.to)}
      {line(a.kind === 'forward' ? tr('Qué') : a.kind === 'mute' ? tr('Acción') : tr('Texto'), a.text)}
      {line(tr('De'), a.kind === 'forward' ? a.from : null)}
      {line(tr('Cuándo'), a.when)}
      {a.state === 'done' && (
        <p style={{ margin: '8px 0 0', fontSize: 13, fontWeight: 800, color: '#16a34a' }}>
          {tr(DONE_TEXT[a.kind] || '✓ Hecho')}
          {a.chatId && <button onClick={() => onOpenChat(a.chatId)} style={{ marginLeft: 10, background: 'none', border: 'none', color: isDark ? '#9db4d4' : BRAND, fontWeight: 800, cursor: 'pointer', padding: 0 }}>{tr('Abrir chat')}</button>}
        </p>
      )}
      {a.state === 'cancelled' && <p style={{ margin: '8px 0 0', fontSize: 13, fontWeight: 700, color: T.textMuted }}>{tr('Cancelado')}</p>}
      {a.state === 'error' && <p style={{ margin: '8px 0 0', fontSize: 13, fontWeight: 700, color: '#dc2626' }}>{a.error}</p>}
      {expired && <p style={{ margin: '8px 0 0', fontSize: 13, fontWeight: 700, color: T.textMuted }}>{tr('Ha caducado: pídeselo otra vez a Willy')}</p>}
      {!a.state && !expired && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button onClick={() => act(true)} disabled={busy}
            style={{ flex: 1, background: BRAND, color: 'white', border: 'none', borderRadius: 12, padding: '9px 0', fontSize: 14, fontWeight: 800, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
            {busy ? tr('Un momento…') : tr('Confirmar')}
          </button>
          <button onClick={() => act(false)} disabled={busy}
            style={{ flex: 1, background: 'none', color: T.textSecondary, border: `1px solid ${T.border}`, borderRadius: 12, padding: '9px 0', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            {tr('Cancelar')}
          </button>
        </div>
      )}
    </div>
  );
}

export default function WillyPage() {
  const navigate = useNavigate();
  const T = useThemeStore(s => s.colors);
  const isDark = useThemeStore(s => s.isDark);
  const [messages, setMessages] = useState(loadChat);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(null);
  const [voice, setVoice] = useState(voiceOn);      // Willy habla en voz alta
  const [micOk, setMicOk] = useState(false);        // ¿se le puede hablar en este dispositivo?
  const [listening, setListening] = useState(false);
  const [live, setLive] = useState(null);           // respuesta en directo: { text, status } mientras Willy escribe
  const endRef = useRef(null);
  const listenRef = useRef(null);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  useEffect(() => {
    willyStatus().then((s) => {
      setStatus(s);
      if (s.available && voiceRef.current) speak(tr(GREETING));   // saludo al entrar
    }).catch(() => setStatus({ available: false }));
    canListen().then(setMicOk);
    return () => { stopSpeaking(); listenRef.current?.stop(); };   // al salir, se calla y deja de escuchar
  }, []);
  useEffect(() => { saveChat(messages); endRef.current?.scrollIntoView({ block: 'end' }); }, [messages, busy, listening, live]);

  const back = () => (window.history.length > 1 ? navigate(-1) : navigate('/', { replace: true }));

  const send = async (text) => {
    const content = String(text ?? input).trim();
    if (!content || busy) return;
    stopSpeaking();
    const next = [...messages, { role: 'user', content }];
    setMessages(next);
    setInput('');
    setError('');
    setBusy(true);
    try {
      // La ubicación solo viaja cuando se habla del taxi (y si ya hay permiso; nunca se pide aquí)
      const loc = aboutTaxi(content) ? await taxiLocation() : null;
      // En directo: el texto aparece según se escribe; mientras consulta, qué está haciendo ("Buscando en tus mensajes…")
      setLive({ text: '', status: '' });
      const r = await askWilly(next, loc, (ev) => setLive((l) => {
        const cur = l || { text: '', status: '' };
        if (ev.type === 'delta') return { text: cur.text + ev.text, status: '' };
        if (ev.type === 'reset') return { text: '', status: cur.status };
        if (ev.type === 'status') return { text: cur.text, status: ev.text };
        return cur;
      }));
      setMessages(m => [...m, { role: 'assistant', content: r.reply, actions: r.actions || [] }]);
      setStatus(s => (s ? { ...s, remaining: r.remaining } : s));
      if (voiceRef.current) speak(r.reply);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      setLive(null);
    }
  };

  /** Micrófono: pulsar para hablar; se envía solo al terminar la frase (o al pulsar otra vez) */
  const toggleListen = () => {
    if (listening) { listenRef.current?.stop(); return; }
    stopSpeaking();   // que no se escuche a sí mismo
    setError('');
    setListening(true);
    const l = listen(t => setInput(t));
    listenRef.current = l;
    l.done
      .then((text) => { setListening(false); listenRef.current = null; if (text) send(text); })
      .catch((e) => { setListening(false); listenRef.current = null; setError(tr(e.message)); });
  };

  const toggleVoice = () => { const on = !voice; setVoice(on); setVoiceOn(on); };

  const unavailable = status && !status.available;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: isDark ? T.bgMain : '#f8fafc' }}>
      {/* Cabecera */}
      <div style={{ flexShrink: 0, background: isDark ? T.bgSurface : BRAND, paddingTop: 'var(--sat, 0px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px 12px' }}>
          <button onClick={back} aria-label={tr('Atrás')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, marginLeft: -6, display: 'flex' }}>
            <svg width="24" height="24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 900, color: 'white' }}>
              Willy <span style={{ fontSize: 11, fontWeight: 800, background: 'rgba(255,255,255,0.22)', borderRadius: 6, padding: '2px 6px', verticalAlign: 'middle' }}>{tr('IA')}</span>
            </h1>
            <p style={{ margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.75)' }}>
              {tr('Willy tu asistente personal inteligente en OldFace')}
            </p>
          </div>
          <button onClick={toggleVoice} aria-label={voice ? tr('Silenciar a Willy') : tr('Activar la voz de Willy')} aria-pressed={voice}
            style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%', width: 34, height: 34, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 5L6 9H2v6h4l5 4V5z" />
              {voice ? <path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14" /> : <path d="M23 9l-6 6M17 9l6 6" />}
            </svg>
          </button>
          {messages.length > 0 && (
            <button onClick={() => { setMessages([]); setError(''); }}
              style={{ background: 'rgba(255,255,255,0.15)', color: 'white', border: 'none', borderRadius: 14, padding: '6px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              {tr('Nueva')}
            </button>
          )}
        </div>
      </div>

      {/* Conversación */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '14px 12px' }}>
        {/* Con la voz activada el saludo se oye; escrito solo si Willy está silenciado */}
        {!voice && (
          <p style={{ margin: '0 auto 14px', maxWidth: 520, textAlign: 'center', fontSize: 12, color: T.textMuted, whiteSpace: 'pre-line' }}>
            {tr(GREETING)}
          </p>
        )}
        {listening && (
          <p style={{ textAlign: 'center', fontSize: 13, color: '#dc2626', fontWeight: 800, margin: '0 0 12px' }}>{tr('Te escucho… habla ahora')}</p>
        )}
        {unavailable && (
          <p style={{ textAlign: 'center', fontSize: 14, color: T.textSecondary, fontWeight: 700 }}>{tr('Willy todavía no está disponible.')}</p>
        )}
        {messages.length === 0 && !unavailable && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 20 }}>
            {SUGGESTIONS.map(s => (
              <button key={s} onClick={() => send(tr(s))}
                style={{ background: T.bgSurface, color: T.textPrimary, border: `1px solid ${T.border}`, borderRadius: 18, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>
                {tr(s)}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => {
          const mine = m.role === 'user';
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
              <div style={{
                maxWidth: 'min(82vw, 520px)', padding: '9px 13px', borderRadius: 16, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                fontSize: 15, lineHeight: 1.4,
                background: mine ? BRAND : T.bgSurface, color: mine ? 'white' : T.textPrimary,
                border: mine ? 'none' : `1px solid ${T.border}`,
              }}>
                {m.content}
              </div>
              {(m.actions || []).map((a, j) => a.type === 'confirm' ? (
                <ConfirmCard key={a.id} a={a} T={T} isDark={isDark}
                  onOpenChat={(chatId) => navigate(`/chat/${encodeURIComponent(chatId)}`)}
                  onChange={(patch) => setMessages(ms => ms.map((x, xi) => (xi !== i ? x
                    : { ...x, actions: x.actions.map((y, yj) => (yj === j ? { ...y, ...patch } : y)) })))} />
              ) : a.type === 'navigate' && (
                <button key={j} onClick={() => navigate(a.path, a.state ? { state: a.state } : undefined)}
                  style={{ marginTop: 6, maxWidth: 'min(82vw, 520px)', textAlign: 'left', background: 'none', border: `1.5px solid ${BRAND}`, color: isDark ? '#9db4d4' : BRAND, borderRadius: 14, padding: '6px 12px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
                  {actionText(a)}
                </button>
              ))}
            </div>
          );
        })}
        {busy && (live?.text ? (
          <div style={{ display: 'flex', marginBottom: 10 }}>
            <div style={{ maxWidth: 'min(82vw, 520px)', padding: '9px 13px', borderRadius: 16, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 15, lineHeight: 1.4,
                          background: T.bgSurface, color: T.textPrimary, border: `1px solid ${T.border}` }}>
              {live.text}<span style={{ opacity: 0.5 }}>▍</span>
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 13, color: T.textMuted, margin: '4px 6px' }}>{live?.status ? tr(live.status) : tr('Willy está pensando…')}</p>
        ))}
        {error && <p style={{ fontSize: 13, color: '#dc2626', margin: '4px 6px', fontWeight: 700 }}>{error}</p>}
        <div ref={endRef} />
      </div>

      {/* Escribir */}
      <div style={{ flexShrink: 0, display: 'flex', gap: 8, alignItems: 'flex-end', padding: '8px 10px calc(var(--sab, 0px) + 10px)', background: T.bgSurface, borderTop: `1px solid ${T.border}` }}>
        <textarea value={input} onChange={e => setInput(e.target.value.slice(0, 4000))} rows={1} disabled={unavailable || listening}
          placeholder={unavailable ? tr('No disponible') : listening ? tr('Te escucho…') : micOk ? tr('Habla o escribe a Willy…') : tr('Pregúntale a Willy…')}
          style={{ flex: 1, resize: 'none', maxHeight: 120, padding: '10px 14px', borderRadius: 20, border: `1px solid ${listening ? '#dc2626' : T.border}`, background: T.bgInput, color: T.textPrimary, fontSize: 15, fontFamily: 'inherit', outline: 'none' }} />
        {micOk && !unavailable && (listening || !input.trim()) ? (
          // Sin texto escrito: micrófono (pulsar para hablar; otra vez para terminar)
          <button onClick={toggleListen} disabled={busy} aria-label={listening ? tr('Terminar de hablar') : tr('Hablar con Willy')} aria-pressed={listening}
            style={{ width: 42, height: 42, borderRadius: '50%', border: 'none', background: listening ? '#dc2626' : BRAND, opacity: busy ? 0.5 : 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                     boxShadow: listening ? '0 0 0 6px rgba(220,38,38,0.25)' : 'none', transition: 'box-shadow 0.2s, background 0.2s' }}>
            {listening
              ? <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
              : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0014 0M12 17v4M8 21h8" /></svg>}
          </button>
        ) : (
          <button onClick={() => send()} disabled={busy || !input.trim() || unavailable} aria-label={tr('Enviar')}
            style={{ width: 42, height: 42, borderRadius: '50%', border: 'none', background: BRAND, opacity: busy || !input.trim() ? 0.5 : 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M2 21l21-9L2 3v7l15 2-15 2z" /></svg>
          </button>
        )}
      </div>
    </div>
  );
}
