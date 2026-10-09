/**
 * SettingsPage — Ajustes de usuario estilo WhatsApp
 * Avatar, nombre, estado, teléfono, notificaciones, privacidad, etc.
 */
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import Avatar from '../components/Avatar.jsx';
import { usePrefsStore, MESSAGE_TONES, LOCK_AFTER } from '../store/prefsStore';
import { playTone } from '../utils/sounds';
import { biometricAvailable, verifyBiometric } from '../components/AppLock.jsx';
import LinkedDevicesSheet from '../components/LinkedDevicesSheet.jsx';
import { tr } from '../i18n';

const BRAND   = '#3D5A80';
const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

/** Recorta y comprime la imagen a 150×150 JPEG < 30KB */
function compressAvatar(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width  = 150;
        canvas.height = 150;
        const ctx = canvas.getContext('2d');
        // Recorte cuadrado centrado
        const side = Math.min(img.width, img.height);
        const sx   = (img.width  - side) / 2;
        const sy   = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, 150, 150);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const { user, setUser, logout } = useAuthStore();
  const { theme, setTheme } = useThemeStore();
  const isDark = theme === 'dark';

  const [editName, setEditName] = useState(false);
  const [editStatus, setEditStatus] = useState(false);
  const [name, setName] = useState(user?.name || '');
  const [status, setStatus] = useState(user?.status || tr('¡Hola! Estoy usando OldFace 👋'));
  const [avatarSrc, setAvatarSrc] = useState(user?.avatar || null);
  const [saving, setSaving] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const fileRef = useRef(null);

  // ── Avatar upload — comprime a 150×150 JPEG y guarda en backend + localStorage ──
  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { alert(tr('La imagen no puede superar 10MB')); return; }
    try {
      const compressed = await compressAvatar(file);
      setAvatarSrc(compressed);
      setUser({ ...user, avatar: compressed });
      // Guardar en backend para que otros usuarios puedan ver la foto
      fetch(`${BACKEND}/user/avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, avatar: compressed }),
      }).catch(() => {});
    } catch {
      alert(tr('No se pudo procesar la imagen'));
    }
  };

  // ── Save name ──
  const saveName = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await new Promise(r => setTimeout(r, 400)); // simula guardado
    setUser({ ...user, name: name.trim() });
    setSaving(false);
    setEditName(false);
  };

  // ── Save status ──
  const saveStatus = async () => {
    setSaving(true);
    await new Promise(r => setTimeout(r, 300));
    setUser({ ...user, status: status.trim() });
    setSaving(false);
    setEditStatus(false);
  };

  // ── Logout ──
  const handleLogout = () => {
    if (window.confirm(tr('¿Seguro que quieres cerrar sesión?'))) {
      usePrefsStore.getState().disableLock();   // el bloqueo es de esta sesión
      logout();
      navigate('/login', { replace: true });
    }
  };

  // Estilos dinámicos según tema
  const bg       = isDark ? 'linear-gradient(160deg, #293241 0%, #141A2A 100%)' : undefined;
  const cardBg   = isDark ? '#2F3A4D' : 'white';
  const labelClr = isDark ? '#98C1D9' : '#6b7280';
  const textClr  = isDark ? '#E0FBFC' : '#1f2937';
  const borderClr= isDark ? 'rgba(255,255,255,0.07)' : '#f9fafb';

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: bg, backgroundColor: isDark ? undefined : '#f9fafb' }}>
      {/* ── Header ── */}
      <div
        className="flex-shrink-0 px-4 pb-4"
        style={{ backgroundColor: isDark ? '#222A38' : BRAND, paddingTop: 'var(--sat)', borderBottom: isDark ? '1px solid rgba(255,255,255,0.07)' : 'none' }}
      >
        <div className="flex items-center gap-3 pt-2">
          <button onClick={() => navigate(-1)} className="text-white p-1 -ml-1 active:opacity-70">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-white font-black text-xl">{tr('Ajustes')}</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scroll-hide">
        {/* ── Perfil card ── */}
        <div className="mx-4 mt-4 rounded-3xl shadow-sm overflow-hidden" style={{ backgroundColor: cardBg }}>
          {/* Avatar section */}
          <div className="flex flex-col items-center pt-8 pb-6 px-4" style={{ background: isDark ? `linear-gradient(to bottom, rgba(119,189,148,0.12), ${cardBg})` : `linear-gradient(to bottom, ${BRAND}15, white)` }}>
            <div className="relative mb-4">
              {avatarSrc ? (
                <img
                  src={avatarSrc}
                  alt={tr('Avatar')}
                  className="w-24 h-24 rounded-full object-cover border-4 border-white shadow-lg"
                />
              ) : (
                <div
                  className="w-24 h-24 rounded-full flex items-center justify-center border-4 border-white shadow-lg"
                  style={{ backgroundColor: BRAND }}
                >
                  <span className="text-white text-4xl font-black">
                    {(user?.name || 'U')[0].toUpperCase()}
                  </span>
                </div>
              )}
              {/* Camera button */}
              <button
                onClick={() => fileRef.current?.click()}
                className="absolute bottom-0 right-0 w-9 h-9 rounded-full flex items-center justify-center shadow-md active:opacity-80 border-2 border-white"
                style={{ backgroundColor: BRAND }}
              >
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
            </div>
            <p className="text-xs font-medium" style={{ color: labelClr }}>{tr('Toca la cámara para cambiar tu foto')}</p>
          </div>

          {/* Nombre */}
          <div className="px-5 py-4" style={{ borderTop: `1px solid ${borderClr}` }}>
            <p className="text-xs font-bold mb-1.5" style={{ color: BRAND }}>{tr('TU NOMBRE')}</p>
            {editName ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  maxLength={40}
                  autoFocus
                  className="flex-1 font-semibold text-base outline-none border-b-2 pb-1 bg-transparent"
                  style={{ borderBottomColor: BRAND, color: textClr }}
                />
                <button onClick={saveName} disabled={saving}
                  className="text-sm font-bold px-3 py-1 rounded-xl text-white active:opacity-80"
                  style={{ backgroundColor: BRAND }}
                >
                  {saving ? '...' : tr('Guardar')}
                </button>
                <button onClick={() => { setEditName(false); setName(user?.name || ''); }}
                  className="text-sm font-semibold px-2 py-1"
                  style={{ color: labelClr }}
                >{tr('Cancelar')}</button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <p className="font-semibold text-base" style={{ color: textClr }}>{user?.name || tr('Sin nombre')}</p>
                <button onClick={() => setEditName(true)} className="p-1.5 rounded-lg">
                  <svg className="w-4 h-4" style={{ color: labelClr }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          {/* Estado / Info */}
          <div className="px-5 py-4" style={{ borderTop: `1px solid ${borderClr}` }}>
            <p className="text-xs font-bold mb-1.5" style={{ color: BRAND }}>{tr('ESTADO')}</p>
            {editStatus ? (
              <div className="flex items-start gap-2">
                <textarea
                  value={status}
                  onChange={e => setStatus(e.target.value)}
                  maxLength={120}
                  rows={2}
                  autoFocus
                  className="flex-1 font-medium text-sm outline-none border-b-2 pb-1 resize-none bg-transparent"
                  style={{ borderBottomColor: BRAND, color: textClr }}
                />
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <button onClick={saveStatus} disabled={saving}
                    className="text-xs font-bold px-3 py-1 rounded-xl text-white"
                    style={{ backgroundColor: BRAND }}
                  >
                    {saving ? '...' : 'OK'}
                  </button>
                  <button onClick={() => { setEditStatus(false); setStatus(user?.status || ''); }}
                    className="text-xs font-semibold px-2 py-1"
                    style={{ color: labelClr }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <p className="font-medium text-sm flex-1 pr-2" style={{ color: labelClr }}>{user?.status || tr('¡Hola! Estoy usando OldFace 👋')}</p>
                <button onClick={() => setEditStatus(true)} className="p-1.5 rounded-lg flex-shrink-0">
                  <svg className="w-4 h-4" style={{ color: labelClr }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          {/* Teléfono (solo lectura) */}
          <div className="px-5 py-4" style={{ borderTop: `1px solid ${borderClr}` }}>
            <p className="text-xs font-bold mb-1.5" style={{ color: BRAND }}>{tr('TELÉFONO')}</p>
            <p className="font-semibold text-base" style={{ color: textClr }}>{user?.phone || '—'}</p>
          </div>
        </div>

        {/* ── Dispositivos vinculados (ordenador / tablet con la misma cuenta) ── */}
        <div className="mx-4 mt-4 rounded-3xl shadow-sm overflow-hidden" style={{ backgroundColor: cardBg }}>
          <button onClick={() => setShowDevices(true)} className="w-full flex items-center gap-3 px-5 py-4 text-left">
            <span className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: isDark ? 'rgba(152,193,217,0.15)' : '#E3EDF2' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={isDark ? '#98C1D9' : BRAND} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="14" height="10" rx="2"/><path d="M6 18h6M9 14v4"/><rect x="17" y="8" width="5" height="12" rx="1"/>
              </svg>
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-semibold text-sm" style={{ color: textClr }}>{tr('Dispositivos vinculados')}</span>
              <span className="block text-xs mt-0.5" style={{ color: labelClr }}>{tr('Usa OldFace en el ordenador o en una tablet')}</span>
            </span>
            <svg className="w-4 h-4" style={{ color: labelClr }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
        {showDevices && <LinkedDevicesSheet onClose={() => setShowDevices(false)} />}

        {/* ── Sección: Sonidos (tono de mensaje) ── */}
        <ToneSection userId={user?.id} cardBg={cardBg} textClr={textClr} labelClr={labelClr} borderClr={borderClr} />

        {/* ── Sección: Bloqueo de la app (PIN + huella/cara) ── */}
        <LockSection cardBg={cardBg} textClr={textClr} labelClr={labelClr} borderClr={borderClr} isDark={isDark} />

        {/* ── Sección: Privacidad ── */}
        <SettingsSection title={tr('Privacidad')} icon="🔒" cardBg={cardBg} textClr={textClr} labelClr={labelClr} borderClr={borderClr} items={[
          { label: tr('Última vez'), value: tr('Todos') },
          { label: tr('Foto de perfil'), value: tr('Todos') },
          { label: tr('Estado'), value: tr('Mis contactos') },
          { label: tr('Confirmación de lectura'), toggle: true, defaultOn: true },
        ]} />

        {/* ── Sección: Apariencia ── */}
        <AppearanceSection isDark={isDark} setTheme={setTheme} cardBg={cardBg} textClr={textClr} borderClr={borderClr} />

        {/* ── Sección: Almacenamiento ── */}
        <SettingsSection title={tr('Almacenamiento y datos')} icon="💾" cardBg={cardBg} textClr={textClr} labelClr={labelClr} borderClr={borderClr} items={[
          { label: tr('Uso de red'), value: '—' },
          { label: tr('Descarga automática'), value: 'WiFi' },
        ]} />

        {/* ── Sección: Ayuda ── */}
        <SettingsSection title={tr('Ayuda')} icon="❓" cardBg={cardBg} textClr={textClr} labelClr={labelClr} borderClr={borderClr} items={[
          { label: tr('Centro de ayuda'), action: true },
          { label: tr('Términos y política de privacidad'), action: true },
          { label: tr('Información de la app'), value: 'v1.0.0' },
        ]} />

        {/* ── Cerrar sesión ── */}
        <div className="mx-4 mb-8 mt-2">
          <button
            onClick={handleLogout}
            className="w-full py-4 rounded-2xl font-bold text-base transition-colors shadow-sm"
            style={{
              color: '#ef4444',
              backgroundColor: isDark ? 'rgba(239,68,68,0.08)' : 'white',
              border: isDark ? '1.5px solid rgba(239,68,68,0.25)' : '2px solid #fee2e2',
            }}
          >{tr('Cerrar sesión')}</button>
        </div>
      </div>
    </div>
  );
}

// ── Cabecera de tarjeta (mismo estilo que SettingsSection) ──
function CardTitle({ children, labelClr, borderClr }) {
  return (
    <div className="px-5 py-3" style={{ borderBottom: `1px solid ${borderClr}` }}>
      <p className="text-xs font-black tracking-wider uppercase" style={{ color: labelClr }}>{children}</p>
    </div>
  );
}

function Toggle({ on, onPress, label }) {
  return (
    <button onClick={onPress} aria-label={label} aria-pressed={on}
      className="relative w-12 h-6 rounded-full transition-colors duration-200 flex items-center flex-shrink-0"
      style={{ backgroundColor: on ? BRAND : 'rgba(120,140,170,0.3)' }}>
      <span className="absolute w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200"
        style={{ transform: on ? 'translateX(26px)' : 'translateX(2px)' }} />
    </button>
  );
}

// ── Sonidos: tono de los mensajes nuevos (con vista previa al elegirlo) ──
function ToneSection({ userId, cardBg, textClr, labelClr, borderClr }) {
  const tone = usePrefsStore(s => s.messageTone);
  const setTone = usePrefsStore(s => s.setMessageTone);
  return (
    <div className="mx-4 mt-4 rounded-3xl shadow-sm overflow-hidden" style={{ backgroundColor: cardBg }}>
      <CardTitle labelClr={labelClr} borderClr={borderClr}>{tr('🔔 Sonidos · Tono de mensaje')}</CardTitle>
      {MESSAGE_TONES.map((t, i) => (
        <button key={t.id} onClick={() => { setTone(t.id, userId); playTone(t.id); }}
          className="w-full flex items-center justify-between px-5 py-3.5 text-left"
          style={{ borderBottom: i < MESSAGE_TONES.length - 1 ? `1px solid ${borderClr}` : 'none' }}>
          <span className="font-semibold text-sm" style={{ color: textClr }}>{t.name}</span>
          <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ border: `2px solid ${tone === t.id ? BRAND : 'rgba(120,140,170,0.5)'}` }}>
            {tone === t.id && <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: BRAND }} />}
          </span>
        </button>
      ))}
      <p className="px-5 pb-4 pt-1 text-xs" style={{ color: labelClr }}>{tr('Suena al recibir un mensaje, también con la app cerrada. Las llamadas usan el tono de llamada del móvil.')}</p>
    </div>
  );
}

// ── Bloqueo de la app: PIN de 4-6 cifras + huella/cara + cuándo se bloquea ──
function LockSection({ cardBg, textClr, labelClr, borderClr, isDark }) {
  const lock = usePrefsStore(s => s.lock);
  const { setLockOption, disableLock } = usePrefsStore.getState();
  const [pinSheet, setPinSheet] = useState(false);   // false | 'enable' | 'change'
  const [bioOk, setBioOk] = useState(false);

  useEffect(() => { biometricAvailable().then(setBioOk); }, []);

  const toggleBio = async () => {
    if (lock.biometric) { setLockOption({ biometric: false }); return; }
    try { await verifyBiometric(tr('Activar huella o cara')); setLockOption({ biometric: true }); } catch { /* canceló */ }
  };

  const row = (children, last) => (
    <div className="flex items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: last ? 'none' : `1px solid ${borderClr}` }}>
      {children}
    </div>
  );

  return (
    <div className="mx-4 mt-4 rounded-3xl shadow-sm overflow-hidden" style={{ backgroundColor: cardBg }}>
      <CardTitle labelClr={labelClr} borderClr={borderClr}>{tr('🔒 Bloqueo de la app')}</CardTitle>
      {row(<>
        <div className="min-w-0">
          <p className="font-semibold text-sm" style={{ color: textClr }}>{tr('Bloquear con PIN')}</p>
          <p className="text-xs mt-0.5" style={{ color: labelClr }}>{tr('Pide el PIN al abrir OldFace')}</p>
        </div>
        <Toggle on={lock.enabled} label={tr('Bloquear con PIN')} onPress={() => (lock.enabled ? disableLock() : setPinSheet('enable'))} />
      </>, !lock.enabled)}

      {lock.enabled && <>
        {bioOk && row(<>
          <div className="min-w-0">
            <p className="font-semibold text-sm" style={{ color: textClr }}>{tr('Desbloquear con huella o cara')}</p>
            <p className="text-xs mt-0.5" style={{ color: labelClr }}>{tr('El PIN sigue sirviendo siempre')}</p>
          </div>
          <Toggle on={lock.biometric} label={tr('Desbloquear con huella o cara')} onPress={toggleBio} />
        </>)}
        <div className="px-5 py-4" style={{ borderBottom: `1px solid ${borderClr}` }}>
          <p className="font-semibold text-sm mb-2" style={{ color: textClr }}>{tr('Bloquear automáticamente')}</p>
          <div className="flex flex-wrap gap-2">
            {LOCK_AFTER.map(o => (
              <button key={o.secs} onClick={() => setLockOption({ after: o.secs })}
                className="px-3 py-1.5 rounded-full text-xs font-bold"
                style={lock.after === o.secs
                  ? { backgroundColor: BRAND, color: 'white' }
                  : { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#E3EDF2', color: textClr }}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
        {row(<>
          <p className="font-semibold text-sm" style={{ color: textClr }}>{tr('Cambiar PIN')}</p>
          <button onClick={() => setPinSheet('change')} className="text-sm font-bold" style={{ color: BRAND }}>{tr('Cambiar')}</button>
        </>, true)}
      </>}

      {pinSheet && <PinSheet mode={pinSheet} onClose={() => setPinSheet(false)} />}
    </div>
  );
}

/** Elegir PIN: se escribe dos veces (4-6 cifras) */
function PinSheet({ mode, onClose }) {
  const setPin = usePrefsStore(s => s.setPin);
  const [first, setFirst] = useState(null);
  const [pin, setPinVal] = useState('');
  const [error, setError] = useState('');

  const confirmStep = first !== null;
  const submit = async () => {
    if (pin.length < 4) { setError(tr('El PIN debe tener entre 4 y 6 cifras')); return; }
    if (!confirmStep) { setFirst(pin); setPinVal(''); setError(''); return; }
    if (pin !== first) { setError(tr('Los PIN no coinciden. Vuelve a empezar.')); setFirst(null); setPinVal(''); return; }
    await setPin(pin);
    onClose();
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: '100%', background: 'white', borderRadius: '22px 22px 0 0', padding: 22, paddingBottom: 'calc(var(--sab, 0px) + 22px)' }}>
        <p style={{ margin: 0, fontWeight: 800, fontSize: 17, color: '#293241' }}>
          {mode === 'change' ? tr('Nuevo PIN') : tr('Crea tu PIN')}
        </p>
        <p style={{ margin: '4px 0 16px', fontSize: 13, color: '#6b7280' }}>
          {confirmStep ? tr('Escríbelo otra vez para confirmarlo') : tr('Entre 4 y 6 cifras. Lo pediremos al abrir OldFace.')}
        </p>
        <input
          type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={6} value={pin}
          onChange={e => { setPinVal(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(''); }}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          aria-label="PIN"
          style={{ width: '100%', fontSize: 28, letterSpacing: 12, textAlign: 'center', padding: '10px 0', borderRadius: 14,
                   border: `2px solid ${error ? '#ef4444' : '#D5E6F0'}`, outline: 'none', color: '#293241' }}
        />
        <p style={{ minHeight: 18, margin: '8px 0', color: '#ef4444', fontSize: 13, fontWeight: 600 }}>{error}</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 13, borderRadius: 14, border: 'none', background: '#E3EDF2', color: '#293241', fontWeight: 700, fontSize: 15 }}>{tr('Cancelar')}</button>
          <button onClick={submit} style={{ flex: 1, padding: 13, borderRadius: 14, border: 'none', background: BRAND, color: 'white', fontWeight: 800, fontSize: 15 }}>
            {confirmStep ? tr('Guardar') : tr('Siguiente')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Componente reutilizable de sección ──
function SettingsSection({ title, icon, items, cardBg, textClr, labelClr, borderClr }) {
  const [toggles, setToggles] = useState(() => {
    const t = {};
    items.forEach((item, i) => { if (item.toggle) t[i] = item.defaultOn ?? true; });
    return t;
  });

  return (
    <div className="mx-4 mt-4 rounded-3xl shadow-sm overflow-hidden" style={{ backgroundColor: cardBg }}>
      <div className="px-5 py-3" style={{ borderBottom: `1px solid ${borderClr}` }}>
        <p className="text-xs font-black tracking-wider uppercase" style={{ color: labelClr }}>
          {icon} {title}
        </p>
      </div>
      {items.map((item, i) => (
        <div
          key={i}
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: i < items.length - 1 ? `1px solid ${borderClr}` : 'none' }}
        >
          <p className="font-semibold text-sm" style={{ color: textClr }}>{item.label}</p>
          {item.toggle && (
            <button
              onClick={() => setToggles(t => ({ ...t, [i]: !t[i] }))}
              className="relative w-12 h-6 rounded-full transition-colors duration-200 flex items-center"
              style={{ backgroundColor: toggles[i] ? '#3D5A80' : 'rgba(120,140,170,0.3)' }}
            >
              <span
                className="absolute w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200"
                style={{ transform: toggles[i] ? 'translateX(26px)' : 'translateX(2px)' }}
              />
            </button>
          )}
          {item.value && (
            <span className="text-sm font-medium" style={{ color: labelClr }}>{item.value}</span>
          )}
          {item.action && (
            <svg className="w-4 h-4" style={{ color: labelClr }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Sección Apariencia: tarjetas visuales Oscuro / Claro ──
function AppearanceSection({ isDark, setTheme, cardBg, textClr, labelClr, borderClr }) {
  return (
    <div className="mx-4 mt-4 rounded-3xl shadow-sm overflow-hidden" style={{ backgroundColor: cardBg }}>
      {/* Título */}
      <div className="px-5 py-3" style={{ borderBottom: `1px solid ${borderClr}` }}>
        <p className="text-xs font-black tracking-wider uppercase" style={{ color: labelClr }}>{tr('🎨 Apariencia')}</p>
      </div>

      {/* Tarjetas de modo */}
      <div className="px-5 py-5 flex gap-4">

        {/* ── Tarjeta OSCURO ── */}
        <button
          onClick={() => setTheme('dark')}
          className="flex-1 rounded-2xl overflow-hidden transition-all duration-200"
          style={{
            border: isDark ? '2px solid #3D5A80' : '2px solid rgba(120,140,170,0.2)',
            boxShadow: isDark ? '0 0 0 1px rgba(119,189,148,0.3), 0 6px 20px rgba(0,0,0,0.4)' : '0 2px 8px rgba(0,0,0,0.15)',
          }}
        >
          {/* Preview oscuro */}
          <div style={{ background: 'linear-gradient(160deg, #293241 0%, #141A2A 100%)', padding: '10px 10px 8px' }}>
            {/* Mini header */}
            <div style={{ height: 8, borderRadius: 4, width: '60%', background: '#222A38', marginBottom: 6 }} />
            {/* Mini burbujas */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
              <div style={{ height: 7, width: '55%', borderRadius: 6, background: 'linear-gradient(135deg,#293241,#3D5A80)' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 4 }}>
              <div style={{ height: 7, width: '45%', borderRadius: 6, background: '#0c2a5e' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{ height: 7, width: '40%', borderRadius: 6, background: 'linear-gradient(135deg,#293241,#3D5A80)' }} />
            </div>
          </div>
          {/* Label */}
          <div style={{ padding: '8px 10px 10px', background: cardBg }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: isDark ? '#3D5A80' : textClr }}>{tr('Oscuro')}</span>
              {isDark && (
                <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#3D5A80', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </span>
              )}
            </div>
            <p style={{ fontSize: 10, color: labelClr, marginTop: 2 }}>{tr('Por defecto')}</p>
          </div>
        </button>

        {/* ── Tarjeta CLARO ── */}
        <button
          onClick={() => setTheme('light')}
          className="flex-1 rounded-2xl overflow-hidden transition-all duration-200"
          style={{
            border: !isDark ? '2px solid #3D5A80' : '2px solid rgba(120,140,170,0.2)',
            boxShadow: !isDark ? '0 0 0 1px rgba(119,189,148,0.3), 0 6px 20px rgba(0,0,0,0.2)' : '0 2px 8px rgba(0,0,0,0.15)',
          }}
        >
          {/* Preview claro */}
          <div style={{ background: '#f9fafb', padding: '10px 10px 8px' }}>
            {/* Mini header */}
            <div style={{ height: 8, borderRadius: 4, width: '60%', background: '#3D5A80', marginBottom: 6 }} />
            {/* Mini burbujas */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
              <div style={{ height: 7, width: '55%', borderRadius: 6, background: '#D5E6F0' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 4 }}>
              <div style={{ height: 7, width: '45%', borderRadius: 6, background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{ height: 7, width: '40%', borderRadius: 6, background: '#D5E6F0' }} />
            </div>
          </div>
          {/* Label */}
          <div style={{ padding: '8px 10px 10px', background: cardBg }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: !isDark ? '#3D5A80' : textClr }}>{tr('Claro')}</span>
              {!isDark && (
                <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#3D5A80', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </span>
              )}
            </div>
            <p style={{ fontSize: 10, color: labelClr, marginTop: 2 }}>{tr('Opcional')}</p>
          </div>
        </button>
      </div>
    </div>
  );
}
