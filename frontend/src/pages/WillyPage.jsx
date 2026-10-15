/**
 * WillyPage — conversación con Willy, el asistente con IA de OldFace (/willy).
 * La conversación se guarda solo en este móvil. Willy puede proponer abrir una pantalla o un chat: aparece un botón
 * y es el usuario quien decide pulsarlo (Willy nunca hace nada por su cuenta).
 * Voz: al entrar Willy saluda en voz alta y lee sus respuestas (botón de altavoz para silenciarlo); con el botón de
 * micrófono el usuario le habla y lo dicho se envía al terminar la frase. Voz y reconocimiento del propio móvil.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useThemeStore } from '../store/themeStore';
import { willyStatus, askWilly, loadChat, saveChat } from '../utils/willy';
import { speak, stopSpeaking, listen, canListen, voiceOn, setVoiceOn } from '../utils/voice';
import { tr } from '../i18n';

const BRAND = '#3D5A80';
const SUGGESTIONS = ['¿Qué chats tengo sin leer?', 'Busca a un contacto', '¿Qué puedes hacer?'];
const GREETING = 'Hola, soy Willy, tu asistente personal en OldFace.\nDime qué necesitas que haga por ti.';

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
  useEffect(() => { saveChat(messages); endRef.current?.scrollIntoView({ block: 'end' }); }, [messages, busy, listening]);

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
      const r = await askWilly(next);
      setMessages(m => [...m, { role: 'assistant', content: r.reply, actions: r.actions || [] }]);
      setStatus(s => (s ? { ...s, remaining: r.remaining } : s));
      if (voiceRef.current) speak(r.reply);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
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
              {(m.actions || []).map((a, j) => a.type === 'navigate' && (
                <button key={j} onClick={() => navigate(a.path)}
                  style={{ marginTop: 6, background: 'none', border: `1.5px solid ${BRAND}`, color: isDark ? '#9db4d4' : BRAND, borderRadius: 14, padding: '6px 12px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
                  {tr('Abrir')}{a.label ? `: ${a.translate ? tr(a.label) : a.label}` : ''}
                </button>
              ))}
            </div>
          );
        })}
        {busy && <p style={{ fontSize: 13, color: T.textMuted, margin: '4px 6px' }}>{tr('Willy está pensando…')}</p>}
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
