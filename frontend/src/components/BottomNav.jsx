/**
 * BottomNav — Barra inferior flotante (tarjeta redondeada) con el botón "+" en el centro.
 * Chats · Grupos · [+] · Contactos · Ajustes. El "+" abre el menú emergente (onPlus).
 */
import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useThemeStore } from '../store/themeStore';
import { tr } from '../i18n';

const BRAND    = '#3D5A80';
const INACTIVE_DARK  = '#7F9BB5';
const INACTIVE_LIGHT = '#8A97A8';

const NAV_ITEMS = [
  {
    path: '/',
    label: tr('Chats'),
    svgPath: 'M21 11.5a8.4 8.4 0 01-12.3 7.5L3 21l2-5.4A8.5 8.5 0 1121 11.5z',
  },
  {
    path: '#groups',          // no navega: abre la hoja de grupos (onGroups)
    label: tr('Grupos'),
  },
  { path: '#plus' },          // hueco del botón "+"
  {
    path: '/contacts',
    label: tr('Contactos'),
  },
  {
    path: '/settings',
    label: tr('Ajustes'),
  },
];

function NavIcon({ path, color, active, svgPath }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={active ? 2.3 : 1.9}
      strokeLinecap="round" strokeLinejoin="round">
      {path === '/settings' ? (
        <>
          <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </>
      ) : path === '#groups' ? (
        <>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3 20v-1a5 5 0 015-5h2a5 5 0 015 5v1" />
          <circle cx="16.5" cy="8.5" r="2.5" />
          <path d="M17 14h.5a4 4 0 014 4v2" />
        </>
      ) : path === '/contacts' ? (
        <>
          <rect x="4" y="3" width="16" height="18" rx="3" />
          <circle cx="12" cy="10" r="3" />
          <path d="M7.5 17.5a4.5 4.5 0 019 0" />
        </>
      ) : (
        <path d={svgPath} />
      )}
    </svg>
  );
}

export default function BottomNav({ onGroups, onPlus, groupsUnread = 0 }) {
  const navigate    = useNavigate();
  const { pathname } = useLocation();
  const { isDark }  = useThemeStore();

  const bg       = isDark ? '#1B2230' : 'white';
  const inactive = isDark ? INACTIVE_DARK : INACTIVE_LIGHT;

  return (
    <div style={{ flexShrink: 0, padding: '6px 12px calc(var(--sab) + 8px)', position: 'relative', zIndex: 20 }}>
      <div
        style={{
          background: bg,
          borderRadius: 26,
          display: 'flex',
          alignItems: 'stretch',
          height: 66,
          border: isDark ? '1px solid rgba(255,255,255,0.07)' : '1px solid rgba(41,50,65,0.05)',
          boxShadow: isDark ? '0 8px 26px rgba(0,0,0,0.55)' : '0 8px 24px rgba(41,50,65,0.12)',
        }}
      >
        {NAV_ITEMS.map(item => {
          if (item.path === '#plus') {
            return (
              <div key="plus" style={{ flex: 1, position: 'relative' }}>
                <button
                  onClick={onPlus}
                  aria-label={tr('Abrir menú')}
                  style={{
                    position: 'absolute', left: '50%', top: -24, transform: 'translateX(-50%)',
                    width: 62, height: 62, borderRadius: '50%',
                    background: `radial-gradient(circle at 35% 30%, #5B7FB0 0%, ${BRAND} 60%, #2C4466 100%)`,
                    border: `3px solid ${isDark ? '#141A2A' : '#E3EDF2'}`,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 0 0 1px rgba(127,163,209,0.35), 0 6px 22px rgba(61,90,128,0.6), 0 0 26px rgba(61,90,128,0.45)',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              </div>
            );
          }

          const isGroups = item.path === '#groups';
          const active = pathname === item.path;
          const color  = active ? 'white' : inactive;

          return (
            <button
              key={item.path}
              onClick={() => (isGroups ? onGroups?.() : navigate(item.path))}
              style={{
                flex: 1,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: 3, padding: '6px 2px',
                background: 'transparent', border: 'none', cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                position: 'relative',
              }}
            >
              {isGroups && groupsUnread > 0 && (
                <span style={{ position: 'absolute', top: 4, left: 'calc(50% + 8px)', minWidth: 17, height: 17, borderRadius: 9,
                               background: BRAND, color: 'white', fontSize: 9, fontWeight: 800, padding: '0 4px', boxSizing: 'border-box',
                               display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1,
                               border: `1.5px solid ${bg}` }}>
                  {groupsUnread > 99 ? '99+' : groupsUnread}
                </span>
              )}
              {/* El activo va dentro de una píldora azul */}
              <span style={{
                width: 46, height: 30, borderRadius: 15,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: active ? BRAND : 'transparent',
                boxShadow: active ? (isDark ? '0 0 0 1px rgba(127,163,209,0.45), 0 0 14px rgba(61,90,128,0.7)' : '0 4px 12px rgba(61,90,128,0.35)') : 'none',
              }}>
                <NavIcon path={item.path} color={color} active={active} svgPath={item.svgPath} />
              </span>
              <span style={{ fontSize: 11, fontWeight: active ? 800 : 600, color: active ? (isDark ? 'white' : BRAND) : inactive, lineHeight: 1 }}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
