/**
 * ZoomImage — imagen a pantalla completa con zoom:
 *   · pellizcar con dos dedos (hasta 5×), arrastrar con un dedo cuando hay zoom,
 *   · doble toque: acerca 2,5× en ese punto / vuelve al tamaño normal,
 *   · un toque sin zoom → onTap (cerrar el visor).
 */
import { useRef, useState } from 'react';

const MAX_SCALE   = 5;
const TAP_SCALE   = 2.5;
const DOUBLE_TAP  = 280;   // ms
const MOVE_SLOP   = 8;     // px

function clamp(t) {
  if (t.s <= 1.01) return { s: 1, x: 0, y: 0 };
  const mx = (window.innerWidth  * (t.s - 1)) / 2;
  const my = (window.innerHeight * (t.s - 1)) / 2;
  return { s: t.s, x: Math.max(-mx, Math.min(mx, t.x)), y: Math.max(-my, Math.min(my, t.y)) };
}

export default function ZoomImage({ src, onTap, protect = false }) {
  const [t, setT]     = useState({ s: 1, x: 0, y: 0 });
  const [anim, setAnim] = useState(false);
  const tRef    = useRef(t);
  const pts     = useRef(new Map());
  const gesture = useRef(null);
  const moved   = useRef(false);
  const lastTap = useRef(0);
  const tapTimer = useRef(null);

  const apply = (next, animate = false) => { tRef.current = next; setAnim(animate); setT(next); };

  const begin = () => {
    const p = [...pts.current.values()];
    const t0 = tRef.current;
    if (p.length >= 2) {
      gesture.current = { kind: 'pinch', t0,
        dist: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1,
        mid: { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 } };
    } else if (p.length === 1) {
      gesture.current = { kind: 'pan', t0, start: p[0] };
    }
  };

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 1) moved.current = false;
    begin();
  };

  const onPointerMove = (e) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const p = [...pts.current.values()];
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    if (g.kind === 'pinch' && p.length >= 2) {
      moved.current = true;
      const dist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      const mid  = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
      const s = Math.max(1, Math.min(MAX_SCALE, g.t0.s * dist / g.dist));
      // El punto de la imagen que estaba bajo los dedos sigue bajo los dedos
      const ix = (g.mid.x - cx - g.t0.x) / g.t0.s;
      const iy = (g.mid.y - cy - g.t0.y) / g.t0.s;
      apply({ s, x: mid.x - cx - ix * s, y: mid.y - cy - iy * s });
    } else if (g.kind === 'pan' && p.length === 1) {
      const dx = p[0].x - g.start.x, dy = p[0].y - g.start.y;
      if (Math.abs(dx) > MOVE_SLOP || Math.abs(dy) > MOVE_SLOP) moved.current = true;
      if (g.t0.s > 1) apply(clamp({ s: g.t0.s, x: g.t0.x + dx, y: g.t0.y + dy }));
    }
  };

  const onPointerUp = (e) => {
    if (!pts.current.has(e.pointerId)) return;
    const up = pts.current.get(e.pointerId);
    pts.current.delete(e.pointerId);
    if (pts.current.size > 0) { begin(); return; }
    gesture.current = null;
    if (moved.current) { apply(clamp(tRef.current), true); return; }

    // Toque: doble toque = zoom, toque simple sin zoom = onTap
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP) {
      clearTimeout(tapTimer.current);
      lastTap.current = 0;
      if (tRef.current.s > 1) apply({ s: 1, x: 0, y: 0 }, true);
      else {
        const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
        apply(clamp({ s: TAP_SCALE, x: -(up.x - cx) * (TAP_SCALE - 1), y: -(up.y - cy) * (TAP_SCALE - 1) }), true);
      }
      return;
    }
    lastTap.current = now;
    clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => { if (tRef.current.s === 1) onTap?.(); }, DOUBLE_TAP);
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onContextMenu={protect ? (e) => e.preventDefault() : undefined}
      style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
               overflow: 'hidden', touchAction: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}>
      <img src={src} alt="" draggable={false}
        style={{ width: '100vw', maxHeight: '100vh', objectFit: 'contain', pointerEvents: 'none',
                 transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})`, transformOrigin: 'center center',
                 transition: anim ? 'transform 0.2s ease-out' : 'none', willChange: 'transform' }} />
    </div>
  );
}
