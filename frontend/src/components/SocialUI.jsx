/**
 * Social — piezas comunes de la pantalla Social y de los canales.
 *
 *   useSocialTheme()      → colores de Social (rojo de marca de Social y Directos; claro u oscuro según Ajustes)
 *   ChannelAvatar · Verified · Icon · Sheet · Toast · Segmented · BottomBar
 *   PostCard              → publicación del muro (fotos en carrusel o vídeo, me gusta, comentarios, compartir, guardar)
 *   PostMenu              → opciones de una publicación (editar quién la ve, borrar, guardar, denunciar, bloquear)
 *   MediaViewer           → fotos a pantalla completa
 *   ReelsViewer           → vídeos verticales a pantalla completa (desliza arriba / abajo)
 *   CommentsSheet · ComposerSheet · NotificationsSheet · VideoTile · PhotoTile
 *
 * El chat sigue con el azul de OldFace; Social y Directos usan el rojo (decidido 2026-11-10).
 */
import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { useThemeStore } from '../store/themeStore';
import { useBackClose } from '../utils/backHandler';
import * as api from '../utils/social';
import { formatDuration } from '../utils/directos';
import { tr } from '../i18n';

export const RED = '#F0174B';
const DARK_S = { isDark: true, bg: '#0B1424', surface: '#111C31', card: '#15213A', border: 'rgba(255,255,255,0.08)', text: '#F1F5F9',
                 sub: '#A3B1C6', muted: '#6B7A90', chip: '#1A2742', red: RED, redSoft: 'rgba(240,23,75,0.16)', overlay: 'rgba(3,8,18,0.72)' };
const LIGHT_S = { isDark: false, bg: '#F3F5FA', surface: '#FFFFFF', card: '#FFFFFF', border: '#E6EAF1', text: '#111827',
                  sub: '#5B6474', muted: '#9AA3B2', chip: '#F1F3F8', red: RED, redSoft: '#FFE4EA', overlay: 'rgba(15,23,42,0.45)' };
export function useSocialTheme() {
  const { isDark } = useThemeStore();
  return isDark ? DARK_S : LIGHT_S;
}

