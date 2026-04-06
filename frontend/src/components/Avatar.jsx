/**
 * Avatar - Componente de avatar reutilizable
 */
import React from 'react';

const COLORS = [
  'bg-oldface-400', 'bg-blue-400', 'bg-purple-400',
  'bg-amber-400', 'bg-pink-400', 'bg-teal-400', 'bg-indigo-400'
];

function getColor(name = '') {
  const idx = name.charCodeAt(0) % COLORS.length;
  return COLORS[idx];
}

function getInitials(name = '') {
  return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

const SIZES = {
  sm: 'w-9 h-9 text-sm',
  md: 'w-11 h-11 text-base',
  lg: 'w-13 h-13 text-lg',
  xl: 'w-20 h-20 text-2xl'
};

export default function Avatar({ name = '', src = null, size = 'md', className = '' }) {
  const sizeClass = SIZES[size] || SIZES.md;
  const color = getColor(name);
  const initials = getInitials(name);

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={`${sizeClass} rounded-full object-cover flex-shrink-0 ${className}`}
      />
    );
  }

  return (
    <div className={`${sizeClass} ${color} rounded-full flex items-center justify-center flex-shrink-0 ${className}`}>
      <span className="text-white font-bold leading-none">{initials || '?'}</span>
    </div>
  );
}
