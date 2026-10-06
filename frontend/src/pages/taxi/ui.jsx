/**
 * Piezas visuales comunes del taxi (cliente y conductor): cabecera, botones, hojas inferiores, avisos.
 */
import React from 'react';

export const BRAND = '#000080';
export const C = { bg: '#f1f5f9', card: '#ffffff', text: '#0f172a', muted: '#64748b', line: '#e2e8f0', ok: '#16a34a', danger: '#dc2626' };

export function Header({ title, subtitle, onBack, right }) {
  return (
    <div style={{ background: BRAND, color: 'white', flexShrink: 0, paddingTop: 'var(--sat)', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', zIndex: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px 12px' }}>
        {onBack && (
          <button onClick={onBack} aria-label="Volver" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 19l-7-7 7-7" /></svg>
          </button>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ fontSize: 18, fontWeight: 900, margin: 0, letterSpacing: 0.3 }}>{title}</p>
          {subtitle && <p style={{ fontSize: 12, margin: 0, opacity: 0.75 }}>{subtitle}</p>}
        </div>
        {right}
      </div>
    </div>
  );
}

export function Btn({ children, onClick, disabled, variant = 'primary', style, type = 'button' }) {
  const v = {
    primary: { background: BRAND, color: 'white', border: 'none' },
    ghost:   { background: 'white', color: BRAND, border: `1.5px solid ${BRAND}` },
    danger:  { background: 'white', color: C.danger, border: `1.5px solid ${C.danger}` },
    soft:    { background: '#e0e7ff', color: BRAND, border: 'none' },
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{
      ...v, width: '100%', padding: '14px 16px', borderRadius: 14, fontSize: 16, fontWeight: 800, cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.5 : 1, ...style,
    }}>{children}</button>
  );
}

export function Card({ children, style, onClick }) {
  return <div onClick={onClick} style={{ background: C.card, borderRadius: 16, padding: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', cursor: onClick ? 'pointer' : undefined, ...style }}>{children}</div>;
}

/** Hoja inferior sobre el mapa */
export function Sheet({ children, style }) {
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 4, background: 'white', borderRadius: '22px 22px 0 0',
                  boxShadow: '0 -4px 24px rgba(0,0,0,0.15)', padding: '10px 16px 14px', maxHeight: '72%', overflowY: 'auto', ...style }}>
      <div style={{ width: 40, height: 4, background: '#cbd5e1', borderRadius: 2, margin: '0 auto 10px' }} />
      {children}
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span style={{ display: 'block', fontSize: 12, fontWeight: 800, color: C.muted, marginBottom: 5 }}>{label}</span>
      {children}
    </label>
  );
}

export const inputStyle = { width: '100%', padding: '12px 14px', borderRadius: 12, border: `1.5px solid ${C.line}`, fontSize: 15, background: 'white', color: C.text, outline: 'none', boxSizing: 'border-box' };

export function Spinner({ size = 28, color = BRAND }) {
  return <div style={{ width: size, height: size, border: `3px solid ${color}33`, borderTopColor: color, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />;
}

export function Center({ children }) {
  return <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center', color: C.muted }}>{children}</div>;
}

export function Toast({ msg, err }) {
  if (!msg) return null;
  return (
    <div style={{ position: 'fixed', left: '50%', bottom: 'calc(var(--sab) + 90px)', transform: 'translateX(-50%)', zIndex: 100, maxWidth: '90%',
                  background: err ? C.danger : 'rgba(15,23,42,0.92)', color: 'white', padding: '10px 18px', borderRadius: 20, fontSize: 14, fontWeight: 700,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.25)', textAlign: 'center' }}>{msg}</div>
  );
}

export function Stars({ value = 0, onChange, size = 34 }) {
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} onClick={() => onChange?.(n)} aria-label={`${n}`} style={{ background: 'none', border: 'none', cursor: onChange ? 'pointer' : 'default', fontSize: size, lineHeight: 1, color: n <= value ? '#f59e0b' : '#cbd5e1', padding: 0 }}>★</button>
      ))}
    </div>
  );
}

/** Barra de pestañas inferior */
export function Tabs({ tabs, value, onChange }) {
  return (
    <div style={{ display: 'flex', background: 'white', borderTop: `1px solid ${C.line}`, paddingBottom: 'var(--sab)', flexShrink: 0, zIndex: 6 }}>
      {tabs.map(t => (
        <button key={t.key} onClick={() => onChange(t.key)} style={{ flex: 1, background: 'none', border: 'none', padding: '9px 0 7px', cursor: 'pointer',
          color: value === t.key ? BRAND : '#94a3b8', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 20, lineHeight: 1 }}>{t.icon}</span>
          <span style={{ fontSize: 11, fontWeight: 800 }}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}
