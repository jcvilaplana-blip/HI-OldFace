/**
 * KaraokeSingPage — cantar en solitario y grabar (voz + música mezcladas en el móvil).
 * Flujo: ¿auriculares? → "Pulsa para empezar" → letra sincronizada + mezclador → Hecho → escuchar / guardar / compartir.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { KaraokeEngine } from '../utils/karaokeEngine';
import { parseLrc, fmtTime } from '../utils/lrc';
import LyricsView, { KARAOKE_ACCENT } from '../components/LyricsView';
import { absUrl } from './KaraokePage';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const BG = 'linear-gradient(180deg, #0b1033 0%, #111827 55%, #000080 140%)';

export default function KaraokeSingPage() {
  const { songId } = useParams();
  const navigate   = useNavigate();
  const { user }   = useAuthStore();

  const engineRef = useRef(null);
  const rafRef    = useRef(null);
  const videoRef  = useRef(null);   // cámara en directo de fondo
  const [hasVideo, setHasVideo] = useState(false);
  const [camOn,    setCamOn]    = useState(true);
  const [song,   setSong]   = useState(null);
  const [lines,  setLines]  = useState([]);
  const [stage,  setStage]  = useState('loading'); // loading | setup | preparing | ready | singing | review | error
  const [error,  setError]  = useState('');
  const [pos,    setPos]    = useState(0);
  const [dur,    setDur]    = useState(0);
  const [level,  setLevel]  = useState(0);
  const [paused, setPaused] = useState(false);
  const [headphones, setHeadphones] = useState(true);
  const [showMixer,  setShowMixer]  = useState(false);
  const [mix, setMix] = useState({ music: 50, voice: 80, monitor: 0 });
  const [rec, setRec] = useState(null);     // { blob, url, duration }
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(null); // grabación guardada

  // ── Cargar canción y letra ─────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const { songs } = await (await fetch(`${BACKEND}/karaoke/songs`)).json();
        const s = (songs || []).find(x => x.id === songId);
        if (!s) throw new Error('Canción no encontrada');
        setSong(s);
        setDur(s.duration || 0);
        const lrc = await (await fetch(absUrl(s.lyricsUrl))).text();
        setLines(parseLrc(lrc));
        setStage('setup');
      } catch (e) { setError(e.message); setStage('error'); }
    })();
    return () => cleanup();
  }, [songId]); // eslint-disable-line

  const cleanup = () => {
    cancelAnimationFrame(rafRef.current);
    engineRef.current?.destroy();
    engineRef.current = null;
    window.OldFaceAudio?.setSpeaker();
  };

  // ── Preparar audio (permiso de micro + carga de la pista) ─────────────────
  const prepare = async (withHeadphones) => {
    setHeadphones(withHeadphones);
    setStage('preparing');
    try {
      const engine = new KaraokeEngine({ audioUrl: absUrl(song.audioUrl), headphones: withHeadphones });
      await engine.init();
      engineRef.current = engine;
      if (!withHeadphones) window.OldFaceAudio?.enableSpeaker(); // sin auriculares, la música por el altavoz
      setMix(m => ({ ...m, monitor: engine.monitor }));          // con auriculares te oyes desde el principio
      setHasVideo(engine.hasVideo);
      setCamOn(true);
      if (engine.preview && videoRef.current) {
        videoRef.current.srcObject = engine.preview;
        videoRef.current.play().catch(() => {});
      }
      engine.onEnded(() => finish());
      setDur(engine.duration || song.duration || 0);
      setStage('ready');
    } catch (e) {
      setError(e?.name === 'NotAllowedError' ? 'Necesitamos permiso para usar el micrófono y la cámara' : (e.message || 'No se pudo preparar el audio'));
      setStage('error');
    }
  };

  const loop = () => {
    const e = engineRef.current;
    if (!e) return;
    setPos(e.position);
    setLevel(e.level());
    rafRef.current = requestAnimationFrame(loop);
  };

  const start = async () => {
    const e = engineRef.current;
    e.restart();
    e.startRecording();
    await e.play();
    setPaused(false);
    setStage('singing');
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
  };

  const togglePause = async () => {
    const e = engineRef.current;
    if (!e) return;
    if (e.paused) { await e.play(); e.resumeRecording(); setPaused(false); }
    else { e.pause(); e.pauseRecording(); setPaused(true); }
  };

  const restart = async () => {
    const e = engineRef.current;
    if (!e) return;
    e.pause();
    await e.stopRecording();
    await start();
  };

  const finish = async () => {
    const e = engineRef.current;
    if (!e) return;
    cancelAnimationFrame(rafRef.current);
    const duration = Math.round(e.position);
    e.pause();
    const blob = await e.stopRecording();
    if (!blob || blob.size < 2000) { setStage('ready'); return; }
    setRec({ blob, url: URL.createObjectURL(blob), duration, video: e.recIsVideo });
    setStage('review');
  };

  const changeMix = (k, v) => {
    setMix(m => ({ ...m, [k]: v }));
    const e = engineRef.current;
    if (!e) return;
    if (k === 'music') e.setMusic(v);
    if (k === 'voice') e.setVoice(v);
    if (k === 'monitor') e.setMonitor(v);
  };

  const toggleCamera = () => {
    const e = engineRef.current;
    if (!e?.hasVideo) return;
    e.setCamera(!camOn);
    setCamOn(!camOn);
  };

  // ── Guardar y compartir ───────────────────────────────────────────────────
  const save = async () => {
    if (!rec || saving) return;
    setSaving(true);
    try {
      // Subida en binario (las grabaciones con vídeo pesan decenas de MB)
      const up = await fetch(`${BACKEND}/karaoke/upload?userId=${encodeURIComponent(user?.id || '')}`, {
        method: 'POST', headers: { 'Content-Type': (rec.blob.type || 'video/webm').split(';')[0] }, body: rec.blob,
      });
      const { url, video, error: upErr } = await up.json().catch(() => ({}));
      if (!url) throw new Error(upErr || 'No se pudo subir la grabación');
      const res = await fetch(`${BACKEND}/karaoke/recordings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user?.id, songId, audioUrl: url, video, duration: rec.duration }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'No se pudo guardar');
      setSaved(d.recording);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const share = async () => {
    if (!saved) return;
    const text = `🎤 ${saved.video ? 'Mira' : 'Escucha'} cómo canto "${song.title}" en OldFace`;
    const url = absUrl(saved.audioUrl);
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (Capacitor.isNativePlatform()) {
        const { Share } = await import('@capacitor/share');
        await Share.share({ title: song.title, text, url, dialogTitle: 'Compartir grabación' });
        return;
      }
    } catch { /* web */ }
    try { if (navigator.share) await navigator.share({ title: song.title, text, url }); else await navigator.clipboard.writeText(`${text}\n${url}`); } catch {}
  };

  const close = () => { cleanup(); navigate(-1); };
  const progress = dur ? Math.min(100, (pos / dur) * 100) : 0;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: BG, color: 'white', display: 'flex', flexDirection: 'column' }}>
      {/* Cámara en directo de fondo (espejo, como un selfie) + degradado para leer la letra */}
      <video ref={videoRef} autoPlay playsInline muted
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', zIndex: 0,
                 display: hasVideo && camOn ? 'block' : 'none' }} />
      {hasVideo && camOn && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
                      background: 'linear-gradient(180deg, rgba(0,0,40,0.55) 0%, rgba(0,0,0,0.15) 25%, rgba(0,0,0,0.25) 60%, rgba(0,0,40,0.75) 100%)' }} />
      )}

      {/* Cabecera */}
      <div style={{ paddingTop: 'max(env(safe-area-inset-top, 12px), 12px)', flexShrink: 0, position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px' }}>
          <button onClick={close} aria-label="Cerrar" style={{ background: 'none', border: 'none', color: 'white', fontSize: 22, cursor: 'pointer', width: 32 }}>✕</button>
          <p style={{ flex: 1, margin: 0, textAlign: 'center', fontSize: 14, fontWeight: 700, opacity: 0.9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            ♫ {song ? `${song.title}${song.artist ? ' - ' + song.artist : ''}` : ''}
          </p>
          <div style={{ width: 32 }} />
        </div>
        <div style={{ padding: '6px 18px 0' }}>
          <div style={{ height: 5, background: 'rgba(255,255,255,0.15)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: KARAOKE_ACCENT, borderRadius: 3, transition: 'width 0.2s linear' }} />
          </div>
          <p style={{ margin: '5px 0 0', fontSize: 12, opacity: 0.7, fontFamily: 'monospace' }}>{fmtTime(pos)} / {fmtTime(dur)}</p>
        </div>
      </div>

      {/* Letra + medidor de micro */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0, zIndex: 1 }}>
        {(stage === 'singing' || stage === 'ready' || stage === 'setup' || stage === 'preparing') && (
          <LyricsView lines={lines} position={stage === 'singing' ? pos : -1} overVideo={hasVideo && camOn} />
        )}
        {stage === 'singing' && (
          <div style={{ position: 'absolute', left: 10, top: '30%', height: '35%', width: 6, background: 'rgba(255,255,255,0.12)', borderRadius: 3, display: 'flex', alignItems: 'flex-end' }}>
            <div style={{ width: '100%', height: `${Math.round(level * 100)}%`, background: level > 0.85 ? '#f97316' : '#22c55e', borderRadius: 3, transition: 'height 0.08s' }} />
            <span style={{ position: 'absolute', bottom: -22, left: -5, fontSize: 13 }}>🎙</span>
          </div>
        )}
      </div>

      {/* Controles */}
      <div style={{ flexShrink: 0, padding: '10px 18px calc(env(safe-area-inset-bottom, 0px) + 18px)', position: 'relative', zIndex: 1 }}>
        {stage === 'ready' && (
          <button onClick={start} style={bigBtn}>Pulsa para empezar</button>
        )}
        {stage === 'preparing' && <p style={{ textAlign: 'center', opacity: 0.8 }}>Preparando cámara, micrófono y canción…</p>}
        {stage === 'singing' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around' }}>
            <CtrlBtn label="Mezclador" onPress={() => setShowMixer(true)}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
            </CtrlBtn>
            {hasVideo && (
              <CtrlBtn label={camOn ? 'Cámara' : 'Sin cámara'} onPress={toggleCamera}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: camOn ? 1 : 0.5 }}><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>{!camOn && <line x1="2" y1="2" x2="22" y2="22"/>}</svg>
              </CtrlBtn>
            )}
            <button onClick={togglePause} aria-label={paused ? 'Continuar' : 'Pausa'} style={{ width: 70, height: 70, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.18)', color: 'white', fontSize: 26, cursor: 'pointer' }}>
              {paused ? '▶' : '❚❚'}
            </button>
            <CtrlBtn label="Reiniciar" onPress={restart}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>
            </CtrlBtn>
            <CtrlBtn label="Hecho" onPress={finish}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-6"/></svg>
            </CtrlBtn>
          </div>
        )}
      </div>

      {/* ¿Auriculares? */}
      {stage === 'setup' && (
        <Modal>
          <div style={{ fontSize: 46, marginBottom: 6 }}>🎧</div>
          <p style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 900 }}>Se recomienda usar auriculares</p>
          <p style={{ margin: '0 0 18px', fontSize: 13, opacity: 0.85, lineHeight: 1.5 }}>Con auriculares te oirás cantando sobre la música y tu voz se grabará limpia, sin eco. Se activará la cámara para grabarte en vídeo.</p>
          <button onClick={() => prepare(true)} style={{ ...bigBtn, marginBottom: 10 }}>Tengo auriculares</button>
          <button onClick={() => prepare(false)} style={{ ...bigBtn, background: 'rgba(255,255,255,0.15)' }}>Cantar sin auriculares</button>
        </Modal>
      )}

      {/* Revisión de la grabación */}
      {stage === 'review' && rec && (
        <Modal>
          <div style={{ fontSize: 46, marginBottom: 6 }}>🎉</div>
          <p style={{ margin: '0 0 4px', fontSize: 19, fontWeight: 900 }}>¡Bravo!</p>
          <p style={{ margin: '0 0 14px', fontSize: 13, opacity: 0.85 }}>{rec.video ? 'Mira' : 'Escucha'} tu grabación de "{song?.title}" ({fmtTime(rec.duration)})</p>
          {rec.video
            ? <video controls playsInline src={rec.url} style={{ width: '100%', maxHeight: '40vh', borderRadius: 14, background: '#000', marginBottom: 14 }} />
            : <audio controls src={rec.url} style={{ width: '100%', marginBottom: 14 }} />}
          {!saved ? (
            <button onClick={save} disabled={saving} style={{ ...bigBtn, marginBottom: 10, opacity: saving ? 0.6 : 1 }}>{saving ? 'Guardando…' : 'Guardar en mis grabaciones'}</button>
          ) : (
            <button onClick={share} style={{ ...bigBtn, marginBottom: 10 }}>Compartir ↗</button>
          )}
          {saved && <p style={{ margin: '0 0 10px', fontSize: 12, color: '#86efac', fontWeight: 700 }}>✓ Guardada en Mis grabaciones</p>}
          {error && <p style={{ margin: '0 0 10px', fontSize: 12, color: '#fca5a5' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => { setRec(null); setSaved(null); setError(''); setStage('ready'); }} style={{ ...bigBtn, flex: 1, background: 'rgba(255,255,255,0.15)', fontSize: 14 }}>Repetir</button>
            <button onClick={() => navigate('/karaoke?tab=grabaciones', { replace: true })} style={{ ...bigBtn, flex: 1, background: 'rgba(255,255,255,0.15)', fontSize: 14 }}>Salir</button>
          </div>
        </Modal>
      )}

      {/* Mezclador */}
      {showMixer && (
        <div onClick={() => setShowMixer(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', zIndex: 5 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', background: '#161c3a', borderRadius: '22px 22px 0 0', padding: '20px 18px calc(env(safe-area-inset-bottom, 0px) + 24px)' }}>
            <p style={{ margin: '0 0 16px', fontWeight: 900, fontSize: 16 }}>Mezclador</p>
            <Slider label="Música" value={mix.music} onChange={v => changeMix('music', v)} />
            <Slider label="Voz (en la grabación)" value={mix.voice} onChange={v => changeMix('voice', v)} />
            {headphones
              ? <Slider label="Oír mi voz en los auriculares" value={mix.monitor} onChange={v => changeMix('monitor', v)} />
              : <p style={{ fontSize: 12, opacity: 0.6, margin: 0 }}>El retorno de voz solo está disponible con auriculares.</p>}
          </div>
        </div>
      )}

      {stage === 'loading' && <Modal><p style={{ margin: 0 }}>Cargando canción…</p></Modal>}
      {stage === 'error' && (
        <Modal>
          <div style={{ fontSize: 40 }}>⚠️</div>
          <p style={{ fontWeight: 800 }}>{error}</p>
          <button onClick={close} style={bigBtn}>Volver</button>
        </Modal>
      )}
    </div>
  );
}

function Modal({ children }) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 10, background: 'rgba(5,8,25,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 360, background: 'linear-gradient(160deg, #000080, #2d3bb8)', borderRadius: 22, padding: '24px 20px', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        {children}
      </div>
    </div>
  );
}

function CtrlBtn({ label, onPress, children }) {
  return (
    <button onClick={onPress} style={{ background: 'none', border: 'none', color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
      {children}
      <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.85 }}>{label}</span>
    </button>
  );
}

function Slider({ label, value, onChange }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
        <span>{label}</span><span style={{ fontWeight: 800 }}>{value}</span>
      </div>
      <input type="range" min="0" max="100" value={value} onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: KARAOKE_ACCENT }} />
    </div>
  );
}

const bigBtn = {
  width: '100%', padding: '15px', border: 'none', borderRadius: 26, cursor: 'pointer', color: 'white',
  background: `linear-gradient(135deg, #4f46e5, ${KARAOKE_ACCENT})`, fontSize: 16, fontWeight: 900,
};
