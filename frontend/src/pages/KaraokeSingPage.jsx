/**
 * KaraokeSingPage — cantar (solo o dúo) y grabar: voz + música mezcladas en el móvil, con cámara.
 *
 *   /karaoke/cantar/:songId              → solo, o abrir un dúo (eliges parte A o B)
 *   /karaoke/cantar/:songId?unirse=<rec> → unirse a un dúo: suena la grabación de la pareja y cantas la otra parte
 *
 * Flujo: modo + ¿auriculares? → "Pulsa para empezar" → letra sincronizada, nota por frase y mezclador
 *        (reverb, tono, velocidad) → Hecho → nota final, ver/escuchar, guardar y compartir.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { KaraokeEngine, REVERB_PRESETS } from '../utils/karaokeEngine';
import { KaraokeScorer, lineLabel } from '../utils/karaokeScore';
import { parseLrc, duetParts, fmtTime } from '../utils/lrc';
import LyricsView, { KARAOKE_ACCENT, DUET_PARTNER } from '../components/LyricsView';
import { absUrl } from './KaraokePage';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const BG = 'linear-gradient(180deg, #141A2A 0%, #111827 55%, #3D5A80 140%)';
const SPEEDS = [0.85, 1, 1.15];

/** Auriculares conectados según Android (APK); 'unknown' en la web o en APK antiguos */
const detectHeadphones = () => {
  try { return window.OldFaceAudio?.getHeadphones?.() || 'unknown'; } catch { return 'unknown'; }
};

