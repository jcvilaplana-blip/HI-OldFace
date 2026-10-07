/**
 * OldFace — App Principal con todas las rutas
 */
import React, { useEffect, useState, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore }  from './store/authStore';
import { useCallStore }  from './store/callStore';
// Importar themeStore activa el tema al cargar (aplica clase 'dark' en html)
import './store/themeStore';

import LoginPage     from './pages/LoginPage.jsx';
import HomePage      from './pages/HomePage.jsx';
import ChatPage      from './pages/ChatPage.jsx';
import CallPage      from './pages/CallPage.jsx';
import VideoCallPage from './pages/VideoCallPage.jsx';
import ContactsPage  from './pages/ContactsPage.jsx';
import SettingsPage  from './pages/SettingsPage.jsx';
import DirectoPage     from './pages/DirectoPage.jsx';
import DirectoLivePage from './pages/DirectoLivePage.jsx';
import TermsPage    from './pages/TermsPage.jsx';
import PrivacyPage  from './pages/PrivacyPage.jsx';
import CookiesPage  from './pages/CookiesPage.jsx';
import PollPage     from './pages/PollPage.jsx';
import KaraokePage     from './pages/KaraokePage.jsx';
import KaraokeSingPage from './pages/KaraokeSingPage.jsx';
import KaraokeRoomPage from './pages/KaraokeRoomPage.jsx';
import { listenDeepLinks, savePendingLink, takePendingLink } from './utils/deepLinks';
// El taxi (mapa MapLibre) se carga solo al abrirlo
const TaxiPage = React.lazy(() => import('./pages/taxi/TaxiPage.jsx'));

const BRAND = '#3D5A80';

function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuthStore();
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

// ── Pantalla de permisos (primer arranque) ───────────────────────────────────
const PERMS_KEY = 'oldface_perms_done';

const PERMISSIONS_LIST = [
  {
    key: 'contacts',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
      </svg>
    ),
    title: 'Contactos',
    desc: 'Para ver qué amigos usan OldFace y poder chatear con ellos directamente.',
  },
  {
    key: 'camera',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>
    ),
    title: 'Cámara y Micrófono',
    desc: 'Necesarios para videollamadas, llamadas de voz y directos en vivo.',
  },
  {
    key: 'location',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
        <circle cx="12" cy="10" r="3"/>
      </svg>
    ),
    title: 'Ubicación',
    desc: 'Para compartir tu ubicación en los chats cuando tú lo decidas.',
  },
  {
    key: 'notifications',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 01-3.46 0"/>
      </svg>
    ),
    title: 'Notificaciones',
    desc: 'Para avisarte de mensajes, llamadas y directos aunque la app esté cerrada.',
  },
];

