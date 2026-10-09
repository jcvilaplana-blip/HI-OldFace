/**
 * LyricsView — letra sincronizada estilo karaoke.
 * La línea actual se rellena de color de izquierda a derecha según avanza la canción;
 * las siguientes se muestran atenuadas y la vista se desplaza sola.
 */
import React, { useEffect, useRef } from 'react';
import { lineIndexAt } from '../utils/lrc';
import { tr } from '../i18n';

// Azul cielo OldFace (el azul de marca #3D5A80 no se lee sobre fondo oscuro)
export const KARAOKE_ACCENT = '#98C1D9';

// Dúos: las frases de la pareja en rosa, las de los dos en morado
export const DUET_PARTNER = '#f472b6';
export const DUET_BOTH    = '#c084fc';

/**
 * @param overVideo  true = la letra va encima de la cámara: sombra para que se lea sobre cualquier fondo
 * @param myPart     dúo: 'A' | 'B' — colorea las frases según quién las canta
 */
export default function LyricsView({ lines, position, compact = false, accent = KARAOKE_ACCENT, overVideo = false, myPart = null }) {
  const boxRef = useRef(null);
  const idx = lineIndexAt(lines, position);

  // Centrar la línea actual
  useEffect(() => {
    const box = boxRef.current;
    const el = box?.querySelector(`[data-line="${Math.max(0, idx)}"]`);
    if (!box || !el) return;
    const target = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
    box.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }, [idx]);

  if (!lines.length) {
    return <p style={{ textAlign: 'center', opacity: 0.6, fontSize: 15 }}>{tr('Esta canción no tiene letra sincronizada')}</p>;
  }

  const size = compact ? 18 : 24;
  return (
    <div ref={boxRef} style={{
      height: '100%', overflowY: 'auto', scrollbarWidth: 'none', padding: '40% 18px',
      WebkitMaskImage: 'linear-gradient(transparent, black 18%, black 82%, transparent)',
      maskImage: 'linear-gradient(transparent, black 18%, black 82%, transparent)',
    }}>
      {lines.map((l, i) => {
        const current = i === idx;
        const past = i < idx;
        const partner = myPart && l.part && l.part !== 'AB' && l.part !== myPart;
        const fill = !myPart || !l.part ? accent : partner ? DUET_PARTNER : l.part === 'AB' ? DUET_BOTH : accent;
        const idle = partner ? '249,168,212' : '255,255,255';
        let pct = 0;
        if (current) {
          const end = lines[i + 1]?.t ?? l.t + 4;
          pct = Math.min(100, Math.max(0, ((position - l.t) / Math.max(0.5, end - l.t - 0.3)) * 100));
        }
        return (
          <p key={i} data-line={i} style={{
            margin: compact ? '0 0 10px' : '0 0 18px', textAlign: 'center', lineHeight: 1.35,
            fontSize: current ? size + 2 : size - 2, fontWeight: current ? 900 : 700,
            color: current ? 'transparent' : past ? `rgba(${idle},${overVideo ? 0.55 : 0.35})` : `rgba(${idle},${overVideo ? 0.9 : 0.75})`,
            transition: 'font-size 0.25s, color 0.25s',
            // drop-shadow (y no text-shadow) para no tapar el relleno de color de la línea actual
            ...(overVideo ? { filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.95)) drop-shadow(0 0 8px rgba(0,0,0,0.6))' } : {}),
            ...(current ? {
              backgroundImage: `linear-gradient(90deg, ${fill} ${pct}%, #ffffff ${pct}%)`,
              WebkitBackgroundClip: 'text', backgroundClip: 'text',
            } : {}),
          }}>
            {l.text || '♪'}
          </p>
        );
      })}
    </div>
  );
}
