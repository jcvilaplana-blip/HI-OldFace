/**
 * DirectoLivePage — Directo en vivo con el servidor RTC propio (mediasoup), estilo Instagram / TikTok.
 *
 *  · Anfitrión (creador del directo): emite cámara + micro, gestiona solicitudes e invitados, finaliza.
 *  · Espectadores: ven y oyen, comentan en el chat, envían likes (corazones), comparten,
 *    y pueden pedir subir al directo. Si el anfitrión acepta, emiten como invitados (pantalla dividida).
 *
 * Servidor: eventos live:* y salas de medios `live_<directoId>` (rtc-server/server.js).
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { RtcCall } from '../utils/rtcCall';
import { ensureRtcConnected, rtcRequest, onRtc } from '../utils/rtcClient';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const RED     = '#ef4444';
const HEART_COLORS = ['#ef4444', '#ec4899', '#f97316', '#eab308', '#a855f7', '#3b82f6'];

function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${m}:${sec}` : `${m}:${sec}`;
}

export default function DirectoLivePage() {
  const { directoId } = useParams();
  const navigate      = useNavigate();
  const { user }      = useAuthStore();

  const callRef     = useRef(null);
  const cleanedRef  = useRef(false);
  const chatEndRef  = useRef(null);
  const unsubsRef   = useRef([]);

  const [directo,   setDirecto]   = useState(null);
  const [status,    setStatus]    = useState('loading'); // loading | live | notStarted | ended | error
  const [errMsg,    setErrMsg]    = useState('');
  const [hostAway,  setHostAway]  = useState(false);
  const [startedAt, setStartedAt] = useState(null);
  const [now,       setNow]       = useState(Date.now());

  const [chat,      setChat]      = useState([]);
  const [likes,     setLikes]     = useState(0);
  const [viewers,   setViewers]   = useState(0);
  const [guests,    setGuests]    = useState([]);       // [{ userId, name }]
  const [streams,   setStreams]   = useState({});       // userId → { stream, name, videoOff }
  const [localStream, setLocalStream] = useState(null);
  const [hearts,    setHearts]    = useState([]);       // [{ id, x, color }]
  const [text,      setText]      = useState('');

  const [requests,  setRequests]  = useState([]);       // anfitrión: [{ userId, name }]
  const [showRequests, setShowRequests] = useState(false);
  const [requested, setRequested] = useState(false);    // espectador: solicitud enviada
  const [approved,  setApproved]  = useState(false);    // espectador: aceptado, puede subir
  const [onStage,   setOnStage]   = useState(false);    // invitado emitiendo
  const [micOn,     setMicOn]     = useState(true);
  const [camOn,     setCamOn]     = useState(true);
  const [needsTap,  setNeedsTap]  = useState(false);    // el navegador bloqueó el audio automático
  const [toast,     setToast]     = useState('');

  const isHost = !!directo && directo.creatorId === user?.id;
  const hostId = directo?.creatorId;

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2800); };

  // ── Arranque ───────────────────────────────────────────────────────────────
  useEffect(() => {
    start();
    return () => cleanup();
  }, []); // eslint-disable-line

  useEffect(() => {
    if (status !== 'live') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ block: 'end' }); }, [chat]);

  const spawnHearts = useCallback((n = 1) => {
    const items = Array.from({ length: Math.min(n, 5) }, () => ({
      id: `${Date.now()}_${Math.random()}`,
      x: Math.round(Math.random() * 40) - 20,
      color: HEART_COLORS[Math.floor(Math.random() * HEART_COLORS.length)],
    }));
    setHearts(h => [...h.slice(-30), ...items]);
    setTimeout(() => setHearts(h => h.filter(x => !items.includes(x))), 2600);
  }, []);

  const applyLiveState = (live) => {
    setChat(live.chat || []);
    setLikes(live.likes || 0);
    setViewers(live.viewers || 0);
    setGuests(live.guests || []);
    setStartedAt(live.startedAt || Date.now());
  };

  const start = async () => {
    try {
      setStatus('loading');
      const res = await fetch(`${BACKEND}/directos/${encodeURIComponent(directoId)}`);
      if (!res.ok) throw new Error('Directo no encontrado');
      const d = await res.json();
      setDirecto(d);
      const amHost = d.creatorId === user?.id;

      await ensureRtcConnected(user);
      subscribe(amHost);

      let live;
      if (amHost) {
        if (d.status !== 'live') {
          await fetch(`${BACKEND}/directos/${encodeURIComponent(directoId)}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'live' }),
          });
        }
        ({ live } = await rtcRequest('live:start', { liveId: directoId }));
      } else {
        try {
          ({ live } = await rtcRequest('live:join', { liveId: directoId }));
        } catch {
          setStatus(d.status === 'ended' ? 'ended' : 'notStarted');
          return;
        }
      }
      applyLiveState(live);

      const call = new RtcCall({
        roomId: `live_${directoId}`,
        video: true,
        publish: amHost,
        onPeerStream: (id, stream, { name }) =>
          setStreams(s => ({ ...s, [id]: { stream, name, videoOff: s[id]?.videoOff || false } })),
        onPeerLeft: (id) => setStreams(s => { const n = { ...s }; delete n[id]; return n; }),
        onPeerMedia: (id, { kind, paused }) => {
          if (kind === 'video') setStreams(s => s[id] ? { ...s, [id]: { ...s[id], videoOff: paused } } : s);
        },
      });
      callRef.current = call;
      await call.join();
      if (amHost) setLocalStream(call.localStream);
      window.OldFaceAudio?.enableSpeaker();
      setStatus('live');
    } catch (err) {
      console.error('[Directo] error:', err);
      setErrMsg(err?.message || 'Error desconocido');
      setStatus('error');
    }
  };

  const subscribe = (amHost) => {
    unsubsRef.current.forEach(u => u());
    const mine = (p) => p?.liveId === directoId;
    unsubsRef.current = [
      onRtc('live:chat',    (p) => { if (mine(p)) setChat(c => [...c.slice(-99), p.msg]); }),
      onRtc('live:like',    (p) => { if (mine(p)) { setLikes(p.likes); if (p.from !== user?.id) spawnHearts(p.n || 1); } }),
      onRtc('live:viewers', (p) => { if (mine(p)) setViewers(p.viewers); }),
      onRtc('live:guests',  (p) => { if (mine(p)) setGuests(p.guests || []); }),
      onRtc('live:ended',   (p) => { if (mine(p)) { cleanup(); setStatus('ended'); } }),
      onRtc('live:hostAway', (p) => { if (mine(p)) setHostAway(true); }),
      onRtc('live:hostBack', (p) => { if (mine(p)) setHostAway(false); }),
      onRtc('live:approved', (p) => { if (mine(p)) { setApproved(true); setRequested(false); showToast('¡El anfitrión te ha aceptado!'); } }),
      onRtc('live:rejected', (p) => { if (mine(p)) { setRequested(false); showToast('El anfitrión no ha aceptado tu solicitud'); } }),
      onRtc('live:removed',  (p) => { if (mine(p)) leaveStage(true); }),
      ...(amHost ? [onRtc('live:joinRequest', (p) => {
        if (!mine(p)) return;
        setRequests(r => r.some(x => x.userId === p.userId) ? r : [...r, { userId: p.userId, name: p.name }]);
        showToast(`${p.name} quiere unirse al directo`);
      })] : []),
    ];
  };

  const cleanup = () => {
    if (cleanedRef.current) return;
    cleanedRef.current = true;
    unsubsRef.current.forEach(u => u());
    unsubsRef.current = [];
    rtcRequest('live:leave', { liveId: directoId }).catch(() => {});
    callRef.current?.leave();
    callRef.current = null;
    window.OldFaceAudio?.setSpeaker();
  };

  // ── Acciones ──────────────────────────────────────────────────────────────
  const sendChat = async (e) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    try { await rtcRequest('live:chat', { liveId: directoId, text: t }); }
    catch (err) { showToast(err.message); }
  };

  const like = () => {
    spawnHearts(1);
    setLikes(l => l + 1);
    rtcRequest('live:like', { liveId: directoId, count: 1 }).then(r => setLikes(r.likes)).catch(() => {});
  };

  const share = async () => {
    const url = `https://oldface.app/directo/${directoId}/live`;
    const title = directo?.title || 'Directo en OldFace';
    const msg = `🔴 ${directo?.creatorName || 'Alguien'} está en directo en OldFace: ${title}`;
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (Capacitor.isNativePlatform()) {
        const { Share } = await import('@capacitor/share');
        await Share.share({ title, text: msg, url, dialogTitle: 'Compartir directo' });
        return;
      }
    } catch { /* web */ }
    try {
      if (navigator.share) { await navigator.share({ title, text: msg, url }); return; }
      await navigator.clipboard.writeText(`${msg}\n${url}`);
      showToast('Enlace copiado');
    } catch { /* cancelado */ }
  };

  const requestJoin = async () => {
    try { await rtcRequest('live:requestJoin', { liveId: directoId }); setRequested(true); showToast('Solicitud enviada al anfitrión'); }
    catch (err) { showToast(err.message); }
  };

  const goOnStage = async () => {
    try {
      await rtcRequest('live:goOnStage', { liveId: directoId });
      const s = await callRef.current.publish({ video: true });
      setLocalStream(s);
      setOnStage(true);
      setApproved(false);
      setMicOn(true); setCamOn(true);
    } catch (err) { showToast(err.message); }
  };

  const leaveStage = async (removedByHost = false) => {
    await callRef.current?.unpublish();
    setLocalStream(null);
    setOnStage(false);
    setApproved(false);
    if (removedByHost) showToast('Has salido del escenario');
    else rtcRequest('live:removeGuest', { liveId: directoId }).catch(() => {});
  };

  const approve = async (r) => {
    try { await rtcRequest('live:approveGuest', { liveId: directoId, guestId: r.userId }); }
    catch (err) { showToast(err.message); }
    setRequests(rs => rs.filter(x => x.userId !== r.userId));
  };
  const reject = (r) => {
    rtcRequest('live:rejectGuest', { liveId: directoId, guestId: r.userId }).catch(() => {});
    setRequests(rs => rs.filter(x => x.userId !== r.userId));
  };
  const removeGuest = (g) => rtcRequest('live:removeGuest', { liveId: directoId, guestId: g.userId }).catch(() => {});

  const toggleMic = () => { const n = !micOn; setMicOn(n); callRef.current?.setMic(n); };
  const toggleCam = () => { const n = !camOn; setCamOn(n); callRef.current?.setCamera(n); };
  const flipCam   = async () => {
    try { setLocalStream(await callRef.current.switchCamera()); } catch { showToast('No se pudo cambiar de cámara'); }
  };

  const endLive = async () => {
    try { await rtcRequest('live:end', { liveId: directoId }); } catch {}
    try {
      await fetch(`${BACKEND}/directos/${encodeURIComponent(directoId)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ended' }),
      });
    } catch {}
    cleanup();
    navigate(-1);
  };

  const close = () => { cleanup(); navigate(-1); };

  // ── Escenario: anfitrión + invitados ──────────────────────────────────────
  const stage = [];
  if (hostId) {
    stage.push(isHost
      ? { id: hostId, name: 'Tú', stream: localStream, local: true, videoOff: !camOn }
      : { id: hostId, name: directo?.creatorName || 'Anfitrión', ...(streams[hostId] || {}) });
  }
  for (const g of guests) {
    if (g.userId === hostId) continue;
    if (g.userId === user?.id) {
      if (onStage) stage.push({ id: g.userId, name: 'Tú', stream: localStream, local: true, videoOff: !camOn });
    } else {
      stage.push({ id: g.userId, name: g.name, ...(streams[g.userId] || {}) });
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (status !== 'live') {
    return (
      <FullMessage
        status={status} errMsg={errMsg} isHost={isHost} directo={directo}
        onRetry={() => { cleanedRef.current = false; start(); }} onBack={close}
      />
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 50, overflow: 'hidden', color: 'white' }}>

      {/* ── Escenario ── */}
      <div style={{
        position: 'absolute', inset: 0, display: 'grid', gap: 2,
        gridTemplateColumns: stage.length > 2 ? '1fr 1fr' : '1fr',
        gridTemplateRows: stage.length >= 2 ? '1fr 1fr' : '1fr',
      }}>
        {stage.map(p => (
          <StageTile key={p.id} {...p} showName={stage.length > 1}
            onRemove={isHost && p.id !== hostId ? () => removeGuest({ userId: p.id }) : null}
            onAutoplayBlocked={() => setNeedsTap(true)} />
        ))}
      </div>

      {/* Degradados para legibilidad */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 140, background: 'linear-gradient(rgba(0,0,0,0.55), transparent)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '45%', background: 'linear-gradient(transparent, rgba(0,0,0,0.7))', pointerEvents: 'none' }} />

      {/* ── Cabecera ── */}
      <div style={{ position: 'absolute', top: 'max(env(safe-area-inset-top, 12px), 12px)', left: 12, right: 12, display: 'flex', alignItems: 'center', gap: 8, zIndex: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,0.35)', borderRadius: 30, padding: '4px 12px 4px 4px', minWidth: 0 }}>
          <div style={{ width: 34, height: 34, borderRadius: '50%', overflow: 'hidden', background: RED, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, flexShrink: 0, border: '2px solid ' + RED }}>
            {directo?.creatorAvatar
              ? <img src={directo.creatorAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : (directo?.creatorName || '?')[0]?.toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>
              {isHost ? 'Tu directo' : directo?.creatorName || 'Directo'}
            </p>
            <p style={{ margin: 0, fontSize: 10, opacity: 0.8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>{directo?.title}</p>
          </div>
        </div>
        <span style={{ background: RED, fontSize: 11, fontWeight: 900, padding: '4px 9px', borderRadius: 6, letterSpacing: 0.5 }}>EN VIVO</span>
        <span style={{ background: 'rgba(0,0,0,0.4)', fontSize: 11, fontWeight: 700, padding: '4px 8px', borderRadius: 6, fontFamily: 'monospace' }}>{fmtElapsed(now - (startedAt || now))}</span>
        <div style={{ flex: 1 }} />
        <span style={{ background: 'rgba(0,0,0,0.4)', fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 4 }}>
          <EyeIcon /> {viewers}
        </span>
        <button onClick={close} aria-label="Cerrar" style={iconBtn(36)}>✕</button>
      </div>

      {hostAway && !isHost && (
        <div style={{ position: 'absolute', top: '40%', left: 0, right: 0, textAlign: 'center', zIndex: 4 }}>
          <span style={{ background: 'rgba(0,0,0,0.6)', padding: '10px 16px', borderRadius: 14, fontSize: 13, fontWeight: 700 }}>
            El anfitrión se ha desconectado un momento…
          </span>
        </div>
      )}

      {needsTap && (
        <button onClick={() => { document.querySelectorAll('video[data-live]').forEach(v => { if (!v.dataset.local) { v.muted = false; v.play().catch(() => {}); } }); setNeedsTap(false); }}
          style={{ position: 'absolute', top: '45%', left: '50%', transform: 'translateX(-50%)', zIndex: 6, background: 'white', color: '#111', border: 'none', borderRadius: 24, padding: '12px 20px', fontWeight: 800, fontSize: 14 }}>
          🔊 Toca para activar el sonido
        </button>
      )}

      {/* ── Corazones flotantes ── */}
      <div style={{ position: 'absolute', right: 18, bottom: 150, width: 60, height: 320, pointerEvents: 'none', zIndex: 6 }}>
        {hearts.map(h => (
          <span key={h.id} style={{
            position: 'absolute', bottom: 0, left: 18 + h.x, fontSize: 28, color: h.color,
            animation: 'liveHeart 2.5s ease-out forwards',
          }}>❤</span>
        ))}
      </div>

      {/* ── Chat del directo ── */}
      <div style={{
        position: 'absolute', left: 12, right: 84, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 74px)',
        maxHeight: '34vh', overflowY: 'auto', zIndex: 5, scrollbarWidth: 'none',
        WebkitMaskImage: 'linear-gradient(transparent, black 22%)', maskImage: 'linear-gradient(transparent, black 22%)',
      }}>
        {chat.map(m => (
          <div key={m.id} style={{ margin: '0 0 6px', fontSize: 13, lineHeight: 1.35, textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
            <span style={{ fontWeight: 800, color: m.userId === hostId ? '#fca5a5' : '#e0e7ff', marginRight: 6 }}>
              {m.userId === user?.id ? 'Tú' : m.name}
            </span>
            <span>{m.text}</span>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* ── Columna de acciones (derecha) ── */}
      <div style={{ position: 'absolute', right: 10, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, zIndex: 7 }}>
        {isHost && (
          <SideBtn label="Solicitudes" badge={requests.length} onPress={() => setShowRequests(true)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
          </SideBtn>
        )}
        {(isHost || onStage) && (
          <>
            <SideBtn label="Girar" onPress={flipCam}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7h-3l-2-3H9L7 7H4a2 2 0 00-2 2v9a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/><path d="M9 13a3 3 0 015-2.2M15 13a3 3 0 01-5 2.2"/></svg>
            </SideBtn>
            <SideBtn label={micOn ? 'Micro' : 'Sin micro'} active={!micOn} onPress={toggleMic}>
              {micOn
                ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/></svg>
                : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23M12 19v4M8 23h8"/></svg>}
            </SideBtn>
            <SideBtn label={camOn ? 'Cámara' : 'Sin cámara'} active={!camOn} onPress={toggleCam}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>{!camOn && <line x1="1" y1="1" x2="23" y2="23"/>}</svg>
            </SideBtn>
          </>
        )}
        {!isHost && !onStage && !approved && (
          <SideBtn label={requested ? 'Enviada' : 'Unirse'} onPress={requested ? undefined : requestJoin} active={requested}>
            <span style={{ fontSize: 22 }}>🙋</span>
          </SideBtn>
        )}
        <SideBtn label="Compartir" onPress={share}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
        </SideBtn>
        <SideBtn label={likes > 999 ? `${(likes / 1000).toFixed(1)}K` : String(likes)} onPress={like} big>
          <span style={{ fontSize: 26, color: RED, lineHeight: 1 }}>❤</span>
        </SideBtn>
      </div>

      {/* ── Barra inferior: comentar + acción principal ── */}
      <form onSubmit={sendChat} style={{
        position: 'absolute', left: 12, right: 12, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 14px)',
        display: 'flex', gap: 8, alignItems: 'center', zIndex: 7,
      }}>
        <input
          value={text} onChange={e => setText(e.target.value)} maxLength={200}
          placeholder="Comenta…" enterKeyHint="send"
          style={{ flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)', color: 'white', borderRadius: 24, padding: '11px 16px', fontSize: 14, outline: 'none' }}
        />
        {text.trim() && (
          <button type="submit" style={{ ...iconBtn(42), background: RED }} aria-label="Enviar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
          </button>
        )}
        {!text.trim() && isHost && (
          <button type="button" onClick={endLive} style={{ background: RED, color: 'white', border: 'none', borderRadius: 22, padding: '11px 16px', fontWeight: 900, fontSize: 13, whiteSpace: 'nowrap' }}>
            Finalizar
          </button>
        )}
        {!text.trim() && approved && !onStage && (
          <button type="button" onClick={goOnStage} style={{ background: '#22c55e', color: 'white', border: 'none', borderRadius: 22, padding: '11px 16px', fontWeight: 900, fontSize: 13, whiteSpace: 'nowrap' }}>
            Subir al directo
          </button>
        )}
        {!text.trim() && onStage && (
          <button type="button" onClick={() => leaveStage(false)} style={{ background: 'rgba(255,255,255,0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.35)', borderRadius: 22, padding: '11px 16px', fontWeight: 800, fontSize: 13, whiteSpace: 'nowrap' }}>
            Bajar
          </button>
        )}
      </form>

      {/* ── Solicitudes (anfitrión) ── */}
      {showRequests && (
        <div onClick={() => setShowRequests(false)} style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', background: '#111827', borderRadius: '22px 22px 0 0', padding: '18px 16px calc(env(safe-area-inset-bottom, 0px) + 20px)', maxHeight: '60vh', overflowY: 'auto' }}>
            <p style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 900 }}>Solicitudes para unirse</p>
            {requests.length === 0 && <p style={{ opacity: 0.6, fontSize: 13 }}>Nadie ha pedido unirse todavía. Los espectadores pueden pulsar 🙋.</p>}
            {requests.map(r => (
              <div key={r.userId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#000080', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 }}>{r.name?.[0]?.toUpperCase()}</div>
                <p style={{ flex: 1, margin: 0, fontWeight: 700 }}>{r.name}</p>
                <button onClick={() => reject(r)} style={pill('rgba(255,255,255,0.12)')}>Rechazar</button>
                <button onClick={() => approve(r)} style={pill('#22c55e')}>Aceptar</button>
              </div>
            ))}
            {guests.length > 0 && (
              <>
                <p style={{ margin: '16px 0 8px', fontSize: 13, fontWeight: 800, opacity: 0.8 }}>En el directo contigo</p>
                {guests.map(g => (
                  <div key={g.userId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
                    <p style={{ flex: 1, margin: 0 }}>{g.name}</p>
                    <button onClick={() => removeGuest(g)} style={pill(RED)}>Quitar</button>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'absolute', top: 'calc(max(env(safe-area-inset-top, 12px), 12px) + 56px)', left: '50%', transform: 'translateX(-50%)', zIndex: 30, background: 'rgba(17,24,39,0.92)', padding: '10px 16px', borderRadius: 20, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
          {toast}
        </div>
      )}

      <style>{`
        @keyframes liveHeart {
          0%   { transform: translateY(0) scale(0.6); opacity: 0; }
          10%  { opacity: 1; transform: translateY(-20px) scale(1.1); }
          100% { transform: translateY(-300px) scale(0.9); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ── Componentes ───────────────────────────────────────────────────────────────
function StageTile({ stream, name, local, videoOff, showName, onRemove, onAutoplayBlocked }) {
  const ref = useRef(null);
  useEffect(() => {
    const v = ref.current;
    if (!v || !stream || v.srcObject === stream) return;
    v.srcObject = stream;
    v.play().catch(() => {
      // Autoplay con sonido bloqueado (navegador): reproducir silenciado y pedir un toque
      if (!local) { v.muted = true; v.play().catch(() => {}); onAutoplayBlocked?.(); }
    });
  }, [stream]); // eslint-disable-line
  return (
    <div style={{ position: 'relative', background: '#111827', overflow: 'hidden', minHeight: 0 }}>
      {stream && (
        <video ref={ref} data-live data-local={local ? '1' : undefined} autoPlay playsInline muted={!!local}
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: local ? 'scaleX(-1)' : 'none', visibility: videoOff ? 'hidden' : 'visible' }} />
      )}
      {(!stream || videoOff) && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <div style={{ width: 96, height: 96, borderRadius: '50%', background: 'rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, fontWeight: 900 }}>
            {name?.[0]?.toUpperCase() || '?'}
          </div>
          {!stream && <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>Conectando…</p>}
        </div>
      )}
      {showName && (
        <span style={{ position: 'absolute', left: 10, bottom: 10, background: 'rgba(0,0,0,0.5)', padding: '3px 9px', borderRadius: 10, fontSize: 12, fontWeight: 700 }}>{name}</span>
      )}
      {onRemove && (
        <button onClick={onRemove} style={{ position: 'absolute', right: 10, top: 10, ...pill('rgba(239,68,68,0.85)') }}>Quitar</button>
      )}
    </div>
  );
}

function SideBtn({ children, label, onPress, badge, active, big }) {
  return (
    <button onClick={onPress} style={{ background: 'none', border: 'none', color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: onPress ? 'pointer' : 'default', padding: 0, position: 'relative' }}>
      <span style={{
        width: big ? 50 : 44, height: big ? 50 : 44, borderRadius: '50%',
        background: active ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{children}</span>
      <span style={{ fontSize: 11, fontWeight: 700, textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>{label}</span>
      {badge > 0 && (
        <span style={{ position: 'absolute', top: -4, right: -4, background: RED, borderRadius: 10, minWidth: 18, height: 18, fontSize: 11, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>{badge}</span>
      )}
    </button>
  );
}

function FullMessage({ status, errMsg, isHost, directo, onRetry, onBack }) {
  const texts = {
    loading:    { title: isHost ? 'Iniciando tu directo…' : 'Entrando al directo…', sub: '' },
    notStarted: { title: 'El directo aún no ha empezado', sub: directo?.scheduledAt ? `Programado: ${new Date(directo.scheduledAt).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Vuelve en un rato' },
    ended:      { title: 'El directo ha terminado', sub: 'Gracias por acompañar' },
    error:      { title: 'No se pudo conectar al directo', sub: errMsg },
  }[status] || { title: '', sub: '' };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'linear-gradient(to bottom, #1e1035, #0f172a)', color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32, textAlign: 'center' }}>
      <div style={{ position: 'relative', width: 80, height: 80 }}>
        {status === 'loading' && <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(239,68,68,0.3)', animation: 'liveRipple 1.5s ease-in-out infinite' }} />}
        <div style={{ position: 'relative', width: 80, height: 80, borderRadius: '50%', background: status === 'error' ? '#7f1d1d' : RED, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/><path d="M6.343 6.343a8 8 0 000 11.314M17.657 6.343a8 8 0 010 11.314M3.515 3.515a13 13 0 000 16.97M20.485 3.515a13 13 0 010 16.97"/>
          </svg>
        </div>
      </div>
      <p style={{ fontSize: 19, fontWeight: 900, margin: 0 }}>{texts.title}</p>
      {texts.sub && <p style={{ fontSize: 13, opacity: 0.65, margin: 0 }}>{texts.sub}</p>}
      {status === 'error' && <button onClick={onRetry} style={{ ...pill(RED), padding: '12px 26px', fontSize: 14 }}>Reintentar</button>}
      <button onClick={onBack} style={{ ...pill('rgba(255,255,255,0.12)'), padding: '10px 24px', fontSize: 13 }}>Volver</button>
      <style>{'@keyframes liveRipple { 0%,100% { transform:scale(1); opacity:0.5 } 50% { transform:scale(1.6); opacity:0 } }'}</style>
    </div>
  );
}

function EyeIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
}

function iconBtn(size) {
  return { width: size, height: size, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.4)', color: 'white', fontSize: 16, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 };
}

function pill(bg) {
  return { background: bg, color: 'white', border: 'none', borderRadius: 18, padding: '7px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer' };
}
