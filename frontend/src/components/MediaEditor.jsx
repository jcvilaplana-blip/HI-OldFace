/**
 * MediaEditor — editor de fotos y vídeos a pantalla completa (chat antes/después de enviar y estados).
 *
 *   Foto:  Recortar (libre, 1:1, 4:5, 16:9) · Girar · Dibujar · Texto · Filtros → onDone({ blob })  (JPEG nuevo)
 *   Vídeo: Recortar (inicio y fin) · Girar · Sonido · Dibujar · Texto → onDone({ edits })  donde
 *          edits = { start, end, mute, rotate, overlay }  (overlay: PNG con el texto y los dibujos, o null),
 *          o edits = null si no se cambió nada. El vídeo lo procesa el servidor (utils/mediaEdit.js).
 *
 * Props: kind 'image' | 'video' · src (blob: o https:) · onCancel() · onDone(result) · busy (texto mientras se guarda)
 * Todo se hace en el móvil, sin servicios externos.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { tr } from '../i18n';
import { useBackClose } from '../utils/backHandler';

const ACCENT = '#98C1D9';
const COLORS = ['#FFFFFF', '#000000', '#EF4444', '#F59E0B', '#FACC15', '#22C55E', '#3B82F6', '#A855F7', '#EC4899'];
const FILTERS = [
  ['none', 'Original', 'none'],
  ['bn', 'B/N', 'grayscale(1)'],
  ['sepia', 'Sepia', 'sepia(0.85)'],
  ['vivo', 'Vivo', 'saturate(1.6) contrast(1.1)'],
  ['calido', 'Cálido', 'sepia(0.3) saturate(1.3) hue-rotate(-10deg)'],
  ['frio', 'Frío', 'saturate(1.1) hue-rotate(15deg) brightness(1.05)'],
  ['suave', 'Suave', 'contrast(0.9) brightness(1.1) saturate(0.85)'],
  ['drama', 'Drama', 'contrast(1.35) brightness(0.9)'],
];
const RATIOS = [['free', 'Libre', null], ['1:1', '1:1', 1], ['4:5', '4:5', 4 / 5], ['16:9', '16:9', 16 / 9]];
const SIZES = [0.008, 0.016, 0.03];
const FONT = '800 {px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const fmtSec = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${Math.floor((s % 1) * 10)}`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const filterCss = (k) => FILTERS.find(f => f[0] === k)?.[2] || 'none';

/** Dibuja trazos y textos (coordenadas 0..1) en un lienzo de W×H */
function drawOverlay(ctx, W, H, strokes, texts) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const s of strokes) {
    if (!s.points.length) continue;
    ctx.strokeStyle = s.color; ctx.lineWidth = Math.max(1, s.size * W);
    ctx.beginPath();
    s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
    if (s.points.length === 1) ctx.lineTo(s.points[0][0] * W + 0.1, s.points[0][1] * H);
    ctx.stroke();
  }
  for (const t of texts) {
    const px = Math.max(8, t.size * H);
    ctx.font = FONT.replace('{px}', String(Math.round(px)));
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lines = String(t.text).split('\n');
    const lh = px * 1.2;
    lines.forEach((line, i) => {
      const y = t.y * H + (i - (lines.length - 1) / 2) * lh;
      if (t.bg) {
        const w = ctx.measureText(line).width + px * 0.6;
        ctx.fillStyle = t.color === '#FFFFFF' ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(t.x * W - w / 2, y - lh / 2, w, lh, px * 0.25); else ctx.rect(t.x * W - w / 2, y - lh / 2, w, lh);
        ctx.fill();
      } else {
        ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = px * 0.18;
      }
      ctx.fillStyle = t.color; ctx.fillText(line, t.x * W, y);
      ctx.shadowBlur = 0;
    });
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (/^https?:/.test(src)) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(tr('No se pudo abrir la foto')));
    img.src = src;
  });
}

const newCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };

