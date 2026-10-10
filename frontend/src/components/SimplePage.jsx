/**
 * SimplePage — página de texto con cabecera y botón Atrás (ayuda, términos, eliminar cuenta…).
 * Sigue el tema claro/oscuro de la app.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useThemeStore } from '../store/themeStore';
import { tr } from '../i18n';

export const BRAND = '#3D5A80';

export default function SimplePage({ title, subtitle, children, headerExtra }) {
  const navigate = useNavigate();
  const T = useThemeStore(s => s.colors);
  const isDark = useThemeStore(s => s.isDark);
  // Abierta desde un enlace sin historial (p. ej. al entrar): Atrás lleva al inicio
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate('/', { replace: true }));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: isDark ? T.bgMain : '#f8fafc' }}>
      <div style={{ flexShrink: 0, background: isDark ? T.bgSurface : BRAND, paddingTop: 'var(--sat, 0px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px 12px' }}>
          <button onClick={back} aria-label={tr('Atrás')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, marginLeft: -6, display: 'flex' }}>
            <svg width="24" height="24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 900, color: 'white' }}>{title}</h1>
            {subtitle && <p style={{ margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.75)' }}>{subtitle}</p>}
          </div>
        </div>
        {headerExtra}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', padding: '18px 16px calc(var(--sab, 0px) + 40px)' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Tarjeta blanca (u oscura) con esquinas redondeadas */
export function Card({ children, style }) {
  const T = useThemeStore(s => s.colors);
  return (
    <div style={{ background: T.bgSurface, borderRadius: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden', marginBottom: 14, ...style }}>
      {children}
    </div>
  );
}
