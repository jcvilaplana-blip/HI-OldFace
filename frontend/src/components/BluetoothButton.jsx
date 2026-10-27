/**
 * Botón "Bluetooth" de las llamadas: solo aparece con unos auriculares Bluetooth conectados y nunca se activa
 * solo; al pulsarlo el audio pasa a los auriculares y al pulsarlo otra vez vuelve a lo de antes (auricular del
 * móvil o altavoz). Si se desconectan durante la llamada, el audio vuelve solo a lo de antes.
 * Necesita el APK con OldFaceAudio.hasBluetooth / setBluetooth; en APK antiguos no aparece.
 */
import React, { useEffect, useRef, useState } from 'react';
import { tr } from '../i18n';

/** restore(): vuelve a poner el auricular o el altavoz (lo que hubiera antes del Bluetooth) */
export function useBluetoothAudio(restore) {
  const [available, setAvailable] = useState(false);
  const [on, setOn] = useState(false);
  const onRef = useRef(false);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  const turnOff = () => {
    if (!onRef.current) return;
    onRef.current = false;
    setOn(false);
    window.OldFaceAudio?.setBluetooth?.(false);
  };

  useEffect(() => {
    const audio = window.OldFaceAudio;
    if (!audio?.hasBluetooth) return undefined;
    const check = () => {
      let has = false;
      try { has = !!audio.hasBluetooth(); } catch { /* nada */ }
      setAvailable(has);
      if (!has && onRef.current) { turnOff(); restoreRef.current?.(); }   // se desconectaron
    };
    check();
    const iv = setInterval(check, 2000);
    return () => clearInterval(iv);
  }, []);

  const toggle = () => {
    if (onRef.current) { turnOff(); restoreRef.current?.(); return; }
    onRef.current = true;
    setOn(true);
    window.OldFaceAudio?.setBluetooth?.(true);
  };

  return { available, on, toggle, off: turnOff };
}

/** Píldora "Bluetooth" (encendida cuando el audio va por los auriculares) */
export function BluetoothPill({ bt }) {
  if (!bt.available) return null;
  return (
    <button onClick={bt.toggle} aria-pressed={bt.on}
      style={{
        pointerEvents: 'all',
        display: 'flex', alignItems: 'center', gap: 6,
        background: bt.on ? '#3D5A80' : 'rgba(255,255,255,0.18)',
        border: `1px solid ${bt.on ? 'rgba(159,192,230,0.8)' : 'rgba(255,255,255,0.3)'}`,
        boxShadow: bt.on ? '0 0 14px rgba(61,90,128,0.8)' : 'none',
        borderRadius: 20, padding: '8px 16px',
        color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer',
      }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 7l10 10-5 5V2l5 5L7 17"/>
      </svg>
      {tr('Bluetooth')}
    </button>
  );
}