export default function MediaEditor({ kind, src, onCancel, onDone, busy = '' }) {
  const isVideo = kind === 'video';
  const [tool, setTool] = useState(isVideo ? 'trim' : null);   // crop | draw | text | filter | trim | null
  const [base, setBase] = useState(null);                      // foto: lienzo de trabajo (sin filtro ni capa)
  const [filter, setFilter] = useState('none');
  const [strokes, setStrokes] = useState([]);
  const [texts, setTexts] = useState([]);
  const [color, setColor] = useState('#FFFFFF');
  const [size, setSize] = useState(1);
  const [crop, setCrop] = useState({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
  const [ratio, setRatio] = useState('free');
  const [textEdit, setTextEdit] = useState(null);              // { id?, text, color, bg }
  const [error, setError] = useState('');
  // Vídeo
  const videoRef = useRef(null);
  const [vid, setVid] = useState({ w: 0, h: 0, dur: 0 });
  const [range, setRange] = useState([0, 0]);
  const [mute, setMute] = useState(false);
  const [rotate, setRotate] = useState(0);
  const [playing, setPlaying] = useState(false);

  const stageRef = useRef(null);
  const baseCvs = useRef(null);
  const drawCvs = useRef(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const live = useRef(null);       // trazo en curso
  const drag = useRef(null);       // texto o recorte que se arrastra

  useBackClose(true, () => (textEdit ? setTextEdit(null) : tool && !isVideo ? setTool(null) : onCancel()));

  // ── Cargar la foto ──
  useEffect(() => {
    if (isVideo) return undefined;
    let alive = true;
    loadImage(src).then(img => {
      if (!alive) return;
      const k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = newCanvas(img.naturalWidth * k, img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      setBase(c);
    }).catch(e => setError(e.message));
    return () => { alive = false; };
  }, [src, isVideo]);

  // ── Tamaño disponible ──
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Proporción del contenido (vídeo girado: se intercambian lados)
  const rotated = rotate === 90 || rotate === 270;
  const content = isVideo ? { w: rotated ? vid.h : vid.w, h: rotated ? vid.w : vid.h } : { w: base?.width || 0, h: base?.height || 0 };
  const box = useMemo(() => {
    if (!content.w || !content.h || !stage.w || !stage.h) return { w: 0, h: 0 };
    const k = Math.min(stage.w / content.w, stage.h / content.h);
    return { w: Math.floor(content.w * k), h: Math.floor(content.h * k) };
  }, [content.w, content.h, stage.w, stage.h]);

  // Miniatura para los botones de filtros (una vez por foto)
  const thumb = useMemo(() => {
    if (!base) return null;
    const k = 120 / Math.max(base.width, base.height);
    const c = newCanvas(base.width * k, base.height * k);
    c.getContext('2d').drawImage(base, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.6);
  }, [base]);

  // ── Pintar la foto (con filtro) ──
  useEffect(() => {
    if (isVideo || !base || !box.w || !baseCvs.current) return;
    const c = baseCvs.current;
    c.width = box.w; c.height = box.h;
    const ctx = c.getContext('2d');
    ctx.filter = filterCss(filter);
    ctx.drawImage(base, 0, 0, box.w, box.h);
    ctx.filter = 'none';
  }, [base, box.w, box.h, filter, isVideo]);

  // ── Pintar los trazos ──
  const paintStrokes = (list = strokes) => {
    const c = drawCvs.current;
    if (!c || !box.w) return;
    c.width = box.w; c.height = box.h;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, box.w, box.h);
    drawOverlay(ctx, box.w, box.h, live.current ? [...list, live.current] : list, []);
  };
  useEffect(() => { paintStrokes(); }, [strokes, box.w, box.h]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Vídeo: medidas y reproducción entre inicio y fin ──
  const onMeta = () => {
    const v = videoRef.current;
    if (!v) return;
    const dur = Number.isFinite(v.duration) ? v.duration : 0;
    setVid({ w: v.videoWidth, h: v.videoHeight, dur });
    setRange([0, dur]);
  };
  const onTime = () => {
    const v = videoRef.current;
    if (v && range[1] > 0 && v.currentTime >= range[1]) v.currentTime = range[0];
  };
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { if (v.currentTime < range[0] || v.currentTime >= range[1]) v.currentTime = range[0]; v.play().catch(() => {}); }
    else v.pause();
  };

  // ── Coordenadas 0..1 dentro del recuadro ──
  const rel = (e) => {
    const r = drawCvs.current.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)];
  };

  // ── Dibujar ──
  const onDown = (e) => {
    if (tool !== 'draw') return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    live.current = { color, size: SIZES[size], points: [rel(e)] };
    paintStrokes();
  };
  const onMove = (e) => {
    if (!live.current) return;
    live.current.points.push(rel(e));
    paintStrokes();
  };
  const onUp = () => {
    if (!live.current) return;
    const s = live.current; live.current = null;
    setStrokes(list => [...list, s]);
  };

  // ── Textos: arrastrar / tocar para editar ──
  const textDown = (e, t) => {
    if (tool === 'draw' || tool === 'crop') return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { id: t.id, start: rel(e), orig: [t.x, t.y], moved: false };
  };
  const textMove = (e) => {
    const d = drag.current;
    if (!d?.id) return;
    const [x, y] = rel(e);
    const dx = x - d.start[0], dy = y - d.start[1];
    if (Math.abs(dx) + Math.abs(dy) > 0.01) d.moved = true;
    setTexts(list => list.map(t => (t.id === d.id ? { ...t, x: clamp(d.orig[0] + dx, 0.02, 0.98), y: clamp(d.orig[1] + dy, 0.02, 0.98) } : t)));
  };
  const textUp = (t) => {
    const d = drag.current; drag.current = null;
    if (d?.id && !d.moved) setTextEdit({ id: t.id, text: t.text, color: t.color, bg: t.bg });
  };
  const saveText = () => {
    const txt = (textEdit.text || '').trim();
    if (textEdit.id) setTexts(list => (txt ? list.map(t => (t.id === textEdit.id ? { ...t, text: txt, color: textEdit.color, bg: textEdit.bg } : t)) : list.filter(t => t.id !== textEdit.id)));
    else if (txt) setTexts(list => [...list, { id: `t${Date.now()}`, text: txt, color: textEdit.color, bg: textEdit.bg, x: 0.5, y: 0.45, size: 0.06 }]);
    setTextEdit(null);
  };

  // ── Foto: fijar trazos y textos en la imagen (antes de girar o recortar) ──
  const bake = () => {
    if (!strokes.length && !texts.length) return base;
    const c = newCanvas(base.width, base.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(base, 0, 0);
    drawOverlay(ctx, c.width, c.height, strokes, texts);
    setStrokes([]); setTexts([]);
    return c;
  };
  const rotatePhoto = () => {
    const b = bake();
    const c = newCanvas(b.height, b.width);
    const ctx = c.getContext('2d');
    ctx.translate(c.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(b, 0, 0);
    setBase(c);
  };
  const applyCrop = () => {
    const b = bake();
    const sx = crop.x * b.width, sy = crop.y * b.height, sw = crop.w * b.width, sh = crop.h * b.height;
    const c = newCanvas(sw, sh);
    c.getContext('2d').drawImage(b, sx, sy, sw, sh, 0, 0, c.width, c.height);
    setBase(c); setTool(null); setCrop({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
  };
  const fitRatio = (r, rect = crop) => {
    const rv = RATIOS.find(x => x[0] === r)?.[2];
    if (!rv || !base) return rect;
    let w = rect.w, h = (w * base.width) / (rv * base.height);
    if (h > 1) { h = 1; w = (h * rv * base.height) / base.width; }
    return { x: clamp(rect.x, 0, 1 - w), y: clamp(rect.y, 0, 1 - h), w, h };
  };

  // ── Recorte: mover o estirar desde una esquina ──
  const cropDown = (e, mode) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { crop: true, mode, start: rel(e), orig: { ...crop } };
  };
  const cropMove = (e) => {
    const d = drag.current;
    if (!d?.crop) return;
    const [x, y] = rel(e);
    const dx = x - d.start[0], dy = y - d.start[1], o = d.orig, MIN = 0.1;
    let r;
    if (d.mode === 'move') r = { ...o, x: clamp(o.x + dx, 0, 1 - o.w), y: clamp(o.y + dy, 0, 1 - o.h) };
    else {
      const left = d.mode.includes('w'), top = d.mode.includes('n');
      const x1 = left ? clamp(o.x + dx, 0, o.x + o.w - MIN) : o.x, x2 = left ? o.x + o.w : clamp(o.x + o.w + dx, o.x + MIN, 1);
      const y1 = top ? clamp(o.y + dy, 0, o.y + o.h - MIN) : o.y, y2 = top ? o.y + o.h : clamp(o.y + o.h + dy, o.y + MIN, 1);
      r = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      const rv = RATIOS.find(q => q[0] === ratio)?.[2];
      if (rv) {
        const h = (r.w * base.width) / (rv * base.height);
        r = top ? { ...r, y: clamp(y2 - h, 0, 1), h: Math.min(h, y2) } : { ...r, h: Math.min(h, 1 - r.y) };
      }
    }
    setCrop(r);
  };

  // ── Terminar ──
  const done = async () => {
    setError('');
    try {
      if (!isVideo) {
        const k = Math.min(1, 1600 / Math.max(base.width, base.height));
        const c = newCanvas(base.width * k, base.height * k);
        const ctx = c.getContext('2d');
        ctx.filter = filterCss(filter);
        ctx.drawImage(base, 0, 0, c.width, c.height);
        ctx.filter = 'none';
        drawOverlay(ctx, c.width, c.height, strokes, texts);
        const blob = await new Promise((resolve, reject) => c.toBlob(b => (b ? resolve(b) : reject(new Error(tr('No se pudo guardar la foto')))), 'image/jpeg', 0.9));
        onDone({ blob });
        return;
      }
      let overlay = null;
      if (strokes.length || texts.length) {
        const k = Math.min(1, 1280 / Math.max(content.w, content.h));
        const c = newCanvas(content.w * k, content.h * k);
        drawOverlay(c.getContext('2d'), c.width, c.height, strokes, texts);
        overlay = c.toDataURL('image/png');
      }
      const [start, end] = range;
      const changed = !!overlay || mute || rotate !== 0 || start > 0.05 || end < vid.dur - 0.05;
      onDone({ edits: changed ? { start: Math.max(0, start), end: Math.max(end, start + 0.5), mute, rotate, overlay } : null });
    } catch (e) { setError(e.message || tr('No se pudo guardar')); }
  };

  const tools = isVideo
    ? [['trim', 'Recortar', 'M6 4v16M18 4v16M6 12h12'], ['rotate', 'Girar', 'M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5'],
       ['sound', mute ? 'Sin sonido' : 'Sonido', mute ? 'M11 5L6 9H2v6h4l5 4zM23 9l-6 6M17 9l6 6' : 'M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 010 7'],
       ['draw', 'Dibujar', 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z'], ['text', 'Texto', 'M4 7V4h16v3M9 20h6M12 4v16']]
    : [['crop', 'Recortar', 'M6 2v14a2 2 0 002 2h14M2 6h14a2 2 0 012 2v14'], ['rotate', 'Girar', 'M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5'],
       ['draw', 'Dibujar', 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z'], ['text', 'Texto', 'M4 7V4h16v3M9 20h6M12 4v16'],
       ['filter', 'Filtros', 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 3v18M3 12h18']];

  const pick = (k) => {
    if (k === 'rotate') { if (isVideo) setRotate(r => (r + 90) % 360); else if (base) rotatePhoto(); return; }
    if (k === 'sound') { setMute(m => !m); return; }
    if (k === 'text') { setTool('text'); setTextEdit({ text: '', color, bg: false }); return; }
    if (k === 'crop') setCrop(fitRatio(ratio, { x: 0.05, y: 0.05, w: 0.9, h: 0.9 }));
    setTool(t => (t === k && !isVideo ? null : k));
  };

  const pill = (active) => ({ padding: '7px 13px', borderRadius: 18, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 800, flexShrink: 0,
                              background: active ? ACCENT : 'rgba(255,255,255,0.12)', color: active ? '#0A0D25' : 'white' });
  const ready = isVideo ? vid.w > 0 : !!base;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1400, background: '#0A0D25', display: 'flex', flexDirection: 'column', color: 'white', userSelect: 'none' }}>
      {/* Barra superior */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 'calc(env(safe-area-inset-top, 0px) + 10px) 14px 8px' }}>
        <button onClick={onCancel} disabled={!!busy} aria-label={tr('Cancelar')}
          style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.12)', border: 'none', color: 'white', fontSize: 18, cursor: 'pointer', flexShrink: 0 }}>✕</button>
        <p style={{ flex: 1, margin: 0, fontSize: 16, fontWeight: 800 }}>{isVideo ? tr('Editar vídeo') : tr('Editar foto')}</p>
        {tool === 'draw' && strokes.length > 0 && (
          <button onClick={() => setStrokes(s => s.slice(0, -1))} style={pill(false)}>{tr('Deshacer')}</button>
        )}
        {tool === 'crop'
          ? <button onClick={applyCrop} style={pill(true)}>{tr('Aplicar')}</button>
          : <button onClick={done} disabled={!ready || !!busy} style={{ ...pill(true), opacity: ready && !busy ? 1 : 0.5 }}>{busy || tr('Listo')}</button>}
      </div>

      {/* Lienzo */}
      <div ref={stageRef} style={{ flex: 1, minHeight: 0, margin: '0 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        {error && <p style={{ position: 'absolute', top: 10, left: 0, right: 0, textAlign: 'center', color: '#fca5a5', fontWeight: 700, zIndex: 5 }}>{error}</p>}
        {!ready && !error && <p style={{ color: 'rgba(255,255,255,0.6)' }}>{tr('Cargando…')}</p>}
        {isVideo && (
          // El vídeo se carga siempre (sus medidas deciden el recuadro); girado con CSS
          <div style={{ position: box.w ? 'relative' : 'absolute', width: box.w || 1, height: box.h || 1, overflow: 'hidden', borderRadius: 8 }}>
            <video ref={videoRef} src={src} playsInline muted={mute} preload="auto" onLoadedMetadata={onMeta} onTimeUpdate={onTime}
              onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)}
              style={{ position: 'absolute', left: '50%', top: '50%', width: rotated ? box.h : box.w, height: rotated ? box.w : box.h,
                       transform: `translate(-50%, -50%) rotate(${rotate}deg)`, objectFit: 'fill', background: '#000',
                       maxWidth: 'none', maxHeight: 'none' }} />
          </div>
        )}
        {ready && box.w > 0 && (
          <div style={{ position: 'absolute', width: box.w, height: box.h, touchAction: 'none' }}
            onPointerMove={(e) => { onMove(e); textMove(e); cropMove(e); }} onPointerUp={() => { onUp(); if (drag.current?.crop) drag.current = null; }}>
            {!isVideo && <canvas ref={baseCvs} style={{ position: 'absolute', inset: 0, width: box.w, height: box.h, borderRadius: 6 }} />}
            <canvas ref={drawCvs} onPointerDown={onDown}
              onClick={isVideo && tool !== 'draw' ? togglePlay : undefined}
              style={{ position: 'absolute', inset: 0, width: box.w, height: box.h, cursor: tool === 'draw' ? 'crosshair' : 'default' }} />
            {texts.map(t => (
              <div key={t.id} onPointerDown={(e) => textDown(e, t)} onPointerUp={() => textUp(t)}
                style={{ position: 'absolute', left: `${t.x * 100}%`, top: `${t.y * 100}%`, transform: 'translate(-50%, -50%)', whiteSpace: 'pre', textAlign: 'center',
                         font: FONT.replace('{px}', String(Math.max(8, Math.round(t.size * box.h)))), lineHeight: 1.2, color: t.color, cursor: 'move', touchAction: 'none',
                         padding: t.bg ? '0 0.3em' : 0, borderRadius: '0.25em',
                         background: t.bg ? (t.color === '#FFFFFF' ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.85)') : 'transparent',
                         textShadow: t.bg ? 'none' : '0 0 0.18em rgba(0,0,0,0.55)' }}>{t.text}</div>
            ))}
            {isVideo && !playing && tool !== 'draw' && (
              <button onClick={togglePlay} aria-label={tr('Reproducir')}
                style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 58, height: 58, borderRadius: '50%', border: 'none',
                         background: 'rgba(0,0,0,0.5)', color: 'white', fontSize: 22, cursor: 'pointer' }}>▶</button>
            )}
            {tool === 'crop' && (
              // Recorte: fuera se oscurece; se mueve arrastrando dentro y se estira desde las esquinas
              <div style={{ position: 'absolute', left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%`,
                            boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)', outline: '2px solid white', cursor: 'move', touchAction: 'none' }}
                onPointerDown={(e) => cropDown(e, 'move')}>
                {[['nw', 0, 0], ['ne', 100, 0], ['sw', 0, 100], ['se', 100, 100]].map(([m, l, tp]) => (
                  <span key={m} onPointerDown={(e) => cropDown(e, m)}
                    style={{ position: 'absolute', left: `${l}%`, top: `${tp}%`, width: 26, height: 26, transform: 'translate(-50%,-50%)', borderRadius: '50%',
                             background: 'white', border: `3px solid ${ACCENT}`, touchAction: 'none' }} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Opciones de la herramienta elegida */}
      <div style={{ padding: '10px 12px 0', minHeight: 50 }}>
        {tool === 'draw' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', scrollbarWidth: 'none' }}>
            {COLORS.map(c => <button key={c} onClick={() => setColor(c)} aria-label={tr('Color')}
              style={{ width: 28, height: 28, borderRadius: '50%', background: c, flexShrink: 0, cursor: 'pointer', border: color === c ? `3px solid ${ACCENT}` : '2px solid rgba(255,255,255,0.4)' }} />)}
            <span style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.2)', flexShrink: 0 }} />
            {SIZES.map((s, i) => <button key={s} onClick={() => setSize(i)} aria-label={tr('Grosor')}
              style={{ ...pill(size === i), width: 38, padding: 0, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ width: 6 + i * 6, height: 6 + i * 6, borderRadius: '50%', background: size === i ? '#0A0D25' : 'white' }} /></button>)}
          </div>
        )}
        {tool === 'crop' && (
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none' }}>
            {RATIOS.map(([k, label]) => <button key={k} onClick={() => { setRatio(k); setCrop(c => fitRatio(k, c)); }} style={pill(ratio === k)}>{tr(label)}</button>)}
          </div>
        )}
        {tool === 'filter' && thumb && (
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', scrollbarWidth: 'none' }}>
            {FILTERS.map(([k, label, css]) => (
              <button key={k} onClick={() => setFilter(k)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0, color: 'white', textAlign: 'center' }}>
                <img src={thumb} alt="" style={{ width: 58, height: 58, objectFit: 'cover', borderRadius: 10, filter: css,
                  border: filter === k ? `3px solid ${ACCENT}` : '3px solid transparent' }} />
                <span style={{ display: 'block', fontSize: 11, fontWeight: 700, marginTop: 2 }}>{tr(label)}</span>
              </button>
            ))}
          </div>
        )}
        {isVideo && tool === 'trim' && vid.dur > 0 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.8)', marginBottom: 4 }}>
              <span>{tr('Inicio')} {fmtSec(range[0])}</span><span>{fmtSec(Math.max(0, range[1] - range[0]))}</span><span>{tr('Fin')} {fmtSec(range[1])}</span>
            </div>
            {[0, 1].map(i => (
              <input key={i} type="range" min={0} max={vid.dur} step={0.1} value={range[i]} aria-label={i ? tr('Fin') : tr('Inicio')}
                onChange={e => {
                  const v = Number(e.target.value);
                  setRange(r => (i === 0 ? [Math.min(v, r[1] - 0.5), r[1]] : [r[0], Math.max(v, r[0] + 0.5)]));
                  if (videoRef.current) videoRef.current.currentTime = v;
                }}
                style={{ width: '100%', accentColor: ACCENT, display: 'block', margin: '4px 0' }} />
            ))}
          </div>
        )}
      </div>

      {/* Herramientas */}
      <div style={{ display: 'flex', justifyContent: 'space-around', padding: '10px 6px', paddingBottom: 'max(14px, env(safe-area-inset-bottom, 14px))' }}>
        {tools.map(([k, label, d]) => {
          const active = tool === k || (k === 'sound' && mute) || (k === 'rotate' && isVideo && rotate !== 0);
          return (
            <button key={k} onClick={() => pick(k)} disabled={!ready || !!busy}
              style={{ background: 'none', border: 'none', color: active ? ACCENT : 'white', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, opacity: ready ? 1 : 0.4 }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
              {tr(label)}
            </button>
          );
        })}
      </div>

      {/* Escribir un texto */}
      {textEdit && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 10, background: 'rgba(0,0,0,0.75)', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 20, gap: 14 }}>
          <textarea autoFocus value={textEdit.text} onChange={e => setTextEdit(t => ({ ...t, text: e.target.value }))} maxLength={120} rows={3}
            placeholder={tr('Escribe aquí…')}
            style={{ width: '100%', boxSizing: 'border-box', background: textEdit.bg ? (textEdit.color === '#FFFFFF' ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.85)') : 'transparent',
                     border: '1.5px solid rgba(255,255,255,0.3)', borderRadius: 14, color: textEdit.color, fontSize: 26, fontWeight: 800, textAlign: 'center', padding: 12, outline: 'none', resize: 'none', fontFamily: 'inherit' }} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            {COLORS.map(c => <button key={c} onClick={() => setTextEdit(t => ({ ...t, color: c }))} aria-label={tr('Color')}
              style={{ width: 30, height: 30, borderRadius: '50%', background: c, cursor: 'pointer', border: textEdit.color === c ? `3px solid ${ACCENT}` : '2px solid rgba(255,255,255,0.4)' }} />)}
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => setTextEdit(t => ({ ...t, bg: !t.bg }))} style={pill(textEdit.bg)}>{tr('Fondo')}</button>
            {textEdit.id && <button onClick={() => { setTexts(l => l.filter(t => t.id !== textEdit.id)); setTextEdit(null); }} style={{ ...pill(false), color: '#fca5a5' }}>{tr('Quitar')}</button>}
            <button onClick={() => setTextEdit(null)} style={pill(false)}>{tr('Cancelar')}</button>
            <button onClick={saveText} style={pill(true)}>{tr('Listo')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
