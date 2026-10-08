/**
 * StatusList — Estados (24 h) en formato vertical.
 *
 *   <StatusList compact onSeeAll={…} />  → pestaña Chats: "Mi estado" + los 3 más recientes y "Ver todos"
 *   <StatusList />                       → pestaña Estados: Mi estado, Recientes y Vistos
 *
 *  · Hasta 20 estados activos por persona: 15 fotos y 5 vídeos como máximo (lo comprueba también el backend).
 *  · Privacidad de cada estado: mis contactos · mis contactos excepto… · solo compartir con…
 *    (se puede guardar como la habitual). El backend solo entrega cada estado a quien puede verlo.
 *  · Fotos y vídeos se suben como archivo (/chat/upload), no en base64.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '../store/chatStore';
import Avatar from './Avatar.jsx';
import { useCandidates, PeoplePicker, Sheet, PrimaryBtn } from './GroupSheets.jsx';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const BRAND = '#3D5A80';
const COLORS = ['#3D5A80', '#e11d48', '#059669', '#d97706', '#7c3aed', '#0284c7', '#db2777'];
const DEFAULT_LIMITS = { total: 20, video: 5, image: 15 };
const MAX_VIDEO_MB = 60;
const IMAGE_SECS = 5;

const mediaSrc = (c) => (String(c || '').startsWith('/files/') ? `${BACKEND}${c}` : c);

function timeAgo(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'ahora mismo';
  if (m < 60) return `hace ${m} min`;
  const d = new Date(ts);
  const hm = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  return new Date().toDateString() === d.toDateString() ? `hoy, ${hm}` : `ayer, ${hm}`;
}

function privacyLabel(p, short = false) {
  if (!p || p.mode === 'contacts') return 'Mis contactos';
  const n = p.userIds?.length || 0;
  if (p.mode === 'except') return short ? `Contactos excepto ${n}` : `Mis contactos excepto ${n} persona${n === 1 ? '' : 's'}`;
  return short ? `Solo ${n}` : `Solo ${n} persona${n === 1 ? '' : 's'}`;
}

/** Foto → JPEG de hasta 1280 px (Blob) */
function compressImage(file, max = 1280) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => (b ? resolve(b) : reject(new Error('No se pudo procesar la foto'))), 'image/jpeg', 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la foto')); };
    img.src = url;
  });
}

