/**
 * DirectoLivePage — Sala de streaming en vivo con ZEGOCLOUD UIKit
 * Host: el creador autorizado transmite cámara/micro
 * Audience: el resto ve el directo
 */
import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

const APP_ID       = parseInt(import.meta.env.VITE_ZEGOCLOUD_APP_ID);
const BACKEND_URL  = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

const DIRECTO_ALLOWED_PHONES = ['641872224', '647148175'];

function isHost(user) {
  if (!user?.phone) return false;
  const digits = (user.phone || '').replace(/\D/g, '');
  return DIRECTO_ALLOWED_PHONES.some(p => digits.endsWith(p));
}

export default function DirectoLivePage() {
  const { directoId } = useParams();
  const navigate      = useNavigate();
  const { user }      = useAuthStore();
  const containerRef  = useRef(null);
  const zegoRef       = useRef(null);

  const [status,  setStatus]  = useState('connecting'); // connecting | live | error
  const [errMsg,  setErrMsg]  = useState('');
  const [viewers, setViewers] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);

  const role = isHost(user) ? 'Host' : 'Audience';

  useEffect(() => {
    initLive();
    return () => cleanup();
  }, []);

  const initLive = async () => {
    try {
      const { ZegoUIKitPrebuilt } = await import('@zegocloud/zego-uikit-prebuilt');

      // TEST: usar generateKitTokenForTest para diagnosticar
      const SERVER_SECRET = import.meta.env.VITE_ZEGOCLOUD_SERVER_SECRET;
      const kitToken = ZegoUIKitPrebuilt.generateKitTokenForTest(
        APP_ID, SERVER_SECRET, directoId, user.id, user.name || 'Usuario'
      );

      zegoRef.current = ZegoUIKitPrebuilt.create(kitToken);

      // Timeout de 25 s: si ZEGOCLOUD no conecta, mostrar error
      const connectTimeout = setTimeout(() => {
        if (zegoRef.current) {
          setErrMsg('Tiempo de conexión agotado. Comprueba tu conexión y vuelve a intentarlo.');
          setStatus('error');
        }
      }, 25000);

      zegoRef.current.joinRoom({
        container:       containerRef.current,
        showPreJoinView: false,
        scenario: {
          mode: ZegoUIKitPrebuilt.VideoConference,
        },
        // Host: micro y cámara ON. Audience: solo escucha/ve
        turnOnMicrophoneWhenJoining:  role === 'Host',
        turnOnCameraWhenJoining:      role === 'Host',
        showMyCameraToggleButton:     true,
        showMyMicrophoneToggleButton: true,
        showAudioVideoSettingsButton: role === 'Host',
        showScreenSharingButton: false,
        showTextChat:  true,
        showUserList:  true,
        maxUsers: 100,
        onJoinRoom: () => {
          clearTimeout(connectTimeout);
          setStatus('live');
          timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
        },
        onUserCountOrPropertyChanged: (users) => {
          setViewers(users.length);
        },
        onLeaveRoom: () => {
          clearTimeout(connectTimeout);
          cleanup();
          navigate(-1);
        },
      });

    } catch (err) {
      console.error('[DirectoLivePage] error:', err);
      setErrMsg(err.message || 'Error desconocido');
      setStatus('error');
    }
  };

  const cleanup = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (zegoRef.current) {
      try { zegoRef.current.destroy(); } catch {}
      zegoRef.current = null;
    }
  };

  const formatTime = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return h > 0 ? `${h}:${m}:${sec}` : `${m}:${sec}`;
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0f172a', zIndex: 50 }}>

      {/* Contenedor ZEGOCLOUD UIKit */}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Overlay: conectando */}
      {status === 'connecting' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(to bottom, #1e1035, #0f172a)',
          gap: 20,
        }}>
          {/* Antena pulsante */}
          <div style={{ position: 'relative', width: 80, height: 80 }}>
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(239,68,68,0.3)', animation: 'ripple 1.5s ease-in-out infinite' }} />
            <div style={{ position: 'relative', width: 80, height: 80, borderRadius: '50%', background: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M6.343 6.343a8 8 0 000 11.314M17.657 6.343a8 8 0 010 11.314M3.515 3.515a13 13 0 000 16.97M20.485 3.515a13 13 0 010 16.97"/>
              </svg>
            </div>
          </div>
          <p style={{ color: 'white', fontSize: 18, fontWeight: 800, margin: 0 }}>
            {role === 'Host' ? 'Iniciando emisión...' : 'Uniéndose al directo...'}
          </p>
          <button
            onClick={() => navigate(-1)}
            style={{ marginTop: 8, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 12, padding: '10px 24px', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            Cancelar
          </button>
          <style>{`@keyframes ripple { 0%,100% { transform:scale(1); opacity:0.5 } 50% { transform:scale(1.6); opacity:0 } }`}</style>
        </div>
      )}

      {/* Overlay: error */}
      {status === 'error' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: '#0f172a', gap: 16, padding: 32,
        }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <p style={{ color: 'white', fontSize: 16, fontWeight: 800, margin: 0 }}>No se pudo iniciar el directo</p>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, margin: 0, textAlign: 'center', fontFamily: 'monospace' }}>{errMsg}</p>
          <button
            onClick={initLive}
            style={{ background: '#ef4444', color: 'white', border: 'none', borderRadius: 14, padding: '12px 28px', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}
          >
            Reintentar
          </button>
          <button
            onClick={() => navigate(-1)}
            style={{ background: 'transparent', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 14, padding: '10px 24px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
          >
            Volver
          </button>
        </div>
      )}

      {/* Badge EN VIVO + contador (visible cuando live y UIKit no lo tapa) */}
      {status === 'live' && (
        <div style={{
          position: 'absolute', top: 'env(safe-area-inset-top, 16px)', left: 0, right: 0, zIndex: 5,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 16px', pointerEvents: 'none',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ background: '#ef4444', color: 'white', fontSize: 11, fontWeight: 900, padding: '3px 10px', borderRadius: 20, letterSpacing: '0.5px' }}>
              ● EN VIVO
            </span>
            <span style={{ background: 'rgba(0,0,0,0.5)', color: 'white', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, fontFamily: 'monospace' }}>
              {formatTime(elapsed)}
            </span>
          </div>
          {viewers > 0 && (
            <span style={{ background: 'rgba(0,0,0,0.5)', color: 'white', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20 }}>
              👁 {viewers}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