function PermissionsGate({ onDone }) {
  const [step, setStep] = useState(0); // 0 = pantalla intro, 1..N = solicitando cada permiso, 99 = listo
  const [granted, setGranted] = useState({});

  const requestAll = async () => {
    setStep(1);
    const results = {};

    // 1. Contactos — requestPermissions() muestra el diálogo nativo de Android
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (Capacitor.isNativePlatform()) {
        const { Contacts } = await import('@capacitor-community/contacts');
        const r = await Contacts.requestPermissions();
        results.contacts = r.contacts === 'granted' || r.contacts === 'limited';
      } else {
        results.contacts = false;
      }
    } catch { results.contacts = false; }
    setGranted(g => ({ ...g, contacts: results.contacts }));

    setStep(2);
    // 2. Cámara y Micrófono
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (Capacitor.isNativePlatform()) {
        // Android: paso 1 — CAMERA via plugin nativo (muestra diálogo del sistema)
        const { Camera } = await import('@capacitor/camera');
        const camResult = await Camera.requestPermissions({ permissions: ['camera'] });
        // Android: paso 2 — RECORD_AUDIO via getUserMedia (MainActivity muestra diálogo del sistema)
        let micGranted = false;
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          stream.getTracks().forEach(t => t.stop());
          micGranted = true;
        } catch { micGranted = false; }
        results.camera = camResult.camera === 'granted' && micGranted;
      } else {
        // Web: getUserMedia directamente
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        stream.getTracks().forEach(t => t.stop());
        results.camera = true;
      }
    } catch { results.camera = false; }
    setGranted(g => ({ ...g, camera: results.camera }));

    setStep(3);
    // 3. Ubicación
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (Capacitor.isNativePlatform()) {
        const { Geolocation } = await import('@capacitor/geolocation');
        await Geolocation.requestPermissions({ permissions: ['location'] });
        results.location = true;
      } else {
        await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
        );
        results.location = true;
      }
    } catch { results.location = false; }
    setGranted(g => ({ ...g, location: results.location }));

    setStep(4);
    // 4. Notificaciones
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (Capacitor.isNativePlatform()) {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        const r = await PushNotifications.requestPermissions();
        if (r.receive === 'granted') await PushNotifications.register();
        results.notifications = r.receive === 'granted';
      } else if ('Notification' in window) {
        const r = await Notification.requestPermission();
        results.notifications = r === 'granted';
      }
    } catch { results.notifications = false; }
    setGranted(g => ({ ...g, notifications: results.notifications }));

    setStep(99);
  };

  const finish = () => {
    localStorage.setItem(PERMS_KEY, '1');
    onDone();
  };

  // Pantalla intro
  if (step === 0) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: 'linear-gradient(160deg, #E3EDF2 0%, #E3EDF2 100%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '32px 24px', zIndex: 9999,
      }}>
        {/* Logo */}
        <div style={{ width: 80, height: 80, borderRadius: 24, background: BRAND, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20, boxShadow: '0 8px 24px rgba(61,90,128,0.3)' }}>
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
          </svg>
        </div>

        <h1 style={{ fontSize: 26, fontWeight: 900, color: '#293241', margin: '0 0 8px', textAlign: 'center' }}>
          Bienvenido a OldFace
        </h1>
        <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 32px', textAlign: 'center', lineHeight: 1.6, maxWidth: 300 }}>
          Para que funcione correctamente, necesitamos que aceptes los siguientes permisos:
        </p>

        {/* Lista de permisos */}
        <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}>
          {PERMISSIONS_LIST.map(p => (
            <div key={p.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, background: 'white', borderRadius: 16, padding: '14px 16px', boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: '#E3EDF2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {p.icon}
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 800, color: '#293241', margin: '0 0 3px' }}>{p.title}</p>
                <p style={{ fontSize: 12, color: '#64748b', margin: 0, lineHeight: 1.5 }}>{p.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={requestAll}
          style={{
            width: '100%', maxWidth: 360,
            padding: '16px', background: BRAND, color: 'white',
            border: 'none', borderRadius: 18, fontWeight: 900, fontSize: 16,
            cursor: 'pointer', boxShadow: '0 6px 20px rgba(119,189,148,0.5)',
          }}
        >
          Aceptar y continuar →
        </button>
        <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 12, textAlign: 'center' }}>
          Puedes cambiar estos permisos en cualquier momento desde los Ajustes del sistema.
        </p>
      </div>
    );
  }

  // Solicitando permisos (pasos 1-4)
  if (step < 99) {
    const current = PERMISSIONS_LIST[step - 1];
    return (
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 24,
      }}>
        <div style={{ background: 'white', borderRadius: 24, padding: '32px 24px', maxWidth: 340, width: '100%', textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, background: '#E3EDF2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            {current?.icon}
          </div>
          <p style={{ fontSize: 16, fontWeight: 900, color: '#293241', margin: '0 0 8px' }}>
            Permiso: {current?.title}
          </p>
          <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 20px', lineHeight: 1.6 }}>
            {current?.desc}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <div style={{ width: 22, height: 22, border: `3px solid #e5e7eb`, borderTopColor: BRAND, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>Esperando respuesta...</span>
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 20 }}>
            {PERMISSIONS_LIST.map((_, i) => (
              <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: i < step ? BRAND : '#e2e8f0' }} />
            ))}
          </div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  // Todos completados
  const allGranted = Object.values(granted).every(Boolean);
  const contactsGranted = granted.contacts;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'linear-gradient(160deg, #E3EDF2 0%, #E3EDF2 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '32px 24px', zIndex: 9999,
    }}>
      <div style={{ width: 72, height: 72, borderRadius: '50%', background: allGranted ? BRAND : '#fef9c3', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20, boxShadow: `0 6px 20px ${allGranted ? 'rgba(61,90,128,0.3)' : 'rgba(0,0,0,0.1)'}` }}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5"/>
        </svg>
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 900, color: '#293241', margin: '0 0 8px', textAlign: 'center' }}>
        {allGranted ? '¡Todo listo!' : 'Configuración completada'}
      </h2>

      <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 8, margin: '20px 0 28px' }}>
        {PERMISSIONS_LIST.map((p, i) => {
          const keys = ['contacts', 'camera', 'location', 'notifications'];
          const ok = granted[keys[i]];
          return (
            <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'white', borderRadius: 14, padding: '12px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
              <span style={{ fontSize: 18 }}>{ok ? '✅' : '⚠️'}</span>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#293241', margin: 0, flex: 1 }}>{p.title}</p>
              <span style={{ fontSize: 11, fontWeight: 600, color: ok ? BRAND : '#f59e0b' }}>{ok ? 'Concedido' : 'Denegado'}</span>
            </div>
          );
        })}
      </div>

      {!contactsGranted && (
        <div style={{ background: '#fef9c3', borderRadius: 14, padding: '12px 16px', maxWidth: 360, width: '100%', marginBottom: 16 }}>
          <p style={{ fontSize: 12, color: '#92400e', margin: 0, lineHeight: 1.5, fontWeight: 600 }}>
            ⚠️ Sin permiso de Contactos no podrás ver qué amigos usan OldFace. Ve a <strong>Ajustes → OldFace → Permisos → Contactos</strong> y actívalo.
          </p>
        </div>
      )}

      <button
        onClick={finish}
        style={{
          width: '100%', maxWidth: 360,
          padding: '16px', background: BRAND, color: 'white',
          border: 'none', borderRadius: 18, fontWeight: 900, fontSize: 16,
          cursor: 'pointer', boxShadow: '0 6px 20px rgba(119,189,148,0.5)',
        }}
      >
        Empezar a usar OldFace →
      </button>
    </div>
  );
}

