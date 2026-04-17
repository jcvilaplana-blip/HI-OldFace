/**
 * PopupMenu — Menú emergente OldFace
 * TODAS las acciones están conectadas a sus rutas reales.
 * POLL abre https://poll.fullstark.es dentro de la app.
 */
import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

// Teléfonos autorizados para crear DIRECTOS (sin prefijo y con +34)
const DIRECTO_ALLOWED = ['641872224', '647148175', '+34641872224', '+34647148175', '34641872224', '34647148175'];

const BRAND = '#000080';

// ─── Definición de items ────────────────────────────────────────────────────
// route   → navega a esa ruta React Router
// action  → lógica especial (poll, settings, etc.)
// ──────────────────────────────────────────────────────────────────────────
const MENU_ITEMS = [
  // ── fila 1 ──
  {
    id: 'calls',
    label: 'Llamadas',
    route: '/contacts?action=call',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21
         l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502
         l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 7V5z"/>`
  },
  {
    id: 'messages',
    label: 'Mensajes',
    route: '/',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8
         a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72
         C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>`
  },
  {
    id: 'videocalls',
    label: 'VideoCalls',
    route: '/contacts?action=video',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M15 10l4.553-2.069A1 1 0 0121 8.868v6.264a1 1 0 01-1.447.894
         L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>`
  },
  // ── POLL — botón destacado ──
  {
    id: 'poll',
    label: 'POLL',
    action: 'poll',
    primary: true,
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2z
         M9 19V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2
         m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>`
  },
  // ── fila 2 ──
  {
    id: 'contacts',
    label: 'Contactos',
    route: '/contacts',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2
         c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857
         M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0
         M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>`
  },
  {
    id: 'settings',
    label: 'Ajustes',
    route: '/settings',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066
         c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572
         c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573
         c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065
         c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066
         c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572
         c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573
         c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>`
  },
  {
    id: 'camera',
    label: 'Cámara',
    action: 'camera',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22
         A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22
         A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/>`
  },
  {
    id: 'location',
    label: 'Ubicación',
    action: 'location',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0
         l-4.244-4.243a8 8 0 1111.314 0z"/>
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>`
  },
  // ── fila 3 ──
  {
    id: 'files',
    label: 'Archivos',
    action: 'soon',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2
         h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>`
  },
  {
    id: 'groups',
    label: 'Grupos',
    action: 'groups',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1z
         m0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/>`
  },
  {
    id: 'status',
    label: 'Estado',
    route: '/?tab=estados',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12
         l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"/>`
  },
  {
    id: 'directo',
    label: 'DIRECTO',
    action: 'directo',
    highlight: true,
    icon: `<circle cx="12" cy="12" r="3" stroke-width="1.8"/>
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M6.343 6.343a8 8 0 000 11.314M17.657 6.343a8 8 0 010 11.314
         M3.515 3.515a13 13 0 000 16.97M20.485 3.515a13 13 0 010 16.97"/>`
  },
];

