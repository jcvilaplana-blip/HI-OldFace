/**
 * VideoCallPage — Videollamada con el servidor RTC propio (mediasoup), 1:1 o en grupo.
 *
 * Layout:
 *  - Vídeo remoto a pantalla completa (cuadrícula si hay varios participantes)
 *  - Vista propia en miniatura arriba a la derecha (espejo)
 *  - Barra de controles propia: [Mic] [Colgar] [Cámara]
 *  - cleanedRef previene doble llamada a doCleanup
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore }  from '../store/authStore';
import { useCallStore }  from '../store/callStore';
import { useChatStore }  from '../store/chatStore';
import { RtcCall }       from '../utils/rtcCall';
import { ensureRtcConnected } from '../utils/rtcClient';
import { playRingSound } from '../utils/sounds';
import { tr } from '../i18n';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

export default function VideoCallPage() {
  const { userId }  = useParams();
  const { state }   = useLocation();
  const navigate    = useNavigate();
  const { user }    = useAuthStore();
  const {
    callRejected, clearCallRejected,
    callEnded,    clearCallEnded,
    sendCallSignal,
  } = useCallStore();

  const cancelledRef    = useRef(false);  // evita doble cancelación
  const cleanedRef      = useRef(false);  // evita doble doCleanup
  const startTimeRef    = useRef(null);
  const loggedRef       = useRef(false);
  const cameraOnRef     = useRef(true);   // ref síncrona — usada al reconectar
  const keepAliveRef    = useRef(null);   // AudioContext silencioso → evita throttling en background

  const [uiStatus,    setUiStatus]    = useState('connecting');
  const [micOn,       setMicOn]       = useState(true);
  const [cameraOn,    setCameraOn]    = useState(true);
  const [facing,      setFacing]      = useState('user');   // 'user' (frontal) | 'environment' (trasera)
  const [showInvite,  setShowInvite]  = useState(false);
  const [inviteSent,  setInviteSent]  = useState({});  // { contactId: true } tras enviar invitación

  const { chats } = useChatStore();

  const isIncoming = state?.isIncoming === true;
  const calleeName = state?.chat?.name || userId;
  // Usar roomId del state (generado por el emisor) o derivar como fallback
  const roomId     = state?.roomId || [user?.id, userId].sort().join('_vroom_');

  const rtcCallRef    = useRef(null);
  const localVideoRef = useRef(null);
  const activeRef     = useRef(false);
  const [remotes, setRemotes] = useState([]); // [{ id, name, stream, videoOff }]

  // Contactos disponibles para invitar (todos los chats excepto el participante actual)
  const inviteContacts = chats
    .filter(c => {
      const otherId = c.participants?.find(p => p !== user?.id);
      return otherId && otherId !== userId;
    })
    .map(c => ({
      id:   c.participants?.find(p => p !== user?.id),
      name: c.name,
    }));

  // ── Señales de rechazo y fin de llamada ───────────────────────────────────
  useEffect(() => {
    if (isIncoming || !callRejected) return;
    clearCallRejected();
    doCleanup();
    navigate(-1);
  }, [callRejected, isIncoming]);

  useEffect(() => {
    if (!callEnded) return;
    clearCallEnded();
    const secs = startTimeRef.current ? Math.round((Date.now() - startTimeRef.current) / 1000) : 0;
    recordCallLog(secs);
    doCleanup();
    navigate(-1);
  }, [callEnded]);

  // ── Tono de llamada saliente ──────────────────────────────────────────────
  useEffect(() => {
    if (uiStatus !== 'connecting' || isIncoming) return;
    playRingSound();
    const interval = setInterval(playRingSound, 3000);
    return () => clearInterval(interval);
  }, [uiStatus, isIncoming]);

  // ── Iniciar llamada al montar ─────────────────────────────────────────────
  useEffect(() => {
    startCall();
    return () => doCleanup();
  }, []); // eslint-disable-line

  // ── Al volver al primer plano: reactivar altavoz + descongelar vídeo ────────
  useEffect(() => {
    const onVisible = async () => {
      if (document.hidden || uiStatus !== 'active') return;

      // 1. Reactivar altavoz (videollamada usa altavoz por defecto)
      window.OldFaceAudio?.enableSpeaker();
      // 2. Si Android cortó la cámara o el micro al minimizar, abrirlos otra vez (el otro dejaba de verme)
      const call = rtcCallRef.current;
      if (call) {
        const s = await call.recoverMedia();
        if (localVideoRef.current && s && localVideoRef.current.srcObject !== s) localVideoRef.current.srcObject = s;
      }
      // 3. Reanudar vídeos que el WebView haya pausado en segundo plano
      document.querySelectorAll('video[data-rtc]').forEach(v => v.play().catch(() => {}));
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [uiStatus]);

  // ── Señales al otro participante ──────────────────────────────────────────
  const sendInviteSignal = () => {
    const callerName = user?.name || user?.id || 'Usuario';
    return sendCallSignal(userId, 'call_invite', { callType: 'video', callerName, roomId });
  };
  const sendEndSignal = () => sendCallSignal(userId, 'call_end');

  // ── Registro de llamada ───────────────────────────────────────────────────
  const recordCallLog = useCallback(async (callDuration) => {
    if (loggedRef.current) return;
    loggedRef.current = true;
    try {
      await fetch(`${BACKEND}/call-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId:      user?.id,
          contactId:   userId,
          contactName: calleeName,
          type:        'video',
          duration:    callDuration,
          direction:   isIncoming ? 'incoming' : 'outgoing',
          timestamp:   Date.now(),
        }),
      });
    } catch { /* silencioso */ }
  }, [user, userId, calleeName, isIncoming]);

  // ── Llamada conectada (llega el vídeo/audio del otro participante) ────────
  const onOwnCallActive = () => {
    if (activeRef.current) return;
    activeRef.current = true;
    setUiStatus('active');
    startTimeRef.current = Date.now();
    window.OldFaceAudio?.setCallActive(true);
    window.OldFaceAudio?.enableSpeaker(); // videollamada: altavoz por defecto
    // Tono silencioso → el WebView no se congela al minimizar (como en la llamada de voz)
    if (!keepAliveRef.current) {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        gain.gain.value = 0.001; osc.connect(gain); gain.connect(ctx.destination); osc.start();
        keepAliveRef.current = { ctx, osc };
      } catch { /* sin AudioContext */ }
    }
  };

  const startOwnCall = async () => {
    await ensureRtcConnected(user);
    if (!isIncoming) await sendInviteSignal();
    rtcCallRef.current?.leave();
    setRemotes([]);
    const call = new RtcCall({
      roomId,
      video: true,
      onPeerStream: (id, stream, { name }) => {
        setRemotes(prev => {
          const others = prev.filter(r => r.id !== id);
          const old = prev.find(r => r.id === id);
          return [...others, { id, name, stream, videoOff: old?.videoOff || false }];
        });
        onOwnCallActive();
      },
      onPeerMedia: (id, { kind, paused }) => {
        if (kind === 'video') setRemotes(prev => prev.map(r => r.id === id ? { ...r, videoOff: paused } : r));
      },
      onPeerLeft: (id) => {
        setRemotes(prev => prev.filter(r => r.id !== id));
        // Sin nadie más en la sala → la llamada ha terminado
        if (call.remoteCount === 0 && activeRef.current && !cancelledRef.current) {
          cancelledRef.current = true;
          const secs = startTimeRef.current ? Math.round((Date.now() - startTimeRef.current) / 1000) : 0;
          recordCallLog(secs); doCleanup(); navigate(-1);
        }
      },
    });
    rtcCallRef.current = call;
    setFacing(call.facingMode);
    await call.join();
    // Llamada en curso: micro y cámara siguen funcionando con la app minimizada
    window.OldFaceAudio?.startCallService?.(true, calleeName);
    if (localVideoRef.current) localVideoRef.current.srcObject = call.localStream;
    if (!micOn) call.setMic(false);
    if (!cameraOnRef.current) call.setCamera(false);
  };

  // ── Flujo principal ────────────────────────────────────────────────────────
  const startCall = async () => {
    try { await startOwnCall(); }
    catch (err) { console.error('[VideoCallPage] error:', err?.message); setUiStatus('error'); }
  };

  // ── Cleanup protegido contra doble ejecución ──────────────────────────────
  const doCleanup = useCallback(() => {
    if (cleanedRef.current) return;
    cleanedRef.current = true;
    try { keepAliveRef.current?.osc?.stop(); keepAliveRef.current?.ctx?.close(); } catch {}
    keepAliveRef.current = null;
    window.OldFaceAudio?.setCallActive(false);
    rtcCallRef.current?.leave();
    rtcCallRef.current = null;
    window.OldFaceAudio?.setSpeaker();
  }, [user]); // eslint-disable-line

  // ── Colgar ────────────────────────────────────────────────────────────────
  const handleCancel = async () => {
    if (cancelledRef.current) return;
    cancelledRef.current = true;
    await sendEndSignal();
    const secs = startTimeRef.current ? Math.round((Date.now() - startTimeRef.current) / 1000) : 0;
    recordCallLog(secs);
    doCleanup();
    navigate(-1);
  };

  // ── Controles de mic y cámara ─────────────────────────────────────────────
  const handleMicToggle = () => {
    const next = !micOn;
    setMicOn(next);
    rtcCallRef.current?.setMic(next);
  };

  const handleCameraToggle = () => {
    const next = !cameraOn;
    cameraOnRef.current = next;
    setCameraOn(next);
    rtcCallRef.current?.setCamera(next);
  };

  // ── Voltear la cámara (frontal ↔ trasera) ─────────────────────────────────
  const handleFlip = async () => {
    const call = rtcCallRef.current;
    if (!call || !cameraOn) return;
    try {
      const s = await call.switchCamera();
      if (localVideoRef.current) localVideoRef.current.srcObject = s;
    } catch {
      if (localVideoRef.current) localVideoRef.current.srcObject = call.localStream;   // sin otra cámara: sigue la de antes
    }
    setFacing(call.facingMode);
  };

  // ── Invitar contacto a la videollamada en curso ───────────────────────────
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
          callType:   'video',
          roomId,
        }),
      });
      setInviteSent(prev => ({ ...prev, [contactId]: 'sent' }));
    } catch {
      setInviteSent(prev => ({ ...prev, [contactId]: 'error' }));
    }
  };

  // ── Reintentar tras error ─────────────────────────────────────────────────
  const handleRetry = () => {
    cancelledRef.current = false;
    cleanedRef.current   = false;
    loggedRef.current    = false;
    setMicOn(true);
    setCameraOn(true);
    setUiStatus('connecting');
    startCall();
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#111827', zIndex: 50 }}>

      {/* Vídeo remoto a pantalla completa (o cuadrícula) + vista propia */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'grid', gap: remotes.length > 1 ? 4 : 0, background: '#000',
        gridTemplateColumns: remotes.length > 1 ? '1fr 1fr' : '1fr',
        gridAutoRows: remotes.length > 2 ? '1fr' : undefined,
      }}>
        {remotes.map(r => (
          <RemoteTile key={r.id} stream={r.stream} name={r.name} videoOff={r.videoOff} showName={remotes.length > 1} />
        ))}
      </div>
      <video
        ref={localVideoRef} data-rtc="local" autoPlay playsInline muted
        style={{
          position: 'absolute', top: 'max(env(safe-area-inset-top, 16px), 16px)', right: 14, zIndex: 30,
          width: 104, height: 146, objectFit: 'cover', borderRadius: 14,
          border: '2px solid rgba(255,255,255,0.35)', background: '#1f2937',
          transform: facing === 'user' ? 'scaleX(-1)' : 'none', boxShadow: '0 4px 18px rgba(0,0,0,0.45)',
          visibility: cameraOn && uiStatus === 'active' ? 'visible' : 'hidden',
        }}
      />

      {/* ── Overlay: Conectando / Llamando ── */}
      {uiStatus === 'connecting' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10,
          background: 'linear-gradient(160deg, #3D5A80 0%, #111827 100%)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'flex-start',
          paddingTop: 'max(env(safe-area-inset-top, 48px), 48px)',
        }}>
          {/* Avatar + nombre */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 60 }}>
            <div style={{ position: 'relative', width: 140, height: 140, marginBottom: 28 }}>
              {!isIncoming && (
                <>
                  <div style={{
                    position: 'absolute', inset: -20, borderRadius: '50%',
                    background: 'rgba(255,255,255,0.08)',
                    animation: 'vcPulse 2s ease-out infinite',
                  }} />
                  <div style={{
                    position: 'absolute', inset: -10, borderRadius: '50%',
                    background: 'rgba(255,255,255,0.12)',
                    animation: 'vcPulse 2s ease-out infinite 0.4s',
                  }} />
                </>
              )}
              <div style={{
                width: 140, height: 140, borderRadius: '50%',
                background: 'rgba(255,255,255,0.15)',
                border: '3px solid rgba(255,255,255,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                position: 'relative',
              }}>
                <span style={{ fontSize: 56, fontWeight: 900, color: 'white' }}>
                  {calleeName?.[0]?.toUpperCase() || '?'}
                </span>
              </div>
            </div>
            <p style={{ fontSize: 22, fontWeight: 700, color: 'white', margin: '0 0 8px' }}>
              {calleeName}
            </p>
            <p style={{
              fontSize: 14, color: 'rgba(255,255,255,0.6)', margin: 0,
              animation: 'vcFade 1.4s ease-in-out infinite',
            }}>
              {isIncoming ? tr('Conectando...') : tr('Llamando...')}
            </p>
          </div>
        </div>
      )}

      {/* Botón colgar en estado "conectando" — posición fija al 80% del alto */}
      {uiStatus === 'connecting' && (
        <div style={{
          position: 'fixed',
          top: '80%',
          left: 0, right: 0,
          zIndex: 20,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
        }}>
          <button onClick={handleCancel} style={{
            width: 68, height: 68, borderRadius: '50%',
            background: '#ef4444', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 6px 24px rgba(239,68,68,0.5)',
          }}>
            <PhoneIcon size={30} />
          </button>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', margin: '8px 0 0' }}>
            {isIncoming ? tr('Colgar') : tr('Cancelar llamada')}
          </p>
        </div>
      )}

      {/* ── Botón Invitar — encima de los controles principales ── */}
      {uiStatus === 'active' && (
        <div style={{
          position: 'fixed',
          top: '68%',
          left: 0, right: 0,
          zIndex: 200,
          display: 'flex', justifyContent: 'center',
        }}>
          <button
            onClick={() => setShowInvite(true)}
            style={{
              pointerEvents: 'all',
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(255,255,255,0.18)',
              border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: 20, padding: '8px 18px',
              color: 'white', fontSize: 13, fontWeight: 700,
              cursor: 'pointer',
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

      {/* ── Controles durante llamada activa ─────────────────────────────────────
           Una sola fila: [Mic] [Colgar] [Cámara] al 78% del alto.
           En Samsung 900px: 78% = 702px desde arriba = 198px desde abajo → libre del nav bar. */}
      {uiStatus === 'active' && (
        <div style={{
          position: 'fixed',
          top: '78%',
          left: 0, right: 0,
          zIndex: 200,
          pointerEvents: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 18,
        }}>
          <CallButton
            active={false}
            onPress={handleFlip}
            label={tr('Girar cámara')}
            disabled={!cameraOn}
          >
            <FlipCameraIcon />
          </CallButton>

          <CallButton
            active={!micOn}
            activeColor="rgba(255,255,255,0.35)"
            onPress={handleMicToggle}
            label={micOn ? tr('Silenciar') : tr('Activar mic')}
          >
            {micOn ? <MicOnIcon /> : <MicOffIcon />}
          </CallButton>

          {/* Botón colgar — más grande, en el centro */}
          <button
            onClick={handleCancel}
            style={{
              pointerEvents: 'all',
              width: 70, height: 70, borderRadius: '50%',
              background: '#ef4444', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 6px 28px rgba(239,68,68,0.65)',
            }}
          >
            <PhoneIcon size={28} />
          </button>

          <CallButton
            active={!cameraOn}
            activeColor="rgba(255,255,255,0.35)"
            onPress={handleCameraToggle}
            label={cameraOn ? tr('Apagar cám.') : tr('Activar cám.')}
          >
            {cameraOn ? <CameraOnIcon /> : <CameraOffIcon />}
          </CallButton>
        </div>
      )}

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
            {/* Cabecera */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px 16px' }}>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'white' }}>{tr('Añadir participante')}</p>
              <button
                onClick={() => setShowInvite(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            {/* Lista de contactos */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {inviteContacts.length === 0 ? (
                <p style={{ color: 'rgba(255,255,255,0.45)', textAlign: 'center', fontSize: 14, margin: '24px 0' }}>{tr('No hay más contactos disponibles')}</p>
              ) : (
                inviteContacts.map(contact => {
                  const sentState = inviteSent[contact.id];
                  return (
                    <div key={contact.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '12px 20px',
                      borderBottom: '1px solid rgba(255,255,255,0.06)',
                    }}>
                      {/* Avatar + nombre */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 42, height: 42, borderRadius: '50%',
                          background: '#3D5A80',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 18, fontWeight: 900, color: 'white',
                          flexShrink: 0,
                        }}>
                          {contact.name?.[0]?.toUpperCase() || '?'}
                        </div>
                        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'white' }}>
                          {contact.name}
                        </p>
                      </div>

                      {/* Botón invitar */}
                      <button
                        onClick={() => sendInvite(contact.id, contact.name)}
                        disabled={!!sentState}
                        style={{
                          padding: '8px 16px', borderRadius: 16, border: 'none',
                          cursor: sentState ? 'default' : 'pointer',
                          fontWeight: 700, fontSize: 13,
                          background: sentState === 'sent'
                            ? 'rgba(34,197,94,0.25)'
                            : sentState === 'sending'
                            ? 'rgba(255,255,255,0.1)'
                            : '#3D5A80',
                          color: sentState === 'sent'
                            ? '#4ade80'
                            : sentState === 'error'
                            ? '#f87171'
                            : 'white',
                        }}
                      >
                        {sentState === 'sent'    ? tr('Invitado')
                          : sentState === 'sending' ? '...'
                          : sentState === 'error'   ? tr('Error')
                          : tr('Invitar')}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Overlay: Error ── */}
      {uiStatus === 'error' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10,
          background: '#111827',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16,
        }}>
          <p style={{ color: '#f87171', fontWeight: 700, fontSize: 16, margin: 0 }}>{tr('No se pudo conectar')}</p>
          <button onClick={handleRetry} style={{
            background: '#3D5A80', color: 'white',
            border: 'none', borderRadius: 18,
            padding: '12px 28px', fontWeight: 800, fontSize: 15, cursor: 'pointer',
          }}>{tr('Reintentar')}</button>
          <button onClick={handleCancel} style={{
            color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14,
          }}>{tr('Volver')}</button>
        </div>
      )}

      <style>{`
        @keyframes vcPulse {
          0%   { transform: scale(1);   opacity: 0.6; }
          100% { transform: scale(1.5); opacity: 0;   }
        }
        @keyframes vcFade {
          0%, 100% { opacity: 0.6; }
          50%       { opacity: 1;   }
        }
      `}</style>
    </div>
  );
}

// ── Componentes auxiliares ─────────────────────────────────────────────────

/** Vídeo de un participante (servidor RTC propio). El audio suena por el propio <video>. */
function RemoteTile({ stream, name, videoOff, showName }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) {
      ref.current.srcObject = stream;
      ref.current.play().catch(() => {});
    }
  }, [stream]);
  return (
    <div style={{ position: 'relative', background: '#111827', overflow: 'hidden', minHeight: 0 }}>
      <video ref={ref} data-rtc="remote" autoPlay playsInline
        style={{ width: '100%', height: '100%', objectFit: 'cover', visibility: videoOff ? 'hidden' : 'visible' }} />
      {videoOff && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{
            width: 110, height: 110, borderRadius: '50%', background: 'rgba(255,255,255,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontSize: 46, fontWeight: 900,
          }}>
            {name?.[0]?.toUpperCase() || '?'}
          </div>
        </div>
      )}
      {showName && (
        <span style={{
          position: 'absolute', left: 8, bottom: 8, background: 'rgba(0,0,0,0.55)', color: 'white',
          fontSize: 12, fontWeight: 700, padding: '3px 8px', borderRadius: 8,
        }}>{name}</span>
      )}
    </div>
  );
}

