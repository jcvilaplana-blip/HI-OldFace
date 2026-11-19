/**
 * DialPad — teclado (marcador) dentro de OldFace para añadir o eliminar contactos.
 * Se escribe un número; si ya está en la agenda se muestra y se puede eliminar; si no, se guarda con un nombre.
 * Si el número usa OldFace se puede abrir el chat o llamar directamente.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { tr } from '../i18n';
import { BRAND } from './NeonAvatar.jsx';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const KEYS = [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'], ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['+', ''], ['0', ''], ['⌫', '']];

/** Solo dígitos (con el 34 de España delante si son 9), para comparar números escritos de formas distintas */
export function phoneKey(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('0034')) d = d.slice(2);
  if (d.length === 9) d = '34' + d;
  return d;
}

export default function DialPad({ T, isDark, contacts = [], initialNumber = '', onClose, onSave, onDelete, onChat, onCall }) {
  const [number, setNumber] = useState(() => String(initialNumber).replace(/[^\d+]/g, ''));
  const [name, setName] = useState('');
  const [step, setStep] = useState('dial');      // dial · name · confirmDelete
  const [onOldFace, setOnOldFace] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);          // { text, ok }
  const holdRef = useRef(null);

  const digits = number.replace(/\D/g, '');
  const valid = digits.length >= 9;
  const existing = useMemo(() => (valid ? contacts.find(c => phoneKey(c.phone) === phoneKey(number)) : null), [contacts, number, valid]);
  // Sugerencias mientras se escribe (por número)
  const suggestions = useMemo(() => {
    if (digits.length < 3 || existing) return [];
    return contacts.filter(c => String(c.phone).replace(/\D/g, '').includes(digits)).slice(0, 3);
  }, [contacts, digits, existing]);

  // ¿Usa OldFace? (se comprueba en el servidor con la sesión, al tener un número completo)
  useEffect(() => {
    setOnOldFace(null);
    if (!valid) return undefined;
    const t = setTimeout(() => {
      fetch(`${BACKEND}/check-users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phones: [number] }) })
        .then(r => (r.ok ? r.json() : null)).then(d => setOnOldFace(!!d?.registeredPhones?.length)).catch(() => setOnOldFace(null));
    }, 350);
    return () => clearTimeout(t);
  }, [number, valid]);

  const press = (k) => {
    setMsg(null);
    try { navigator.vibrate?.(8); } catch { /* sin vibración */ }
    if (k === '⌫') { setNumber(n => n.slice(0, -1)); return; }
    if (k === '+' && number.length) return;   // el + solo al principio
    if (number.length >= 16) return;
    setNumber(n => n + k);
  };
  // Mantener ⌫ borra todo; mantener 0 al principio escribe +
  const holdStart = (k) => {
    clearTimeout(holdRef.current);
    holdRef.current = setTimeout(() => { holdRef.current = 'done'; if (k === '⌫') setNumber(''); if (k === '0' && !number) setNumber('+'); }, 550);
  };
  const holdEnd = (k) => { const h = holdRef.current; clearTimeout(h); holdRef.current = null; if (h !== 'done') press(k); };

  const save = async () => {
    if (!name.trim()) { setMsg({ text: tr('Escribe un nombre'), ok: false }); return; }
    setBusy(true);
    const r = await onSave({ name: name.trim(), phone: number });
    setBusy(false);
    if (r?.success) { setMsg({ text: tr('Contacto guardado'), ok: true }); setStep('dial'); setName(''); }
    else setMsg({ text: r?.error || tr('No se pudo guardar el contacto'), ok: false });
  };
  const remove = async () => {
    if (!existing) return;
    setBusy(true);
    const r = await onDelete(existing);
    setBusy(false);
    setStep('dial');
    if (r?.success) { setMsg({ text: tr('Contacto eliminado'), ok: true }); setNumber(''); }
    else setMsg({ text: r?.error || tr('No se pudo eliminar el contacto'), ok: false });
  };

  const keyBg = isDark ? 'rgba(255,255,255,0.06)' : '#f1f5f9';
  const action = (bg, color = 'white') => ({ flex: 1, minWidth: 0, padding: '13px 8px', borderRadius: 16, border: 'none', background: bg, color,
    fontSize: 14, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: busy ? 0.6 : 1 });
  const info = msg ? msg.text
    : existing ? `${existing.name}${existing.usesOldFace ? ' · ' + tr('En OldFace') : ''}`
    : valid ? (onOldFace === true ? tr('Usa OldFace · no está en tu agenda') : onOldFace === false ? tr('No está en tu agenda') : '…') : '';
  const infoColor = msg ? (msg.ok ? '#16A34A' : '#DC2626') : existing ? (isDark ? '#9FC0E6' : BRAND) : T.textSecondary;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, background: T.bgSurface, borderRadius: '24px 24px 0 0',
        padding: '14px 18px calc(var(--sab, 0px) + 18px)', boxShadow: '0 -8px 30px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: isDark ? 'rgba(255,255,255,0.2)' : '#cbd5e1' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ margin: 0, fontSize: 17, fontWeight: 800, color: T.textPrimary }}>{tr('Teclado')}</p>
          <button onClick={onClose} aria-label={tr('Cerrar')}
            style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', background: keyBg, color: T.textPrimary, cursor: 'pointer', fontWeight: 700 }}>✕</button>
        </div>

        {/* Número escrito */}
        <div style={{ textAlign: 'center', margin: '10px 0 4px', minHeight: 44 }}>
          {number ? (
            <span style={{ fontSize: number.length > 12 ? 28 : 34, fontWeight: 700, letterSpacing: 1.5, color: T.textPrimary, fontVariantNumeric: 'tabular-nums' }}>{number}</span>
          ) : (
            <span style={{ color: T.textMuted, fontSize: 18, fontWeight: 600, lineHeight: '44px' }}>{tr('Escribe un número')}</span>
          )}
        </div>
        {/* Qué es ese número */}
        <div style={{ textAlign: 'center', minHeight: 22, fontSize: 13, fontWeight: 700, marginBottom: 6, color: infoColor }}>{info}</div>
        {suggestions.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 8 }}>
            {suggestions.map(c => (
              <button key={c.id} onClick={() => setNumber(String(c.phone).replace(/[^\d+]/g, ''))}
                style={{ border: `1px solid ${T.border}`, background: 'transparent', color: T.textPrimary, borderRadius: 14, padding: '5px 10px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                {c.name}
              </button>
            ))}
          </div>
        )}

        {step === 'name' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '6px 0 4px' }}>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder={tr('Nombre del contacto')} maxLength={60}
              onKeyDown={e => { if (e.key === 'Enter') save(); }}
              style={{ padding: '14px 16px', borderRadius: 14, border: `1.5px solid ${isDark ? '#4F7CC4' : BRAND}`, background: 'transparent', color: T.textPrimary, fontSize: 16, outline: 'none' }} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setStep('dial')} style={action(keyBg, T.textPrimary)}>{tr('Atrás')}</button>
              <button onClick={save} disabled={busy} style={action(BRAND)}>{tr('Guardar contacto')}</button>
            </div>
          </div>
        ) : step === 'confirmDelete' && existing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '6px 0 4px' }}>
            <p style={{ margin: 0, textAlign: 'center', fontSize: 14, color: T.textPrimary }}>
              {tr('¿Eliminar a {name} de los contactos del móvil?', { name: existing.name })}
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setStep('dial')} style={action(keyBg, T.textPrimary)}>{tr('Cancelar')}</button>
              <button onClick={remove} disabled={busy} style={action('#DC2626')}>{tr('Eliminar')}</button>
            </div>
          </div>
        ) : (
          <>
            {/* Teclas */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, margin: '4px 6px 12px' }}>
              {KEYS.map(([k, sub]) => (
                <button key={k} onPointerDown={() => holdStart(k)} onPointerUp={() => holdEnd(k)}
                  onPointerLeave={() => { clearTimeout(holdRef.current); holdRef.current = null; }}
                  aria-label={k === '⌫' ? tr('Borrar') : k}
                  style={{ height: 58, borderRadius: 18, border: 'none', background: k === '⌫' ? 'transparent' : keyBg, color: T.textPrimary, cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'manipulation' }}>
                  {k === '⌫' ? (
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={T.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 5H9l-6 7 6 7h12a1 1 0 001-1V6a1 1 0 00-1-1z"/><path d="M17 9l-6 6M11 9l6 6"/></svg>
                  ) : (
                    <>
                      <span style={{ fontSize: 24, fontWeight: 600, lineHeight: 1 }}>{k}</span>
                      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 1.2, color: T.textMuted, minHeight: 11, marginTop: 2 }}>{k === '0' ? '+' : sub}</span>
                    </>
                  )}
                </button>
              ))}
            </div>

            {/* Acciones según el número */}
            <div style={{ display: 'flex', gap: 10 }}>
              {existing ? (
                <>
                  <button onClick={() => setStep('confirmDelete')} disabled={busy} style={action(isDark ? 'rgba(220,38,38,0.18)' : '#FEE2E2', '#DC2626')}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
                    {tr('Eliminar')}
                  </button>
                  {existing.usesOldFace && <button onClick={() => onChat(existing)} style={action(BRAND)}>{tr('Chat')}</button>}
                  {existing.usesOldFace && <button onClick={() => onCall(existing)} style={action('#16A34A')}>{tr('Llamar')}</button>}
                </>
              ) : (
                <>
                  <button onClick={() => { setMsg(null); setStep('name'); }} disabled={!valid} style={{ ...action(BRAND), opacity: valid ? 1 : 0.45 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                    {tr('Añadir contacto')}
                  </button>
                  {valid && onOldFace && <button onClick={() => onChat({ name: number, phone: number })} style={action('#0F766E')}>{tr('Chat')}</button>}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