async function uploadFile(blob, userId) {
  const res = await fetch(`${BACKEND}/chat/upload?userId=${encodeURIComponent(userId)}`, {
    method: 'POST', headers: { 'Content-Type': (blob.type || 'application/octet-stream').split(';')[0] }, body: blob,
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || 'No se pudo subir el archivo');
  return d.url.startsWith('http') ? d.url : `${BACKEND}${d.url}`;
}

// ══ Lista ════════════════════════════════════════════════════════════════════
export default function StatusList({ user, T, isDark, compact = false, onSeeAll }) {
  const [stories, setStories]   = useState([]);
  const [authors, setAuthors]   = useState({});
  const [limits, setLimits]     = useState(DEFAULT_LIMITS);
  const [creating, setCreating] = useState(false);
  const [viewer, setViewer]     = useState(null);   // { queue: [userId], ui, idx }

  const fetchStories = useCallback(() => {
    if (!user?.id) return;
    fetch(`${BACKEND}/stories?userId=${encodeURIComponent(user.id)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!d) return; setStories(d.stories || []); setAuthors(d.authors || {}); if (d.limits) setLimits(d.limits); })
      .catch(() => {});
  }, [user?.id]);

  useEffect(() => {
    fetchStories();
    const iv = setInterval(fetchStories, 30_000);
    return () => clearInterval(iv);
  }, [fetchStories]);

  // Mis estados y los de los demás, agrupados por persona (del más antiguo al más nuevo, como se ven)
  const mine = useMemo(() => stories.filter(s => s.userId === user?.id).sort((a, b) => a.createdAt - b.createdAt), [stories, user?.id]);
  const people = useMemo(() => {
    const map = new Map();
    for (const s of stories) {
      if (s.userId === user?.id) continue;
      if (!map.has(s.userId)) map.set(s.userId, []);
      map.get(s.userId).push(s);
    }
    return [...map.entries()].map(([userId, list]) => {
      list.sort((a, b) => a.createdAt - b.createdAt);
      return {
        userId, stories: list, latest: list[list.length - 1],
        name: authors[userId]?.name || list[0].userName || userId, avatar: authors[userId]?.avatar || null,
        allSeen: list.every(s => s.seen),
      };
    }).sort((a, b) => b.latest.createdAt - a.latest.createdAt);
  }, [stories, authors, user?.id]);
  const recent = people.filter(p => !p.allSeen);
  const seen   = people.filter(p => p.allSeen);

  const storiesOf = useCallback((uid) => (uid === user?.id ? mine : people.find(p => p.userId === uid)?.stories || []), [mine, people, user?.id]);

  const open = (uid, list) => {
    const queue = list.map(p => p.userId);
    const ui = Math.max(0, queue.indexOf(uid));
    const own = storiesOf(uid);
    const firstUnseen = uid === user?.id ? 0 : Math.max(0, own.findIndex(s => !s.seen));
    setViewer({ queue: queue.length ? queue : [uid], ui, idx: firstUnseen });
  };

  const counts = {
    total: mine.length,
    image: mine.filter(s => s.mediaType === 'image').length,
    video: mine.filter(s => s.mediaType === 'video').length,
  };
  const full = counts.total >= limits.total;

  const shownRecent = compact ? [...recent, ...seen].slice(0, 3) : recent;
  const hidden = compact ? people.length - shownRecent.length : 0;

  return (
    <>
      <div style={{ background: T.bgSurface, borderBottom: `1px solid ${T.border}`, paddingBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 16px 4px' }}>
          <p style={{ flex: 1, margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: '0.6px', color: BRAND }}>ESTADOS</p>
          {compact && people.length > 0 && (
            <button onClick={onSeeAll} style={{ background: 'none', border: 'none', color: BRAND, fontSize: 12, fontWeight: 800, cursor: 'pointer', padding: 0 }}>
              Ver todos ›
            </button>
          )}
        </div>

        {/* Mi estado */}
        <Row T={T}
          onClick={() => (mine.length ? open(user.id, [{ userId: user.id }]) : setCreating(true))}
          left={<Ring T={T} count={mine.length} seen={false} empty={!mine.length}>
            <Avatar name={user?.name} src={user?.avatar || null} size="lg" />
          </Ring>}
          title="Mi estado"
          sub={mine.length
            ? `${mine.length} de ${limits.total} · ${timeAgo(mine[mine.length - 1].createdAt)}`
            : 'Toca para añadir un estado'}
          right={
            <button onClick={(e) => { e.stopPropagation(); if (!full) setCreating(true); }} disabled={full} aria-label="Nuevo estado"
              style={{ width: 38, height: 38, borderRadius: '50%', border: 'none', cursor: full ? 'default' : 'pointer', opacity: full ? 0.4 : 1,
                       background: isDark ? 'rgba(255,255,255,0.08)' : '#E3EDF2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>
              </svg>
            </button>
          } />

        {!compact && recent.length > 0 && <SectionTitle T={T}>RECIENTES</SectionTitle>}
        {shownRecent.map(p => (
          <Row key={p.userId} T={T} onClick={() => open(p.userId, shownRecent)}
            left={<Ring T={T} count={p.stories.length} seen={p.allSeen}><Thumb story={p.latest} name={p.name} avatar={p.avatar} /></Ring>}
            title={p.name} sub={timeAgo(p.latest.createdAt)} />
        ))}

        {!compact && seen.length > 0 && <SectionTitle T={T}>VISTOS</SectionTitle>}
        {!compact && seen.map(p => (
          <Row key={p.userId} T={T} onClick={() => open(p.userId, seen)}
            left={<Ring T={T} count={p.stories.length} seen><Thumb story={p.latest} name={p.name} avatar={p.avatar} /></Ring>}
            title={p.name} sub={timeAgo(p.latest.createdAt)} />
        ))}

        {compact && hidden > 0 && (
          <button onClick={onSeeAll}
            style={{ width: '100%', background: 'none', border: 'none', padding: '8px 16px 10px', textAlign: 'left', color: BRAND, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
            Ver {hidden} estado{hidden === 1 ? '' : 's'} más
          </button>
        )}
        {!compact && people.length === 0 && (
          <p style={{ margin: 0, padding: '14px 16px 18px', fontSize: 13, color: T.textMuted, lineHeight: 1.5 }}>
            Aquí verás los estados de tus contactos. Duran 24 horas.
          </p>
        )}
      </div>

      {creating && (
        <StatusCreator user={user} T={T} isDark={isDark} counts={counts} limits={limits}
          onClose={() => setCreating(false)}
          onPublished={() => { setCreating(false); fetchStories(); }} />
      )}

      {viewer && (
        <StatusViewer user={user} viewer={viewer} setViewer={setViewer} storiesOf={storiesOf}
          authors={authors} onChanged={fetchStories} onClose={() => { setViewer(null); fetchStories(); }} />
      )}
    </>
  );
}

function SectionTitle({ T, children }) {
  return <p style={{ margin: '10px 16px 2px', fontSize: 11, fontWeight: 800, letterSpacing: '0.5px', color: T.textMuted }}>{children}</p>;
}

function Row({ T, left, title, sub, right, onClick }) {
  return (
    <div onClick={onClick} role="button"
      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 16px', cursor: 'pointer' }}>
      {left}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: T.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</p>
        <p style={{ margin: '2px 0 0', fontSize: 12, color: T.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</p>
      </div>
      {right}
    </div>
  );
}

/** Aro alrededor de la foto: un trozo por estado (azul sin ver, gris visto) */
function Ring({ T, count, seen, empty, children }) {
  const size = 58, r = 27, c = 2 * Math.PI * r;
  const n = Math.max(1, Math.min(count || 1, 20));
  const gap = n > 1 ? 4 : 0;
  const seg = c / n - gap;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="2.5"
          stroke={empty || seen ? T.textMuted : BRAND}
          strokeDasharray={empty ? '4 4' : `${seg} ${gap}`} strokeLinecap={n > 1 ? 'round' : 'butt'} />
      </svg>
      <div style={{ position: 'absolute', inset: 5, borderRadius: '50%', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {children}
      </div>
      {empty && (
        <span style={{ position: 'absolute', right: 0, bottom: 0, width: 20, height: 20, borderRadius: '50%', background: BRAND,
                       border: `2px solid ${T.bgSurface}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                       color: 'white', fontSize: 14, fontWeight: 900, lineHeight: 1 }}>+</span>
      )}
    </div>
  );
}