function CallButton({ children, active, activeColor, onPress, label, disabled }) {
  return (
    <button
      onClick={onPress}
      title={label}
      aria-label={label}
      disabled={disabled}
      style={{
        pointerEvents: 'all',
        width: 56, height: 56, borderRadius: '50%', border: 'none', cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        background: active ? activeColor : 'rgba(255,255,255,0.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        transition: 'background 0.15s',
      }}
    >
      {children}
    </button>
  );
}

function PhoneIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="white"
      style={{ transform: 'rotate(135deg)' }}>
      <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
    </svg>
  );
}

function MicOnIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
      <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="1" y1="1" x2="23" y2="23"/>
      <path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"/>
      <path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23M12 19v4M8 23h8"/>
    </svg>
  );
}

function CameraOnIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 7l-7 5 7 5V7z"/>
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
    </svg>
  );
}

function FlipCameraIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 7h-3l-2-3H9L7 7H4a2 2 0 00-2 2v9a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/>
      <path d="M9 13a3 3 0 015-2.2M15 13a3 3 0 01-5 2.2"/>
      <polyline points="14 9 14 10.8 12.2 10.8"/>
      <polyline points="10 17 10 15.2 11.8 15.2"/>
    </svg>
  );
}

function CameraOffIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 16v1a2 2 0 01-2 2H3a2 2 0 01-2-2V7a2 2 0 012-2h2m5.66 0H14a2 2 0 012 2v3.34l1 1L23 7v10"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}
