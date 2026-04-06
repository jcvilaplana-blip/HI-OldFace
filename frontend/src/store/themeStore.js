/**
 * themeStore — Tema global de la app (oscuro / claro)
 * Por defecto: OSCURO (azul marino profundo estilo VS Code)
 * Persiste en localStorage.
 */
import { create } from 'zustand';

// ── Paleta de colores ────────────────────────────────────────────────
export const DARK = {
  bgMain:     '#080f1e',   // fondo principal (muy oscuro)
  bgSurface:  '#0c1526',   // tarjetas, cabeceras, nav
  bgHover:    '#111d32',   // hover / press
  bgInput:    '#0f1b2e',   // inputs
  bgSection:  '#060c18',   // secciones de separación
  border:     'rgba(255,255,255,0.06)',
  borderStrong: 'rgba(255,255,255,0.10)',
  textPrimary:   '#dce8ff',
  textSecondary: '#6a8db5',
  textMuted:     '#35527a',
  accent:     '#000080',   // verde marca (solo acentos puntuales)
  accentDim:  'rgba(37,99,235,0.12)',
};

export const LIGHT = {
  bgMain:     '#f8fafc',
  bgSurface:  '#ffffff',
  bgHover:    '#f1f5f9',
  bgInput:    '#ffffff',
  bgSection:  '#f8fafc',
  border:     '#f1f5f9',
  borderStrong: '#e2e8f0',
  textPrimary:   '#1e293b',
  textSecondary: '#64748b',
  textMuted:     '#94a3b8',
  accent:     '#000080',
  accentDim:  '#eff6ff',
};

function applyTheme(theme) {
  const t = theme === 'dark' ? DARK : LIGHT;
  const el = document.documentElement;
  el.classList.toggle('dark', theme === 'dark');
  // CSS variables para componentes que las usen
  el.style.setProperty('--bg-main',        t.bgMain);
  el.style.setProperty('--bg-surface',     t.bgSurface);
  el.style.setProperty('--bg-hover',       t.bgHover);
  el.style.setProperty('--text-primary',   t.textPrimary);
  el.style.setProperty('--text-secondary', t.textSecondary);
  el.style.setProperty('--border',         t.border);
}

// Migración: si estaba guardado 'dark' de versión anterior, resetear a 'light'
if (localStorage.getItem('oldface-theme') === 'dark') {
  localStorage.removeItem('oldface-theme');
}
const _stored = localStorage.getItem('oldface-theme') || 'light';
applyTheme(_stored);

export const useThemeStore = create((set) => ({
  theme:  _stored,
  isDark: _stored === 'dark',
  colors: _stored === 'dark' ? DARK : LIGHT,

  setTheme: (theme) => {
    localStorage.setItem('oldface-theme', theme);
    applyTheme(theme);
    set({ theme, isDark: theme === 'dark', colors: theme === 'dark' ? DARK : LIGHT });
  },
}));