// ─── Componente principal ───────────────────────────────────────────────────
export default function PopupMenu({ onClose, onGroups }) {
  const navigate = useNavigate();
  const { user }  = useAuthStore();
  const isDirectoCreator = DIRECTO_ALLOWED.some(p =>
    (user?.phone || '').replace(/\s/g, '').includes(p.replace(/\+34/, ''))
  );

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const handleItem = async (item) => {
    // 1. Rutas directas
    if (item.route) {
      onClose();
      navigate(item.route);
      return;
    }

    // 2. Acciones especiales
    onClose(); // siempre cerrar primero

    switch (item.action) {
      case 'poll': {
        // Abre poll.fullstark.es dentro de la app en nativo, en nueva pestaña en web
        try {
          const { Capacitor } = await import('@capacitor/core');
          if (Capacitor.isNativePlatform()) {
            const { Browser } = await import('@capacitor/browser');
            await Browser.open({
              url: 'https://poll.fullstark.es',
              presentationStyle: 'fullscreen',
              toolbarColor: '#000080',
            });
          } else {
            window.open('https://poll.fullstark.es', '_blank', 'noopener');
          }
        } catch {
          window.open('https://poll.fullstark.es', '_blank', 'noopener');
        }
        break;
      }
      case 'location': {
        // Navegar al chat activo con acción de ubicación
        navigate('/?action=location');
        break;
      }
      case 'camera': {
        // En web: usar input file. En nativo (Android/iOS) usa la cámara real tras compilar con Capacitor
        try {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.capture = 'environment';
          input.click();
        } catch { /* no disponible */ }
        break;
      }
      case 'directo':
        navigate('/directo');
        break;
      case 'groups':
        onGroups?.();
        break;
      case 'soon':
        // Próximamente — no hacer nada
        break;
      default:
        break;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 animate-fade-in"
        style={{ background: 'rgba(0,0,0,0.42)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />

      {/* Bottom sheet */}
      <div
        className="relative w-full rounded-t-3xl shadow-2xl animate-slide-up scroll-hide"
        style={{ background: '#f8fafc', maxHeight: '88vh', overflowY: 'auto' }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-4 pb-2">
          <div style={{ width: 40, height: 4, background: '#cbd5e1', borderRadius: 2 }} />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-3">
          <div className="flex items-center gap-3">
            {/* Logo */}
            <div
              className="flex items-center justify-center overflow-hidden"
              style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: BRAND }}
            >
              <img
                src="/logo-oldface.png"
                alt="OldFace"
                style={{ width: 34, height: 34, objectFit: 'contain' }}
                onError={e => { e.target.style.display = 'none'; }}
              />
            </div>
            <div>
              <p style={{ fontSize: 15, fontWeight: 900, color: '#1e293b', lineHeight: 1.2 }}>OldFace</p>
              <p style={{ fontSize: 10, fontWeight: 700, color: BRAND }}>Elige una acción</p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: '50%',
              background: '#e2e8f0', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#64748b', fontSize: 16, fontWeight: 800,
            }}
          >
            ✕
          </button>
        </div>

        {/* Grid 4 columnas */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '14px 8px',
            padding: '4px 12px calc(var(--sab) + 24px)',
          }}
        >
          {MENU_ITEMS.map(item => (
            <MenuButton key={item.id} item={item} onClick={() => handleItem(item)} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Botón individual del grid ──────────────────────────────────────────────
function MenuButton({ item, onClick }) {
  const isPoll      = item.primary    === true;
  const isDirecto   = item.highlight  === true;
  const accentColor = isDirecto ? '#ef4444' : BRAND;

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 6,
        background: 'transparent', border: 'none', cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* Círculo */}
      <div
        style={{
          width: 60, height: 60, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'transform 0.15s',
          // POLL: fondo verde | DIRECTO: fondo rojo | resto: fondo blanco con borde
          background: isPoll ? BRAND : isDirecto ? '#ef4444' : 'white',
          border: (isPoll || isDirecto) ? 'none' : '1px solid #e2e8f0',
          boxShadow: isPoll
            ? '0 4px 14px rgba(37,99,235,0.35)'
            : isDirecto
              ? '0 4px 14px rgba(239,68,68,0.40)'
              : '0 1px 6px rgba(0,0,0,0.07)',
        }}
        onMouseDown={e => e.currentTarget.style.transform = 'scale(0.88)'}
        onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
        onTouchStart={e => e.currentTarget.style.transform = 'scale(0.88)'}
        onTouchEnd={e => e.currentTarget.style.transform = 'scale(1)'}
      >
        {/* SVG con stroke explícito — no depende de currentColor/Tailwind */}
        <svg
          width="26" height="26"
          fill="none"
          stroke={(isPoll || isDirecto) ? 'white' : BRAND}
          strokeLinecap="round"
          strokeLinejoin="round"
          viewBox="0 0 24 24"
          dangerouslySetInnerHTML={{ __html: item.icon }}
        />
      </div>

      {/* Label */}
      <span
        style={{
          fontSize: 10, fontWeight: 800, textAlign: 'center', lineHeight: 1.2,
          color: isPoll ? '#000080' : isDirecto ? '#dc2626' : '#64748b',
        }}
      >
        {item.label}
      </span>
    </button>
  );
}
