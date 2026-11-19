/**
 * VideoNote — notas de vídeo del chat (vídeo redondo grabado con la cámara, como una nota de voz pero con imagen).
 *  · VideoNoteRecorder: pantalla para grabar (cámara frontal por defecto, hasta 60 s, cambiar cámara, repetir, enviar).
 *  · VideoNoteBubble: el círculo dentro del chat (se mueve sin sonido mientras se ve; al tocarlo, con sonido).
 * El vídeo se sube como cualquier otro vídeo del chat; el mensaje lleva `videoNote: true`.
 */
import React, { useEffect, useRef, useState } from 'react';
import { tr } from '../i18n';

export const VIDEO_NOTE_MAX_SECS = 60;
const SIZE = 'min(78vw, 300px)';

function pickMime() {
  const opts = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'];
  try { return opts.find(t => window.MediaRecorder?.isTypeSupported?.(t)) || ''; } catch { return ''; }
}
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Aro de progreso alrededor del círculo (0..1) */
function Ring({ progress, color = '#ef4444' }) {
  const r = 48, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 100 100" style={{ position: 'absolute', inset: -6, width: 'calc(100% + 12px)', height: 'calc(100% + 12px)', transform: 'rotate(-90deg)', pointerEvents: 'none' }}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="2.2" />
      <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, progress)))} style={{ transition: 'stroke-dashoffset 0.25s linear' }} />
    </svg>
  );
}