export const SHARE_BASE = 'https://oldface.app/social';
export async function shareText(text) {
  try {
    if (Capacitor.isNativePlatform()) { const { Share } = await import('@capacitor/share'); await Share.share({ text }); return 'shared'; }
    if (navigator.share) { await navigator.share({ text }); return 'shared'; }
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch { return null; }
}

// ── Iconos (trazo, heredan el color) ──
const PATHS = {
  heart: 'M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 00-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 000-7.8z',
  comment: 'M21 11.5a8.4 8.4 0 01-9 8.4 8.6 8.6 0 01-3.8-.9L3 20.5l1.5-4.6A8.4 8.4 0 1121 11.5z',
  share: 'M14 5l7 7-7 7M21 12H9a6 6 0 00-6 6v1',
  bookmark: 'M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z',
  dots: 'M12 5h.01M12 12h.01M12 19h.01',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
  bell: 'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0',
  plus: 'M12 5v14M5 12h14',
  plusCircle: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 8v8M8 12h8',
  compass: 'M12 22a10 10 0 100-20 10 10 0 000 20zM16.2 7.8l-2.1 6.3-6.3 2.1 2.1-6.3z',
  user: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z',
  users: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8',
  live: 'M12 14a2 2 0 100-4 2 2 0 000 4zM16.2 7.8a6 6 0 010 8.4M7.8 16.2a6 6 0 010-8.4M19.1 4.9a10 10 0 010 14.2M4.9 19.1a10 10 0 010-14.2',
  play: 'M7 4l13 8-13 8z',
  back: 'M15 19l-7-7 7-7',
  close: 'M18 6L6 18M6 6l12 12',
  globe: 'M12 22a10 10 0 100-20 10 10 0 000 20zM2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 018 0v4',
  home: 'M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z',
  reels: 'M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2zM3 8h18M8 3l3 5M14 3l3 5M10 12v5l4-2.5z',
  image: 'M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2zM8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM21 15l-5-5L5 21',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  sort: 'M7 4v16M7 4L4 7M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  flag: 'M4 22V4M4 4h13l-2 4 2 4H4',
  block: 'M12 22a10 10 0 100-20 10 10 0 000 20zM4.9 4.9l14.2 14.2',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z',
  check: 'M20 6L9 17l-5-5',
  camera: 'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2zM12 17a4 4 0 100-8 4 4 0 000 8z',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
  volume: 'M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14',
  mute: 'M11 5L6 9H2v6h4l5 4zM23 9l-6 6M17 9l6 6',
};
export function Icon({ name, size = 22, color = 'currentColor', fill = 'none', stroke = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Verified({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label={tr('Verificado')} style={{ flexShrink: 0 }}>
      <path fill="#1D9BF0" d="M12 1l2.6 2.2 3.4-.4.9 3.3 3 1.7-1.3 3.2 1.3 3.2-3 1.7-.9 3.3-3.4-.4L12 23l-2.6-2.2-3.4.4-.9-3.3-3-1.7 1.3-3.2L2.1 9.8l3-1.7.9-3.3 3.4.4z" />
      <path d="M7.5 12.3l3 3 6-6" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const GRADS = ['#F0174B,#FF7A59', '#7C3AED,#EC4899', '#0EA5E9,#6366F1', '#10B981,#0EA5E9', '#F59E0B,#EF4444'];
export function ChannelAvatar({ author, size = 40, ring = false, ringBg = '#fff', onClick }) {
  const name = author?.name || '?';
  const g = GRADS[[...name].reduce((n, ch) => n + ch.charCodeAt(0), 0) % GRADS.length];
  const inner = author?.avatar
    ? <img src={author.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%', display: 'block' }} />
    : <span style={{ width: '100%', height: '100%', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                     background: `linear-gradient(135deg,${g})`, color: '#fff', fontWeight: 800, fontSize: size * 0.4 }}>{name.trim()[0]?.toUpperCase()}</span>;
  return (
    <span onClick={onClick} style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'inline-block', cursor: onClick ? 'pointer' : 'default',
                                     padding: ring ? 3 : 0, background: ring ? `linear-gradient(135deg,${RED},#FF7A59)` : 'transparent', boxSizing: 'border-box' }}>
      <span style={{ display: 'block', width: '100%', height: '100%', borderRadius: '50%', padding: ring ? 3 : 0, background: ring ? ringBg : 'transparent', boxSizing: 'border-box' }}>
        {inner}
      </span>
    </span>
  );
}

/** Hoja que sube desde abajo (Atrás la cierra) */
export function Sheet({ S, onClose, title, children, full = false, footer }) {
  useBackClose(true, onClose);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 800, background: S.overlay, display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 640, margin: '0 auto', background: S.surface, color: S.text,
           borderRadius: '22px 22px 0 0', maxHeight: full ? '94vh' : '86vh', height: full ? '94vh' : 'auto', display: 'flex', flexDirection: 'column',
           paddingBottom: 'env(safe-area-inset-bottom, 0px)', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px 10px', gap: 10, borderBottom: `1px solid ${S.border}` }}>
          <p style={{ flex: 1, margin: 0, fontWeight: 800, fontSize: 17 }}>{title}</p>
          <button onClick={onClose} aria-label={tr('Cerrar')} style={{ background: S.chip, border: 'none', borderRadius: '50%', width: 34, height: 34, color: S.text, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain' }}>{children}</div>
        {footer}
      </div>
    </div>
  );
}

export function Toast({ text }) {
  if (!text) return null;
  return (
    <div style={{ position: 'fixed', left: '50%', bottom: 'calc(96px + env(safe-area-inset-bottom, 0px))', transform: 'translateX(-50%)', zIndex: 950,
                  background: 'rgba(17,24,39,0.92)', color: '#fff', padding: '10px 16px', borderRadius: 14, fontSize: 13, fontWeight: 600, maxWidth: '86vw', textAlign: 'center' }}>{text}</div>
  );
}
export function useToast() {
  const [text, setText] = useState('');
  const timer = useRef(null);
  const show = useCallback((t) => { setText(t); clearTimeout(timer.current); timer.current = setTimeout(() => setText(''), 2400); }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [text, show];
}

/** Público / Privado (rojo = elegido) */
export function Segmented({ S, value, options, onChange, small = false }) {
  return (
    <div style={{ display: 'inline-flex', background: S.chip, borderRadius: 999, padding: 3, flexShrink: 0 }}>
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)} style={{ border: 'none', cursor: 'pointer', borderRadius: 999, fontWeight: 700,
                 padding: small ? '5px 12px' : '7px 16px', fontSize: small ? 12 : 13,
                 background: value === o.id ? S.red : 'transparent', color: value === o.id ? '#fff' : S.sub,
                 boxShadow: value === o.id ? '0 4px 12px rgba(240,23,75,0.35)' : 'none' }}>{o.label}</button>
      ))}
    </div>
  );
}

/** Barra inferior de Social: Explorar · Publicar · Mensajes · Mi canal */
export function BottomBar({ S, active, onExplore, onPublish, onMessages, onChannel }) {
  const item = (id, icon, label, onClick, logo) => (
    <button key={id} onClick={onClick} style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column',
             alignItems: 'center', gap: 3, padding: '8px 0 6px', color: active === id ? S.red : S.sub, position: 'relative' }}>
      {logo ? <img src="/logo-oldface.png" alt="" style={{ width: 26, height: 26, objectFit: 'contain' }} /> : <Icon name={icon} size={25} stroke={1.9} />}
      <span style={{ fontSize: 11.5, fontWeight: active === id ? 800 : 600 }}>{label}</span>
      {active === id && <span style={{ position: 'absolute', bottom: 0, width: 34, height: 3, borderRadius: 3, background: S.red }} />}
    </button>
  );
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 60, background: S.surface, borderTop: `1px solid ${S.border}`,
                  display: 'flex', paddingBottom: 'env(safe-area-inset-bottom, 0px)', boxShadow: S.isDark ? 'none' : '0 -4px 16px rgba(15,23,42,0.05)' }}>
      {item('explore', 'compass', tr('Explorar'), onExplore)}
      {item('publish', 'plusCircle', tr('Publicar'), onPublish)}
      {item('messages', null, tr('Mensajes'), onMessages, true)}
      {item('channel', 'user', tr('Mi canal'), onChannel)}
    </div>
  );
}

// ── Publicación ──
export const postTitle = (p) => (p.text || '').split('\n')[0].slice(0, 80);

