/**
 * BottomNav — Navegación inferior con soporte dark mode
 */
import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useThemeStore } from '../store/themeStore';
import { tr } from '../i18n';

const BRAND    = '#3D5A80';
const INACTIVE_DARK  = '#5F84A0';
const INACTIVE_LIGHT = '#9ca3af';

const NAV_ITEMS = [
  {
    path: '/',
    label: tr('Chats'),
    svgPath: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  },
  {
    path: '#groups',          // no navega: abre la hoja de grupos (onGroups)
    label: tr('Grupos'),
  },
  {
    path: '/contacts',
    label: tr('Contactos'),
    svgPath: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  },
  {
    path: '/settings',
    label: tr('Ajustes'),
  },
];

export default function BottomNav({ onGroups, groupsUnread = 0 }) {
  const navigate    = useNavigate();
  const { pathname } = useLocation();
  const { isDark }  = useThemeStore();

  const bg       = isDark ? '#222A38' : 'white';
  const border   = isDark ? 'rgba(255,255,255,0.06)' : '#e5e7eb';
  const inactive = isDark ? INACTIVE_DARK : INACTIVE_LIGHT;

  return (
    <div
      style={{
        background: bg,
        borderTop: `1px solid ${border}`,
        display: 'flex',
        flexShrink: 0,
        paddingBottom: 'calc(var(--sab) + 6px)',
      }}
    >
      {NAV_ITEMS.map(item => {
        const isGroups = item.path === '#groups';
        const active = pathname === item.path;
        const color  = active ? BRAND : inactive;

        return (
          <button
            key={item.path}
            onClick={() => (isGroups ? onGroups?.() : navigate(item.path))}
            style={{
              flex: 1,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 3, padding: '13px 4px 6px',
              background: 'transparent', border: 'none', cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
              minHeight: 56,
              position: 'relative',
            }}
          >
            {isGroups && groupsUnread > 0 && (
              <span style={{ position: 'absolute', top: 6, left: 'calc(50% + 6px)', minWidth: 16, height: 16, borderRadius: 8,
                             background: BRAND, color: 'white', fontSize: 9, fontWeight: 800, padding: '0 4px', boxSizing: 'border-box',
                             display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {groupsUnread > 9 ? '9+' : groupsUnread}
              </span>
            )}
            <svg
              width="22" height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke={color}
              strokeWidth={active ? 2.5 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {item.path === '/settings' ? (
                <>
                  <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </>
              ) : isGroups ? (
                <>
                  {/* dos personas y "+" */}
                  <circle cx="8" cy="9" r="3" />
                  <path d="M2.5 20v-.8a4.7 4.7 0 014.7-4.7h1.6a4.7 4.7 0 014.7 4.7v.8" />
                  <circle cx="15" cy="9.5" r="2.4" />
                  <path d="M15.6 14.5h.6a4.3 4.3 0 014.3 4.3v1.2" />
                  <path d="M19.5 2.5v5M17 5h5" />
                </>
              ) : (
                <path d={item.svgPath} />
              )}
            </svg>
            <span style={{ fontSize: 10, fontWeight: active ? 800 : 600, color, lineHeight: 1 }}>
              {item.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
