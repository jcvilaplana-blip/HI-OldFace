/**
 * KaraokeRoomPage — sala de karaoke en directo (servidor RTC propio).
 *  · Cola de canciones: cada uno elige canción del catálogo; cuando le toca, pulsa "Empezar".
 *  · El cantante emite voz + música mezcladas (KaraokeEngine) y envía la posición para sincronizar la letra.
 *  · El público escucha, ve la letra sincronizada, comenta y manda ❤.
 *  · El anfitrión puede saltar la canción y cerrar la sala.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { ensureRtcConnected, rtcRequest, rtcEmit, onRtc } from '../utils/rtcClient';
import { RtcCall } from '../utils/rtcCall';
import { KaraokeEngine } from '../utils/karaokeEngine';
import { parseLrc } from '../utils/lrc';
import LyricsView, { KARAOKE_ACCENT } from '../components/LyricsView';
import { absUrl, SongRow } from './KaraokePage';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const RED = '#ef4444';
const BG  = 'linear-gradient(180deg, #141A2A 0%, #293241 50%, #3D5A80 130%)';
const LISTENER_LATENCY = 0.35; // s de retraso aproximado del audio respecto a la posición enviada

export default function KaraokeRoomPage() {
  const { roomId: routeId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [roomId, setRoomId] = useState(routeId === 'nueva' ? null : routeId);
  const [room,   setRoom]   = useState(null);        // { title, hostId, hostName }
  const [status, setStatus] = useState('loading');   // loading | live | closed | error
  const [error,  setError]  = useState('');
  const [queue,  setQueue]  = useState([]);
  const [current, setCurrent] = useState(null);
  const [chat,   setChat]   = useState([]);
  const [likes,  setLikes]  = useState(0);
  const [listeners, setListeners] = useState(0);
  const [lines,  setLines]  = useState([]);
  const [pos,    setPos]    = useState(0);
  const [singing, setSinging] = useState(false);
  const [askHeadphones, setAskHeadphones] = useState(false);
  const [songs,  setSongs]  = useState([]);
  const [sheet,  setSheet]  = useState(null);         // 'songs' | 'queue' | null
  const [query,  setQuery]  = useState('');
  const [text,   setText]   = useState('');
  const [toast,  setToast]  = useState('');
  const [needsTap, setNeedsTap] = useState(false);
  const [hearts, setHearts] = useState([]);
  const [videos, setVideos] = useState({});           // userId → stream de vídeo recibido (cámara del cantante)
  const [localPreview, setLocalPreview] = useState(null); // mi cámara mientras canto
  const [camOn,  setCamOn]  = useState(true);
  const [monitorOn, setMonitorOn] = useState(false);  // oírme en los auriculares

  const callRef     = useRef(null);
  const engineRef   = useRef(null);
  const progressRef = useRef({ position: 0, at: 0 });
  const rafRef      = useRef(null);
  const timerRef    = useRef(null);
  const audioBoxRef = useRef(null);
  const unsubsRef   = useRef([]);
  const lyricsCache = useRef({});
  const cleanedRef  = useRef(false);
  const roomIdRef   = useRef(roomId);

  const isHost  = room?.hostId === user?.id;
  const myCount = queue.filter(e => e.userId === user?.id).length;
  const myTurn  = !current && queue[0]?.userId === user?.id;

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2800); };

  // ── Entrar / crear sala ────────────────────────────────────────────────────
  useEffect(() => {
    start();
    fetch(`${BACKEND}/karaoke/songs`).then(r => r.json()).then(d => setSongs(d.songs || [])).catch(() => {});
    return () => cleanup();
  }, []); // eslint-disable-line

  const applyState = (r) => {
    setRoom({ title: r.title, hostId: r.hostId, hostName: r.hostName });
    setQueue(r.queue || []);
    setCurrent(r.current || null);
    setChat(r.chat || []);
    setLikes(r.likes || 0);
    setListeners(r.listeners || 0);
    if (r.current) progressRef.current = { position: r.current.position || 0, at: Date.now() };
  };

  const start = async () => {
    try {
      await ensureRtcConnected(user);
      let res;
      if (routeId === 'nueva') {
        res = await rtcRequest('karaoke:create', { title: params.get('title') || '' });
        navigate(`/karaoke/sala/${res.room.roomId}`, { replace: true });
      } else {
        res = await rtcRequest('karaoke:join', { roomId: routeId });
      }
      const id = res.room.roomId;
      roomIdRef.current = id;
      setRoomId(id);
      subscribe(id);
      applyState(res.room);

      const call = new RtcCall({
        roomId: `karaoke_${id}`, video: false, publish: false,
        onPeerStream: (peerId, stream) => { attachAudio(peerId, stream); setPeerVideo(peerId, stream); },
        onPeerLeft: (peerId) => { audioBoxRef.current?.querySelector(`audio[data-peer="${peerId}"]`)?.remove(); setPeerVideo(peerId, null); },
      });
      callRef.current = call;
      await call.join();
      mediaAudio();
      setStatus('live');
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      setError(e.message || 'No se pudo entrar en la sala');
      setStatus(/no existe/.test(e.message || '') ? 'closed' : 'error');
    }
  };

  const subscribe = (id) => {
    unsubsRef.current.forEach(u => u());
    const mine = (p) => p?.roomId === id;
    unsubsRef.current = [
      onRtc('karaoke:state', (p) => {
        if (!mine(p)) return;
        setQueue(p.queue || []);
        setCurrent(p.current || null);
        if (p.current) progressRef.current = { position: p.current.position || 0, at: Date.now() };
      }),
      onRtc('karaoke:progress', (p) => { if (mine(p)) progressRef.current = { position: p.position, at: Date.now() }; }),
      onRtc('karaoke:chat', (p) => { if (mine(p)) setChat(c => [...c.slice(-99), p.msg]); }),
      onRtc('karaoke:like', (p) => { if (mine(p)) { setLikes(p.likes); if (p.from !== user?.id) spawnHeart(); } }),
      onRtc('karaoke:listeners', (p) => { if (mine(p)) setListeners(p.listeners); }),
      onRtc('karaoke:yourTurn', (p) => { if (mine(p)) showToast('🎤 ¡Te toca cantar!'); }),
      onRtc('karaoke:songEnded', (p) => { if (mine(p) && engineRef.current) stopSinging(false); }),
      onRtc('karaoke:closed', (p) => { if (mine(p)) { cleanup(); setStatus('closed'); } }),
    ];
  };

  const cleanup = () => {
    if (cleanedRef.current) return;
    cleanedRef.current = true;
    cancelAnimationFrame(rafRef.current);
    clearInterval(timerRef.current);
    unsubsRef.current.forEach(u => u());
    if (roomIdRef.current) rtcRequest('karaoke:leave', { roomId: roomIdRef.current }).catch(() => {});
    engineRef.current?.destroy();
    engineRef.current = null;
    callRef.current?.leave();
    callRef.current = null;
    window.OldFaceAudio?.setSpeaker();
  };

  // ── Letra de la canción actual ─────────────────────────────────────────────
  useEffect(() => {
    if (!current?.song?.lyricsUrl) { setLines([]); return; }
    const key = current.song.id;
    if (lyricsCache.current[key]) { setLines(lyricsCache.current[key]); return; }
    fetch(absUrl(current.song.lyricsUrl)).then(r => r.text()).then(t => {
      lyricsCache.current[key] = parseLrc(t);
      setLines(lyricsCache.current[key]);
    }).catch(() => setLines([]));
  }, [current?.song?.id]); // eslint-disable-line

  // Posición: el cantante la lee de su motor; el público la extrapola desde el último aviso
  const tick = () => {
    const e = engineRef.current;
    if (e) setPos(e.position);
    else {
      const p = progressRef.current;
      setPos(p.at ? p.position + (Date.now() - p.at) / 1000 - LISTENER_LATENCY : 0);
    }
    rafRef.current = requestAnimationFrame(tick);
  };

  const attachAudio = (peerId, stream) => {
    const box = audioBoxRef.current;
    if (!box) return;
    let el = box.querySelector(`audio[data-peer="${peerId}"]`);
    if (!el) { el = document.createElement('audio'); el.dataset.peer = peerId; el.autoplay = true; box.appendChild(el); }
    el.srcObject = stream;
    el.play().catch(() => setNeedsTap(true));
  };

  // Vídeo del cantante (el audio va por el <audio>; el <video> de fondo va silenciado)
  const setPeerVideo = (peerId, stream) => {
    const track = stream?.getVideoTracks().find(t => t.readyState === 'live');
    setVideos(v => {
      const next = { ...v };
      if (track) next[peerId] = new MediaStream([track]); else delete next[peerId];
      return next;
    });
  };

  // ── Cantar ────────────────────────────────────────────────────────────────
  const startSinging = async (headphones) => {
    setAskHeadphones(false);
    const entry = queue[0];
    if (!entry || entry.userId !== user?.id) return;
    try {
      let headphoneKind = 'unknown';
      try { headphoneKind = window.OldFaceAudio?.getHeadphones?.() || 'unknown'; } catch {}
      const engine = new KaraokeEngine({ audioUrl: absUrl(entry.song.audioUrl), headphones, camera: true, headphoneKind });
      await engine.init();
      engineRef.current = engine;
      if (headphones) mediaAudio();               // todo por los auriculares (no también por el altavoz)
      else window.OldFaceAudio?.enableSpeaker();
      setLocalPreview(engine.preview);
      setCamOn(true);
      setMonitorOn(engine.monitor > 0);
      await rtcRequest('karaoke:start', { roomId, entryId: entry.id });
      await callRef.current.publish({ stream: engine.stream });
      engine.onEnded(() => stopSinging(true));
      await engine.play();
      setSinging(true);
      // Posición para sincronizar la letra del público (2 veces por segundo)
      clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        const e = engineRef.current;
        // El público recibe la música retrasada lo mismo que la voz (sincronía): enviar esa posición
        if (e) rtcEmit('karaoke:progress', { roomId, position: e.songTime() });
      }, 500);
    } catch (e) {
      engineRef.current?.destroy();
      engineRef.current = null;
      setLocalPreview(null);
      showToast(e?.name === 'NotAllowedError' ? 'Necesitamos permiso para el micrófono y la cámara' : (e.message || 'No se pudo empezar'));
    }
  };

  const stopSinging = async (notify = true) => {
    clearInterval(timerRef.current);
    if (notify) await rtcRequest('karaoke:finish', { roomId }).catch(() => {});
    try { await callRef.current?.unpublish(); } catch {}
    engineRef.current?.destroy();
    engineRef.current = null;
    setLocalPreview(null);
    setSinging(false);
    mediaAudio();
  };

  const toggleCamera = () => {
    const e = engineRef.current;
    if (!e?.hasVideo) return;
    e.setCamera(!camOn);   // apagada, el público ve negro
    setCamOn(!camOn);
  };
  const toggleMonitor = () => {
    const e = engineRef.current;
    if (!e) return;
    if (!e.headphones && !monitorOn) { showToast('🎧 Oír tu voz solo funciona con auriculares'); return; }
    e.setMonitor(monitorOn ? 0 : 70);
    setMonitorOn(!monitorOn);
  };

  // ── Acciones ──────────────────────────────────────────────────────────────
  const addSong = async (song) => {
    try {
      await rtcRequest('karaoke:queue', { roomId, song });
      setSheet(null);
      showToast(`"${song.title}" añadida a la cola`);
    } catch (e) { showToast(e.message); }
  };
  const unqueue = (entryId) => rtcRequest('karaoke:unqueue', { roomId, entryId }).catch(e => showToast(e.message));
  const skip = () => rtcRequest('karaoke:finish', { roomId }).catch(e => showToast(e.message));
  const closeRoom = async () => { await rtcRequest('karaoke:close', { roomId }).catch(() => {}); cleanup(); navigate(-1); };
  const leave = () => { if (engineRef.current) stopSinging(true); cleanup(); navigate(-1); };

  const sendChat = (e) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    rtcRequest('karaoke:chat', { roomId, text: t }).catch(err => showToast(err.message));
  };
  const spawnHeart = () => {
    const h = { id: Math.random(), x: Math.round(Math.random() * 30) - 15 };
    setHearts(a => [...a.slice(-20), h]);
    setTimeout(() => setHearts(a => a.filter(x => x !== h)), 2500);
  };
  const like = () => { spawnHeart(); setLikes(l => l + 1); rtcRequest('karaoke:like', { roomId }).then(r => setLikes(r.likes)).catch(() => {}); };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? songs.filter(s => `${s.title} ${s.artist}`.toLowerCase().includes(q)) : songs;
  }, [songs, query]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (status !== 'live') {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: BG, color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 30, textAlign: 'center' }}>
        <div style={{ fontSize: 50 }}>{status === 'loading' ? '🎤' : status === 'closed' ? '🌙' : '⚠️'}</div>
        <p style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>
          {status === 'loading' ? 'Entrando en la sala…' : status === 'closed' ? 'Esta sala de karaoke se ha cerrado' : 'No se pudo entrar en la sala'}
        </p>
        {status === 'error' && <p style={{ opacity: 0.7, fontSize: 13, margin: 0 }}>{error}</p>}
        {status !== 'loading' && <button onClick={() => navigate('/karaoke?tab=salas', { replace: true })} style={pillBtn('rgba(255,255,255,0.15)')}>Ver otras salas</button>}
      </div>
    );
  }

  const singerIsMe = current?.userId === user?.id;
  // Fondo: mi cámara si canto yo; si no, la cámara del cantante actual
  const bgStream = current ? (singerIsMe ? (camOn ? localPreview : null) : videos[current.userId]) : null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: BG, color: 'white', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div ref={audioBoxRef} style={{ display: 'none' }} />

      {/* Cámara en directo del cantante de fondo + degradado para leer la letra */}
      {bgStream && (
        <>
          <BgVideo stream={bgStream} mirror={singerIsMe} />
          <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
                        background: 'linear-gradient(180deg, rgba(0,0,40,0.6) 0%, rgba(0,0,0,0.15) 28%, rgba(0,0,0,0.25) 60%, rgba(0,0,40,0.8) 100%)' }} />
        </>
      )}

      {/* Cabecera */}
      <div style={{ paddingTop: 'max(env(safe-area-inset-top, 12px), 12px)', flexShrink: 0, position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px' }}>
          <div style={{ width: 38, height: 38, borderRadius: '50%', background: RED, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, flexShrink: 0 }}>{room?.hostName?.[0]?.toUpperCase()}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{room?.title}</p>
            <p style={{ margin: 0, fontSize: 11, opacity: 0.75 }}>Anfitrión: {isHost ? 'tú' : room?.hostName} · 👂 {listeners} · ❤ {likes}</p>
          </div>
          {isHost && <button onClick={closeRoom} style={pillBtn('rgba(239,68,68,0.85)')}>Cerrar sala</button>}
          <button onClick={leave} aria-label="Salir" style={{ ...pillBtn('rgba(255,255,255,0.15)'), width: 36, height: 36, padding: 0, borderRadius: '50%' }}>✕</button>
        </div>
      </div>

      {/* Escenario: cantante + letra */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 1, textShadow: bgStream ? '0 1px 4px rgba(0,0,0,0.9)' : 'none' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 0 4px', flexShrink: 0 }}>
          {!bgStream && <div style={{ position: 'relative', width: 92, height: 92 }}>
            {current && <div style={{ position: 'absolute', inset: -10, borderRadius: '50%', border: `3px solid ${KARAOKE_ACCENT}`, animation: 'kPulse 1.6s ease-out infinite' }} />}
            <div style={{ width: 92, height: 92, borderRadius: '50%', background: current ? `linear-gradient(135deg, #4E7D96, ${KARAOKE_ACCENT})` : 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 38, fontWeight: 900 }}>
              {current ? current.name?.[0]?.toUpperCase() : '🎤'}
            </div>
          </div>}
          <p style={{ margin: bgStream ? '2px 0 0' : '10px 0 0', fontSize: 15, fontWeight: 900 }}>
            {current ? (singerIsMe ? 'Estás cantando' : `${current.name} está cantando`) : 'Nadie está cantando'}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 12, opacity: 0.75 }}>
            {current ? `♫ ${current.song.title}${current.song.artist ? ' - ' + current.song.artist : ''}` : queue.length ? `Siguiente: ${queue[0].name}` : '¡Elige una canción y canta!'}
          </p>
          {current && (isHost || singerIsMe) && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              {singerIsMe && singing && (
                <>
                  <button onClick={toggleMonitor} style={pillBtn(monitorOn ? KARAOKE_ACCENT : 'rgba(0,0,0,0.35)')}>🎧 Mi voz {monitorOn ? 'ON' : 'OFF'}</button>
                  {engineRef.current?.hasVideo && (
                    <button onClick={toggleCamera} style={pillBtn(camOn ? 'rgba(0,0,0,0.35)' : 'rgba(239,68,68,0.85)')}>📷 {camOn ? 'Cámara' : 'Sin cámara'}</button>
                  )}
                </>
              )}
              <button onClick={singerIsMe ? () => stopSinging(true) : skip} style={pillBtn('rgba(0,0,0,0.35)')}>
                {singerIsMe ? 'Terminar' : 'Saltar canción'}
              </button>
            </div>
          )}
        </div>
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          {current ? <LyricsView lines={lines} position={pos} compact overVideo={!!bgStream} /> : (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5, fontSize: 40 }}>♪ ♫ ♪</div>
          )}
        </div>
      </div>

      {/* Chat flotante */}
      <div style={{ position: 'absolute', left: 12, right: 70, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 70px)', maxHeight: '22vh', overflowY: 'auto', pointerEvents: 'none', WebkitMaskImage: 'linear-gradient(transparent, black 30%)', maskImage: 'linear-gradient(transparent, black 30%)' }}>
        {chat.slice(-12).map(m => (
          <div key={m.id} style={{ fontSize: 13, margin: '0 0 4px', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
            <b style={{ color: m.userId === room?.hostId ? '#fca5a5' : '#c7d2fe', marginRight: 6 }}>{m.userId === user?.id ? 'Tú' : m.name}</b>{m.text}
          </div>
        ))}
      </div>

      {/* Corazones */}
      <div style={{ position: 'absolute', right: 20, bottom: 140, width: 40, height: 260, pointerEvents: 'none' }}>
        {hearts.map(h => <span key={h.id} style={{ position: 'absolute', bottom: 0, left: 10 + h.x, fontSize: 26, color: KARAOKE_ACCENT, animation: 'kHeart 2.4s ease-out forwards' }}>❤</span>)}
      </div>

      {/* Mi turno */}
      {myTurn && !singing && (
        <div style={{ position: 'absolute', left: 14, right: 14, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 74px)', zIndex: 6, background: `linear-gradient(135deg, #4E7D96, ${KARAOKE_ACCENT})`, borderRadius: 18, padding: 14, display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.4)' }}>
          <span style={{ fontSize: 30 }}>🎤</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontWeight: 900 }}>¡Te toca!</p>
            <p style={{ margin: 0, fontSize: 12, opacity: 0.9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{queue[0].song.title}</p>
          </div>
          <button onClick={() => setAskHeadphones(true)} style={pillBtn('white', '#1e1b4b')}>Empezar</button>
          <button onClick={() => unqueue(queue[0].id)} style={pillBtn('rgba(0,0,0,0.25)')}>Pasar</button>
        </div>
      )}

      {/* Barra inferior */}
      <form onSubmit={sendChat} style={{ position: 'relative', zIndex: 5, display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px calc(env(safe-area-inset-bottom, 0px) + 12px)', flexShrink: 0 }}>
        <input value={text} onChange={e => setText(e.target.value)} maxLength={200} placeholder="Di algo…"
          style={{ flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.13)', border: '1px solid rgba(255,255,255,0.2)', color: 'white', borderRadius: 22, padding: '10px 14px', fontSize: 14, outline: 'none' }} />
        {text.trim()
          ? <button type="submit" style={pillBtn(KARAOKE_ACCENT)}>Enviar</button>
          : <>
              <button type="button" onClick={like} aria-label="Me gusta" style={{ ...pillBtn('rgba(255,255,255,0.13)'), fontSize: 18, padding: '7px 12px', color: KARAOKE_ACCENT }}>❤</button>
              <button type="button" onClick={() => setSheet('queue')} style={pillBtn('rgba(255,255,255,0.13)')}>Cola ({queue.length})</button>
              <button type="button" onClick={() => setSheet('songs')} disabled={myCount >= 2}
                style={{ ...pillBtn(`linear-gradient(135deg, #4E7D96, ${KARAOKE_ACCENT})`), opacity: myCount >= 2 ? 0.5 : 1 }}>🎵 Elegir</button>
            </>}
      </form>

      {/* Hoja: elegir canción */}
      {sheet === 'songs' && (
        <Sheet title="Elige una canción" onClose={() => setSheet(null)}>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar…" style={{ width: '100%', padding: '10px 14px', borderRadius: 14, border: 'none', marginBottom: 10, fontSize: 14, boxSizing: 'border-box' }} />
          {filtered.length === 0 && <p style={{ opacity: 0.7, fontSize: 13 }}>{songs.length ? 'Sin resultados' : 'El catálogo está vacío'}</p>}
          <div style={{ borderRadius: 14, overflow: 'hidden' }}>
            {filtered.map(s => <SongRow key={s.id} song={s} cta="Añadir" onSing={() => addSong(s)} />)}
          </div>
        </Sheet>
      )}

      {/* Hoja: cola */}
      {sheet === 'queue' && (
        <Sheet title={`Cola de canciones (${queue.length})`} onClose={() => setSheet(null)}>
          {queue.length === 0 && <p style={{ opacity: 0.7, fontSize: 13 }}>La cola está vacía. ¡Pulsa 🎵 Elegir para cantar!</p>}
          {queue.map((e, i) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <span style={{ width: 26, textAlign: 'center', fontWeight: 900, color: current?.id === e.id ? KARAOKE_ACCENT : 'rgba(255,255,255,0.6)' }}>{current?.id === e.id ? '🎤' : i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontWeight: 800, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.song.title}</p>
                <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>{e.userId === user?.id ? 'Tú' : e.name}</p>
              </div>
              {(e.userId === user?.id || isHost) && current?.id !== e.id && (
                <button onClick={() => unqueue(e.id)} style={pillBtn('rgba(239,68,68,0.8)')}>Quitar</button>
              )}
            </div>
          ))}
        </Sheet>
      )}

      {/* ¿Auriculares? */}
      {askHeadphones && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'rgba(5,8,25,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ width: '100%', maxWidth: 360, background: 'linear-gradient(160deg, #3D5A80, #4E7D96)', borderRadius: 22, padding: '24px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 44 }}>🎧</div>
            <p style={{ margin: '6px 0', fontSize: 18, fontWeight: 900 }}>Se recomienda usar auriculares</p>
            <p style={{ margin: '0 0 16px', fontSize: 13, opacity: 0.85, lineHeight: 1.5 }}>Así te oirás cantando y el público te oirá con la música limpia y sin eco. Se activará tu cámara para que te vean en directo.</p>
            <button onClick={() => startSinging(true)} style={{ ...bigBtn, marginBottom: 10 }}>Tengo auriculares</button>
            <button onClick={() => startSinging(false)} style={{ ...bigBtn, background: 'rgba(255,255,255,0.15)' }}>Cantar sin auriculares</button>
          </div>
        </div>
      )}

      {needsTap && (
        <button onClick={() => { audioBoxRef.current?.querySelectorAll('audio').forEach(a => a.play().catch(() => {})); setNeedsTap(false); }}
          style={{ position: 'absolute', top: '45%', left: '50%', transform: 'translateX(-50%)', zIndex: 15, ...pillBtn('white', '#111'), padding: '12px 20px', fontSize: 14 }}>
          🔊 Toca para escuchar
        </button>
      )}

      {toast && <div style={{ position: 'absolute', top: 'calc(max(env(safe-area-inset-top, 12px), 12px) + 58px)', left: '50%', transform: 'translateX(-50%)', zIndex: 30, background: 'rgba(17,24,39,0.92)', padding: '10px 16px', borderRadius: 20, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>{toast}</div>}

      <style>{`
        @keyframes kPulse { 0% { transform: scale(1); opacity: 0.9 } 100% { transform: scale(1.35); opacity: 0 } }
        @keyframes kHeart { 0% { transform: translateY(0) scale(0.6); opacity: 0 } 10% { opacity: 1 } 100% { transform: translateY(-240px) scale(1); opacity: 0 } }
      `}</style>
    </div>
  );
}

/**
 * Audio multimedia normal: con auriculares sale por ellos y si no, por el altavoz.
 * (APK antiguos sin setMediaMode: forzar el altavoz como antes)
 */
function mediaAudio() {
  if (window.OldFaceAudio?.setMediaMode) window.OldFaceAudio.setMediaMode();
  else window.OldFaceAudio?.enableSpeaker();
}

function BgVideo({ stream, mirror }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    el.play().catch(() => {});
  }, [stream]);
  return (
    <video ref={ref} autoPlay playsInline muted
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0, transform: mirror ? 'scaleX(-1)' : 'none' }} />
  );
}

function Sheet({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 15, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxHeight: '75vh', overflowY: 'auto', background: '#161c3a', borderRadius: '22px 22px 0 0', padding: '18px 14px calc(env(safe-area-inset-bottom, 0px) + 20px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <p style={{ flex: 1, margin: 0, fontWeight: 900, fontSize: 16 }}>{title}</p>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'white', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function pillBtn(bg, color = 'white') {
  return { background: bg, color, border: 'none', borderRadius: 18, padding: '8px 14px', fontWeight: 800, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 };
}

const bigBtn = {
  width: '100%', padding: '14px', border: 'none', borderRadius: 24, cursor: 'pointer', color: 'white',
  background: `linear-gradient(135deg, #4E7D96, ${KARAOKE_ACCENT})`, fontSize: 15, fontWeight: 900,
};