/** Miniatura del último estado de una persona */
function Thumb({ story, name, avatar }) {
  const fill = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };
  if (story?.mediaType === 'image') return <img src={mediaSrc(story.content)} alt="" style={fill} />;
  if (story?.mediaType === 'video') return <video src={`${mediaSrc(story.content)}#t=0.5`} muted playsInline preload="metadata" style={fill} />;
  if (story?.mediaType === 'text') {
    return (
      <div style={{ ...fill, background: story.bgColor || BRAND, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'white', fontSize: 9, fontWeight: 800, textAlign: 'center', padding: 4, boxSizing: 'border-box', overflow: 'hidden', lineHeight: 1.15 }}>
        {String(story.content).slice(0, 28)}
      </div>
    );
  }
  return <Avatar name={name} src={avatar} size="lg" />;
}

// ══ Crear estados ════════════════════════════════════════════════════════════
function StatusCreator({ user, T, isDark, counts, limits, onClose, onPublished }) {
  const { candidates } = useCandidates(user?.id);
  const [text, setText]         = useState('');
  const [color, setColor]       = useState(COLORS[0]);
  const [queue, setQueue]       = useState([]);   // [{ type, blob, preview }]
  const [privacy, setPrivacy]   = useState({ mode: 'contacts', userIds: [] });
  const [remember, setRemember] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [busy, setBusy]         = useState('');
  const [error, setError]       = useState('');
  const photoRef = useRef(null);
  const videoRef = useRef(null);
  const queueRef = useRef(queue);
  queueRef.current = queue;

  // Privacidad habitual
  useEffect(() => {
    fetch(`${BACKEND}/stories/privacy?userId=${encodeURIComponent(user.id)}`)
      .then(r => (r.ok ? r.json() : null)).then(p => p && setPrivacy(p)).catch(() => {});
  }, [user.id]);

  useEffect(() => () => queueRef.current.forEach(q => URL.revokeObjectURL(q.preview)), []);

  const qImages = queue.filter(q => q.type === 'image').length;
  const qVideos = queue.filter(q => q.type === 'video').length;
  const qTotal  = queue.length + (text.trim() ? 1 : 0);
  const left = {
    total: limits.total - counts.total - qTotal,
    image: limits.image - counts.image - qImages,
    video: limits.video - counts.video - qVideos,
  };
  const canPhoto = left.total > 0 && left.image > 0;
  const canVideo = left.total > 0 && left.video > 0;

  const addFiles = async (files, kind) => {
    setError('');
    const room = Math.max(0, Math.min(left.total, kind === 'image' ? left.image : left.video));
    const picked = [...files];
    if (picked.length > room) setError(kind === 'image'
      ? `Solo puedes añadir ${room} foto${room === 1 ? '' : 's'} más (máximo ${limits.image} fotos y ${limits.total} estados)`
      : `Solo puedes añadir ${room} vídeo${room === 1 ? '' : 's'} más (máximo ${limits.video} vídeos y ${limits.total} estados)`);
    for (const f of picked.slice(0, room)) {
      try {
        if (kind === 'video') {
          if (f.size > MAX_VIDEO_MB * 1024 * 1024) { setError(`Un vídeo supera los ${MAX_VIDEO_MB} MB y no se ha añadido`); continue; }
          setQueue(q => [...q, { type: 'video', blob: f, preview: URL.createObjectURL(f) }]);
        } else {
          const b = await compressImage(f);
          setQueue(q => [...q, { type: 'image', blob: b, preview: URL.createObjectURL(b) }]);
        }
      } catch (err) { setError(err.message); }
    }
  };

  const removeItem = (i) => setQueue(q => { URL.revokeObjectURL(q[i].preview); return q.filter((_, k) => k !== i); });

  const post = async (body) => {
    const res = await fetch(`${BACKEND}/stories`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, userName: user.name, privacy, contactIds: candidates.map(c => c.id), ...body }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'No se pudo publicar');
  };

  const publish = async () => {
    if (privacy.mode === 'only' && !privacy.userIds.length) { setError('Elige con quién compartirlo'); return; }
    setError('');
    try {
      if (remember) {
        await fetch(`${BACKEND}/stories/privacy`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: user.id, ...privacy }),
        }).catch(() => {});
      }
      if (text.trim()) {
        setBusy('Publicando…');
        await post({ mediaType: 'text', content: text.trim(), bgColor: color });
        setText('');
      }
      const items = [...queue];
      for (let i = 0; i < items.length; i++) {
        setBusy(`Subiendo ${i + 1} de ${items.length}…`);
        const url = await uploadFile(items[i].blob, user.id);
        await post({ mediaType: items[i].type, content: url });
        URL.revokeObjectURL(items[i].preview);
        setQueue(q => q.slice(1));   // ya publicado: si algo falla después, no se repite
      }
      onPublished();
    } catch (err) {
      setError(err.message);
      setBusy('');
    }
  };

  const nothing = !text.trim() && queue.length === 0;
  const tileBtn = (label, enabled, onClick, icon) => (
    <button onClick={onClick} disabled={!enabled || !!busy}
      style={{ flex: 1, padding: '12px 6px', borderRadius: 14, border: 'none', cursor: enabled ? 'pointer' : 'default', opacity: enabled ? 1 : 0.4,
               background: isDark ? 'rgba(255,255,255,0.07)' : '#f1f5f9', color: T.textPrimary, fontWeight: 800, fontSize: 13,
               display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
      {label}
    </button>
  );

  return (
    <>
      <Sheet T={T} isDark={isDark} title="Nuevo estado" onClose={() => !busy && onClose()}
        subtitle={`Fotos ${counts.image + qImages}/${limits.image} · Vídeos ${counts.video + qVideos}/${limits.video} · Total ${counts.total + qTotal}/${limits.total}`}
        footer={<>
          {error && <p style={{ fontSize: 12, color: '#ef4444', margin: '0 0 8px', fontWeight: 600 }}>{error}</p>}
          <PrimaryBtn onClick={publish} disabled={!!busy || nothing}>{busy || 'Publicar'}</PrimaryBtn>
          <p style={{ fontSize: 11, color: T.textMuted, textAlign: 'center', margin: '8px 0 0' }}>Los estados desaparecen a las 24 horas</p>
        </>}>
        <div style={{ padding: '14px 18px 4px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Escribe un estado de texto (opcional)…" maxLength={300} rows={3}
            disabled={!text.trim() && left.total <= 0}
            style={{ width: '100%', boxSizing: 'border-box', padding: 12, borderRadius: 14, border: `1.5px solid ${T.borderStrong}`,
                     background: text.trim() ? color : T.bgInput, color: text.trim() ? 'white' : T.textPrimary, fontSize: 15, fontWeight: text.trim() ? 700 : 500,
                     resize: 'none', outline: 'none', fontFamily: 'inherit' }} />
          {text.trim() && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {COLORS.map(c => (
                <button key={c} onClick={() => setColor(c)} aria-label="Color de fondo"
                  style={{ width: 28, height: 28, borderRadius: '50%', background: c, cursor: 'pointer',
                           border: color === c ? '3px solid white' : '2px solid transparent', outline: color === c ? `2px solid ${c}` : 'none' }} />
              ))}
            </div>
          )}

          {queue.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {queue.map((q, i) => (
                <div key={q.preview} style={{ position: 'relative', aspectRatio: '1', borderRadius: 12, overflow: 'hidden', background: '#000' }}>
                  {q.type === 'video'
                    ? <video src={q.preview} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <img src={q.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                  {!busy && (
                    <button onClick={() => removeItem(i)} aria-label="Quitar"
                      style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.6)',
                               color: 'white', fontSize: 13, cursor: 'pointer', lineHeight: 1 }}>×</button>
                  )}
                  {q.type === 'video' && (
                    <span style={{ position: 'absolute', left: 4, bottom: 4, background: 'rgba(0,0,0,0.6)', color: 'white', fontSize: 10, fontWeight: 800,
                                   padding: '1px 5px', borderRadius: 5 }}>▶ Vídeo</span>
                  )}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            {tileBtn(`Fotos (${Math.max(0, Math.min(left.image, left.total))})`, canPhoto, () => photoRef.current?.click(),
              <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></>)}
            {tileBtn(`Vídeos (${Math.max(0, Math.min(left.video, left.total))})`, canVideo, () => videoRef.current?.click(),
              <><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></>)}
          </div>

          {/* Quién puede verlo */}
          <button onClick={() => setShowPrivacy(true)} disabled={!!busy}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14, border: `1px solid ${T.border}`,
                     background: 'transparent', cursor: 'pointer', textAlign: 'left' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
            </svg>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 12, color: T.textSecondary, fontWeight: 600 }}>Quién puede verlo</span>
              <span style={{ display: 'block', fontSize: 14, color: T.textPrimary, fontWeight: 800 }}>{privacyLabel(privacy)}</span>
            </span>
            <svg width="18" height="18" fill="none" stroke={T.textMuted} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>
          </button>
        </div>

        <input ref={photoRef} type="file" accept="image/*" multiple hidden
          onChange={e => { const f = e.target.files; if (f?.length) addFiles(f, 'image'); e.target.value = ''; }} />
        <input ref={videoRef} type="file" accept="video/*" multiple hidden
          onChange={e => { const f = e.target.files; if (f?.length) addFiles(f, 'video'); e.target.value = ''; }} />
      </Sheet>

      {showPrivacy && (
        <PrivacySheet T={T} isDark={isDark} user={user} initial={privacy} remember={remember}
          onClose={() => setShowPrivacy(false)}
          onDone={(p, rem) => { setPrivacy(p); setRemember(rem); setShowPrivacy(false); }} />
      )}
    </>
  );
}

// ══ Privacidad de un estado ══════════════════════════════════════════════════
function PrivacySheet({ T, isDark, user, initial, remember: initRemember, onClose, onDone }) {
  const { candidates, loading } = useCandidates(user?.id);
  const [mode, setMode]         = useState(initial.mode);
  const [except, setExcept]     = useState(new Set(initial.mode === 'except' ? initial.userIds : []));
  const [only, setOnly]         = useState(new Set(initial.mode === 'only' ? initial.userIds : []));
  const [picking, setPicking]   = useState(null);   // 'except' | 'only'
  const [remember, setRemember] = useState(initRemember);

  const toggle = (setFn) => (id) => setFn(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const result = () => ({ mode, userIds: mode === 'except' ? [...except] : mode === 'only' ? [...only] : [] });

  if (picking) {
    const sel = picking === 'except' ? except : only;
    return (
      <Sheet T={T} isDark={isDark} z={620} onClose={() => setPicking(null)} onBack={() => setPicking(null)}
        title={picking === 'except' ? 'Ocultar estado a…' : 'Compartir solo con…'}
        subtitle={sel.size ? `${sel.size} elegida${sel.size === 1 ? '' : 's'}` : 'Elige personas'}
        footer={<PrimaryBtn onClick={() => setPicking(null)}>Listo</PrimaryBtn>}>
        <PeoplePicker T={T} isDark={isDark} people={candidates} selected={sel} loading={loading}
          onToggle={toggle(picking === 'except' ? setExcept : setOnly)}
          emptyText="No hay contactos en OldFace todavía" />
      </Sheet>
    );
  }

  const option = (key, title, sub, pickable) => {
    const on = mode === key;
    return (
      <div onClick={() => { setMode(key); if (pickable && !(key === 'except' ? except.size : only.size)) setPicking(key); }} role="radio" aria-checked={on}
        style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', cursor: 'pointer', borderBottom: `1px solid ${T.border}` }}>
        <span style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${on ? BRAND : T.borderStrong}`, flexShrink: 0,
                       display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {on && <span style={{ width: 11, height: 11, borderRadius: '50%', background: BRAND }} />}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 15, fontWeight: 800, color: T.textPrimary }}>{title}</span>
          <span style={{ display: 'block', fontSize: 12, color: T.textSecondary }}>{sub}</span>
        </span>
        {pickable && (
          <button onClick={(e) => { e.stopPropagation(); setMode(key); setPicking(key); }}
            style={{ background: 'none', border: 'none', color: BRAND, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
            Elegir
          </button>
        )}
      </div>
    );
  };

  const invalid = mode === 'only' && only.size === 0;
  return (
    <Sheet T={T} isDark={isDark} z={600} title="Quién puede ver este estado" onClose={onClose}
      footer={<>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 12px', fontSize: 13, color: T.textPrimary, fontWeight: 600, cursor: 'pointer' }}>
          <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} style={{ width: 18, height: 18, accentColor: BRAND }} />
          Usar siempre esta opción (privacidad habitual)
        </label>
        <PrimaryBtn disabled={invalid} onClick={() => onDone(result(), remember)}>{invalid ? 'Elige al menos una persona' : 'Aceptar'}</PrimaryBtn>
      </>}>
      {option('contacts', 'Mis contactos', 'Todos tus contactos de OldFace')}
      {option('except', 'Mis contactos excepto…', except.size ? `Oculto a ${except.size} persona${except.size === 1 ? '' : 's'}` : 'Elige a quién ocultarlo', true)}
      {option('only', 'Solo compartir con…', only.size ? `${only.size} persona${only.size === 1 ? '' : 's'}` : 'Elige con quién compartirlo', true)}
      <p style={{ margin: 0, padding: '12px 18px', fontSize: 12, color: T.textMuted, lineHeight: 1.5 }}>
        Solo quien elijas verá el estado. Cambiar esta opción no afecta a los estados ya publicados.
      </p>
    </Sheet>
  );
}

// ══ Visor a pantalla completa ════════════════════════════════════════════════
function StatusViewer({ user, viewer, setViewer, storiesOf, authors, onChanged, onClose }) {
  const navigate = useNavigate();
  const { persistMessage, createOrGetChat } = useChatStore();
  const [replyText, setReplyText] = useState('');
  const [replySent, setReplySent] = useState(false);
  const [paused, setPaused]       = useState(false);
  const [viewersList, setViewersList] = useState(null);   // autor: quién lo vio
  const [confirmDel, setConfirmDel] = useState(false);
  const timerRef   = useRef(null);
  const markedRef  = useRef(new Set());
  const historyRef = useRef(false);

  const uid = viewer.queue[viewer.ui];
  const list = storiesOf(uid);
  const story = list[Math.min(viewer.idx, list.length - 1)];
  const isMine = uid === user.id;
  const name = isMine ? 'Mi estado' : (authors[uid]?.name || story?.userName || '');

  const close = useCallback(() => {
    clearTimeout(timerRef.current);
    if (historyRef.current) { historyRef.current = false; window.history.back(); }
    onClose();
  }, [onClose]);

  // Atrás de Android cierra el visor
  useEffect(() => {
    window.history.pushState({ storyViewer: true }, '');
    historyRef.current = true;
    const onPop = () => { if (historyRef.current) { historyRef.current = false; onClose(); } };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []); // eslint-disable-line

  const resetPanel = () => { setReplyText(''); setReplySent(false); setViewersList(null); setPaused(false); };
  const isLast = viewer.idx >= list.length - 1 && !viewer.queue.slice(viewer.ui + 1).some(u => storiesOf(u).length);

  const goNext = () => {
    if (isLast) { close(); return; }
    resetPanel();
    setViewer(v => {
      const cur = storiesOf(v.queue[v.ui]);
      if (v.idx < cur.length - 1) return { ...v, idx: v.idx + 1 };
      // Siguiente persona: empieza por su primer estado sin ver
      for (let u = v.ui + 1; u < v.queue.length; u++) {
        const l = storiesOf(v.queue[u]);
        if (l.length) return { ...v, ui: u, idx: Math.max(0, l.findIndex(s => !s.seen)) };
      }
      return v;
    });
  };
  const goPrev = () => {
    resetPanel();
    setViewer(v => {
      if (v.idx > 0) return { ...v, idx: v.idx - 1 };
      for (let u = v.ui - 1; u >= 0; u--) {
        const l = storiesOf(v.queue[u]);
        if (l.length) return { ...v, ui: u, idx: l.length - 1 };
      }
      return v;
    });
  };

  // Sin estados (p. ej. borré el último) → cerrar
  useEffect(() => { if (!story) close(); }, [story, close]);

  // Marcar como visto al mostrarlo
  useEffect(() => {
    if (!story || isMine || story.seen || markedRef.current.has(story.id)) return;
    markedRef.current.add(story.id);
    fetch(`${BACKEND}/stories/${story.id}/view`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ viewerId: user.id }),
    }).catch(() => {});
  }, [story?.id]); // eslint-disable-line

  // Avance automático de fotos y textos (los vídeos avanzan al terminar)
  const stopped = paused || !!viewersList || confirmDel;
  useEffect(() => {
    clearTimeout(timerRef.current);
    if (!story || story.mediaType === 'video' || stopped) return;
    timerRef.current = setTimeout(goNext, IMAGE_SECS * 1000);
    return () => clearTimeout(timerRef.current);
  }, [story?.id, stopped, isLast]); // eslint-disable-line

  if (!story) return null;

  const sendReply = async () => {
    const t = replyText.trim();
    if (!t) return;
    const chatId = `chat_${[user.id, uid].sort().join('_')}`;
    const replyTo = {
      senderName: story.userName,
      type: story.mediaType === 'text' ? 'text' : story.mediaType,
      url: story.mediaType === 'text' ? null : mediaSrc(story.content),
      text: story.mediaType === 'text' ? story.content : `Estado de ${story.userName}`,
    };
    try {
      await createOrGetChat(user.id, uid, story.userName);
      await persistMessage(chatId, user.id, t, 'text', null, replyTo);
      setReplyText(''); setReplySent(true); setPaused(false);
      setTimeout(() => setReplySent(false), 2500);
    } catch { /* silencioso */ }
  };

  const showViewers = async () => {
    setViewersList([]);
    try {
      const r = await fetch(`${BACKEND}/stories/${story.id}/viewers?userId=${encodeURIComponent(user.id)}`);
      const d = await r.json();
      setViewersList(d.viewers || []);
    } catch { setViewersList([]); }
  };

  const del = async () => {
    await fetch(`${BACKEND}/stories/${story.id}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: user.id }),
    }).catch(() => {});
    setConfirmDel(false);
    if (viewer.idx > 0 && viewer.idx >= list.length - 1) setViewer(v => ({ ...v, idx: v.idx - 1 }));
    onChanged();
  };

  const isMedia = story.mediaType === 'image' || story.mediaType === 'video';
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 700, background: isMedia ? '#000' : (story.bgColor || BRAND), display: 'flex', flexDirection: 'column' }}>
      {/* Barras de progreso */}
      <div style={{ position: 'absolute', top: 'calc(var(--sat, 0px) + 8px)', left: 0, right: 0, display: 'flex', gap: 3, padding: '0 10px', zIndex: 10 }}>
        {list.map((s, i) => {
          const current = i === viewer.idx;
          const animate = current && story.mediaType !== 'video' && !stopped;
          return (
            <div key={s.id} style={{ flex: 1, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.35)', overflow: 'hidden' }}>
              <div key={`${story.id}-${stopped}`}
                style={{ height: '100%', background: 'white',
                         width: i < viewer.idx || (current && !animate) ? '100%' : current ? undefined : '0%',
                         opacity: current && !animate ? 0.7 : 1,
                         animation: animate ? `stProg ${IMAGE_SECS}s linear forwards` : 'none' }} />
            </div>
          );
        })}
      </div>

      {/* Cabecera */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px 10px', paddingTop: 'calc(var(--sat, 0px) + 22px)', zIndex: 5,
                    background: 'linear-gradient(to bottom, rgba(0,0,0,0.5), transparent)' }}>
        <button onClick={close} aria-label="Cerrar" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
        </button>
        <Avatar name={isMine ? user.name : name} src={isMine ? user.avatar || null : authors[uid]?.avatar || null} size="sm" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, color: 'white', fontWeight: 800, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
          <p style={{ margin: 0, color: 'rgba(255,255,255,0.7)', fontSize: 11 }}>
            {timeAgo(story.createdAt)}{list.length > 1 ? ` · ${viewer.idx + 1}/${list.length}` : ''}
            {isMine ? ` · ${privacyLabel(story.privacy, true)}` : ''}
          </p>
        </div>
        {isMine && (
          <button onClick={() => setConfirmDel(true)} aria-label="Eliminar estado"
            style={{ background: 'rgba(239,68,68,0.85)', border: 'none', borderRadius: 18, padding: '6px 12px', color: 'white', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>
            Eliminar
          </button>
        )}
      </div>

      {/* Contenido: tocar a la izquierda = anterior, a la derecha = siguiente */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {story.mediaType === 'image' && <img src={mediaSrc(story.content)} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />}
        {story.mediaType === 'video' && (
          <video key={story.id} src={mediaSrc(story.content)} autoPlay playsInline onEnded={goNext}
            style={{ maxWidth: '100%', maxHeight: '100%' }} />
        )}
        {story.mediaType === 'text' && (
          <p style={{ color: 'white', fontSize: 26, fontWeight: 800, textAlign: 'center', lineHeight: 1.35, padding: '0 28px', textShadow: '0 2px 8px rgba(0,0,0,0.25)',
                      wordBreak: 'break-word' }}>
            {story.content}
          </p>
        )}
        <div onClick={goPrev} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '33%' }} />
        <div onClick={goNext} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '67%' }} />
      </div>

      {/* Pie: autor → vistas; otros → responder */}
      {isMine ? (
        <div style={{ padding: '12px 16px', paddingBottom: 'calc(var(--sab, 0px) + 16px)', display: 'flex', justifyContent: 'center', zIndex: 6 }}>
          <button onClick={showViewers}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,0.45)', border: 'none', borderRadius: 20, padding: '9px 18px',
                     color: 'white', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            {story.viewers?.length || 0} vista{story.viewers?.length === 1 ? '' : 's'}
            {story.audienceCount != null && <span style={{ fontWeight: 600, opacity: 0.75 }}> · de {story.audienceCount}</span>}
          </button>
        </div>
      ) : (
        <div style={{ padding: '10px 14px', paddingBottom: 'calc(var(--sab, 0px) + 14px)', background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', gap: 8, zIndex: 6 }}>
          {replySent ? (
            <p style={{ flex: 1, margin: 0, textAlign: 'center', color: 'white', fontWeight: 700, fontSize: 14, padding: '10px 0' }}>✓ Respuesta enviada</p>
          ) : (
            <>
              <input value={replyText} onChange={e => setReplyText(e.target.value)}
                onFocus={() => setPaused(true)} onBlur={() => !replyText.trim() && setPaused(false)}
                onKeyDown={e => { if (e.key === 'Enter') sendReply(); }}
                placeholder={`Responder a ${name.split(' ')[0]}…`}
                style={{ flex: 1, background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 24,
                         padding: '10px 16px', color: 'white', fontSize: 14, outline: 'none', fontFamily: 'inherit' }} />
              <button onClick={sendReply} disabled={!replyText.trim()} aria-label="Enviar"
                style={{ width: 42, height: 42, borderRadius: '50%', border: 'none', flexShrink: 0, cursor: replyText.trim() ? 'pointer' : 'default',
                         background: replyText.trim() ? BRAND : 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="18" height="18" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>
              </button>
            </>
          )}
        </div>
      )}

      {/* Quién lo ha visto */}
      {viewersList && (
        <div onClick={() => setViewersList(null)} style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxHeight: '60%', background: '#1a2340', borderRadius: '20px 20px 0 0', overflowY: 'auto',
                     paddingBottom: 'calc(var(--sab, 0px) + 12px)' }}>
            <p style={{ margin: 0, padding: '16px 18px 8px', color: 'white', fontWeight: 800, fontSize: 15 }}>
              Visto por {viewersList.length}
            </p>
            {viewersList.length === 0 && <p style={{ margin: 0, padding: '6px 18px 16px', color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>Todavía nadie</p>}
            {viewersList.map(v => (
              <button key={v.userId}
                onClick={() => { close(); navigate(`/chat/${v.userId}`, { state: { chat: { id: v.userId, name: v.name, participantId: v.userId } } }); }}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '9px 18px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <Avatar name={v.name} size="sm" />
                <span style={{ color: 'white', fontSize: 14, fontWeight: 600 }}>{v.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Confirmar borrado */}
      {confirmDel && (
        <div onClick={() => setConfirmDel(false)} style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#1a2340', borderRadius: 18, padding: '20px 18px 14px', width: '100%', maxWidth: 320 }}>
            <p style={{ margin: '0 0 16px', color: 'white', fontWeight: 800, fontSize: 16 }}>¿Eliminar este estado?</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirmDel(false)} style={{ flex: 1, padding: 11, borderRadius: 12, border: '1px solid rgba(255,255,255,0.3)', background: 'transparent', color: 'white', fontWeight: 800, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={del} style={{ flex: 1, padding: 11, borderRadius: 12, border: 'none', background: '#ef4444', color: 'white', fontWeight: 800, cursor: 'pointer' }}>Eliminar</button>
            </div>
          </div>
        </div>
      )}

      <style>{'@keyframes stProg { from { width: 0% } to { width: 100% } }'}</style>
    </div>
  );
}