// ── App principal ─────────────────────────────────────────────────────────────
export default function AppRoot() {
  // null = comprobando, false = mostrar gate, true = saltar gate
  const [permsReady, setPermsReady] = useState(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      // ── 1. Comprobar permiso real de contactos ────────────────────────────
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) {
          // Web: no hay contactos nativos, saltar gate directamente
          if (mounted) setPermsReady(true);
        } else {
          const { Contacts } = await import('@capacitor-community/contacts');
          const status = await Contacts.checkPermissions();
          if (!mounted) return;
          // 'granted'/'limited' → ya concedido, saltar gate
          // 'prompt' (nunca pedido) → mostrar gate para solicitar
          // 'denied' (denegado explícitamente) → saltar gate, el tab de contactos mostrará el error con botón a Ajustes
          if (status.contacts === 'granted' || status.contacts === 'limited') {
            setPermsReady(true);
          } else if (status.contacts === 'prompt') {
            setPermsReady(false); // Mostrar gate para pedir el permiso
          } else {
            // 'denied': ya pasó por el gate antes y denegó, no volver a bloquear la app
            setPermsReady(true);
          }
        }
      } catch {
        // Plugin no disponible (APK viejo o web): usar localStorage como fallback
        if (mounted) setPermsReady(localStorage.getItem(PERMS_KEY) === '1');
      }

      // ── 2. Back button Android — se registra en AppShell con control de llamadas ──
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (Capacitor.isNativePlatform()) {
          // El handler único vive en AppShell (tiene acceso a isCallActiveRef)
          // Aquí solo iniciamos el registro de push notifications.

          try {
            const { PushNotifications } = await import('@capacitor/push-notifications');
            const BACKEND_PUSH = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

            // Guardar token FCM en backend para poder enviar push a este dispositivo
            PushNotifications.addListener('registration', async (tokenData) => {
              const fcmToken = tokenData.value;
              console.log('[Push] FCM token:', fcmToken);
              try {
                const { useAuthStore } = await import('./store/authStore');
                const userId = useAuthStore.getState().user?.id;
                if (userId && fcmToken) {
                  await fetch(`${BACKEND_PUSH}/register-fcm-token`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId, token: fcmToken }),
                  });
                }
              } catch { /* silent */ }
            });

            PushNotifications.addListener('registrationError', (err) => {
              console.error('[Push] registration error:', err.error);
            });

            // Notificación recibida con app en primer plano — reproducir sonido
            PushNotifications.addListener('pushNotificationReceived', (n) => {
              console.log('[Push] primer plano:', n.title);
              // Llamada con la app abierta (aviso solo de datos) → modal de llamada entrante
              const data = n.data || {};
              // Nuevo servicio del taxi con la app a la vista → abrir el taxi con la oferta
              if (data.type === 'taxi_offer' && data.code) {
                if (Number(data.expiresAt) && Date.now() > Number(data.expiresAt)) return;
                openTaxiOffer(data.code);
                return;
              }
              if (data.type === 'call' && data.callerId) {
                if (Date.now() - (Number(data.ts) || 0) > 45000) return;
                import('./store/callStore').then(({ useCallStore }) => {
                  const st = useCallStore.getState();
                  if (st.incomingCall?.callerId === data.callerId) return;   // ya llegó por el socket
                  st.showIncomingCall({ callerId: data.callerId, callerName: data.callerName,
                                        callType: data.callType, roomId: data.roomId || null });
                }).catch(() => {});
              }
            });

            // Usuario pulsa la notificación → navegar al chat o a la llamada
            PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
              const data = action.notification?.data || {};
              if (String(data.type || '').startsWith('taxi_')) {
                // Oferta de viaje (conductor) o cambio del viaje (cliente) → abrir el taxi (si ya está abierto, se actualiza solo)
                if (window.location.pathname !== '/taxi') window.location.href = '/taxi';
                return;
              }
              if (data.type === 'live' && data.directoId) {
                // "X está en directo" → abrir el directo
                window.location.href = `/directo/${encodeURIComponent(data.directoId)}/live`;
                return;
              }
              if (data.type === 'call' && data.callerId) {
                // Llamada entrante via FCM (incluyendo invitaciones a videollamada en curso)
                import('./store/callStore').then(({ useCallStore }) => {
                  useCallStore.getState().setPendingFCMCall({
                    callType:   data.callType || 'video',
                    callerId:   data.callerId,
                    callerName: data.callerName || data.callerId,
                    roomId:     data.roomId    || null,
                    ts:         Number(data.ts) || null,
                  });
                }).catch(() => {});
                return;
              }
              if (data.chatId) {
                window.location.hash = '';
                // Navegar al chat usando la URL directamente (funciona fuera del router)
                window.location.href = `/#/chat/${data.chatId}`;
              }
            });

            // Registrar para recibir push (por si el permiso ya estaba concedido)
            try { await PushNotifications.register(); } catch { /* ya registrado */ }
          } catch { /* silent — PushNotifications no disponible */ }
        }
      } catch { /* silent */ }
    })();

    document.addEventListener('gesturestart', e => e.preventDefault());
    return () => { mounted = false; };
  }, []);

  // Cargando — pantalla en blanco breve mientras se comprueba el permiso
  if (permsReady === null) return null;

  if (!permsReady) {
    return <PermissionsGate onDone={() => {
      localStorage.setItem(PERMS_KEY, '1');
      setPermsReady(true);
    }} />;
  }

  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

