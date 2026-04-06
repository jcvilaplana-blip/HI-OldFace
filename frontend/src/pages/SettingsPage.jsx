/**
 * SettingsPage — Ajustes de usuario estilo WhatsApp
 * Avatar, nombre, estado, teléfono, notificaciones, privacidad, etc.
 */
import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import Avatar from '../components/Avatar.jsx';

const BRAND = '#000080';

export default function SettingsPage() {
  const navigate = useNavigate();
  const { user, setUser, logout } = useAuthStore();
  const { theme, setTheme } = useThemeStore();
  const isDark = theme === 'dark';

  const [editName, setEditName] = useState(false);
  const [editStatus, setEditStatus] = useState(false);
  const [name, setName] = useState(user?.name || '');
  const [status, setStatus] = useState(user?.status || '¡Hola! Estoy usando OldFace 👋');
  const [avatarSrc, setAvatarSrc] = useState(user?.avatar || null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  // ── Avatar upload ──
  const handleAvatarChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert('La imagen no puede superar 5MB'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      setAvatarSrc(dataUrl);
      setUser({ ...user, avatar: dataUrl });
    };
    reader.readAsDataURL(file);
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
    if (window.confirm('¿Seguro que quieres cerrar sesión?')) {
      logout();
      navigate('/login', { replace: true });
    }
  };

  // Estilos dinámicos según tema
  const bg       = isDark ? 'linear-gradient(160deg, #021d4a 0%, #021132 100%)' : undefined;
  const cardBg   = isDark ? '#041e50' : 'white';
  const labelClr = isDark ? '#8fb3dd' : '#6b7280';
  const textClr  = isDark ? '#dce8ff' : '#1f2937';
  const borderClr= isDark ? 'rgba(255,255,255,0.07)' : '#f9fafb';

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: bg, backgroundColor: isDark ? undefined : '#f9fafb' }}>
      {/* ── Header ── */}
      <div
        className="flex-shrink-0 px-4 pb-4"
        style={{ backgroundColor: isDark ? '#031640' : BRAND, paddingTop: 'env(safe-area-inset-top, 44px)', borderBottom: isDark ? '1px solid rgba(255,255,255,0.07)' : 'none' }}
      >
        <div className="flex items-center gap-3 pt-2">
          <button onClick={() => navigate(-1)} className="text-white p-1 -ml-1 active:opacity-70">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-white font-black text-xl">Ajustes</h1>
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
                  alt="Avatar"
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
            <p className="text-xs font-medium" style={{ color: labelClr }}>Toca la cámara para cambiar tu foto</p>
          </div>

          {/* Nombre */}
          <div className="px-5 py-4" style={{ borderTop: `1px solid ${borderClr}` }}>
            <p className="text-xs font-bold mb-1.5" style={{ color: BRAND }}>TU NOMBRE</p>
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
                  {saving ? '...' : 'Guardar'}
                </button>
                <button onClick={() => { setEditName(false); setName(user?.name || ''); }}
                  className="text-sm font-semibold px-2 py-1"
                  style={{ color: labelClr }}
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <p className="font-semibold text-base" style={{ color: textClr }}>{user?.name || 'Sin nombre'}</p>
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
            <p className="text-xs font-bold mb-1.5" style={{ color: BRAND }}>ESTADO</p>
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
                <p className="font-medium text-sm flex-1 pr-2" style={{ color: labelClr }}>{user?.status || '¡Hola! Estoy usando OldFace 👋'}</p>
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
            <p className="text-xs font-bold mb-1.5" style={{ color: BRAND }}>TELÉFONO</p>
            <p className="font-semibold text-base" style={{ color: textClr }}>{user?.phone || '—'}</p>
          </div>
        </div>

        {/* ── Sección: Notificaciones ── */}
        <SettingsSection title="Notificaciones" icon="🔔" cardBg={cardBg} textClr={textClr} labelClr={labelClr} borderClr={borderClr} items={[
          { label: 'Sonidos de mensaje', toggle: true, defaultOn: true },
          { label: 'Notificaciones de llamada', toggle: true, defaultOn: true },
          { label: 'Vibración', toggle: true, defaultOn: false },
        ]} />

        {/* ── Sección: Privacidad ── */}
        <SettingsSection title="Privacidad" icon="🔒" cardBg={cardBg} textClr={textClr} labelClr={labelClr} borderClr={borderClr} items={[
          { label: 'Última vez', value: 'Todos' },
          { label: 'Foto de perfil', value: 'Todos' },
          { label: 'Estado', value: 'Mis contactos' },
          { label: 'Confirmación de lectura', toggle: true, defaultOn: true },
        ]} />

        {/* ── Sección: Apariencia ── */}
        <AppearanceSection isDark={isDark} setTheme={setTheme} cardBg={cardBg} textClr={textClr} borderClr={borderClr} />

        {/* ── Sección: Almacenamiento ── */}
        <SettingsSection title="Almacenamiento y datos" icon="💾" cardBg={cardBg} textClr={textClr} labelClr={labelClr} borderClr={borderClr} items={[
          { label: 'Uso de red', value: '—' },
          { label: 'Descarga automática', value: 'WiFi' },
        ]} />

        {/* ── Sección: Ayuda ── */}
        <SettingsSection title="Ayuda" icon="❓" cardBg={cardBg} textClr={textClr} labelClr={labelClr} borderClr={borderClr} items={[
          { label: 'Centro de ayuda', action: true },
          { label: 'Términos y política de privacidad', action: true },
          { label: 'Información de la app', value: 'v1.0.0' },
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
          >
            Cerrar sesión
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
              style={{ backgroundColor: toggles[i] ? '#000080' : 'rgba(120,140,170,0.3)' }}
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
        <p className="text-xs font-black tracking-wider uppercase" style={{ color: labelClr }}>
          🎨 Apariencia
        </p>
      </div>

      {/* Tarjetas de modo */}
      <div className="px-5 py-5 flex gap-4">

        {/* ── Tarjeta OSCURO ── */}
        <button
          onClick={() => setTheme('dark')}
          className="flex-1 rounded-2xl overflow-hidden transition-all duration-200"
          style={{
            border: isDark ? '2px solid #000080' : '2px solid rgba(120,140,170,0.2)',
            boxShadow: isDark ? '0 0 0 1px rgba(119,189,148,0.3), 0 6px 20px rgba(0,0,0,0.4)' : '0 2px 8px rgba(0,0,0,0.15)',
          }}
        >
          {/* Preview oscuro */}
          <div style={{ background: 'linear-gradient(160deg, #021d4a 0%, #021132 100%)', padding: '10px 10px 8px' }}>
            {/* Mini header */}
            <div style={{ height: 8, borderRadius: 4, width: '60%', background: '#031640', marginBottom: 6 }} />
            {/* Mini burbujas */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
              <div style={{ height: 7, width: '55%', borderRadius: 6, background: 'linear-gradient(135deg,#000066,#000080)' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 4 }}>
              <div style={{ height: 7, width: '45%', borderRadius: 6, background: '#0c2a5e' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{ height: 7, width: '40%', borderRadius: 6, background: 'linear-gradient(135deg,#000066,#000080)' }} />
            </div>
          </div>
          {/* Label */}
          <div style={{ padding: '8px 10px 10px', background: cardBg }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: isDark ? '#000080' : textClr }}>Oscuro</span>
              {isDark && (
                <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#000080', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </span>
              )}
            </div>
            <p style={{ fontSize: 10, color: labelClr, marginTop: 2 }}>Por defecto</p>
          </div>
        </button>

        {/* ── Tarjeta CLARO ── */}
        <button
          onClick={() => setTheme('light')}
          className="flex-1 rounded-2xl overflow-hidden transition-all duration-200"
          style={{
            border: !isDark ? '2px solid #000080' : '2px solid rgba(120,140,170,0.2)',
            boxShadow: !isDark ? '0 0 0 1px rgba(119,189,148,0.3), 0 6px 20px rgba(0,0,0,0.2)' : '0 2px 8px rgba(0,0,0,0.15)',
          }}
        >
          {/* Preview claro */}
          <div style={{ background: '#f9fafb', padding: '10px 10px 8px' }}>
            {/* Mini header */}
            <div style={{ height: 8, borderRadius: 4, width: '60%', background: '#000080', marginBottom: 6 }} />
            {/* Mini burbujas */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
              <div style={{ height: 7, width: '55%', borderRadius: 6, background: '#dbeafe' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 4 }}>
              <div style={{ height: 7, width: '45%', borderRadius: 6, background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{ height: 7, width: '40%', borderRadius: 6, background: '#dbeafe' }} />
            </div>
          </div>
          {/* Label */}
          <div style={{ padding: '8px 10px 10px', background: cardBg }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: !isDark ? '#000080' : textClr }}>Claro</span>
              {!isDark && (
                <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#000080', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </span>
              )}
            </div>
            <p style={{ fontSize: 10, color: labelClr, marginTop: 2 }}>Opcional</p>
          </div>
        </button>
      </div>
    </div>
  );
}
