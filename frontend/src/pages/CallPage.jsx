/**
 * CallPage — Llamada de voz con el servidor RTC propio (mediasoup), 1:1 o en grupo.
 * UI: estilo WhatsApp (avatar + píldora de controles). El audio de cada participante
 * se reproduce en un <audio> oculto; por defecto suena por el auricular del teléfono.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore }  from '../store/authStore';
import { useCallStore }  from '../store/callStore';
import { RtcCall }       from '../utils/rtcCall';
import { ensureRtcConnected } from '../utils/rtcClient';
import { useChatStore }  from '../store/chatStore';
import { playRingSound } from '../utils/sounds';
import { tr } from '../i18n';
import { useUserAvatar } from '../utils/userAvatar';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

export default function CallPage() {
  const { userId }  = useParams();
  const { state }   = useLocation();
  const navigate    = useNavigate();
  const { user }    = useAuthStore();
  const { chats }   = useChatStore();
  const {
    callRejected, clearCallRejected,
    callEnded,    clearCallEnded,
    sendCallSignal,
  } = useCallStore();

  // Avatar del contacto desde el store
  const contactChat   = chats.find(c => c.participants?.includes(userId));
  const fetchedAvatar = useUserAvatar(userId);   // si no hay chat con él (p. ej. quien me llama), se pide al servidor
  const contactAvatar = state?.chat?.avatar || contactChat?.avatar || fetchedAvatar || null;

  const timerRef            = useRef(null);
  const cancelledRef        = useRef(false);
  const cleanedRef          = useRef(false);
  const loggedRef           = useRef(false);
  const earpieceTimer       = useRef([]);
  const keepAliveRef        = useRef(null); // AudioContext silencioso → evita throttling en background
  const micOnRef            = useRef(true); // ref síncrona del estado del mic
  const speakerOnRef        = useRef(false); // ref síncrona del altavoz (los timers de auricular la respetan)

  const [status,     setStatus]    = useState('calling');
  const [duration,   setDuration]  = useState(0);
  const [micOn,      setMicOn]     = useState(true);
  const [speakerOn,  setSpeakerOn] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteSent, setInviteSent] = useState({});
  const [animKey,    setAnimKey]   = useState(0); // fuerza remount de animaciones al volver de background
  // Pasar a videollamada sin colgar: mi cámara y el vídeo de los demás
  const [camOn,       setCamOn]       = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [facing,      setFacing]      = useState('user');
  const [remoteVids,  setRemoteVids]  = useState({});   // peerId → { stream, off }
  const [camBusy,     setCamBusy]     = useState(false);
  const [camError,    setCamError]    = useState(false);

  const isIncoming = state?.isIncoming || false;
  const calleeName = state?.chat?.name || userId;
  const roomId     = state?.roomId || [user?.id, userId].sort().join('_voice_');

  const rtcCallRef     = useRef(null);        // RtcCall (servidor propio)
  const audioBoxRef    = useRef(null);        // contenedor de <audio> de los participantes
  const activeRef      = useRef(false);
  const durationRef    = useRef(0);

  const inviteContacts = chats
    .filter(c => {
      const otherId = c.participants?.find(p => p !== user?.id);
      return otherId && otherId !== userId;
    })
    .map(c => ({
      id:   c.participants?.find(p => p !== user?.id),
      name: c.name,
    }));

  // ── Señales de rechazo / fin ──────────────────────────────────────────────
  useEffect(() => {
    if (isIncoming || !callRejected) return;
    clearCallRejected(); doCleanup(); navigate(-1);
  }, [callRejected, isIncoming]);

  useEffect(() => {
    if (!callEnded) return;
    clearCallEnded(); recordCallLog(duration); doCleanup(); navigate(-1);
  }, [callEnded]);

  // ── Tono de llamada saliente ──────────────────────────────────────────────
  useEffect(() => {
    if (status !== 'calling' || isIncoming) return;
    playRingSound();
    const interval = setInterval(playRingSound, 3000);
    return () => clearInterval(interval);
  }, [status, isIncoming]);

  useEffect(() => { startCall(); return () => doCleanup(); }, []); // eslint-disable-line

  // ── Recuperación al volver al primer plano ────────────────────────────────
  useEffect(() => {
    const onVisible = async () => {
      if (document.hidden) return;
      // Reiniciar animaciones CSS que se congelen en background
      setAnimKey(k => k + 1);
      if (status !== 'active') return;
      if (speakerOnRef.current) window.OldFaceAudio?.enableSpeaker();
      else window.OldFaceAudio?.setEarpiece();
      // Si Android cortó el micro o la cámara al minimizar, abrirlos otra vez
      const call = rtcCallRef.current;
      if (call) { const s = await call.recoverMedia(); if (s) setLocalStream(s); }
      // Reanudar la reproducción si el WebView la pausó
      audioBoxRef.current?.querySelectorAll('audio').forEach(a => a.play().catch(() => {}));
      document.querySelectorAll('video[data-vc]').forEach(v => v.play().catch(() => {}));
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [status]);

  // ── Señales al otro participante ──────────────────────────────────────────
  const sendInviteSignal = () => {
    const callerName = user?.name || user?.id || 'Usuario';
    return sendCallSignal(userId, 'call_invite', { callType: 'voice', callerName, roomId });
  };
  const sendEndSignal = () => sendCallSignal(userId, 'call_end');

  // ── Registro ──────────────────────────────────────────────────────────────
  const recordCallLog = useCallback(async (callDuration) => {
    if (loggedRef.current) return;
    loggedRef.current = true;
    try {
      await fetch(`${BACKEND}/call-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user?.id, contactId: userId, contactName: calleeName,
          type: 'voice', duration: callDuration,
          direction: isIncoming ? 'incoming' : 'outgoing', timestamp: Date.now(),
        }),
      });
    } catch { /* silencioso */ }
  }, [user, userId, calleeName, isIncoming]);

  // ── Llamada conectada (llega el audio del otro participante) ──────────────
  const onCallActive = () => {
    if (activeRef.current) return;
    activeRef.current = true;
    setStatus('active');
    timerRef.current = setInterval(() => { durationRef.current += 1; setDuration(d => d + 1); }, 1000);
    window.OldFaceAudio?.setCallActive(true);
    // Tono silencioso → mantiene el AudioContext activo → evita que Android
    // throttlee el JS del WebView a los ~3s cuando la app está en background
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.001;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      keepAliveRef.current = { ctx, osc };
    } catch {}

    // ── Auricular: retardos escalonados para capturar una init tardía del audio ──
    earpieceTimer.current.forEach(clearTimeout);
    earpieceTimer.current = [0, 300, 700, 1400, 2500, 4000, 6000, 9000].map(ms =>
      setTimeout(() => { if (!speakerOnRef.current) window.OldFaceAudio?.setEarpiece(); }, ms)
    );
  };

  // ── Audio de cada participante en un <audio> oculto ───────────────────────
  const attachAudio = (peerId, stream) => {
    const box = audioBoxRef.current;
    if (!box) return;
    let el = box.querySelector(`audio[data-peer="${peerId}"]`);
    if (!el) {
      el = document.createElement('audio');
      el.dataset.peer = peerId;
      el.autoplay = true;
      el.setAttribute('playsinline', '');
      box.appendChild(el);
    }
    el.srcObject = stream;
    el.play().catch(() => {});
  };

  const startOwnCall = async () => {
    await ensureRtcConnected(user);
    if (!isIncoming) await sendInviteSignal();
    window.OldFaceAudio?.setCallActive(true);
    window.OldFaceAudio?.setEarpiece();
    rtcCallRef.current?.leave();
    const call = new RtcCall({
      roomId,
      video: false,
      onPeerStream: (peerId, stream) => {
        attachAudio(peerId, stream);
        // El otro ha encendido la cámara → se ve su vídeo
        if (stream.getVideoTracks().length) {
          setRemoteVids(prev => ({ ...prev, [peerId]: { stream, off: prev[peerId]?.off || false } }));
        }
        onCallActive();
      },
      onPeerMedia: (peerId, { kind, paused }) => {
        if (kind !== 'video') return;
        setRemoteVids(prev => prev[peerId] ? { ...prev, [peerId]: { ...prev[peerId], off: paused } } : prev);
      },
      onPeerLeft: (peerId) => {
        setRemoteVids(prev => { const n = { ...prev }; delete n[peerId]; return n; });
        audioBoxRef.current?.querySelector(`audio[data-peer="${peerId}"]`)?.remove();
        // Sin nadie más en la sala → la llamada ha terminado
        if (call.remoteCount === 0 && activeRef.current && !cancelledRef.current) {
          cancelledRef.current = true;
          recordCallLog(durationRef.current); doCleanup(); navigate(-1);
        }
      },
    });
    rtcCallRef.current = call;
    await call.join();
    // Llamada en curso: el micro sigue funcionando con la app minimizada
    window.OldFaceAudio?.startCallService?.(false, calleeName);
    setLocalStream(call.localStream);
    if (!micOnRef.current) call.setMic(false);
  };

  // ── Flujo principal ───────────────────────────────────────────────────────
  const startCall = async () => {
    try { await startOwnCall(); }
    catch (err) { console.error('[CallPage] error:', err?.message); setStatus('error'); }
  };

  // ── Cleanup ───────────────────────────────────────────────────────────────
  const doCleanup = useCallback(() => {
    if (cleanedRef.current) return;
    cleanedRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    earpieceTimer.current.forEach(clearTimeout);
    earpieceTimer.current = [];
    try { keepAliveRef.current?.osc?.stop(); keepAliveRef.current?.ctx?.close(); } catch {}
    keepAliveRef.current = null;
    window.OldFaceAudio?.setSpeaker();
    window.OldFaceAudio?.setCallActive(false);
    rtcCallRef.current?.leave();
    rtcCallRef.current = null;
    if (audioBoxRef.current) audioBoxRef.current.innerHTML = '';
  }, [user]); // eslint-disable-line

  // ── Colgar ────────────────────────────────────────────────────────────────
  const handleEnd = async () => {
    if (cancelledRef.current) return;
    cancelledRef.current = true;
    await sendEndSignal();
    recordCallLog(duration);
    doCleanup();
    navigate(-1);
  };

  // ── Mic ───────────────────────────────────────────────────────────────────
  const handleMicToggle = () => {
    const next = !micOn;
    micOnRef.current = next;
    setMicOn(next);
    rtcCallRef.current?.setMic(next);
  };

  // ── Invitar a la llamada en curso ─────────────────────────────────────────
  const sendInvite = async (contactId) => {
    setInviteSent(prev => ({ ...prev, [contactId]: 'sending' }));
    try {
      await fetch(`${BACKEND}/call-notification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calleeId:   contactId,
          callerId:   user.id,
          callerName: user.name || user.id,
          callType:   'voice',
          roomId,
        }),
      });
      setInviteSent(prev => ({ ...prev, [contactId]: 'sent' }));
    } catch {
      setInviteSent(prev => ({ ...prev, [contactId]: 'error' }));
    }
  };

  // ── Speaker toggle ────────────────────────────────────────────────────────
  // enableSpeaker: altavoz ON, para el poller · setEarpiece: auricular ON, reinicia el poller
  const handleSpeakerToggle = () => setSpeaker(!speakerOn);

  // ── Pasar a videollamada (encender / apagar mi cámara) ─────────────────────
  const setSpeaker = (on) => {
    speakerOnRef.current = on;
    setSpeakerOn(on);
    if (on) window.OldFaceAudio?.enableSpeaker(); else window.OldFaceAudio?.setEarpiece();
  };

  const handleCamToggle = async () => {
    const call = rtcCallRef.current;
    if (!call || camBusy) return;
    if (camOn) { setCamOn(false); call.setCamera(false); return; }
    setCamBusy(true);
    try {
      const s = await call.enableVideo();
      setLocalStream(s);
      setFacing(call.facingMode);
      setCamOn(true);
      if (!speakerOnRef.current) setSpeaker(true);           // con vídeo, altavoz (como en WhatsApp)
      window.OldFaceAudio?.startCallService?.(true, calleeName); // la cámara también sigue al minimizar
    } catch {
      setCamError(true);
      setTimeout(() => setCamError(false), 3000);
    } finally {
      setCamBusy(false);
    }
  };

  const handleFlip = async () => {
    const call = rtcCallRef.current;
    if (!call || !camOn) return;
    try { setLocalStream(await call.switchCamera()); } catch { setLocalStream(call.localStream); /* sin otra cámara */ }
    setFacing(call.facingMode);
  };

  const remoteVideo = Object.entries(remoteVids).find(([, v]) => !v.off);
  const videoMode = status === 'active' && (camOn || !!remoteVideo);

  const fmt = (s) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const statusText =
    status === 'calling' ? (isIncoming ? tr('Conectando...') : tr('Llamando...'))
    : status === 'error' ? tr('Error al conectar')
    : fmt(duration);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#1c1c1e', zIndex: 50, overflow: 'hidden' }}>

      {/* Elementos <audio> de los participantes (sin UI) */}
      <div ref={audioBoxRef} style={{ display: 'none' }} />

      {/* ── Vídeo (al pasar a videollamada): el del otro a pantalla completa, el mío en miniatura ── */}
      {videoMode && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: '#000' }}>
          {remoteVideo
            ? <VideoEl stream={remoteVideo[1].stream} />
            : <VideoEl stream={localStream} mirror={facing === 'user'} />}
          {remoteVideo && camOn && (
            <div style={{ position: 'absolute', zIndex: 3, top: 'calc(env(safe-area-inset-top, 44px) + 70px)', right: 14,
                          width: 104, height: 146, borderRadius: 14, overflow: 'hidden',
                          border: '2px solid rgba(255,255,255,0.35)', boxShadow: '0 4px 18px rgba(0,0,0,0.45)', background: '#1f2937' }}>
              <VideoEl stream={localStream} mirror={facing === 'user'} />
            </div>
          )}
          {/* Degradados para leer la cabecera y los controles sobre la imagen */}
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 160, background: 'linear-gradient(rgba(0,0,0,0.55), transparent)' }} />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 220, background: 'linear-gradient(transparent, rgba(0,0,0,0.6))' }} />
        </div>
      )}


      {/* ── Error ── */}
      {status === 'error' && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <p style={{ color: '#f87171', fontWeight: 700, fontSize: 16, margin: 0 }}>{tr('No se pudo conectar')}</p>
          <button onClick={() => { setStatus('calling'); startCall(); }}
            style={{ background: '#3D5A80', color: 'white', border: 'none', borderRadius: 18, padding: '12px 28px', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>{tr('Reintentar')}</button>
          <button onClick={handleEnd}
            style={{ color: 'rgba(255,255,255,0.45)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>{tr('Volver')}</button>
        </div>
      )}

      {/* ── UI principal ── */}
      <div style={{ position: 'relative', zIndex: 2, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

        {/* Zona segura superior */}
        <div style={{ height: 'env(safe-area-inset-top, 44px)', minHeight: 44 }} />

        {/* ── Cabecera ── */}
        <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', marginTop: 4 }}>
          <button onClick={handleEnd}
            style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,255,255,0.10)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>

          <div style={{ textAlign: 'center' }}>
            <p style={{ margin: 0, color: 'white', fontWeight: 700, fontSize: 18, letterSpacing: -0.3 }}>{calleeName}</p>
            <p style={{ margin: '3px 0 0', color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: 500 }}>{statusText}</p>
          </div>

          {camOn ? (
            <button onClick={handleFlip} aria-label={tr('Girar cámara')} title={tr('Girar cámara')}
              style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,255,255,0.18)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 7h-3l-2-3H9L7 7H4a2 2 0 00-2 2v9a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/>
                <path d="M9 13a3 3 0 015-2.2M15 13a3 3 0 01-5 2.2"/>
              </svg>
            </button>
          ) : <div style={{ width: 44 }} />}
        </div>

        {/* ── Avatar (oculto en videollamada) ── */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'relative', display: videoMode ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {status === 'calling' && (
              <>
                <div key={`p1-${animKey}`} style={{ position: 'absolute', inset: -32, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', animation: 'ocPulse 2.4s ease-out infinite' }} />
                <div key={`p2-${animKey}`} style={{ position: 'absolute', inset: -16, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', animation: 'ocPulse 2.4s ease-out infinite 0.6s' }} />
              </>
            )}
            <div style={{ width: 190, height: 190, borderRadius: '50%', overflow: 'hidden', position: 'relative', zIndex: 2, border: '3px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {contactAvatar
                ? <img src={contactAvatar} alt={calleeName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ color: 'white', fontSize: 76, fontWeight: 900, lineHeight: 1 }}>{calleeName?.[0]?.toUpperCase() || '?'}</span>
              }
            </div>
          </div>
        </div>

        {/* ── El otro ha encendido la cámara y yo no ── */}
        {status === 'active' && remoteVideo && !camOn && (
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(0,0,0,0.55)',
                        borderRadius: 22, padding: '6px 6px 6px 14px', maxWidth: 'calc(100% - 32px)' }}>
            <span style={{ color: 'white', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {calleeName}{' '}{tr('ha activado la cámara')}</span>
            <button onClick={handleCamToggle} disabled={camBusy}
              style={{ flexShrink: 0, background: '#3D5A80', color: 'white', border: 'none', borderRadius: 16, padding: '7px 12px',
                       fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
              {camBusy ? '…' : tr('Activar la mía')}
            </button>
          </div>
        )}

        {camError && (
          <div style={{ marginBottom: 12, background: 'rgba(15,15,25,0.92)', color: 'white', padding: '8px 16px', borderRadius: 18, fontSize: 13, fontWeight: 600 }}>{tr('No se pudo encender la cámara')}</div>
        )}

        {/* ── Botón Añadir participante ── */}
        {status === 'active' && (
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}>
            <button
              onClick={() => setShowInvite(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'rgba(255,255,255,0.18)',
                border: '1px solid rgba(255,255,255,0.3)',
                borderRadius: 20, padding: '8px 18px',
                color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <line x1="19" y1="8" x2="19" y2="14"/>
                <line x1="22" y1="11" x2="16" y2="11"/>
              </svg>{tr('Añadir participante')}</button>
          </div>
        )}

        {/* ── Controles: Mic + Colgar ── */}
        <div style={{ width: '100%', padding: '0 20px', marginBottom: 44 }}>
          <div style={{
            background: 'rgba(44,44,46,0.97)',
            borderRadius: 60,
            padding: '16px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-around',
            gap: 8,
            boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
          }}>

            {/* Micrófono */}
            <CtrlBtn active={!micOn} onPress={handleMicToggle} label={micOn ? tr('Silenciar') : tr('Activar mic')}>
              {micOn
                ? <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                    <path d="M19 10v2a7 7 0 01-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                  </svg>
                : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="1" y1="1" x2="23" y2="23"/>
                    <path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"/>
                    <path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23"/>
                    <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                  </svg>
              }
            </CtrlBtn>

            {/* Vídeo: pasar a videollamada sin colgar (y volver a voz) */}
            <CtrlBtn active={camOn} onPress={handleCamToggle} label={camOn ? tr('Apagar cámara') : tr('Pasar a videollamada')} disabled={status !== 'active' || camBusy}>
              {camOn
                ? <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
                  </svg>
                : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 16v1a2 2 0 01-2 2H3a2 2 0 01-2-2V7a2 2 0 012-2h2m5.66 0H14a2 2 0 012 2v3.34l1 1L23 7v10"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
              }
            </CtrlBtn>

            {/* Colgar */}
            <button onClick={handleEnd} style={{
              width: 72, height: 72, borderRadius: '50%',
              background: '#ef4444', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 6px 24px rgba(239,68,68,0.55)', flexShrink: 0,
            }}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="white" style={{ transform: 'rotate(135deg)' }}>
                <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
              </svg>
            </button>

            {/* Altavoz */}
            <CtrlBtn active={speakerOn} onPress={handleSpeakerToggle} label={speakerOn ? tr('Auricular') : tr('Altavoz')}>
              {speakerOn
                ? <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                    <path d="M19.07 4.93a10 10 0 010 14.14"/>
                    <path d="M15.54 8.46a5 5 0 010 7.07"/>
                  </svg>
                : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                    <line x1="23" y1="9" x2="17" y2="15"/>
                    <line x1="17" y1="9" x2="23" y2="15"/>
                  </svg>
              }
            </CtrlBtn>

          </div>
        </div>

        <div style={{ height: 'env(safe-area-inset-bottom, 20px)' }} />
      </div>

      {/* ── Modal: Añadir participante ── */}
      {showInvite && (
        <div
          onClick={() => setShowInvite(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 300,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 480,
              background: '#1a2340', borderRadius: '24px 24px 0 0',
              padding: '20px 0 32px',
              maxHeight: '60vh', display: 'flex', flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px 16px' }}>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'white' }}>{tr('Añadir participante')}</p>
              <button onClick={() => setShowInvite(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {inviteContacts.length === 0 ? (
                <p style={{ color: 'rgba(255,255,255,0.45)', textAlign: 'center', fontSize: 14, margin: '24px 0' }}>{tr('No hay más contactos disponibles')}</p>
              ) : (
                inviteContacts.map(contact => {
                  const sentState = inviteSent[contact.id];
                  return (
                    <div key={contact.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 42, height: 42, borderRadius: '50%', background: '#3D5A80',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 18, fontWeight: 900, color: 'white', flexShrink: 0,
                        }}>
                          {contact.name?.[0]?.toUpperCase() || '?'}
                        </div>
                        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'white' }}>{contact.name}</p>
                      </div>
                      <button
                        onClick={() => sendInvite(contact.id)}
                        disabled={!!sentState}
                        style={{
                          padding: '8px 16px', borderRadius: 16, border: 'none',
                          cursor: sentState ? 'default' : 'pointer',
                          fontWeight: 700, fontSize: 13,
                          background: sentState === 'sent' ? 'rgba(34,197,94,0.25)' : sentState === 'sending' ? 'rgba(255,255,255,0.1)' : '#3D5A80',
                          color: sentState === 'sent' ? '#4ade80' : sentState === 'error' ? '#f87171' : 'white',
                        }}
                      >
                        {sentState === 'sent' ? tr('Invitado') : sentState === 'sending' ? '...' : sentState === 'error' ? tr('Error') : tr('Invitar')}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes ocPulse {
          0%   { transform: scale(1);   opacity: 1; }
          100% { transform: scale(1.5); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

/** Vídeo de la llamada (sin sonido: el audio va por los <audio> ocultos) */
function VideoEl({ stream, mirror }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== stream) { el.srcObject = stream || null; el.play().catch(() => {}); }
  }, [stream]);
  return (
    <video ref={ref} data-vc="1" autoPlay playsInline muted
      style={{ width: '100%', height: '100%', objectFit: 'cover', transform: mirror ? 'scaleX(-1)' : undefined }} />
  );
}

function CtrlBtn({ children, active, onPress, label, disabled }) {
  return (
    <button onClick={onPress} title={label} aria-label={label} disabled={disabled} style={{
      opacity: disabled ? 0.4 : 1,
      width: 56, height: 56, borderRadius: '50%', border: 'none', cursor: disabled ? 'default' : 'pointer',
      background: active ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'background 0.15s', flexShrink: 0,
    }}>
      {children}
    </button>
  );
}
