/**
 * PopupMenu — Menú emergente OldFace
 * 4 filas con el orden definido por el cliente. Las acciones marcadas como
 * 'soon' (Social, Taxi, Karaoke, Archivos) se desarrollarán más adelante.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const BRAND = '#000080';

// ─── Definición de items ────────────────────────────────────────────────────
// route   → navega a esa ruta React Router
// action  → lógica especial (camera, groups, soon…)
// ──────────────────────────────────────────────────────────────────────────
const ITEMS = {
  calls: {
    label: 'Llamada',
    route: '/contacts?action=call',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21
         l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502
         l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 7V5z"/>`
  },
  videocalls: {
    label: 'Videollamada',
    route: '/contacts?action=video',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M15 10l4.553-2.069A1 1 0 0121 8.868v6.264a1 1 0 01-1.447.894
         L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>`
  },
  directo: {
    label: 'Directo',
    route: '/directo',
    highlight: true,
    icon: `<circle cx="12" cy="12" r="3" stroke-width="1.8"/>
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M6.343 6.343a8 8 0 000 11.314M17.657 6.343a8 8 0 010 11.314
         M3.515 3.515a13 13 0 000 16.97M20.485 3.515a13 13 0 010 16.97"/>`
  },
  social: {
    label: 'Social',
    action: 'soon',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M4 5a2 2 0 012-2h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5z
         M8 8h8M8 12h8M8 16h5"/>`
  },
  chats: {
    label: 'Chats',
    route: '/',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8
         a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72
         C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>`
  },
  status: {
    label: 'Estado',
    route: '/?tab=estados',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12
         l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"/>`
  },
  taxi: {
    label: 'Taxi',
    action: 'soon',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M5 13l1.5-4.5A2 2 0 018.4 7h7.2a2 2 0 011.9 1.5L19 13
         M5 13h14v4a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1H8v1a1 1 0 01-1 1H6a1 1 0 01-1-1v-4z
         M10 4h4l.5 3h-5l.5-3z"/>
      <circle cx="8" cy="15" r="0.8" fill="currentColor" stroke-width="1"/>
      <circle cx="16" cy="15" r="0.8" fill="currentColor" stroke-width="1"/>`
  },
  poll: {
    label: 'Poll',
    route: '/poll',
    primary: true,
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2z
         M9 19V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2
         m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>`
  },
  groups: {
    label: 'Grupos',
    action: 'groups',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1z
         m0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/>`
  },
  contacts: {
    label: 'Contactos',
    route: '/contacts',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2
         c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857
         M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0
         M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>`
  },
  karaoke: {
    label: 'Karaoke',
    action: 'soon',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M12 3a3 3 0 00-3 3v5a3 3 0 006 0V6a3 3 0 00-3-3z
         M19 11a7 7 0 01-14 0M12 18v3M8 21h8"/>`
  },
  camera: {
    label: 'Cámara',
    action: 'camera',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22
         A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22
         A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/>`
  },
  location: {
    label: 'Ubicación',
    route: '/?action=location',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0
         l-4.244-4.243a8 8 0 1111.314 0z"/>
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>`
  },
  settings: {
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
  archived: {
    label: 'Archivos',
    action: 'soon',
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
      d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8
         m-9 4h4"/>`
  },
};

// Orden y filas del menú
const MENU_ROWS = [
  ['calls', 'videocalls', 'directo', 'social'],
  ['chats', 'status', 'taxi', 'poll'],
  ['groups', 'contacts', 'karaoke'],
  ['camera', 'location', 'settings', 'archived'],
];

// ─── Componente principal ───────────────────────────────────────────────────
export default function PopupMenu({ onClose, onGroups }) {
  const navigate = useNavigate();
  const [soonMsg, setSoonMsg] = useState('');
  const soonTimer = useRef(null);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; clearTimeout(soonTimer.current); };
  }, []);

  const handleItem = (item) => {
    // Próximamente: avisar sin cerrar el menú
    if (item.action === 'soon') {
      setSoonMsg(`${item.label}: próximamente`);
      clearTimeout(soonTimer.current);
      soonTimer.current = setTimeout(() => setSoonMsg(''), 2000);
      return;
    }

    onClose();

    if (item.route) {
      navigate(item.route);
      return;
    }

    switch (item.action) {
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
      case 'groups':
        onGroups?.();
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

        {/* Grid 4 columnas — una fila por entrada de MENU_ROWS */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '14px 8px',
            padding: '4px 12px calc(var(--sab) + 24px)',
          }}
        >
          {MENU_ROWS.flatMap((row, r) => [
            ...row.map(id => <MenuButton key={id} item={ITEMS[id]} onClick={() => handleItem(ITEMS[id])} />),
            ...Array.from({ length: 4 - row.length }, (_, i) => <div key={`gap-${r}-${i}`} />),
          ])}
        </div>

        {/* Aviso "próximamente" */}
        {soonMsg && (
          <div style={{
            position: 'absolute', left: '50%', bottom: 'calc(var(--sab) + 18px)', transform: 'translateX(-50%)',
            background: 'rgba(15,23,42,0.92)', color: 'white', padding: '9px 18px', borderRadius: 20,
            fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          }}>
            {soonMsg}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Botón individual del grid ──────────────────────────────────────────────
function MenuButton({ item, onClick }) {
  const isPoll      = item.primary    === true;
  const isDirecto   = item.highlight  === true;
  const isSoon      = item.action     === 'soon';

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 6,
        background: 'transparent', border: 'none', cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        opacity: isSoon ? 0.6 : 1,
      }}
    >
      {/* Círculo */}
      <div
        style={{
          width: 60, height: 60, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'transform 0.15s',
          // POLL: fondo marca | DIRECTO: fondo rojo | resto: fondo blanco con borde
          background: isPoll ? BRAND : isDirecto ? '#ef4444' : 'white',
          border: (isPoll || isDirecto) ? 'none' : '1px solid #e2e8f0',
          boxShadow: isPoll
            ? '0 4px 14px rgba(37,99,235,0.35)'
            : isDirecto
              ? '0 4px 14px rgba(239,68,68,0.40)'
              : '0 1px 6px rgba(0,0,0,0.07)',
          color: (isPoll || isDirecto) ? 'white' : BRAND,
        }}
        onMouseDown={e => e.currentTarget.style.transform = 'scale(0.88)'}
        onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
        onTouchStart={e => e.currentTarget.style.transform = 'scale(0.88)'}
        onTouchEnd={e => e.currentTarget.style.transform = 'scale(1)'}
      >
        {/* SVG con stroke explícito — no depende de Tailwind */}
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