// ── Shell interior al BrowserRouter ──────────────────────────────────────────
/**
 * Abrir una oferta de viaje del taxi (conductor): si el taxi ya está abierto se le pasa la oferta (evento
 * 'taxi:offer'); si no, se abre /taxi y el conductor la ve al cargar (dashboard → pendingOffer).
 */
function openTaxiOffer(code, navigate) {
  if (window.location.pathname === '/taxi') {
    window.dispatchEvent(new CustomEvent('taxi:offer', { detail: { code } }));
  } else if (navigate) {
    navigate('/taxi');
  } else {
    window.location.href = '/taxi';
  }
}

function AppShell() {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useAuthStore();
  const { init: initCalls, incomingCall, acceptCall, rejectCall, callError,
          pendingCallOut, clearPendingCall, callAccepted, clearCallAccepted,
          pendingFCMCall, clearPendingFCMCall, showIncomingCall } = useCallStore();

  // Conectar con el servidor RTC propio (llamadas y mensajes en tiempo real) al autenticarse
  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;
    if (!/^[a-zA-Z0-9_-]+$/.test(user.id)) {
      console.warn('[Auth] User ID inválido, forzando re-login:', user.id);
      logout();
      return;
    }
    initCalls(user);

    // Re-enviar token FCM al backend si el usuario acaba de autenticarse
    (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;
        const { PushNotifications } = await import('@capacitor/push-notifications');
        await PushNotifications.register();
      } catch { /* silent */ }
    })();
  }, [isAuthenticated, user?.id]);

  // ── Navegar a call room cuando el usuario inicia una llamada ─────────────
  useEffect(() => {
    if (!pendingCallOut) return;
    const { calleeId, calleeName, callType, roomId } = pendingCallOut;
    clearPendingCall();
    const path = callType === 'video' ? 'video-call' : 'call';
    navigate(`/${path}/${calleeId}`, { state: { chat: { name: calleeName }, isIncoming: false, roomId } });
  }, [pendingCallOut]);

  // ── Navegar a call room cuando el usuario acepta una llamada ─────────────
  useEffect(() => {
    if (!callAccepted) return;
    const { callerId, callerName, callType, roomId } = callAccepted;
    clearCallAccepted();
    const path = callType === 'video' ? 'video-call' : 'call';
    navigate(`/${path}/${callerId}`, { state: { chat: { name: callerName }, isIncoming: true, roomId } });
  }, [callAccepted]);

  // ── Notificación FCM de llamada pulsada → modal Aceptar/Rechazar ──────────
  // (antes entraba directamente en la llamada y el receptor no podía aceptar ni rechazar)
  useEffect(() => {
    if (!pendingFCMCall) return;
    const { callerId, callerName, callType, roomId, ts } = pendingFCMCall;
    clearPendingFCMCall();
    if (ts && Date.now() - ts > 60000) { console.log('[FCM] Llamada caducada, no se muestra'); return; }
    showIncomingCall({ callerId, callerName: callerName || callerId, callType, roomId });
  }, [pendingFCMCall]);

  // ── "Contestar" en la pantalla de llamada nativa (Android) → entrar directamente en la llamada ──
  useEffect(() => {
    if (!isAuthenticated || !window.OldFaceCalls) return;
    const takeAccepted = () => {
      let call = null;
      try { call = JSON.parse(window.OldFaceCalls.takePendingCall() || 'null'); } catch { /* nada */ }
      if (!call || call.action !== 'accept' || !call.callerId) return;
      if (Date.now() - (call.at || 0) > 60000) return;   // contestada hace demasiado
      useCallStore.getState().sendCallSignal(call.callerId, 'call_accept');
      useCallStore.setState({
        incomingCall: null,
        callAccepted: { callerId: call.callerId, callerName: call.callerName || call.callerId,
                        callType: call.callType || 'voice', roomId: call.roomId || null },
      });
    };
    takeAccepted();
    window.addEventListener('oldfacecall', takeAccepted);
    // Una vez: permisos para que las llamadas entren a pantalla completa y en modo ahorro
    try { window.OldFaceCalls.ensureCallPermissions(); } catch { /* app antigua */ }
    return () => window.removeEventListener('oldfacecall', takeAccepted);
  }, [isAuthenticated]);

  // ── "Ver servicio" en la pantalla nativa "Nuevo servicio" del taxi (conductor) → abrir la oferta en el taxi ──
  useEffect(() => {
    if (!isAuthenticated || !window.OldFaceCalls?.takePendingTaxiOffer) return;
    const takeOffer = () => {
      let o = null;
      try { o = JSON.parse(window.OldFaceCalls.takePendingTaxiOffer() || 'null'); } catch { /* nada */ }
      if (o?.code) openTaxiOffer(o.code, navigate);
    };
    takeOffer();
    window.addEventListener('oldfacetaxi', takeOffer);
    return () => window.removeEventListener('oldfacetaxi', takeOffer);
  }, [isAuthenticated]); // eslint-disable-line

  // ── Deep links: https://oldface.app/directo/<id>/live (WhatsApp, etc.) abre la app ──
  useEffect(() => {
    let stop = null;
    listenDeepLinks((path) => {
      if (useAuthStore.getState().isAuthenticated) navigate(path);
      else savePendingLink(path);  // se abre al terminar el login
    }).then(s => { stop = s; }).catch(() => {});
    return () => { stop?.(); };
  }, []);

  // Enlace recibido antes de iniciar sesión → abrirlo al entrar
  useEffect(() => {
    if (!isAuthenticated) return;
    const path = takePendingLink();
    if (path) navigate(path);
  }, [isAuthenticated]);

  // ── Único handler de back button Android ─────────────────────────────────
  useEffect(() => {
    let handle = null;
    (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;
        const { App: CapApp } = await import('@capacitor/app');
        handle = await CapApp.addListener('backButton', ({ canGoBack }) => {
          // No interrumpir llamadas/videollamadas activas con el botón de retroceso
          const path = window.location.pathname;
          if (path.startsWith('/call/') || path.startsWith('/video-call/')) return;
          if (!canGoBack) CapApp.exitApp();
          else window.history.back();
        });
      } catch { /* web: no aplica */ }
    })();
    return () => { handle?.remove?.(); };
  }, []);

  // ── Ringtone cuando hay llamada entrante ──────────────────────────────────
  const isRinging = !!incomingCall;
  useEffect(() => {
    if (!isRinging) return;
    // App Android: el tono de llamada del propio teléfono (y vibración), como una llamada normal
    if (window.OldFaceCalls?.startRingtone) {
      try {
        window.OldFaceCalls.startRingtone();
        return () => { try { window.OldFaceCalls.stopRingtone(); } catch { /* nada */ } };
      } catch { /* app antigua → tono web */ }
    }
    let audioCtx = null;
    let interval = null;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const beep = (time, freq, dur) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'sine'; osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.35, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        osc.start(time); osc.stop(time + dur + 0.02);
      };
      const ring = () => {
        const t = audioCtx.currentTime;
        beep(t, 440, 0.4);        beep(t, 480, 0.4);
        beep(t + 0.65, 440, 0.4); beep(t + 0.65, 480, 0.4);
      };
      ring();
      interval = setInterval(ring, 2400);
    } catch {}
    return () => { clearInterval(interval); try { audioCtx?.close(); } catch {} };
  }, [isRinging]);

  return (
    <>
      <Routes>
        <Route path="/login"   element={<LoginPage />} />
        <Route path="/terms"   element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/cookies" element={<CookiesPage />} />
        <Route path="/"        element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
        <Route path="/chat/:chatId" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
        <Route path="/contacts"    element={<ProtectedRoute><ContactsPage /></ProtectedRoute>} />
        <Route path="/settings"    element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
        <Route path="/directo"     element={<ProtectedRoute><DirectoPage /></ProtectedRoute>} />
        <Route path="/directo/:directoId/live" element={<ProtectedRoute><DirectoLivePage /></ProtectedRoute>} />
        <Route path="/poll"         element={<ProtectedRoute><PollPage /></ProtectedRoute>} />
        <Route path="/poll/:pollId" element={<ProtectedRoute><PollPage /></ProtectedRoute>} />
        <Route path="/karaoke"                 element={<ProtectedRoute><KaraokePage /></ProtectedRoute>} />
        <Route path="/karaoke/cantar/:songId"  element={<ProtectedRoute><KaraokeSingPage /></ProtectedRoute>} />
        <Route path="/karaoke/sala/:roomId"    element={<ProtectedRoute><KaraokeRoomPage /></ProtectedRoute>} />
        <Route path="/taxi" element={<ProtectedRoute><React.Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#f1f5f9' }} />}><TaxiPage /></React.Suspense></ProtectedRoute>} />
        <Route path="/video-call/:userId" element={<ProtectedRoute><VideoCallPage /></ProtectedRoute>} />
        <Route path="/call/:userId"        element={<ProtectedRoute><CallPage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* ── Modal llamada entrante ─────────────────────────────────────── */}
      {incomingCall && (
        <IncomingCallModal
          call={incomingCall}
          onAccept={acceptCall}
          onReject={rejectCall}
        />
      )}

      {/* ── Toast de error de llamada ────────────────────────────────────── */}
      {callError && (
        <div style={{
          position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(15,15,25,0.92)', color: 'white',
          padding: '11px 22px', borderRadius: 24,
          fontSize: 13, fontWeight: 600, zIndex: 999,
          whiteSpace: 'nowrap', boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {callError}
        </div>
      )}
    </>
  );
}

// ── Overlay: llamada saliente en espera ───────────────────────────────────────
function OutgoingCallOverlay({ onCancel, callInfo }) {
  const name    = callInfo?.contactName || '?';
  const isVideo = callInfo?.type === 'video';
  const initial = name[0]?.toUpperCase() || '?';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 201,
      background: 'linear-gradient(160deg, #3D5A80 0%, #111827 100%)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
    }}>
      {/* Avatar del destinatario con pulso animado */}
      <div style={{ position: 'relative', width: 130, height: 130, marginBottom: 24 }}>
        {[0, 1].map(i => (
          <div key={i} style={{
            position: 'absolute',
            inset: i === 0 ? -22 : -11, borderRadius: '50%',
            background: 'rgba(255,255,255,0.08)',
            animation: `vcPulse 2s ease-out infinite ${i * 0.4}s`,
          }} />
        ))}
        <div style={{
          width: 130, height: 130, borderRadius: '50%',
          background: 'rgba(255,255,255,0.18)',
          border: '3px solid rgba(255,255,255,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ color: 'white', fontSize: 64, fontWeight: 900, lineHeight: 1 }}>
            {initial}
          </span>
        </div>
      </div>

      <p style={{ color: 'white', fontSize: 26, fontWeight: 800, margin: '0 0 6px', letterSpacing: '-0.3px' }}>
        {name}
      </p>
      <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, margin: '0 0 8px', fontWeight: 500 }}>
        {isVideo ? 'Videollamada saliente' : 'Llamada de voz saliente'}
      </p>
      <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, margin: '0 0 52px',
                  animation: 'vcFade 1.4s ease-in-out infinite' }}>
        Esperando respuesta...
      </p>
      <button onClick={onCancel} style={{
        width: 70, height: 70, borderRadius: '50%', background: '#ef4444',
        border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 6px 24px rgba(239,68,68,0.5)',
      }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="white" style={{ transform: 'rotate(135deg)' }}>
          <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
        </svg>
      </button>
      <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 10 }}>Cancelar llamada</p>
      <style>{`
        @keyframes vcPulse { 0%{transform:scale(1);opacity:0.6} 100%{transform:scale(1.6);opacity:0} }
        @keyframes vcFade  { 0%,100%{opacity:0.5} 50%{opacity:1} }
      `}</style>
    </div>
  );
}