export function PostCard({ S, post, author, onOpenChannel, onOpenComments, onOpenMedia, onOpenVideo, onMenu, onChanged, toast }) {
  const [p, setP] = useState(post);
  useEffect(() => setP(post), [post]);
  const [index, setIndex] = useState(0);
  const strip = useRef(null);
  const update = (patch) => { const n = { ...p, ...patch }; setP(n); onChanged?.(n); };

  const toggleLike = async () => {
    const on = !p.liked;
    update({ liked: on, likes: Math.max(0, p.likes + (on ? 1 : -1)) });
    try { const r = await api.like(p.id, on); update({ liked: r.liked, likes: r.likes }); }
    catch (e) { update({ liked: !on, likes: p.likes }); toast?.(e.message); }
  };
  const toggleSave = async () => {
    const on = !p.saved;
    update({ saved: on });
    try { await api.save(p.id, on); toast?.(on ? tr('Guardado') : tr('Quitado de guardados')); }
    catch (e) { update({ saved: !on }); toast?.(e.message); }
  };
  const share = async () => {
    const r = await shareText(`${p.text ? `${postTitle(p)}\n` : ''}${SHARE_BASE}?post=${p.id}`);
    if (r === 'copied') toast?.(tr('Enlace copiado'));
  };
  const media = p.media || [];
  const video = media[0]?.type === 'video' ? media[0] : null;

  return (
    <article style={{ background: S.card, borderBottom: `1px solid ${S.border}`, paddingTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px' }}>
        <ChannelAvatar author={author} size={42} onClick={() => onOpenChannel?.(p.userId)} />
        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => onOpenChannel?.(p.userId)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ fontWeight: 800, fontSize: 15, color: S.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{author?.name || 'OldFace'}</span>
            {author?.verified && <Verified />}
            <span style={{ fontSize: 12.5, color: S.red, whiteSpace: 'nowrap' }}>{api.ago(p.createdAt)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: S.muted, fontSize: 12 }}>
            <Icon name={p.visibility === 'public' ? 'globe' : 'users'} size={12} />
            <span>{p.visibility === 'public' ? tr('Público') : tr('Solo mis contactos')}</span>
            {p.hiddenByAdmin && <span style={{ color: S.red, fontWeight: 700 }}>· {tr('Retirada por OldFace')}</span>}
          </div>
        </div>
        <button onClick={() => onMenu?.(p)} aria-label={tr('Opciones')} style={{ background: 'none', border: 'none', color: S.sub, cursor: 'pointer', padding: 6 }}>
          <Icon name="dots" size={22} stroke={3} />
        </button>
      </div>
      {p.text ? <p style={{ margin: '8px 14px 10px', color: S.text, fontSize: 14.5, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{p.text}</p>
        : <div style={{ height: 10 }} />}

      {video && (
        <div onClick={() => onOpenVideo?.(p)} style={{ position: 'relative', margin: '0 14px', borderRadius: 14, overflow: 'hidden', background: '#000', aspectRatio: '16 / 10', cursor: 'pointer' }}>
          {video.thumb ? <img src={video.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            : <video src={video.url} preload="metadata" muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
          <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ width: 62, height: 62, borderRadius: '50%', background: 'rgba(0,0,0,0.45)', border: '2px solid rgba(255,255,255,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', paddingLeft: 4, boxSizing: 'border-box' }}>
              <Icon name="play" size={26} color="#fff" fill="#fff" />
            </span>
          </span>
          {video.duration ? <span style={badge({ left: 10, bottom: 10 })}>{formatDuration(video.duration)}</span> : null}
          <span style={badge({ right: 10, bottom: 10 })}>{tr('{n} reproducciones', { n: api.compact(p.views) })}</span>
        </div>
      )}
      {!video && media.length === 1 && (
        <img src={media[0].url} alt="" onClick={() => onOpenMedia?.(p, 0)} loading="lazy"
             style={{ display: 'block', width: 'calc(100% - 28px)', margin: '0 14px', borderRadius: 14, maxHeight: '70vh', objectFit: 'cover', cursor: 'zoom-in', background: S.chip }} />
      )}
      {!video && media.length > 1 && (
        <div style={{ position: 'relative' }}>
          <div ref={strip} onScroll={() => { const el = strip.current; if (el) setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth * 0.86))); }}
               style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollSnapType: 'x mandatory', padding: '0 14px', scrollbarWidth: 'none' }}>
            {media.map((m, i) => (
              <img key={i} src={m.url} alt="" loading="lazy" onClick={() => onOpenMedia?.(p, i)}
                   style={{ flex: '0 0 86%', height: 300, objectFit: 'cover', borderRadius: 14, scrollSnapAlign: 'center', cursor: 'zoom-in', background: S.chip }} />
            ))}
          </div>
          <span style={badge({ right: 24, top: 10 })}>{Math.min(index + 1, media.length)}/{media.length}</span>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '10px 14px 12px', color: S.text }}>
        <button onClick={toggleLike} style={actionBtn(p.liked ? S.red : S.text)} aria-label={tr('Me gusta')}>
          <Icon name="heart" size={24} fill={p.liked ? S.red : 'none'} color={p.liked ? S.red : S.text} />
          <span>{api.compact(p.likes)}</span>
        </button>
        <button onClick={() => onOpenComments?.(p)} style={actionBtn(S.text)} aria-label={tr('Comentarios')}>
          <Icon name="comment" size={23} /><span>{api.compact(p.comments)}</span>
        </button>
        <button onClick={share} style={actionBtn(S.text)} aria-label={tr('Compartir')}>
          <Icon name="share" size={23} />
        </button>
        <span style={{ flex: 1 }} />
        <button onClick={toggleSave} style={actionBtn(p.saved ? S.red : S.text)} aria-label={tr('Guardar')}>
          <Icon name="bookmark" size={23} fill={p.saved ? S.red : 'none'} color={p.saved ? S.red : S.text} />
        </button>
      </div>
    </article>
  );
}
const badge = (pos) => ({ position: 'absolute', ...pos, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 12, fontWeight: 700, padding: '4px 9px', borderRadius: 8 });
const actionBtn = (color) => ({ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color, fontSize: 14, fontWeight: 700, padding: 0 });

