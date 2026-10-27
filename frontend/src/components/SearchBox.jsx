/**
 * SearchBox — caja de búsqueda en píldora (mismo aspecto que la de Chats) y matches() para filtrar listas
 * sin distinguir mayúsculas ni acentos ("jose" encuentra "José"); los teléfonos se comparan solo por sus cifras.
 */
import React from 'react';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** ¿Alguno de los textos contiene la búsqueda? (búsqueda vacía → sí) */
export function matches(query, ...texts) {
  const q = norm(query).trim();
  if (!q) return true;
  const qDigits = q.replace(/\D/g, '');
  return texts.some(t => norm(t).includes(q) || (qDigits.length >= 3 && String(t || '').replace(/\D/g, '').includes(qDigits)));
}

export default function SearchBox({ value, onChange, placeholder, T, inputRef, style }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.bgSurface, borderRadius: 22, padding: '10px 16px',
                  border: `1px solid ${T.borderStrong}`, ...style }}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', fontSize: 14, color: T.textPrimary, fontWeight: 500 }}
      />
      {value && (
        <button onClick={() => onChange('')} aria-label="✕" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      )}
    </div>
  );
}
