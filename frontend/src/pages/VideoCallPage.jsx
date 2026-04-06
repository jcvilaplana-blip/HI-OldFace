/**
 * VideoCallPage — Videollamada con ZEGOCLOUD UIKit
 *
 * Flujo LLAMANTE:
 *   1. Envía invitación ZIM al destinatario
 *   2. Entra al room ZEGOCLOUD mostrando overlay "Llamando..."
 *   3. Si destinatario acepta → overlay desaparece, UIKit toma control
 *   4. Si destinatario rechaza / timeout → vuelve atrás automáticamente
 *   5. Botón "Cancelar" → cancela invitación ZIM y sale
 *
 * Flujo RECEPTOR (isIncoming=true):
 *   1. Llega desde IncomingCallModal (ya aceptó en ZIM)
 *   2. Entra directamente al mismo room (roomId determinista)
 *   3. UIKit conecta ambos usuarios
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore }  from '../store/authStore';
import { useZIMStore }   from '../store/zimStore';

const APP_ID = parseInt(import.meta.env.VITE_ZEGOCLOUD_APP_ID);

export default function VideoCallPage() {
  const { userId }  = useParams();
  const { state }   = useLocation();
  const navigate    = useNavigate();
  const { user }    = useAuthStore();
  const { sendCallInvitation, cancelCall, outgoingStatus, resetOutgoingStatus } = useZIMStore();

  const containerRef = useRef(null);
  const zegoRef      = useRef(null);

  const [uiStatus, setUiStatus] = useState('connecting'); // connecting | active | error

  const chat       = state?.chat;
  const isIncoming = state?.isIncoming || false;
  const calleeName = chat?.name || userId;

  // roomId determinista — igual para ambos usuarios con .sort()
  const roomId = [user?.id, userId].sort().join('_vroom_');

  // ── Reaccionar al estado ZIM (para el llamante) ────────────────────────
  useEffect(() => {
    if (isIncoming) return; // el receptor no necesita escuchar esto
    if (outgoingStatus === 'rejected' || outgoingStatus === 'timeout') {
      cleanup();
      resetOutgoingStatus();
      navigate(-1);
    }
  }, [outgoingStatus, isIncoming]);

  // ── Montar: enviar invitación + unirse al room ─────────────────────────
  useEffect(() => {
    if (!isIncoming) {
      sendCallInvitation({
        calleeId:   userId,
        roomId,
        callType:   'video',
        callerName: user?.name || 'Usuario',
      }).catch(() => {});
    }
    initZegoCall();
    return () => cleanup();
  }, []);

  // ── Inicializar ZEGOCLOUD UIKit ────────────────────────────────────────
  const initZegoCall = async () => {
    try {
      const { ZegoUIKitPrebuilt } = await import('@zegocloud/zego-uikit-prebuilt');
      const SERVER_SECRET = import.meta.env.VITE_ZEGOCLOUD_SERVER_SECRET;

      const kitToken = ZegoUIKitPrebuilt.generateKitTokenForTest(
        APP_ID, SERVER_SECRET, roomId, user.id, user.name || 'Usuario'
      );

      zegoRef.current = ZegoUIKitPrebuilt.create(kitToken);
      zegoRef.current.joinRoom({
        container:                    containerRef.current,
        showPreJoinView:              false,
        turnOnMicrophoneWhenJoining:  true,
        turnOnCameraWhenJoining:      true,
        showMyCameraToggleButton:     true,
        showMyMicrophoneToggleButton: true,
        showAudioVideoSettingsButton: false,
        showScreenSharingButton:      false,
        showTextChat:                 false,
        showUserList:                 false,
        maxUsers:                     2,
        layout:                       'Auto',
        showLayoutButton:             false,
        scenario: { mode: ZegoUIKitPrebuilt.OneONoneCall },
        onJoinRoom:  () => setUiStatus('active'),
        onLeaveRoom: () => { cleanup(); navigate(-1); },
      });
    } catch (err) {
      console.error('[VideoCallPage] error:', err.message);
      setUiStatus('error');
    }
  };

  const cleanup = useCallback(() => {
    try { zegoRef.current?.destroy(); zegoRef.current = null; } catch {}
  }, []);

  const handleCancel = async () => {
    if (!isIncoming) await cancelCall();
    cleanup();
    resetOutgoingStatus();
    navigate(-1);
  };

  const handleRetry = () => {
    setUiStatus('connecting');
    initZegoCall();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#111827', zIndex: 50 }}>

      {/* ZEGOCLOUD UIKit — ocupa toda la pantalla */}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* ── Overlay: Conectando / Llamando ── */}
      {uiStatus === 'connecting' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10,
          background: 'linear-gradient(160deg, #000080 0%, #111827 100%)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          paddingTop: 'env(safe-area-inset-top, 48px)',
        }}>
          {/* Anillos pulsantes */}
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
            {/* Avatar */}
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
            fontSize: 14, color: 'rgba(255,255,255,0.6)', margin: '0 0 56px',
            animation: 'vcFade 1.4s ease-in-out infinite',
          }}>
            {isIncoming ? 'Conectando...' : (outgoingStatus === 'accepted' ? 'Conectando...' : 'Llamando...')}
          </p>

          {/* Botón cancelar / colgar */}
          <button
            onClick={handleCancel}
            style={{
              width: 70, height: 70, borderRadius: '50%',
              background: '#ef4444',
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 6px 24px rgba(239,68,68,0.5)',
            }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="white" style={{ transform: 'rotate(135deg)' }}>
              <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
            </svg>
          </button>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 10 }}>
            {isIncoming ? 'Colgar' : 'Cancelar llamada'}
          </p>
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
          <p style={{ color: '#f87171', fontWeight: 700, fontSize: 16, margin: 0 }}>
            No se pudo conectar
          </p>
          <button
            onClick={handleRetry}
            style={{
              background: '#000080', color: 'white',
              border: 'none', borderRadius: 18,
              padding: '12px 28px', fontWeight: 800, fontSize: 15, cursor: 'pointer',
            }}
          >
            Reintentar
          </button>
          <button
            onClick={handleCancel}
            style={{ color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}
          >
            Volver
          </button>
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