/** Opciones de una publicación (mías: quién la ve y borrar; de otros: canal, guardar, denunciar, bloquear) */
export function PostMenu({ S, post, author, onClose, onChanged, onDeleted, onOpenChannel, onBlocked, toast }) {
  const [step, setStep] = useState('menu');   // menu | report | confirmDelete | confirmBlock
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn) => { setBusy(true); try { await fn(); } catch (e) { toast?.(e.message); } finally { setBusy(false); } };
  const row = (icon, text, onClick, danger) => (
    <button key={text} onClick={onClick} disabled={busy} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', background: 'none',
             border: 'none', borderBottom: `1px solid ${S.border}`, color: danger ? S.red : S.text, fontSize: 15, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>
      <Icon name={icon} size={20} />{text}
    </button>
  );
  const REASONS = [tr('Spam'), tr('Contenido sexual'), tr('Violencia o acoso'), tr('Información falsa'), tr('Otro motivo')];
  return (
    <Sheet S={S} onClose={onClose} title={step === 'report' ? tr('Denunciar') : author?.name || tr('Opciones')}>
      {step === 'menu' && post.mine && <>
        {row(post.visibility === 'public' ? 'users' : 'globe', post.visibility === 'public' ? tr('Cambiar a: Solo mis contactos') : tr('Cambiar a: Público'),
          () => run(async () => { const r = await api.updatePost(post.id, { visibility: post.visibility === 'public' ? 'contacts' : 'public' }); onChanged?.(r.post); toast?.(tr('Guardado')); onClose(); }))}
        {row('trash', tr('Eliminar publicación'), () => setStep('confirmDelete'), true)}
      </>}
      {step === 'menu' && !post.mine && <>
        {row('user', tr('Ver canal'), () => { onClose(); onOpenChannel?.(post.userId); })}
        {row('bookmark', post.saved ? tr('Quitar de guardados') : tr('Guardar'),
          () => run(async () => { await api.save(post.id, !post.saved); onChanged?.({ ...post, saved: !post.saved }); onClose(); }))}
        {row('flag', tr('Denunciar'), () => setStep('report'), true)}
        {row('block', tr('Bloquear a {name}', { name: author?.name || '' }), () => setStep('confirmBlock'), true)}
      </>}
      {step === 'confirmDelete' && (
        <Confirm S={S} text={tr('¿Eliminar esta publicación? Se borrarán también sus fotos o su vídeo.')} ok={tr('Eliminar')} busy={busy}
          onCancel={() => setStep('menu')} onOk={() => run(async () => { await api.deletePost(post.id); onDeleted?.(post.id); toast?.(tr('Publicación eliminada')); onClose(); })} />
      )}
      {step === 'confirmBlock' && (
        <Confirm S={S} text={tr('No veréis vuestras publicaciones, canales ni directos públicos, y dejaréis de seguiros. Puedes desbloquear cuando quieras desde su canal.')}
          ok={tr('Bloquear')} busy={busy} onCancel={() => setStep('menu')}
          onOk={() => run(async () => { await api.block(post.userId); onBlocked?.(post.userId); toast?.(tr('Usuario bloqueado')); onClose(); })} />
      )}
      {step === 'report' && (
        <div style={{ padding: 16 }}>
          <p style={{ margin: '0 0 12px', color: S.sub, fontSize: 14 }}>{tr('¿Por qué denuncias esta publicación? OldFace la revisará.')}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {REASONS.map(r => (
              <button key={r} onClick={() => setReason(r)} style={{ border: `1px solid ${reason === r ? S.red : S.border}`, background: reason === r ? S.redSoft : 'transparent',
                       color: reason === r ? S.red : S.text, borderRadius: 999, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{r}</button>
            ))}
          </div>
          <PrimaryBtn S={S} disabled={!reason || busy} onClick={() => run(async () => { await api.report('post', post.id, reason); toast?.(tr('Gracias. Lo revisaremos.')); onClose(); })}>
            {tr('Enviar denuncia')}
          </PrimaryBtn>
        </div>
      )}
    </Sheet>
  );
}

export function Confirm({ S, text, ok, busy, onCancel, onOk }) {
  return (
    <div style={{ padding: 18 }}>
      <p style={{ margin: '0 0 18px', color: S.text, fontSize: 15, lineHeight: 1.5 }}>{text}</p>
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onCancel} style={{ flex: 1, padding: 13, borderRadius: 14, border: `1px solid ${S.border}`, background: 'transparent', color: S.text, fontWeight: 700, cursor: 'pointer' }}>{tr('Cancelar')}</button>
        <PrimaryBtn S={S} disabled={busy} onClick={onOk} style={{ flex: 1 }}>{ok}</PrimaryBtn>
      </div>
    </div>
  );
}

