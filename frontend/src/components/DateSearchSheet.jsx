/**
 * DateSearchSheet — "Buscar por fecha" dentro de un chat: elegir año y mes y saltar al primer mensaje de ese mes.
 * Los meses con mensajes se marcan con cuántos hay; los vacíos se ven apagados.
 */
import React, { useMemo, useState } from 'react';
import { tr, LOCALE } from '../i18n';

export default function DateSearchSheet({ T, isDark, messages = [], onClose, onPick }) {
  // Mensajes por mes: { 'año-mes': cantidad }
  const counts = useMemo(() => {
    const c = {};
    for (const m of messages) {
      if (!m.createdAt || m.deleted) continue;
      const d = new Date(m.createdAt);
      const k = `${d.getFullYear()}-${d.getMonth()}`;
      c[k] = (c[k] || 0) + 1;
    }
    return c;
  }, [messages]);
  const years = useMemo(() => {
    const ys = new Set(Object.keys(counts).map(k => Number(k.split('-')[0])));
    ys.add(new Date().getFullYear());
    return [...ys].sort((a, b) => b - a);
  }, [counts]);
  const [year, setYear] = useState(() => {
    const withMsgs = Object.keys(counts).map(k => Number(k.split('-')[0]));
    return withMsgs.length ? Math.max(...withMsgs) : new Date().getFullYear();
  });
  const monthName = (m) => new Date(2000, m, 1).toLocaleDateString(LOCALE, { month: 'long' });
  const now = new Date();

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: T.bgSurface, borderRadius: '20px 20px 0 0',
        padding: '16px 16px calc(var(--sab, 0px) + 18px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <p style={{ margin: 0, fontSize: 17, fontWeight: 800, color: T.textPrimary }}>{tr('Buscar por fecha')}</p>
          <button onClick={onClose} aria-label={tr('Cerrar')}
            style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', background: isDark ? 'rgba(255,255,255,0.08)' : '#f1f5f9', color: T.textPrimary, cursor: 'pointer', fontWeight: 700 }}>✕</button>
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: T.textSecondary }}>{tr('Elige un mes para ir a sus mensajes.')}</p>

        {/* Años */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6, marginBottom: 8 }} className="scroll-hide">
          {years.map(y => (
            <button key={y} onClick={() => setYear(y)}
              style={{ flexShrink: 0, padding: '7px 16px', borderRadius: 18, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 800,
                background: y === year ? '#3D5A80' : (isDark ? 'rgba(255,255,255,0.08)' : '#eef2f7'), color: y === year ? 'white' : T.textPrimary }}>
              {y}
            </button>
          ))}
        </div>

        {/* Meses */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {Array.from({ length: 12 }, (_, m) => {
            const n = counts[`${year}-${m}`] || 0;
            const future = year > now.getFullYear() || (year === now.getFullYear() && m > now.getMonth());
            return (
              <button key={m} disabled={!n} onClick={() => onPick(year, m)}
                style={{ padding: '12px 6px', borderRadius: 14, cursor: n ? 'pointer' : 'default', textAlign: 'center',
                  border: `1px solid ${n ? (isDark ? 'rgba(127,163,209,0.45)' : '#c7d6ea') : 'transparent'}`,
                  background: n ? (isDark ? 'rgba(61,90,128,0.25)' : '#f0f5fb') : (isDark ? 'rgba(255,255,255,0.03)' : '#f8fafc'),
                  opacity: future ? 0.35 : n ? 1 : 0.55 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 800, color: T.textPrimary, textTransform: 'capitalize' }}>{monthName(m)}</span>
                <span style={{ display: 'block', fontSize: 11.5, marginTop: 2, color: n ? (isDark ? '#9FC0E8' : '#3D5A80') : T.textMuted, fontWeight: 700 }}>
                  {n === 1 ? tr('1 mensaje') : n ? tr('{n} mensajes', { n }) : '—'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
