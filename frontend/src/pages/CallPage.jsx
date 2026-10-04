/**
 * CallPage — Llamada de voz
 * UI: estilo WhatsApp (avatar + píldora de controles)
 *
 * ZEGOCLOUD UIKit inyecta su UI en dos sitios:
 *   1. Dentro del <div ref={containerRef}> que le pasamos
 *   2. En document.body como portals React (tiles de video, overlays, etc.)
 *
 * Para una llamada de VOZ ocultamos AMBOS:
 *   1. El container es 0×0 y está fuera de pantalla → ZEGOCLOUD no crea portals grandes
 *   2. Snapshot de document.body ANTES de joinRoom → MutationObserver oculta cualquier
 *      elemento nuevo que ZEGOCLOUD añada posteriormente
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore }  from '../store/authStore';
import { useZegoStore }  from '../store/zegoStore';
import { useChatStore }  from '../store/chatStore';
import { playRingSound } from '../utils/sounds';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

export default function CallPage() {
  const { userId }  = useParams();
  const { state }   = useLocation();
  const navigate    = useNavigate();
  const { user }    = useAuthStore();
  const { chats }   = useChatStore();
  const {
    zimEngine,
    callRejected, clearCallRejected,
    callEnded,    clearCallEnded,
    acquireCallInstance, releaseCallInstance,
    sendCallSignal,
  } = useZegoStore();

  // Avatar del contacto desde el store
  const contactChat   = chats.find(c => c.participants?.includes(userId));
  const contactAvatar = state?.chat?.avatar || contactChat?.avatar || null;

  const containerRef        = useRef(null);
  const zpRef               = useRef(null);
  const timerRef            = useRef(null);
  const cancelledRef        = useRef(false);
  const cleanedRef          = useRef(false);
  const zimSnapRef          = useRef(null);
  const loggedRef           = useRef(false);
  const earpieceTimer       = useRef([]);
  const zegoObserverRef     = useRef(null);
  const bodySnapshotRef     = useRef(null);
  const hideStyleRef        = useRef(null);
  const keepAliveRef        = useRef(null); // AudioContext silencioso → evita throttling en background
  const micOnRef            = useRef(true); // ref síncrona del estado del mic

  const [status,     setStatus]    = useState('calling');
  const [duration,   setDuration]  = useState(0);
  const [micOn,      setMicOn]     = useState(true);
  const [speakerOn,  setSpeakerOn] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteSent, setInviteSent] = useState({});
  const [animKey,    setAnimKey]   = useState(0); // fuerza remount de animaciones al volver de background

  const isIncoming = state?.isIncoming || false;
  const calleeName = state?.chat?.name || userId;
  const roomId     = state?.roomId || [user?.id, userId].sort().join('_voice_');

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
    const onVisible = () => {
      if (document.hidden) return;
      // Reiniciar animaciones CSS que se congelen en background
      setAnimKey(k => k + 1);
      if (status !== 'active') return;
      window.OldFaceAudio?.setEarpiece();
      // Ciclar mic para relanzar el pipeline de audio de ZEGOCLOUD tras throttling
      setTimeout(() => {
        try { zpRef.current?.turnMicrophoneOn?.(false); } catch {}
        setTimeout(() => {
          try { zpRef.current?.turnMicrophoneOn?.(micOnRef.current); } catch {}
        }, 200);
      }, 300);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [status]);

  // ── ZIM ───────────────────────────────────────────────────────────────────
  const sendZIMInvite = async () => {
    const callerName = user?.name || user?.id || 'Usuario';
    sendCallSignal(userId, 'call_invite', { callType: 'voice', callerName, roomId }); // servidor RTC propio
    const zim = zimSnapRef.current;
    if (!zim) return;
    try {
      await zim.sendMessage(
        { type: 1, message: JSON.stringify({ _oc_type: 'call_invite', callType: 'voice', callerName, roomId }) },
        userId, 0, { priority: 3 }
      );
    } catch (err) { console.warn('[CallPage] ZIM invite error:', err?.message); }
  };

  const sendZIMEnd = async () => {
    sendCallSignal(userId, 'call_end'); // servidor RTC propio
    const zim = zimSnapRef.current;
    if (!zim) return;
    try {
      await zim.sendMessage(
        { type: 1, message: JSON.stringify({ _oc_type: 'call_end' }) },
        userId, 0, { priority: 3 }
      );
    } catch { /* silencioso */ }
  };

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

  // ── Flujo principal ───────────────────────────────────────────────────────
  const startCall = async () => {
    try {
      const { ZIM } = await import('zego-zim-web');
      zimSnapRef.current = ZIM.getInstance() || zimEngine;
      if (!isIncoming) await sendZIMInvite();

      const zp = await acquireCallInstance(roomId, user.id, user.name);
      if (!zp) { setStatus('error'); return; }
      zpRef.current = zp;

      const { ZegoUIKitPrebuilt } = await import('@zegocloud/zego-uikit-prebuilt');

      // Forzar auricular ANTES de que ZEGOCLOUD active su engine de audio
      window.OldFaceAudio?.setCallActive(true);
      window.OldFaceAudio?.setEarpiece();

      // ── CSS global: oculta PERMANENTEMENTE los portals que ZEGOCLOUD inyecta ──
      // El MutationObserver perdía la carrera con el re-render de ZEGOCLOUD.
      // Una regla CSS en <head> se aplica de forma continua aunque ZEGOCLOUD
      // destruya y recree elementos. Solo se excluyen #root, <script> y <style>.
      if (!hideStyleRef.current) {
        const s = document.createElement('style');
        s.id = 'oc-voice-hide';
        // Dos capas de defensa:
        // 1. Portals en body (hijos directos fuera de #root)
        // 2. Cualquier <video> en cualquier lugar del DOM
        s.textContent =
          'body>*:not(#root):not(script):not(style)' +
          '{display:none!important;visibility:hidden!important;pointer-events:none!important;}' +
          'body>div:not(#root)>*' +
          '{display:none!important;visibility:hidden!important;}' +
          'video,canvas[style*="position: fixed"],canvas[style*="position:fixed"]' +
          '{display:none!important;visibility:hidden!important;}';
        document.head.appendChild(s);
        hideStyleRef.current = s;
      }

      zp.joinRoom({
        container:                    containerRef.current,
        showPreJoinView:              false,
        turnOnMicrophoneWhenJoining:  true,
        turnOnCameraWhenJoining:      false,
        showMyCameraToggleButton:     false,
        showMyMicrophoneToggleButton: false,
        showAudioVideoSettingsButton: false,
        showTextChat:                 false,
        showUserList:                 false,
        maxUsers:                     9,
        useSpeakerWhenJoining:        false,
        leaveRoomConfirmDialogInfo:   null,
        scenario:                     { mode: ZegoUIKitPrebuilt.GroupCall },
        showLeaveRoomConfirmDialog:   false,

        onJoinRoom: () => {
          setStatus('active');
          timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
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

          // ── Auricular: retardos escalonados para capturar init tardía de ZEGOCLOUD ──
          earpieceTimer.current.forEach(clearTimeout);
          earpieceTimer.current = [0, 300, 700, 1400, 2500, 4000, 6000, 9000].map(ms =>
            setTimeout(() => window.OldFaceAudio?.setEarpiece(), ms)
          );
        },

        onLeaveRoom: () => { doCleanup(); navigate(-1); },
      });
    } catch (err) {
      console.error('[CallPage] error:', err?.message);
      setStatus('error');
    }
  };

  // ── Cleanup ───────────────────────────────────────────────────────────────
  const doCleanup = useCallback(() => {
    if (cleanedRef.current) return;
    cleanedRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    earpieceTimer.current.forEach(clearTimeout);
    earpieceTimer.current = [];
    zegoObserverRef.current?.disconnect();
    zegoObserverRef.current = null;
    hideStyleRef.current?.remove();
    hideStyleRef.current = null;
    try { keepAliveRef.current?.osc?.stop(); keepAliveRef.current?.ctx?.close(); } catch {}
    keepAliveRef.current = null;
    window.OldFaceAudio?.setSpeaker();
    window.OldFaceAudio?.setCallActive(false);
    releaseCallInstance(user);
  }, [user]); // eslint-disable-line

  // ── Colgar ────────────────────────────────────────────────────────────────
  const handleEnd = async () => {
    if (cancelledRef.current) return;
    cancelledRef.current = true;
    await sendZIMEnd();
    recordCallLog(duration);
    doCleanup();
    navigate(-1);
  };

  // ── Mic ───────────────────────────────────────────────────────────────────
  const handleMicToggle = () => {
    const next = !micOn;
    micOnRef.current = next;
    setMicOn(next);
    try { zpRef.current?.turnMicrophoneOn?.(next); } catch {}
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
  const handleSpeakerToggle = () => {
    const next = !speakerOn;
    setSpeakerOn(next);
    if (next) {
      window.OldFaceAudio?.enableSpeaker();   // altavoz ON, para el poller
    } else {
      window.OldFaceAudio?.setEarpiece();     // auricular ON, reinicia el poller
    }
  };

  const fmt = (s) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const statusText =
    status === 'calling' ? (isIncoming ? 'Conectando...' : 'Llamando...')
    : status === 'error' ? 'Error al conectar'
    : fmt(duration);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#1c1c1e', zIndex: 50, overflow: 'hidden' }}>

      {/* ── ZEGOCLOUD: solo procesa audio, UI completamente oculta ─────────────
           transform: translateZ(0) convierte este div en el containing block de
           los hijos con position:fixed que ZEGOCLOUD renderice — quedan clipados
           por overflow:hidden al ser 0×0 y estar a -9999px fuera de pantalla.   */}
      <div style={{
        position: 'fixed', top: -9999, left: -9999,
        width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none',
        transform: 'translateZ(0)',
      }}>
        <div ref={containerRef} style={{ width: 1, height: 1 }} />
      </div>

      {/* ── Error ── */}
      {status === 'error' && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <p style={{ color: '#f87171', fontWeight: 700, fontSize: 16, margin: 0 }}>No se pudo conectar</p>
          <button onClick={() => { setStatus('calling'); startCall(); }}
            style={{ background: '#000080', color: 'white', border: 'none', borderRadius: 18, padding: '12px 28px', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>
            Reintentar
          </button>
          <button onClick={handleEnd}
            style={{ color: 'rgba(255,255,255,0.45)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>
            Volver
          </button>
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

          <div style={{ width: 44 }} />
        </div>

        {/* ── Avatar ── */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
              </svg>
              Añadir participante
            </button>
          </div>
        )}

        {/* ── Controles: Mic + Colgar ── */}
        <div style={{ width: '100%', padding: '0 20px', marginBottom: 44 }}>
          <div style={{
            background: 'rgba(44,44,46,0.97)',
            borderRadius: 60,
            padding: '16px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-around',
            gap: 8,
            boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
          }}>

            {/* Micrófono */}
            <CtrlBtn active={!micOn} onPress={handleMicToggle} label={micOn ? 'Silenciar' : 'Activar mic'}>
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
            <CtrlBtn active={speakerOn} onPress={handleSpeakerToggle} label={speakerOn ? 'Auricular' : 'Altavoz'}>
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
              <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'white' }}>Añadir participante</p>
              <button onClick={() => setShowInvite(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {inviteContacts.length === 0 ? (
                <p style={{ color: 'rgba(255,255,255,0.45)', textAlign: 'center', fontSize: 14, margin: '24px 0' }}>
                  No hay más contactos disponibles
                </p>
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
                          width: 42, height: 42, borderRadius: '50%', background: '#000080',
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
                          background: sentState === 'sent' ? 'rgba(34,197,94,0.25)' : sentState === 'sending' ? 'rgba(255,255,255,0.1)' : '#000080',
                          color: sentState === 'sent' ? '#4ade80' : sentState === 'error' ? '#f87171' : 'white',
                        }}
                      >
                        {sentState === 'sent' ? 'Invitado' : sentState === 'sending' ? '...' : sentState === 'error' ? 'Error' : 'Invitar'}
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

function CtrlBtn({ children, active, onPress, label }) {
  return (
    <button onClick={onPress} title={label} style={{
      width: 56, height: 56, borderRadius: '50%', border: 'none', cursor: 'pointer',
      background: active ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'background 0.15s', flexShrink: 0,
    }}>
      {children}
    </button>
  );
}
