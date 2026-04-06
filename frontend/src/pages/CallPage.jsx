/**
 * CallPage - Llamada de voz con ZEGOCLOUD UIKit
 *
 * Flujo:
 *  Llamante → envía ZIM call invitation al destinatario → ambos entran al room
 *  Receptor → llega por navigate desde IncomingCallModal (state.isIncoming = true)
 *             → entra directamente al room sin enviar invitación
 */
import React, { useEffect, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useZIMStore } from '../store/zimStore';

const APP_ID  = parseInt(import.meta.env.VITE_ZEGOCLOUD_APP_ID);

export default function CallPage() {
  const { userId } = useParams();       // ID del otro usuario
  const { state }  = useLocation();
  const navigate   = useNavigate();
  const { user }   = useAuthStore();
  const { engine: zimEngine, sendCallInvitation } = useZIMStore();

  const containerRef = useRef(null);
  const zegoRef      = useRef(null);
  const timerRef     = useRef(null);

  const [status,   setStatus]   = useState('calling'); // calling | active | error
  const [duration, setDuration] = useState(0);
  const [micOn,    setMicOn]    = useState(true);

  const chat       = state?.chat;
  const isIncoming = state?.isIncoming || false;
  const calleeName = chat?.name || userId;

  // roomId determinista: ambos calculan lo mismo con .sort()
  const roomId = [user?.id, userId].sort().join('_voice_');

  useEffect(() => {
    // 1. Si somos el llamante, enviar invitación ZIM al destinatario
    if (!isIncoming) {
      sendCallInvitation({
        calleeId:   userId,
        roomId,
        callType:   'voice',
        callerName: user?.name || 'Usuario',
      }).catch(() => {}); // si falla (callee offline), seguimos en la sala
    }

    // 2. Unirse al room ZEGOCLOUD
    initVoiceCall();
    return () => cleanup();
  }, []);

  const initVoiceCall = async () => {
    try {
      const { ZegoUIKitPrebuilt } = await import('@zegocloud/zego-uikit-prebuilt');

      const SERVER_SECRET = import.meta.env.VITE_ZEGOCLOUD_SERVER_SECRET;
      const kitToken = ZegoUIKitPrebuilt.generateKitTokenForTest(
        APP_ID, SERVER_SECRET, roomId, user.id, user.name || 'Usuario'
      );

      zegoRef.current = ZegoUIKitPrebuilt.create(kitToken);
      zegoRef.current.joinRoom({
        container:                   containerRef.current,
        showPreJoinView:             false,
        turnOnMicrophoneWhenJoining: true,
        turnOnCameraWhenJoining:     false,
        showMyCameraToggleButton:    false,
        showMyMicrophoneToggleButton: true,
        showAudioVideoSettingsButton: false,
        showTextChat:                false,
        showUserList:                false,
        maxUsers:                    2,
        scenario: { mode: ZegoUIKitPrebuilt.OneONoneCall },
        onJoinRoom: () => {
          setStatus('active');
          timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
        },
        onLeaveRoom: () => { cleanup(); navigate(-1); },
      });
    } catch (err) {
      console.error('[CallPage] error:', err.message);
      setStatus('error');
    }
  };

  const cleanup = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    try { zegoRef.current?.destroy(); } catch {}
  };

  const handleEnd = () => { cleanup(); navigate(-1); };

  const formatDuration = (s) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-50">
      {/* ZEGOCLOUD UIKit container (audio real) */}
      <div ref={containerRef} className="absolute inset-0" style={{ zIndex: 1 }} />

      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900" style={{ zIndex: 10 }}>
          <p className="text-red-400 font-bold mb-4">No se pudo conectar</p>
          <button onClick={() => { cleanup(); initVoiceCall(); }} className="bg-oldface-500 text-white px-6 py-3 rounded-2xl font-bold mb-3">
            Reintentar
          </button>
          <button onClick={handleEnd} className="text-gray-400">Volver</button>
        </div>
      )}

      {/* UI personalizada sobre el container */}
      <div className="flex flex-col h-full bg-gradient-to-b from-[#000080] to-gray-900" style={{ zIndex: 2 }}>
        <div style={{ height: 'env(safe-area-inset-top, 80px)', minHeight: 44 }} />

        <div className="flex flex-col items-center flex-1 justify-center">
          <div className="relative">
            {status === 'calling' && (
              <>
                <div className="absolute inset-0 rounded-full bg-oldface-400 animate-ping opacity-30" style={{ animationDuration: '2s' }} />
                <div className="absolute -inset-4 rounded-full bg-oldface-400 animate-ping opacity-20" style={{ animationDuration: '2.5s' }} />
              </>
            )}
            <div className="w-36 h-36 rounded-full bg-oldface-400 flex items-center justify-center relative z-10 border-4 border-white/20">
              <span className="text-white text-6xl font-black">{calleeName?.[0]?.toUpperCase()}</span>
            </div>
          </div>

          <h2 className="text-white text-2xl font-bold mt-6">{calleeName}</h2>
          <p className="text-white/70 mt-2 font-medium">
            {status === 'calling'
              ? (isIncoming ? 'Conectando...' : 'Llamando...')
              : status === 'error'
              ? 'Error al conectar'
              : formatDuration(duration)}
          </p>
        </div>

        <div className="pb-16 px-8">
          <div className="flex justify-around items-center mb-8">
            <VoiceControl
              label={micOn ? 'Silenciar' : 'Activar mic'}
              active={!micOn}
              onPress={() => setMicOn(v => !v)}
              icon={micOn
                ? "M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                : "M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
              }
            />
            <button
              onClick={handleEnd}
              className="w-20 h-20 rounded-full bg-red-500 flex items-center justify-center shadow-2xl active:bg-red-600 active:scale-95 transition-all"
            >
              <svg className="w-10 h-10 text-white rotate-[135deg]" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
              </svg>
            </button>
            <VoiceControl
              label="Auricular"
              active={false}
              onPress={() => {}}
              icon="M15.536 8.464a5 5 0 010 7.072M12 6a7 7 0 010 12m-4.536-1.464a5 5 0 010-7.072"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function VoiceControl({ label, active, onPress, icon }) {
  return (
    <button onClick={onPress} className="flex flex-col items-center gap-2">
      <div className={`w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-90 ${
        active ? 'bg-white/30' : 'bg-white/10'
      }`}>
        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
        </svg>
      </div>
      <span className="text-white/70 text-xs font-medium">{label}</span>
    </button>
  );
}
