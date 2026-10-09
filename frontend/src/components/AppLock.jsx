/**
 * AppLock — bloqueo de la app con PIN (+ huella/cara).
 *
 *  · Se bloquea al abrir la app y al volver tras estar fuera el tiempo elegido en Ajustes.
 *  · No se bloquea durante una llamada (al minimizarla y volver, sigue la llamada).
 *  · Las llamadas entrantes se ven por encima (su aviso tiene zIndex 9999; este 9000).
 *  · "¿Olvidaste el PIN?" → cerrar sesión en este dispositivo (se vuelve a entrar con el código).
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { usePrefsStore } from '../store/prefsStore';
import { useAuthStore } from '../store/authStore';
import { tr } from '../i18n';

const IN_CALL = /^\/(call|video-call|group-call)\//;

/** ¿Hay huella/cara en este móvil? (false en el navegador o sin el plugin) */
export async function biometricAvailable() {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return false;
    const { NativeBiometric } = await import('@capgo/capacitor-native-biometric');
    const r = await NativeBiometric.isAvailable({ useFallback: false });
    return !!r?.isAvailable;
  } catch { return false; }
}

export async function verifyBiometric(title = tr('Desbloquear OldFace')) {
  const { NativeBiometric } = await import('@capgo/capacitor-native-biometric');
  await NativeBiometric.verifyIdentity({
    title, subtitle: tr('Usa tu huella o tu cara'), negativeButtonText: tr('Usar PIN'), maxAttempts: 5,
  });
}

export default function AppLock() {
  const lock = usePrefsStore(s => s.lock);
  const checkPin = usePrefsStore(s => s.checkPin);
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  const [locked, setLocked] = useState(() => usePrefsStore.getState().lock.enabled);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [forgot, setForgot] = useState(false);
  const leftAt = useRef(null);
  const bioBusy = useRef(false);

  const active = isAuthenticated && lock.enabled && !!lock.pinHash;

  // Salir / volver a la app
  useEffect(() => {
    if (!active) return;
    const onLeave = () => { if (leftAt.current == null && !bioBusy.current) leftAt.current = Date.now(); };
    const onBack = () => {
      const t = leftAt.current;
      leftAt.current = null;
      if (t == null || IN_CALL.test(window.location.pathname)) return;
      if ((Date.now() - t) / 1000 >= (usePrefsStore.getState().lock.after ?? 60)) setLocked(true);
    };
    const onVis = () => (document.hidden ? onLeave() : onBack());
    document.addEventListener('visibilitychange', onVis);
    let removeApp = null;
    import('@capacitor/core').then(async ({ Capacitor }) => {
      if (!Capacitor.isNativePlatform()) return;
      const { App: CapApp } = await import('@capacitor/app');
      const h = await CapApp.addListener('appStateChange', ({ isActive }) => (isActive ? onBack() : onLeave()));
      removeApp = () => h.remove();
    }).catch(() => {});
    return () => { document.removeEventListener('visibilitychange', onVis); removeApp?.(); };
  }, [active]);

  const unlock = () => { setLocked(false); setPin(''); setError(''); setForgot(false); };

  const tryBiometric = useCallback(async () => {
    if (bioBusy.current || !usePrefsStore.getState().lock.biometric) return;
    bioBusy.current = true;
    // El cuadro de la huella pausa la app un instante: que no cuente como "salir"
    try { await verifyBiometric(); unlock(); } catch { /* canceló → PIN */ }
    finally { leftAt.current = null; setTimeout(() => { bioBusy.current = false; }, 600); }
  }, []);

  const show = active && locked && !IN_CALL.test(window.location.pathname);

  useEffect(() => { if (show && lock.biometric) tryBiometric(); }, [show]); // eslint-disable-line

  if (!show) return null;

  const press = async (d) => {
    if (pin.length >= 6) return;
    const next = pin + d;
    setPin(next);
    setError('');
    if (next.length >= 4 && await checkPin(next)) unlock();
    else if (next.length === 6) { setError(tr('PIN incorrecto')); setTimeout(() => setPin(''), 350); }
  };

  const logoutHere = () => {
    usePrefsStore.getState().disableLock();
    useAuthStore.getState().logout();
    window.location.replace('/login');
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'linear-gradient(160deg, #3D5A80 0%, #111827 100%)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24,
                  paddingTop: 'calc(var(--sat, 0px) + 24px)', paddingBottom: 'calc(var(--sab, 0px) + 24px)', userSelect: 'none' }}>
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>
      </svg>
      <p style={{ color: 'white', fontWeight: 800, fontSize: 19, margin: '14px 0 4px' }}>{tr('OldFace está bloqueado')}</p>
      <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, margin: 0 }}>{tr('Introduce tu PIN')}</p>

      <div style={{ display: 'flex', gap: 14, margin: '26px 0 8px', height: 16 }}>
        {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
          <span key={i} style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid white',
                                 background: i < pin.length ? 'white' : 'transparent' }} />
        ))}
      </div>
      <p style={{ color: '#fecaca', fontSize: 13, fontWeight: 700, height: 18, margin: '0 0 12px' }}>{error}</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 72px)', gap: 16 }}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => <Key key={d} onPress={() => press(d)}>{d}</Key>)}
        {lock.biometric
          ? <Key onPress={tryBiometric} label={tr('Usar huella o cara')}><FingerIcon /></Key>
          : <span />}
        <Key onPress={() => press('0')}>0</Key>
        <Key onPress={() => { setPin(p => p.slice(0, -1)); setError(''); }} label={tr('Borrar')}><BackIcon /></Key>
      </div>

      {forgot ? (
        <div style={{ marginTop: 22, textAlign: 'center', maxWidth: 300 }}>
          <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, margin: '0 0 10px' }}>{tr('Se cerrará la sesión en este dispositivo y se quitará el bloqueo. Tus chats siguen en tu cuenta: vuelve a entrar con tu teléfono.')}</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button onClick={() => setForgot(false)} style={linkBtn}>{tr('Cancelar')}</button>
            <button onClick={logoutHere} style={{ ...linkBtn, background: '#ef4444', color: 'white' }}>{tr('Cerrar sesión')}</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setForgot(true)} style={{ ...linkBtn, marginTop: 22, background: 'none' }}>{tr('¿Olvidaste el PIN?')}</button>
      )}
    </div>
  );
}

const linkBtn = { border: 'none', borderRadius: 16, padding: '8px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                  background: 'rgba(255,255,255,0.15)', color: 'white' };

function Key({ children, onPress, label }) {
  return (
    <button onClick={onPress} aria-label={label}
      style={{ width: 72, height: 72, borderRadius: '50%', border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.12)',
               color: 'white', fontSize: 28, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {children}
    </button>
  );
}

const FingerIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 11c0 3.5-1 6.5-2.5 9M8.5 6.5A6 6 0 0118 11c0 2.5-.3 4.8-1 7M6 9.5A6 6 0 006 13c0 2-.4 3.6-1 5M12 7a4 4 0 014 4c0 3-.5 5.8-1.5 8.5M8 11a4 4 0 01.3-1.5"/>
  </svg>
);
const BackIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/>
  </svg>
);