export function VideoNoteRecorder({ onCancel, onSend }) {
  const liveRef = useRef(null);
  const streamRef = useRef(null);
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const startRef = useRef(0);
  const timerRef = useRef(null);
  const [facing, setFacing] = useState('user');
  const [phase, setPhase] = useState('ready');   // ready · recording · review
  const [secs, setSecs] = useState(0);
  const [result, setResult] = useState(null);    // { blob, url, duration }
  const [error, setError] = useState('');

  const stopStream = () => { streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null; };

  // Cámara (y micro) mientras no se está revisando lo grabado
  useEffect(() => {
    if (phase === 'review') return undefined;
    let cancelled = false;
    (async () => {
      try {
        stopStream();
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 640 } },
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        if (cancelled) { s.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = s;
        if (liveRef.current) { liveRef.current.srcObject = s; liveRef.current.play().catch(() => {}); }
        setError('');
      } catch {
        setError(tr('No se pudo abrir la cámara. Revisa los permisos de cámara y micrófono.'));
      }
    })();
    return () => { cancelled = true; };
  }, [facing, phase]);

  // Al salir: cámara apagada, temporizador parado y vista previa liberada
  useEffect(() => () => {
    clearInterval(timerRef.current);
    try { recRef.current?.state === 'recording' && recRef.current.stop(); } catch { /* ya parado */ }
    stopStream();
  }, []);
  useEffect(() => () => { if (result?.url) URL.revokeObjectURL(result.url); }, [result]);

  const start = () => {
    const s = streamRef.current;
    if (!s || phase !== 'ready') return;
    const mimeType = pickMime();
    let rec;
    try { rec = new MediaRecorder(s, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 900_000 }); }
    catch { setError(tr('Este móvil no permite grabar vídeo aquí.')); return; }
    chunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      clearInterval(timerRef.current);
      const duration = Math.max(1, Math.round((Date.now() - startRef.current) / 1000));
      const blob = new Blob(chunksRef.current, { type: (rec.mimeType || mimeType || 'video/webm').split(';')[0] });
      stopStream();
      if (blob.size < 1000) { setPhase('ready'); setSecs(0); return; }
      setResult({ blob, url: URL.createObjectURL(blob), duration });
      setPhase('review');
    };
    recRef.current = rec;
    startRef.current = Date.now();
    rec.start(500);
    setSecs(0);
    setPhase('recording');
    try { navigator.vibrate?.(30); } catch { /* sin vibración */ }
    timerRef.current = setInterval(() => {
      const el = (Date.now() - startRef.current) / 1000;
      setSecs(el);
      if (el >= VIDEO_NOTE_MAX_SECS) { try { rec.stop(); } catch { /* ya parado */ } }
    }, 250);
  };
  const stop = () => { try { recRef.current?.state === 'recording' && recRef.current.stop(); } catch { /* ya parado */ } };
  const retry = () => { setResult(null); setSecs(0); setPhase('ready'); };
  const send = () => { if (result) { const r = result; stopStream(); onSend?.(r.blob, r.duration); } };

  const circle = {
    position: 'relative', width: SIZE, height: SIZE, borderRadius: '50%', overflow: 'visible',
    boxShadow: phase === 'recording' ? '0 0 0 4px rgba(239,68,68,0.25), 0 10px 40px rgba(0,0,0,0.5)' : '0 10px 40px rgba(0,0,0,0.5)',
  };
  const roundBtn = (bg) => ({ width: 54, height: 54, borderRadius: '50%', border: 'none', background: bg, color: 'white', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 });

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(8,12,20,0.94)', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 26, padding: '24px 16px calc(var(--sab, 0px) + 24px)' }}>
      <p style={{ color: 'white', fontSize: 17, fontWeight: 800, margin: 0 }}>{tr('Nota de vídeo')}</p>

      <div style={circle}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', overflow: 'hidden', background: '#111827' }}>
          {phase === 'review' && result ? (
            <video src={result.url} autoPlay loop playsInline controls={false}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <video ref={liveRef} muted playsInline autoPlay
              style={{ width: '100%', height: '100%', objectFit: 'cover', transform: facing === 'user' ? 'scaleX(-1)' : 'none' }} />
          )}
        </div>
        {phase === 'recording' && <Ring progress={secs / VIDEO_NOTE_MAX_SECS} />}
      </div>

      <div style={{ minHeight: 22, color: phase === 'recording' ? '#fca5a5' : 'rgba(255,255,255,0.75)', fontSize: 15, fontWeight: 700, textAlign: 'center' }}>
        {error || (phase === 'recording' ? `● ${fmt(secs)} / ${fmt(VIDEO_NOTE_MAX_SECS)}`
          : phase === 'review' ? tr('{s} s grabados', { s: result?.duration || 0 })
          : tr('Toca el botón rojo para grabar (máx. {n} s)', { n: VIDEO_NOTE_MAX_SECS }))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        <button onClick={() => { stopStream(); onCancel?.(); }} aria-label={tr('Cancelar')} style={roundBtn('rgba(255,255,255,0.14)')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>

        {phase === 'review' ? (
          <>
            <button onClick={retry} aria-label={tr('Repetir')} style={roundBtn('rgba(255,255,255,0.14)')}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.8L3 8"/><path d="M3 3v5h5"/></svg>
            </button>
            <button onClick={send} aria-label={tr('Enviar')} style={{ ...roundBtn('#3D5A80'), width: 68, height: 68, boxShadow: '0 6px 20px rgba(61,90,128,0.6)' }}>
              <svg width="26" height="26" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
            </button>
          </>
        ) : (
          <>
            <button onClick={phase === 'recording' ? stop : start} disabled={!!error} aria-label={phase === 'recording' ? tr('Parar') : tr('Grabar')}
              style={{ width: 78, height: 78, borderRadius: '50%', border: '4px solid white', background: 'transparent', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: error ? 0.4 : 1 }}>
              <span style={{ width: phase === 'recording' ? 28 : 58, height: phase === 'recording' ? 28 : 58, borderRadius: phase === 'recording' ? 6 : '50%',
                background: '#ef4444', transition: 'all 0.2s' }} />
            </button>
            <button onClick={() => setFacing(f => (f === 'user' ? 'environment' : 'user'))} disabled={phase === 'recording'}
              aria-label={tr('Cambiar cámara')} style={{ ...roundBtn('rgba(255,255,255,0.14)'), opacity: phase === 'recording' ? 0.4 : 1 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 7h-3l-2-3H9L7 7H4a2 2 0 00-2 2v9a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/><path d="M9 13a3 3 0 015-2.2M15 13a3 3 0 01-5 2.2"/><path d="M14 9v2h-2M10 17v-2h2"/>
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Círculo de la nota de vídeo dentro del chat */
export function VideoNoteBubble({ src, duration, meta, onMediaLoad, urgent = false, isMine = false }) {
  const ref = useRef(null);
  const boxRef = useRef(null);
  const [withSound, setWithSound] = useState(false);
  const [progress, setProgress] = useState(0);

  // Sin sonido y en bucle solo mientras se ve en pantalla (así no hay decenas de vídeos moviéndose a la vez)
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver(([e]) => {
      const v = ref.current;
      if (!v) return;
      if (e.isIntersecting) { if (v.paused && !withSound) v.play().catch(() => {}); }
      else if (!v.paused) { v.pause(); if (withSound) { v.muted = true; setWithSound(false); } }
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [withSound]);

  const toggle = (e) => {
    e.stopPropagation();
    const v = ref.current;
    if (!v) return;
    if (withSound) { v.muted = true; setWithSound(false); setProgress(0); v.loop = true; v.play().catch(() => {}); return; }
    v.currentTime = 0; v.muted = false; v.loop = false; setWithSound(true);
    v.play().catch(() => { v.muted = true; setWithSound(false); });
  };

  return (
    <div ref={boxRef} style={{ display: 'flex', flexDirection: 'column', alignItems: isMine ? 'flex-end' : 'flex-start', gap: 4 }}>
      <div onClick={toggle} style={{ position: 'relative', width: 'min(56vw, 220px)', height: 'min(56vw, 220px)', cursor: 'pointer' }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', overflow: 'hidden', background: '#111827',
          border: urgent ? '3px solid #dc2626' : '3px solid rgba(255,255,255,0.85)', boxShadow: '0 6px 20px rgba(0,0,0,0.25)' }}>
          <video ref={ref} src={src} muted loop playsInline preload="metadata" onLoadedData={onMediaLoad}
            onTimeUpdate={(e) => { const v = e.currentTarget; if (withSound && v.duration) setProgress(v.currentTime / v.duration); }}
            onEnded={(e) => { const v = e.currentTarget; v.muted = true; v.loop = true; setWithSound(false); setProgress(0); v.play().catch(() => {}); }}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
        {withSound && <Ring progress={progress} color="#7DD3FC" />}
        {!withSound && (
          <span style={{ position: 'absolute', left: '50%', bottom: 10, transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.55)', color: 'white',
            borderRadius: 12, padding: '3px 9px', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M11 5L6 9H2v6h4l5 4V5z"/></svg>
            {duration ? fmt(duration) : tr('Nota de vídeo')}
          </span>
        )}
      </div>
      {/* Hora y ✓✓: píldora oscura para los enviados (texto claro) y clara para los recibidos (texto gris) */}
      {meta && <div style={{ display: 'flex', alignItems: 'center', gap: 4, borderRadius: 10, padding: '2px 9px',
        background: isMine ? 'rgba(30,41,59,0.72)' : 'rgba(255,255,255,0.92)', boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }}>{meta}</div>}
    </div>
  );
}
