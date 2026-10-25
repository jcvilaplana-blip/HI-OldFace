/**
 * NeonAvatar — avatar con aro de color (brillo neón) de la pantalla principal: chats, contactos y llamadas.
 * Cada contacto tiene su color fijo; con `active` el aro se enciende (luz que gira y late, ver .of-ring en index.css).
 * También exporta los estilos comunes de las tarjetas y botones redondos del nuevo diseño.
 */
import React from 'react';

export const BRAND = '#3D5A80';
/** Variante clara del azul de marca para textos y brillos sobre fondo oscuro */
export const BRAND_LIGHT = '#7FA3D1';

const RING_COLORS = ['#4F7CC4', '#818CF8', '#FF7A1A', '#22C55E', '#EF4444', '#A855F7', '#EC4899', '#14B8A6'];

/** Color fijo del aro de un contacto (mismo color siempre para el mismo id o nombre) */
export function ringColorOf(key = '') {
  let h = 0;
  for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return RING_COLORS[h % RING_COLORS.length];
}

const initialsOf = (name = '') => String(name).replace(/[^\p{L}\p{N}\s]/gu, '').trim()
  .split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';

export default function NeonAvatar({ name = '', src = null, size = 52, color, active = false, online = false, T, onClick }) {
  const ring = color || ringColorOf(name);
  return (
    <div onClick={onClick} className={`of-ring${active ? ' on' : ''}`}
      style={{ '--ring': ring, width: size, height: size, flexShrink: 0, boxSizing: 'border-box', padding: 2 }}>
      {src ? (
        <img src={src} alt="" draggable={false}
          style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <div style={{ width: '100%', height: '100%', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'radial-gradient(circle at 35% 30%, #EEF5FC 0%, #D6E6F5 75%)',   // azul claro pastel
                      color: ring, fontWeight: 800, fontSize: Math.round(size * 0.32), letterSpacing: '0.5px' }}>
          {initialsOf(name)}
        </div>
      )}
      {online && (
        <span style={{ position: 'absolute', right: -1, bottom: -1, width: Math.round(size * 0.24), height: Math.round(size * 0.24),
                       borderRadius: '50%', background: '#22C55E', border: `2px solid ${T?.bgSurface || 'white'}` }} />
      )}
    </div>
  );
}

/** Tarjeta redondeada de las listas (chats, estados, llamadas, contactos) */
export const cardStyle = (T, isDark) => ({
  background: T.bgSurface,
  borderRadius: 18,
  border: isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(41,50,65,0.04)',
  boxShadow: isDark ? '0 4px 14px rgba(0,0,0,0.35)' : '0 2px 10px rgba(41,50,65,0.07)',
});

/** Botón redondo de icono (llamar, vídeo, cámara…) */
export function RoundBtn({ onClick, children, isDark, size = 38, label, filled = false }) {
  return (
    <button onClick={onClick} aria-label={label}
      style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, cursor: 'pointer', padding: 0,
               display: 'flex', alignItems: 'center', justifyContent: 'center',
               background: filled ? BRAND : (isDark ? 'rgba(61,90,128,0.22)' : '#E3EDF2'),
               border: isDark && !filled ? '1px solid rgba(127,163,209,0.35)' : 'none',
               boxShadow: filled ? '0 4px 14px rgba(61,90,128,0.45)' : (isDark ? '0 0 10px rgba(61,90,128,0.35)' : '0 2px 6px rgba(41,50,65,0.08)') }}>
      {children}
    </button>
  );
}

/** Título de sección de las listas (MI ESTADO, EN OLDFACE…) */
export function SectionLabel({ T, children, color }) {
  return <p style={{ margin: '14px 18px 8px', fontSize: 12, fontWeight: 800, letterSpacing: '0.6px', color: color || T.textSecondary }}>{children}</p>;
}