export default function KaraokeSingPage() {
  const { songId } = useParams();
  const [params]   = useSearchParams();
  const joinId     = params.get('unirse');
  const navigate   = useNavigate();
  const { user }   = useAuthStore();

  const engineRef  = useRef(null);
  const scorerRef  = useRef(null);
  const rafRef     = useRef(null);
  const lastScore  = useRef(0);
  const videoRef   = useRef(null);   // mi cámara de fondo
  const partnerRef = useRef(null);   // vídeo de la pareja (unirse a un dúo)
  const canvasRef  = useRef(null);   // composición de las dos cámaras para la grabación del dúo
  const drawTimer  = useRef(null);
  const camOnRef   = useRef(true);

  const [song,    setSong]    = useState(null);
  const [rawLines, setRawLines] = useState([]);
  const [partner, setPartner] = useState(null);     // grabación a la que me uno
  const [mode,    setMode]    = useState(joinId ? 'join' : 'solo'); // solo | duo | join
  const [myPart,  setMyPart]  = useState('A');
  const [stage,   setStage]   = useState('loading'); // loading | setup | preparing | ready | singing | review | error
  const [error,   setError]   = useState('');
  const [pos,     setPos]     = useState(0);
  const [dur,     setDur]     = useState(0);
  const [level,   setLevel]   = useState(0);
  const [paused,  setPaused]  = useState(false);
  const [headphones, setHeadphones] = useState(true);
  const [hpKind]  = useState(detectHeadphones);
  const [hasVideo, setHasVideo] = useState(false);
  const [camOn,   setCamOn]   = useState(true);
  const [showMixer, setShowMixer] = useState(false);
  const [mix, setMix] = useState({ music: 45, voice: 85, monitor: 0, reverb: 25, reverbType: 'estudio', key: 0, speed: 1, sync: 0 });
  const [autoSync, setAutoSync] = useState(0);
  const [canKey,  setCanKey]  = useState(false);
  const [liveScore, setLiveScore] = useState(null);
  const [flash,   setFlash]   = useState(null);     // nota de la última frase
  const [result,  setResult]  = useState(null);     // nota final
  const [rec,     setRec]     = useState(null);     // { blob, url, duration, video }
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(null);

  const duetPart = mode === 'solo' ? null : mode === 'join' ? (partner?.duetPart === 'A' ? 'B' : 'A') : myPart;
  const lines = useMemo(() => (duetPart ? duetParts(rawLines) : rawLines), [rawLines, duetPart]);

  // ── Cargar canción, letra y (si me uno) la grabación de la pareja ─────────
  useEffect(() => {
    (async () => {
      try {
        const { songs } = await (await fetch(`${BACKEND}/karaoke/songs`)).json();
        const s = (songs || []).find(x => x.id === songId);
        if (!s) throw new Error('Canción no encontrada');
        if (joinId) {
          const r = await fetch(`${BACKEND}/karaoke/recordings/${encodeURIComponent(joinId)}`);
          const d = await r.json().catch(() => ({}));
          if (!r.ok || !d.recording?.duetPart || d.recording.duetOf || d.recording.songId !== songId) throw new Error('Este dúo ya no está disponible');
          setPartner(d.recording);
        }
        setSong(s);
        setDur(s.duration || 0);
        const lrc = await (await fetch(absUrl(s.lyricsUrl))).text();
        setRawLines(parseLrc(lrc));
        setStage('setup');
      } catch (e) { setError(e.message); setStage('error'); }
    })();
    return () => cleanup();
  }, [songId, joinId]); // eslint-disable-line

  const cleanup = () => {
    cancelAnimationFrame(rafRef.current);
    clearInterval(drawTimer.current);
    engineRef.current?.destroy();
    engineRef.current = null;
    window.OldFaceAudio?.setSpeaker();
  };

  // ── Preparar audio (permisos, pista o grabación de la pareja, efectos) ────
  const prepare = async (withHeadphones) => {
    setHeadphones(withHeadphones);
    setStage('preparing');
    try {
      let mediaElement = null;
      if (mode === 'join') {
        mediaElement = partner.video ? partnerRef.current : new Audio();
        mediaElement.crossOrigin = 'anonymous';
        mediaElement.preload = 'auto';
        mediaElement.src = absUrl(partner.audioUrl);
      }
      const engine = new KaraokeEngine({ audioUrl: absUrl(song.audioUrl), mediaElement, headphones: withHeadphones, camera: true, headphoneKind: hpKind });
      await engine.init();
      engineRef.current = engine;
      // Con auriculares: audio multimedia normal (todo por los auriculares, no también por el altavoz).
      // Sin auriculares: la música por el altavoz.
      if (withHeadphones) window.OldFaceAudio?.setMediaMode?.();
      else window.OldFaceAudio?.enableSpeaker();

      setMix(m => ({ ...m, monitor: engine.monitor, reverb: engine.reverb, reverbType: engine.reverbType, key: 0, speed: 1, sync: engine.syncMs }));
      setAutoSync(engine.autoSyncMs);
      setCanKey(engine.canShiftKey && mode !== 'join');
      setHasVideo(engine.hasVideo);
      setCamOn(true); camOnRef.current = true;
      if (engine.preview && videoRef.current) {
        videoRef.current.srcObject = engine.preview;
        videoRef.current.play().catch(() => {});
      }
      if (mode === 'join') startCompositor(engine);
      scorerRef.current = new KaraokeScorer(lines, duetPart);
      engine.onEnded(() => finish());
      setDur(engine.duration || song.duration || 0);
      setStage('ready');
    } catch (e) {
      setError(e?.name === 'NotAllowedError' ? 'Necesitamos permiso para usar el micrófono y la cámara' : (e.message || 'No se pudo preparar el audio'));
      setStage('error');
    }
  };

  // Dúo: la grabación lleva las dos imágenes (pareja arriba, yo abajo)
  const startCompositor = (engine) => {
    const canvas = canvasRef.current;
    if (!canvas?.captureStream) return;
    canvas.width = 720; canvas.height = 1280;
    const ctx = canvas.getContext('2d');
    const half = (el, y, label, mirror) => {
      const W = 720, H = 640;
      if (el && el.videoWidth && !(mirror && !camOnRef.current)) {
        const s = Math.max(W / el.videoWidth, H / el.videoHeight);
        const sw = W / s, sh = H / s;
        ctx.save();
        if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
        ctx.drawImage(el, (el.videoWidth - sw) / 2, (el.videoHeight - sh) / 2, sw, sh, 0, y, W, H);
        ctx.restore();
      } else {
        const g = ctx.createLinearGradient(0, y, W, y + H);
        g.addColorStop(0, '#3D5A80'); g.addColorStop(1, mirror ? '#4E7D96' : '#be185d');
        ctx.fillStyle = g; ctx.fillRect(0, y, W, H);
        ctx.fillStyle = 'white'; ctx.font = 'bold 120px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText((label || '?')[0].toUpperCase(), W / 2, y + H / 2 + 40);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(16, y + 16, 300, 50);
      ctx.fillStyle = 'white'; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(label || '', 30, y + 52);
    };
    clearInterval(drawTimer.current);
    drawTimer.current = setInterval(() => {
      half(partner.video ? partnerRef.current : null, 0, partner.userName, false);
      half(videoRef.current, 640, user?.name || 'Yo', true);
    }, 1000 / 24);
    engine.setRecordVideoTrack(canvas.captureStream(24).getVideoTracks()[0]);
  };

  const loop = () => {
    const e = engineRef.current;
    if (!e) return;
    const p = e.position, lvl = e.level();
    setPos(p);
    setLevel(lvl);
    // Puntuación ~12 veces por segundo (detectar el tono cuesta ~2 ms)
    const now = performance.now();
    if (!e.paused && scorerRef.current && now - lastScore.current > 80) {
      lastScore.current = now;
      // La voz que entra ahora corresponde a la música que sonó hace "sync" ms
      const songT = e.songTime();
      const done = scorerRef.current.sample(songT, lvl, e.pitch());
      if (done) {
        const f = { ...lineLabel(done.score), id: now };
        setFlash(f);
        setTimeout(() => setFlash(x => (x?.id === f.id ? null : x)), 1300);
        setLiveScore(scorerRef.current.result(songT).score);
      }
    }
    rafRef.current = requestAnimationFrame(loop);
  };

  const start = async () => {
    const e = engineRef.current;
    e.restart();
    scorerRef.current?.reset();
    setLiveScore(null); setFlash(null); setResult(null);
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
    const res = scorerRef.current?.result(e.songTime()) || null;
    e.pause();
    const blob = await e.stopRecording();
    if (!blob || blob.size < 2000) { setStage('ready'); return; }
    setResult(res);
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
    if (k === 'reverb') e.setReverb(v);
    if (k === 'reverbType') e.setReverbType(v);
    if (k === 'key') e.setKey(v);
    if (k === 'speed') e.setSpeed(v);
    if (k === 'sync') e.setSync(v);
  };

  const toggleCamera = () => {
    const e = engineRef.current;
    if (!e?.hasVideo) return;
    e.setCamera(!camOn);
    camOnRef.current = !camOn;
    setCamOn(!camOn);
  };

  // ── Guardar y compartir ───────────────────────────────────────────────────
  const save = async () => {
    if (!rec || saving) return;
    setSaving(true);
    setError('');
    try {
      // Subida en binario (las grabaciones con vídeo pesan decenas de MB)
      const up = await fetch(`${BACKEND}/karaoke/upload?userId=${encodeURIComponent(user?.id || '')}`, {
        method: 'POST', headers: { 'Content-Type': (rec.blob.type || 'video/webm').split(';')[0] }, body: rec.blob,
      });
      const { url, video, error: upErr } = await up.json().catch(() => ({}));
      if (!url) throw new Error(upErr || 'No se pudo subir la grabación');
      const res = await fetch(`${BACKEND}/karaoke/recordings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user?.id, songId, audioUrl: url, video, duration: rec.duration, score: result?.score,
          ...(mode === 'duo' ? { duetPart: myPart } : {}), ...(mode === 'join' ? { duetOf: joinId } : {}),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'No se pudo guardar');
      setSaved(d.recording);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const share = async () => {
    if (!saved) return;
    const what = mode === 'duo' ? `¡Canta conmigo! Abrí un dúo de "${song.title}" en OldFace (Karaoke → Dúos)`
               : mode === 'join' ? `🎤 Mira nuestro dúo de "${song.title}" con ${partner?.userName} en OldFace`
               : `🎤 ${saved.video ? 'Mira' : 'Escucha'} cómo canto "${song.title}" en OldFace`;
    const text = result ? `${what} — ¡${result.score} puntos!` : what;
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
  const joinVideo = mode === 'join' && partner?.video;
  const showCam = hasVideo && camOn;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: BG, color: 'white', display: 'flex', flexDirection: 'column' }}>
      {/* Fondo: mi cámara a pantalla completa; uniéndome a un dúo, la pareja arriba y yo abajo */}
      <video ref={partnerRef} playsInline
        style={{ position: 'absolute', left: 0, right: 0, top: 0, width: '100%', height: '50%', objectFit: 'cover', zIndex: 0, display: joinVideo ? 'block' : 'none' }} />
      <video ref={videoRef} autoPlay playsInline muted
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, width: '100%', height: mode === 'join' ? '50%' : '100%', objectFit: 'cover',
                 transform: 'scaleX(-1)', zIndex: 0, display: showCam ? 'block' : 'none' }} />
      {mode === 'join' && partner && !partner.video && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: '50%', zIndex: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: `linear-gradient(135deg, #3D5A80, #be185d)`, fontSize: 70, fontWeight: 900 }}>{partner.userName?.[0]?.toUpperCase()}</div>
      )}
      {(showCam || joinVideo) && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
                      background: 'linear-gradient(180deg, rgba(0,0,40,0.55) 0%, rgba(0,0,0,0.15) 25%, rgba(0,0,0,0.25) 60%, rgba(0,0,40,0.75) 100%)' }} />
      )}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Cabecera */}
      <div style={{ paddingTop: 'max(env(safe-area-inset-top, 12px), 12px)', flexShrink: 0, position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px' }}>
          <button onClick={close} aria-label="Cerrar" style={{ background: 'none', border: 'none', color: 'white', fontSize: 22, cursor: 'pointer', width: 32 }}>✕</button>
          <p style={{ flex: 1, margin: 0, textAlign: 'center', fontSize: 14, fontWeight: 700, opacity: 0.9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {mode !== 'solo' && '👥 '}♫ {song ? `${song.title}${song.artist ? ' - ' + song.artist : ''}` : ''}
          </p>
          <div style={{ minWidth: 32, textAlign: 'right', fontSize: 13, fontWeight: 900, color: '#facc15' }}>
            {stage === 'singing' && liveScore !== null ? `⭐ ${liveScore}` : ''}
          </div>
        </div>
        <div style={{ padding: '6px 18px 0' }}>
          <div style={{ height: 5, background: 'rgba(255,255,255,0.15)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: KARAOKE_ACCENT, borderRadius: 3, transition: 'width 0.2s linear' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', margin: '5px 0 0', fontSize: 12, opacity: 0.8 }}>
            <span style={{ fontFamily: 'monospace' }}>{fmtTime(pos)} / {fmtTime(dur)}</span>
            {duetPart && (
              <span style={{ fontWeight: 800 }}>
                <span style={{ color: KARAOKE_ACCENT }}>● Tú (parte {duetPart})</span>
                {'  '}<span style={{ color: DUET_PARTNER }}>● {mode === 'join' ? partner?.userName : 'Tu pareja'}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Letra + medidor de micro + nota de la frase */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0, zIndex: 1 }}>
        {['singing', 'ready', 'setup', 'preparing'].includes(stage) && (
          <LyricsView lines={lines} position={stage === 'singing' ? pos : -1} overVideo={showCam || joinVideo} myPart={duetPart} />
        )}
        {stage === 'singing' && (
          <div style={{ position: 'absolute', left: 10, top: '30%', height: '35%', width: 6, background: 'rgba(255,255,255,0.12)', borderRadius: 3, display: 'flex', alignItems: 'flex-end' }}>
            <div style={{ width: '100%', height: `${Math.round(level * 100)}%`, background: level > 0.85 ? '#f97316' : '#22c55e', borderRadius: 3, transition: 'height 0.08s' }} />
            <span style={{ position: 'absolute', bottom: -22, left: -5, fontSize: 13 }}>🎙</span>
          </div>
        )}
        {flash && (
          <div key={flash.id} style={{ position: 'absolute', top: '16%', left: 0, right: 0, textAlign: 'center', pointerEvents: 'none',
                                       fontSize: 30, fontWeight: 900, color: flash.color, textShadow: '0 2px 10px rgba(0,0,0,0.8)', animation: 'kFlash 1.3s ease-out forwards' }}>
            {flash.text}
          </div>
        )}
      </div>

      {/* Controles */}
      <div style={{ flexShrink: 0, padding: '10px 18px calc(env(safe-area-inset-bottom, 0px) + 18px)', position: 'relative', zIndex: 1 }}>
        {stage === 'ready' && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setShowMixer(true)} aria-label="Ajustes de sonido" style={{ ...bigBtn, width: 60, flexShrink: 0, background: 'rgba(255,255,255,0.18)', fontSize: 20 }}>🎚</button>
            <button onClick={start} style={bigBtn}>Pulsa para empezar</button>
          </div>
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

      {/* Modo + ¿auriculares? */}
      {stage === 'setup' && (
        <Modal>
          {mode === 'join' ? (
            <>
              <div style={{ fontSize: 40, marginBottom: 4 }}>👥</div>
              <p style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 900 }}>Dúo con {partner?.userName}</p>
              <p style={{ margin: '0 0 14px', fontSize: 13, opacity: 0.85, lineHeight: 1.5 }}>
                Oirás su grabación y cantarás la <b>parte {duetPart}</b>. Sus frases salen en <span style={{ color: DUET_PARTNER, fontWeight: 800 }}>rosa</span>.
              </p>
            </>
          ) : (
            <>
              <p style={{ margin: '0 0 10px', fontSize: 17, fontWeight: 900 }}>¿Cómo quieres cantar?</p>
              <div style={{ display: 'flex', gap: 8, marginBottom: mode === 'duo' ? 8 : 14 }}>
                {[['solo', '🎤 Solo'], ['duo', '👥 Dúo']].map(([id, label]) => (
                  <button key={id} onClick={() => setMode(id)} style={{ ...chip(mode === id), flex: 1, padding: '11px 0', fontSize: 14 }}>{label}</button>
                ))}
              </div>
              {mode === 'duo' && (
                <>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    {['A', 'B'].map(p => <button key={p} onClick={() => setMyPart(p)} style={{ ...chip(myPart === p), flex: 1 }}>Parte {p}</button>)}
                  </div>
                  <p style={{ margin: '0 0 14px', fontSize: 12, opacity: 0.8, lineHeight: 1.45 }}>Grabas tu parte y tus amigos se unen después desde Karaoke → Dúos para cantar la otra.</p>
                </>
              )}
            </>
          )}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: 14 }}>
            <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 900 }}>🎧 {hpTitle(hpKind)}</p>
            <p style={{ margin: '0 0 14px', fontSize: 12, opacity: 0.85, lineHeight: 1.5 }}>{hpText(hpKind)}</p>
            <button onClick={() => prepare(true)} style={{ ...bigBtn, marginBottom: 10 }}>{hpKind === 'none' ? 'Tengo auriculares' : 'Cantar con auriculares'}</button>
            <button onClick={() => prepare(false)} style={{ ...bigBtn, background: 'rgba(255,255,255,0.15)' }}>Cantar sin auriculares</button>
          </div>
        </Modal>
      )}

      {/* Revisión: nota final + grabación */}
      {stage === 'review' && rec && (
        <Modal>
          {result && result.lines > 0 ? (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 74, height: 74, borderRadius: '50%', fontSize: 38, fontWeight: 900,
                            background: 'linear-gradient(135deg, #facc15, #f97316)', color: '#1e1b4b', boxShadow: '0 6px 20px rgba(250,204,21,0.4)' }}>{result.grade}</div>
              <p style={{ margin: '8px 0 2px', fontSize: 22, fontWeight: 900 }}>{result.score} puntos</p>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.85 }}>Ritmo {result.timing}% · Afinación {result.tune}%</p>
            </div>
          ) : (
            <><div style={{ fontSize: 46, marginBottom: 6 }}>🎉</div><p style={{ margin: '0 0 4px', fontSize: 19, fontWeight: 900 }}>¡Bravo!</p></>
          )}
          <p style={{ margin: '0 0 12px', fontSize: 13, opacity: 0.85 }}>{rec.video ? 'Mira' : 'Escucha'} tu grabación de "{song?.title}" ({fmtTime(rec.duration)})</p>
          {rec.video
            ? <video controls playsInline src={rec.url} style={{ width: '100%', maxHeight: '34vh', borderRadius: 14, background: '#000', marginBottom: 12 }} />
            : <audio controls src={rec.url} style={{ width: '100%', marginBottom: 12 }} />}
          {!saved ? (
            <button onClick={save} disabled={saving} style={{ ...bigBtn, marginBottom: 10, opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Guardando…' : mode === 'duo' ? 'Guardar y abrir el dúo' : 'Guardar en mis grabaciones'}
            </button>
          ) : (
            <button onClick={share} style={{ ...bigBtn, marginBottom: 10 }}>Compartir ↗</button>
          )}
          {saved && (
            <p style={{ margin: '0 0 10px', fontSize: 12, color: '#86efac', fontWeight: 700 }}>
              {mode === 'duo' ? '✓ Dúo abierto: otros pueden unirse desde Karaoke → Dúos' : '✓ Guardada en Mis grabaciones'}
            </p>
          )}
          {error && <p style={{ margin: '0 0 10px', fontSize: 12, color: '#fca5a5' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => { setRec(null); setSaved(null); setError(''); setResult(null); setStage('ready'); }} style={{ ...bigBtn, flex: 1, background: 'rgba(255,255,255,0.15)', fontSize: 14 }}>Repetir</button>
            <button onClick={() => navigate('/karaoke?tab=grabaciones', { replace: true })} style={{ ...bigBtn, flex: 1, background: 'rgba(255,255,255,0.15)', fontSize: 14 }}>Salir</button>
          </div>
        </Modal>
      )}

      {/* Mezclador */}
      {showMixer && (
        <div onClick={() => setShowMixer(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', zIndex: 5 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxHeight: '80vh', overflowY: 'auto', background: '#161c3a', borderRadius: '22px 22px 0 0', padding: '20px 18px calc(env(safe-area-inset-bottom, 0px) + 24px)' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
              <p style={{ flex: 1, margin: 0, fontWeight: 900, fontSize: 16 }}>Mezclador</p>
              <button onClick={() => setShowMixer(false)} style={{ background: 'none', border: 'none', color: 'white', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>
            <Slider label="Música" value={mix.music} onChange={v => changeMix('music', v)} />
            <Slider label="Voz (en la grabación)" value={mix.voice} onChange={v => changeMix('voice', v)} />
            {headphones
              ? <Slider label="Oír mi voz en los auriculares" value={mix.monitor} onChange={v => changeMix('monitor', v)} />
              : <p style={{ fontSize: 12, opacity: 0.6, margin: '0 0 16px' }}>Oír tu voz solo está disponible con auriculares.</p>}

            <Section title="🎯 Sincronizar voz con la música">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, marginBottom: 6 }}>
                <span>Ajuste de la grabación</span>
                <span style={{ fontWeight: 800 }}>{mix.sync} ms{mix.sync === autoSync ? ' (auto)' : ''}</span>
              </div>
              <input type="range" min="0" max="500" step="10" value={mix.sync} onChange={e => changeMix('sync', Number(e.target.value))}
                style={{ width: '100%', accentColor: KARAOKE_ACCENT }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                <p style={{ flex: 1, margin: 0, fontSize: 11, opacity: 0.7, lineHeight: 1.4 }}>
                  Si al escuchar la grabación tu voz va <b>retrasada</b> respecto a la música, súbelo; si va <b>adelantada</b>, bájalo.
                </p>
                {mix.sync !== autoSync && (
                  <button onClick={() => changeMix('sync', autoSync)} style={{ ...chip(false), flexShrink: 0 }}>Auto</button>
                )}
              </div>
            </Section>

            <Section title="✨ Reverb (efecto de estudio)">
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                {Object.entries(REVERB_PRESETS).map(([id, p]) => (
                  <button key={id} onClick={() => changeMix('reverbType', id)} style={{ ...chip(mix.reverbType === id), flex: 1 }}>{p.label}</button>
                ))}
              </div>
              <Slider label="Cantidad de reverb" value={mix.reverb} onChange={v => changeMix('reverb', v)} />
            </Section>

            <Section title="🎼 Tono de la canción">
              {canKey ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button onClick={() => changeMix('key', Math.max(-6, mix.key - 1))} style={stepBtn}>−</button>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <p style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>{mix.key > 0 ? `+${mix.key}` : mix.key}</p>
                    <p style={{ margin: 0, fontSize: 11, opacity: 0.7 }}>{mix.key === 0 ? 'Tono original' : mix.key > 0 ? 'Más agudo' : 'Más grave'} (semitonos)</p>
                  </div>
                  <button onClick={() => changeMix('key', Math.min(6, mix.key + 1))} style={stepBtn}>+</button>
                </div>
              ) : <p style={{ fontSize: 12, opacity: 0.6, margin: 0 }}>{mode === 'join' ? 'En un dúo se canta en el tono que eligió tu pareja.' : 'Tu móvil no permite cambiar el tono.'}</p>}
            </Section>

            <Section title="⏱ Velocidad">
              {mode === 'solo' ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  {SPEEDS.map(s => <button key={s} onClick={() => changeMix('speed', s)} style={{ ...chip(mix.speed === s), flex: 1 }}>{s === 1 ? 'Normal' : `${s}x`}</button>)}
                </div>
              ) : <p style={{ fontSize: 12, opacity: 0.6, margin: 0 }}>En los dúos se canta a velocidad normal para que encajen las dos partes.</p>}
            </Section>
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

      <style>{`@keyframes kFlash { 0% { transform: scale(0.6); opacity: 0 } 15% { transform: scale(1.1); opacity: 1 } 30% { transform: scale(1) } 100% { transform: translateY(-30px); opacity: 0 } }`}</style>
    </div>
  );
}

function hpTitle(kind) {
  return { wired: 'Auriculares con cable conectados', usb: 'Auriculares USB conectados', bluetooth: 'Auriculares Bluetooth conectados',
           none: 'No hay auriculares conectados' }[kind] || 'Se recomienda usar auriculares';
}
function hpText(kind) {
  if (kind === 'bluetooth') return 'Con Bluetooth tu voz te llegará con algo de retraso (es propio del Bluetooth). Para oírte al instante usa auriculares con cable.';
  if (kind === 'none') return 'Conecta unos auriculares para oírte cantando sobre la música sin eco. Sin auriculares la música sonará por el altavoz.';
  return 'Te oirás cantando sobre la música, con efecto de estudio, y tu voz se grabará limpia. Se activará la cámara para grabarte en vídeo.';
}

function Modal({ children }) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 10, background: 'rgba(5,8,25,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 360, maxHeight: '92vh', overflowY: 'auto', background: 'linear-gradient(160deg, #3D5A80, #4E7D96)', borderRadius: 22, padding: '22px 20px', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        {children}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 14, marginTop: 4, marginBottom: 14 }}>
      <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 900 }}>{title}</p>
      {children}
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

const chip = (on) => ({
  padding: '8px 10px', borderRadius: 14, cursor: 'pointer', fontWeight: 800, fontSize: 13, color: 'white',
  border: `1.5px solid ${on ? KARAOKE_ACCENT : 'rgba(255,255,255,0.25)'}`, background: on ? 'rgba(79,155,255,0.3)' : 'rgba(255,255,255,0.06)',
});

const stepBtn = {
  width: 48, height: 48, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.15)', color: 'white', fontSize: 24, fontWeight: 900, cursor: 'pointer',
};

const bigBtn = {
  width: '100%', padding: '15px', border: 'none', borderRadius: 26, cursor: 'pointer', color: 'white',
  background: `linear-gradient(135deg, #4E7D96, ${KARAOKE_ACCENT})`, fontSize: 16, fontWeight: 900,
};
