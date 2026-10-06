/**
 * Avatar - Componente de avatar reutilizable
 */
import React from 'react';

const COLORS = [
  '#3b82f6', '#8b5cf6', '#f59e0b',
  '#ec4899', '#14b8a6', '#6366f1', '#3D5A80'
];

const FONT_SIZES = { sm: 13, md: 15, lg: 15, xl: 22 };

// Tamaños en px — explícitos para evitar dependencia de clases Tailwind no estándar
const SIZES_PX = { sm: 36, md: 44, lg: 48, xl: 80 };

function getColor(name = '') {
  const idx = name.charCodeAt(0) % COLORS.length;
  return COLORS[idx];
}

function getInitials(name = '') {
  return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

export default function Avatar({ name = '', src = null, size = 'md', className = '' }) {
  const px     = SIZES_PX[size] || SIZES_PX.md;
  const fs     = FONT_SIZES[size] || 15;
  const color  = getColor(name);
  const initials = getInitials(name);

  const baseStyle = {
    width: px, height: px, borderRadius: '50%',
    flexShrink: 0, overflow: 'hidden',
  };

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={className}
        style={{ ...baseStyle, objectFit: 'cover', display: 'block' }}
      />
    );
  }

  return (
    <div
      className={className}
      style={{ ...baseStyle, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <span style={{ color: 'white', fontWeight: 700, fontSize: fs, lineHeight: 1 }}>
        {initials || '?'}
      </span>
    </div>
  );
}