// ── Modal: llamada entrante ───────────────────────────────────────────────────
function IncomingCallModal({ call, onAccept, onReject }) {
  const [countdown, setCountdown] = React.useState(60);
  const isVideo = call.isVideo !== false;

  // Countdown — se cierra solo cuando llega a 0 (callStore ya limpia incomingCall por timeout)
  React.useEffect(() => {
    const t = setInterval(() => {
      setCountdown(c => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const avatarBg  = isVideo ? '#3D5A80'  : '#3D5A80';
  const acceptBg  = isVideo ? '#22c55e'  : '#22c55e';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        background: 'linear-gradient(160deg, #293241 0%, #0a0a1a 100%)',
        borderRadius: 32, padding: '40px 28px 32px',
        maxWidth: 340, width: '100%',
        textAlign: 'center',
        boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
      }}>

        {/* Avatar con anillos pulsantes */}
        <div style={{ position: 'relative', width: 100, height: 100, margin: '0 auto 24px' }}>
          <div style={{
            position: 'absolute', inset: -18, borderRadius: '50%',
            background: 'rgba(255,255,255,0.05)',
            animation: 'callPulse 2s ease-out infinite',
          }}/>
          <div style={{
            position: 'absolute', inset: -9, borderRadius: '50%',
            background: 'rgba(255,255,255,0.08)',
            animation: 'callPulse 2s ease-out infinite 0.5s',
          }}/>
          <div style={{
            width: 100, height: 100, borderRadius: '50%',
            background: avatarBg,
            border: '3px solid rgba(255,255,255,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative',
          }}>
            <span style={{ fontSize: 40, fontWeight: 900, color: 'white' }}>
              {(call.callerName?.[0] || '?').toUpperCase()}
            </span>
          </div>
        </div>

        {/* Tipo de llamada */}
        <p style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '1.5px',
          color: isVideo ? '#818cf8' : '#4ade80',
          margin: '0 0 8px',
          textTransform: 'uppercase',
        }}>
          {isVideo ? '📹 Videollamada entrante' : '📞 Llamada de voz'}
        </p>

        {/* Nombre */}
        <p style={{ fontSize: 24, fontWeight: 900, color: 'white', margin: '0 0 4px' }}>
          {call.callerName || '?'}
        </p>

        {/* Countdown */}
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', margin: '0 0 36px' }}>
          {countdown > 0 ? `Expira en ${countdown}s` : 'Llamada perdida'}
        </p>

        {/* Botones */}
        <div style={{ display: 'flex', gap: 32, justifyContent: 'center', alignItems: 'center' }}>

          {/* Rechazar */}
          <div style={{ textAlign: 'center' }}>
            <button onClick={onReject} style={{
              width: 72, height: 72, borderRadius: '50%',
              background: '#ef4444', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 6px 24px rgba(239,68,68,0.5)',
            }}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="white" style={{ transform: 'rotate(135deg)' }}>
                <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
              </svg>
            </button>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', margin: '10px 0 0', fontWeight: 700 }}>
              Rechazar
            </p>
          </div>

          {/* Aceptar */}
          <div style={{ textAlign: 'center' }}>
            <button onClick={onAccept} style={{
              width: 72, height: 72, borderRadius: '50%',
              background: acceptBg, border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 6px 24px rgba(34,197,94,0.5)',
              animation: 'callBounce 0.8s ease-in-out infinite',
            }}>
              {isVideo ? (
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 10l4.553-2.069A1 1 0 0121 8.868v6.264a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                </svg>
              ) : (
                <svg width="30" height="30" viewBox="0 0 24 24" fill="white">
                  <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
                </svg>
              )}
            </button>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', margin: '10px 0 0', fontWeight: 700 }}>
              Aceptar
            </p>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes callPulse  { 0%{transform:scale(1);opacity:0.6} 100%{transform:scale(1.6);opacity:0} }
        @keyframes callBounce { 0%,100%{transform:scale(1)} 50%{transform:scale(1.08)} }
      `}</style>
    </div>
  );
}