export function PrimaryBtn({ S, children, onClick, disabled, style }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ width: '100%', padding: 13, borderRadius: 14, border: 'none', background: S.red, color: '#fff', fontSize: 15,
             fontWeight: 800, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, boxShadow: '0 6px 18px rgba(240,23,75,0.35)', ...style }}>{children}</button>
  );
}

/** Fotos a pantalla completa (desliza a los lados) */
export function MediaViewer({ post, start = 0, onClose }) {
  useBackClose(true, onClose);
  const box = useRef(null);
  const [i, setI] = useState(start);
  useLayoutEffect(() => { if (box.current) box.current.scrollLeft = start * box.current.clientWidth; }, []); // eslint-disable-line
  useEffect(() => { api.countView(post.id); }, [post.id]);
  const media = post.media || [];
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 900, background: '#000' }}>
      <div ref={box} onScroll={() => { const el = box.current; if (el) setI(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))); }}
           style={{ position: 'absolute', inset: 0, display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory', scrollbarWidth: 'none' }}>
        {media.map((m, k) => (
          <div key={k} style={{ flex: '0 0 100%', height: '100%', scrollSnapAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {m.type === 'video' ? <video src={m.url} poster={m.thumb || undefined} controls autoPlay playsInline style={{ maxWidth: '100%', maxHeight: '100%' }} />
              : <img src={m.url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />}
          </div>
        ))}
      </div>
      <button onClick={onClose} aria-label={tr('Cerrar')} style={roundDark({ top: 'calc(var(--sat, 0px) + 12px)', left: 12 })}><Icon name="close" color="#fff" /></button>
      {media.length > 1 && <span style={badge({ top: 'calc(var(--sat, 0px) + 18px)', right: 14 })}>{i + 1}/{media.length}</span>}
    </div>
  );
}
const roundDark = (pos) => ({ position: 'absolute', ...pos, zIndex: 3, width: 40, height: 40, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.45)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' });

/** Vídeos verticales a pantalla completa (Reels). `posts` son publicaciones de vídeo; `authors` sus canales */
export function ReelsViewer({ posts, authors, startIndex = 0, onClose, onOpenChannel, onOpenComments, onChanged, toast, emptyText }) {
  useBackClose(true, onClose);
  const [active, setActive] = useState(startIndex);
  const [muted, setMuted] = useState(false);
  const box = useRef(null);
  useLayoutEffect(() => { if (box.current) box.current.scrollTop = startIndex * box.current.clientHeight; }, []); // eslint-disable-line
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 700, background: '#000' }}>
      <div ref={box} onScroll={() => { const el = box.current; if (!el) return; const k = Math.round(el.scrollTop / Math.max(1, el.clientHeight)); if (k !== active) setActive(k); }}
           style={{ position: 'absolute', inset: 0, overflowY: 'auto', scrollSnapType: 'y mandatory', overscrollBehavior: 'contain', scrollbarWidth: 'none' }}>
        {posts.map((p, k) => (
          <Reel key={p.id} post={p} author={authors[p.userId]} active={k === active} near={Math.abs(k - active) <= 1} muted={muted} onMuted={setMuted}
                onOpenChannel={onOpenChannel} onOpenComments={onOpenComments} onChanged={onChanged} toast={toast} />
        ))}
        {!posts.length && <p style={{ color: '#fff', textAlign: 'center', marginTop: '45vh', padding: 20 }}>{emptyText || tr('Todavía no hay vídeos')}</p>}
      </div>
      <button onClick={onClose} aria-label={tr('Cerrar')} style={roundDark({ top: 'calc(var(--sat, 0px) + 12px)', left: 12 })}><Icon name="back" color="#fff" /></button>
    </div>
  );
}

function Reel({ post, author, active, near, muted, onMuted, onOpenChannel, onOpenComments, onChanged, toast }) {
  const video = useRef(null);
  const [p, setP] = useState(post);
  const [paused, setPaused] = useState(false);
  const [followed, setFollowed] = useState(false);
  useEffect(() => setP(post), [post]);
  const m = p.media[0] || {};
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (active) { v.currentTime = 0; v.play().catch(() => {}); setPaused(false); api.countView(p.id); }
    else v.pause();
  }, [active]); // eslint-disable-line
  const update = (patch) => { const n = { ...p, ...patch }; setP(n); onChanged?.(n); };
  const like = async () => {
    const on = !p.liked;
    update({ liked: on, likes: Math.max(0, p.likes + (on ? 1 : -1)) });
    try { const r = await api.like(p.id, on); update({ liked: r.liked, likes: r.likes }); } catch (e) { toast?.(e.message); }
  };
  const follow = async () => {
    try { await api.follow(p.userId); setFollowed(true); toast?.(tr('Ahora sigues a {name}', { name: author?.name || '' })); } catch (e) { toast?.(e.message); }
  };
  const toggle = () => { const v = video.current; if (!v) return; if (v.paused) { v.play().catch(() => {}); setPaused(false); } else { v.pause(); setPaused(true); } };
  const side = (icon, text, onClick, color = '#fff', fill = 'none') => (
    <button onClick={onClick} style={{ background: 'none', border: 'none', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12, fontWeight: 700, textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}>
      <Icon name={icon} size={32} color={color} fill={fill} />{text}
    </button>
  );
  return (
    <div style={{ height: '100%', width: '100%', scrollSnapAlign: 'start', position: 'relative', overflow: 'hidden' }}>
      {near ? <video ref={video} src={m.url} poster={m.thumb || undefined} loop playsInline muted={muted} preload={active ? 'auto' : 'metadata'} onClick={toggle}
                     style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} />
        : m.thumb ? <img src={m.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(8px)' }} /> : null}
      {paused && <span onClick={toggle} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="play" size={70} color="#fff" fill="rgba(255,255,255,0.85)" /></span>}
      <div style={{ position: 'absolute', right: 10, bottom: 'calc(110px + env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'center' }}>
        {side('heart', api.compact(p.likes), like, p.liked ? RED : '#fff', p.liked ? RED : 'none')}
        {side('comment', api.compact(p.comments), () => onOpenComments?.(p))}
        {side('share', tr('Compartir'), async () => { if (await shareText(`${postTitle(p)}\n${SHARE_BASE}?post=${p.id}`) === 'copied') toast?.(tr('Enlace copiado')); })}
        {side(muted ? 'mute' : 'volume', '', () => onMuted(!muted))}
      </div>
      <div style={{ position: 'absolute', left: 0, right: 70, bottom: 0, padding: '60px 14px calc(24px + env(safe-area-inset-bottom, 0px))',
                    background: 'linear-gradient(transparent, rgba(0,0,0,0.75))', color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <ChannelAvatar author={author} size={40} onClick={() => onOpenChannel?.(p.userId)} />
          <span onClick={() => onOpenChannel?.(p.userId)} style={{ fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>{author?.name}</span>
          {author?.verified && <Verified />}
          {!p.mine && !followed && !author?.followed && (
            <button onClick={follow} style={{ marginLeft: 6, background: RED, color: '#fff', border: 'none', borderRadius: 999, padding: '6px 14px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>{tr('Seguir')}</button>
          )}
        </div>
        {p.text && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.4, maxHeight: 60, overflow: 'hidden' }}>{p.text}</p>}
        <p style={{ margin: '6px 0 0', fontSize: 12, opacity: 0.8 }}>{tr('{n} reproducciones', { n: api.compact(p.views) })} · {api.ago(p.createdAt)}</p>
      </div>
    </div>
  );
}

/** Comentarios de una publicación */
export function CommentsSheet({ S, post, onClose, onCount, onOpenChannel, toast }) {
  const [list, setList] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.comments(post.id).then(d => setList(d.comments)).catch(e => { setList([]); toast?.(e.message); });
  }, [post.id]); // eslint-disable-line
  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try { const r = await api.addComment(post.id, t); setList(l => [...(l || []), r.comment]); setText(''); onCount?.(r.comments); }
    catch (e) { toast?.(e.message); }
    finally { setBusy(false); }
  };
  const remove = async (c) => {
    try { await api.deleteComment(c.id); setList(l => { const n = l.filter(x => x.id !== c.id); onCount?.(n.length); return n; }); }
    catch (e) { toast?.(e.message); }
  };
  return (
    <Sheet S={S} onClose={onClose} title={tr('Comentarios')} full
      footer={
        <div style={{ display: 'flex', gap: 8, padding: '10px 12px', borderTop: `1px solid ${S.border}` }}>
          <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} maxLength={500}
                 placeholder={tr('Escribe un comentario…')} style={{ flex: 1, minWidth: 0, padding: '12px 16px', borderRadius: 999, border: `1px solid ${S.border}`, background: S.chip, color: S.text, fontSize: 15, outline: 'none' }} />
          <button onClick={send} disabled={!text.trim() || busy} aria-label={tr('Enviar')} style={{ width: 46, height: 46, flexShrink: 0, borderRadius: '50%', border: 'none', background: S.red, color: '#fff', cursor: 'pointer', opacity: text.trim() ? 1 : 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="send" size={20} color="#fff" />
          </button>
        </div>
      }>
      {list === null && <p style={{ padding: 20, color: S.muted }}>{tr('Cargando…')}</p>}
      {list?.length === 0 && <p style={{ padding: 24, color: S.muted, textAlign: 'center' }}>{tr('Sé el primero en comentar')}</p>}
      {list?.map(c => (
        <div key={c.id} style={{ display: 'flex', gap: 10, padding: '12px 16px' }}>
          <ChannelAvatar author={c.author} size={36} onClick={() => { onClose(); onOpenChannel?.(c.author?.userId); }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 800, fontSize: 13.5 }}>{c.author?.name}</span>
              {c.author?.verified && <Verified size={14} />}
              <span style={{ fontSize: 12, color: S.muted }}>{api.ago(c.createdAt)}</span>
            </div>
            <p style={{ margin: '2px 0 0', fontSize: 14.5, lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.text}</p>
          </div>
          {c.canDelete && <button onClick={() => remove(c)} aria-label={tr('Borrar comentario')} style={{ background: 'none', border: 'none', color: S.muted, cursor: 'pointer', alignSelf: 'flex-start' }}><Icon name="trash" size={17} /></button>}
        </div>
      ))}
    </Sheet>
  );
}

/** Publicar: fotos (hasta 10) o un vídeo, texto, categoría y quién lo ve */
export function ComposerSheet({ S, onClose, onPosted, toast }) {
  const [files, setFiles] = useState([]);       // [{ file, url, type }]
  const [text, setText] = useState('');
  const [category, setCategory] = useState('otros');
  const [visibility, setVisibility] = useState('public');
  const [progress, setProgress] = useState('');
  const input = useRef(null);
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => () => filesRef.current.forEach(f => URL.revokeObjectURL(f.url)), []);
  const pick = (e) => {
    const chosen = [...(e.target.files || [])];
    e.target.value = '';
    if (!chosen.length) return;
    const video = chosen.find(f => f.type.startsWith('video/'));
    if (video) {
      files.forEach(f => URL.revokeObjectURL(f.url));
      if (chosen.length > 1 || files.length) toast?.(tr('Un vídeo va solo en su publicación'));
      setFiles([{ file: video, url: URL.createObjectURL(video), type: 'video' }]);
      return;
    }
    const base = files[0]?.type === 'video' ? [] : files;
    if (files[0]?.type === 'video') URL.revokeObjectURL(files[0].url);
    const imgs = chosen.filter(f => f.type.startsWith('image/')).slice(0, 10 - base.length);
    if (base.length + chosen.length > 10) toast?.(tr('Máximo 10 fotos por publicación'));
    setFiles([...base, ...imgs.map(f => ({ file: f, url: URL.createObjectURL(f), type: 'image' }))]);
  };
  const removeAt = (i) => { URL.revokeObjectURL(files[i].url); setFiles(l => l.filter((_, k) => k !== i)); };
  const publish = async () => {
    if (progress || (!text.trim() && !files.length)) return;
    try {
      const urls = [];
      for (let i = 0; i < files.length; i++) {
        setProgress(files.length > 1 ? tr('Subiendo {i} de {n}…', { i: i + 1, n: files.length }) : tr('Subiendo…'));
        urls.push(await api.uploadMedia(files[i].file));
      }
      setProgress(tr('Publicando…'));
      const r = await api.createPost({ text: text.trim(), media: urls, category, visibility });
      onPosted?.(r.post, r.authors);
      toast?.(tr('¡Publicado!'));
      onClose();
    } catch (e) { toast?.(e.message); setProgress(''); }
  };
  return (
    <Sheet S={S} onClose={() => !progress && onClose()} title={tr('Nueva publicación')} full
      footer={<div style={{ padding: 12, borderTop: `1px solid ${S.border}` }}>
        <PrimaryBtn S={S} onClick={publish} disabled={!!progress || (!text.trim() && !files.length)}>{progress || tr('Publicar')}</PrimaryBtn>
      </div>}>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <textarea value={text} onChange={e => setText(e.target.value)} maxLength={2200} rows={4} placeholder={tr('¿Qué quieres compartir?')}
                  style={{ width: '100%', boxSizing: 'border-box', resize: 'none', border: `1px solid ${S.border}`, borderRadius: 14, padding: 14, fontSize: 15, background: S.chip, color: S.text, outline: 'none', fontFamily: 'inherit' }} />
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none' }}>
          <button onClick={() => input.current?.click()} style={{ flex: '0 0 96px', height: 96, borderRadius: 14, border: `2px dashed ${S.red}`, background: S.redSoft, color: S.red,
                   display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>
            <Icon name="image" size={26} />{tr('Fotos o vídeo')}
          </button>
          {files.map((f, i) => (
            <div key={f.url} style={{ position: 'relative', flex: '0 0 96px', height: 96 }}>
              {f.type === 'video' ? <video src={f.url} muted playsInline style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 14, background: '#000' }} />
                : <img src={f.url} alt="" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 14 }} />}
              <button onClick={() => removeAt(i)} aria-label={tr('Quitar')} style={{ position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={14} color="#fff" />
              </button>
            </div>
          ))}
        </div>
        <input ref={input} type="file" accept="image/*,video/*" multiple hidden onChange={pick} />
        <div>
          <p style={label(S)}>{tr('Quién lo ve')}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['public', 'globe', tr('Público'), tr('Cualquier usuario de OldFace')], ['contacts', 'users', tr('Solo mis contactos'), tr('Tu agenda en OldFace')]].map(([id, icon, t, sub]) => (
              <button key={id} onClick={() => setVisibility(id)} style={{ flex: 1, textAlign: 'left', padding: 12, borderRadius: 14, cursor: 'pointer',
                       border: `2px solid ${visibility === id ? S.red : S.border}`, background: visibility === id ? S.redSoft : 'transparent', color: S.text }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: 14, color: visibility === id ? S.red : S.text }}><Icon name={icon} size={17} />{t}</span>
                <span style={{ display: 'block', fontSize: 12, color: S.sub, marginTop: 3 }}>{sub}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <p style={label(S)}>{tr('Categoría')}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {api.CATEGORIES.map(c => (
              <button key={c.id} onClick={() => setCategory(c.id)} style={chip(S, category === c.id)}>{c.icon} {c.label}</button>
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  );
}
const label = (S) => ({ margin: '0 0 8px', fontSize: 12, fontWeight: 800, letterSpacing: 0.5, color: S.sub, textTransform: 'uppercase' });
export const chip = (S, on) => ({ border: on ? '1px solid transparent' : `1px solid ${S.border}`, background: on ? S.red : S.surface, color: on ? '#fff' : S.text, borderRadius: 999,
                                  padding: '7px 13px', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                                  boxShadow: on ? '0 4px 12px rgba(240,23,75,0.3)' : 'none' });

/** Avisos de Social */
export function NotificationsSheet({ S, onClose, onOpenChannel, onOpenPost, onOpenLive }) {
  const [list, setList] = useState(null);
  useEffect(() => {
    api.notifications().then(d => { setList(d.notifications); if (d.unread) api.readNotifications().catch(() => {}); }).catch(() => setList([]));
  }, []);
  const TEXT = { follow: tr('ha empezado a seguirte'), like: tr('le ha gustado tu publicación'), comment: tr('ha comentado tu publicación'),
                 post: tr('ha publicado algo nuevo'), live: tr('está en directo') };
  const open = (n) => {
    onClose();
    if (n.type === 'follow') onOpenChannel?.(n.fromId);
    else if (n.type === 'live') onOpenLive?.(n.directoId);
    else if (n.postId) onOpenPost?.(n.postId);
  };
  return (
    <Sheet S={S} onClose={onClose} title={tr('Avisos')} full>
      {list === null && <p style={{ padding: 20, color: S.muted }}>{tr('Cargando…')}</p>}
      {list?.length === 0 && <p style={{ padding: 30, textAlign: 'center', color: S.muted }}>{tr('Aquí verás quién te sigue, le gusta o comenta lo tuyo')}</p>}
      {list?.map(n => (
        <button key={n.id} onClick={() => open(n)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', border: 'none', textAlign: 'left',
                 background: n.read ? 'transparent' : S.redSoft, borderBottom: `1px solid ${S.border}`, color: S.text, cursor: 'pointer' }}>
          <ChannelAvatar author={n.from} size={42} />
          <span style={{ flex: 1, fontSize: 14, lineHeight: 1.35 }}>
            <b>{n.from?.name}</b> {TEXT[n.type] || ''}
            <span style={{ display: 'block', fontSize: 12, color: S.muted, marginTop: 2 }}>{api.ago(n.at)}</span>
          </span>
          {n.type === 'live' && <span style={{ background: RED, color: '#fff', fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 6 }}>{tr('EN VIVO')}</span>}
        </button>
      ))}
    </Sheet>
  );
}

/** Miniatura de vídeo con duración, título y visitas (cuadrículas y filas de Explorar) */
export function VideoTile({ S, thumb, duration, title, meta, onClick, width, badgeText, locked, avatar }) {
  return (
    <div onClick={onClick} style={{ width, flexShrink: 0, cursor: 'pointer', minWidth: 0 }}>
      <div style={{ position: 'relative', aspectRatio: '16 / 10', borderRadius: 12, overflow: 'hidden', background: S.chip }}>
        {thumb ? <img src={thumb} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', filter: locked ? 'blur(6px)' : 'none' }} />
          : <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted }}><Icon name="play" size={30} /></span>}
        {badgeText && <span style={{ position: 'absolute', left: 8, top: 8, background: RED, color: '#fff', fontSize: 11, fontWeight: 800, padding: '3px 7px', borderRadius: 6 }}>{badgeText}</span>}
        {locked && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="lock" size={28} color="#fff" /></span>}
        {avatar && <span style={{ position: 'absolute', left: 8, bottom: 8, display: 'flex', alignItems: 'center', gap: 6, color: '#fff', fontWeight: 800, fontSize: 13, textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}>
          <ChannelAvatar author={avatar} size={26} />{avatar.name}{avatar.verified && <Verified size={14} />}
        </span>}
        {duration ? <span style={{ position: 'absolute', right: 8, bottom: 8, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 12, fontWeight: 700, padding: '2px 7px', borderRadius: 6 }}>{formatDuration(duration)}</span> : null}
      </div>
      <p style={{ margin: '7px 0 0', fontSize: 13.5, fontWeight: 700, color: S.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title || tr('Vídeo')}</p>
      {meta && <p style={{ margin: '2px 0 0', fontSize: 12, color: S.sub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta}</p>}
    </div>
  );
}

/** Una publicación sola a pantalla completa (enlace, aviso, foto de Explorar, del buscador o de un canal) */
export function PostDetail({ S, detail, onClose, cardProps }) {
  useBackClose(true, onClose);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 620, background: S.bg, overflowY: 'auto', paddingTop: 'var(--sat, 0px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', position: 'sticky', top: 0, background: S.surface, zIndex: 2, borderBottom: `1px solid ${S.border}` }}>
        <button onClick={onClose} aria-label={tr('Atrás')} style={{ background: 'none', border: 'none', color: S.text, cursor: 'pointer' }}><Icon name="back" size={26} /></button>
        <p style={{ margin: 0, fontWeight: 800, fontSize: 17 }}>{tr('Publicación')}</p>
      </div>
      <PostCard post={detail.post} author={detail.authors?.[detail.post.userId]} {...cardProps} />
    </div>
  );
}

export function PhotoTile({ S, post, onClick, width }) {
  const m = post.media[0];
  return (
    <div onClick={onClick} style={{ width, flexShrink: 0, position: 'relative', aspectRatio: '1 / 1', borderRadius: 12, overflow: 'hidden', background: S.chip, cursor: 'pointer' }}>
      <img src={m.thumb || m.url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      {post.media.length > 1 && <span style={{ position: 'absolute', right: 6, top: 6 }}><Icon name="grid" size={16} color="#fff" /></span>}
    </div>
  );
}
