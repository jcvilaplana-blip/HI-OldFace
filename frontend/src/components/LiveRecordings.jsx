/**
 * Grabaciones de directos: cuadrícula de 2 columnas (tarjetas 9:16, buscador y filtros), reproductor a pantalla
 * completa con desplazamiento vertical (como Reels/TikTok), canal de un usuario y hoja de edición.
 * Las grabaciones las hace el servidor al terminar cada directo y quedan en el canal del anfitrión (solo sus contactos).
 * Las de pago llegan bloqueadas (locked, sin url) hasta pagarlas o canjear un código (PaySheet).
 * Portada: la genera el servidor (JPG); así el vídeo se ve nativo, sin la imagen gris de "play" de Android.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { useBackClose } from '../utils/backHandler';
import { listRecordings, saveRecording, deleteRecording, countView, formatDuration, formatMoney } from '../utils/directos';
import { PaySheet, EarningsSheet } from './LivePay';
import { tr, LOCALE } from '../i18n';

const BRAND = '#3D5A80';
const RED   = '#ef4444';
const TEXT  = 'var(--text-primary)';
const MUTED = 'var(--text-secondary)';
// Póster vacío: sin él, Android pinta su imagen gris de "play" mientras carga el vídeo
const NO_POSTER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString(LOCALE, { day: '2-digit', month: 'short', year: 'numeric' }) : '');

function Avatar({ name, src, size = 40 }) {
  return src
    ? <img src={src} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
    : <div style={{ width: size, height: size, borderRadius: '50%', background: BRAND, color: 'white', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: size * 0.42 }}>
        {(name || '?').trim().charAt(0).toUpperCase()}
      </div>;
}

function Badge({ children, bg, color }) {
  return <span style={{ fontSize: 10, fontWeight: 800, color, background: bg, borderRadius: 20, padding: '2px 8px', whiteSpace: 'nowrap' }}>{children}</span>;
}

/** Portada de una grabación: la imagen del servidor o, si aún no la hay, el primer fotograma del vídeo */
function Cover({ rec, blur }) {
  const style = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', background: '#0A0D25',
                  filter: blur ? 'blur(14px) brightness(0.7)' : 'none', transform: blur ? 'scale(1.15)' : 'none' };
  if (rec.poster) return <img src={rec.poster} alt="" loading="lazy" style={style} />;
  if (rec.url) return <video src={`${rec.url}#t=1`} poster={NO_POSTER} preload="metadata" muted playsInline style={{ ...style, pointerEvents: 'none' }} />;
  return <div style={{ ...style, background: 'linear-gradient(160deg, #1e1035, #3D5A80)' }} />;
}

// ── Cuadrícula (2 columnas, 9:16) con buscador y filtros ─────────────────────
const FILTERS = [['recent', 'Recientes'], ['views', 'Más vistas'], ['free', 'Gratis'], ['paid', 'De pago']];

/** onOpen(lista visible, índice) abre el reproductor con lo que se está viendo (ya filtrado) */
export function RecordingsGrid({ recordings, loading, emptyText, showOwner = true, onOpen, onEdit, searchable = true }) {
  const myId = useAuthStore(s => s.user?.id);
  const [query, setQuery]   = useState('');
  const [filter, setFilter] = useState('recent');

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    let l = recordings.filter(r => !q || `${r.title} ${r.ownerName} ${r.description || ''}`.toLowerCase().includes(q));
    if (filter === 'free') l = l.filter(r => !(r.price > 0));
    if (filter === 'paid') l = l.filter(r => r.price > 0);
    return filter === 'views' ? [...l].sort((a, b) => (b.views || 0) - (a.views || 0)) : l;
  }, [recordings, query, filter]);

  return (
    <div>
      {searchable && recordings.length > 0 && (
        <div style={{ padding: '0 12px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-surface)', borderRadius: 14, padding: '9px 12px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder={tr('Buscar vídeos o canales')}
              style={{ flex: 1, border: 'none', outline: 'none', fontSize: 14, color: TEXT, background: 'transparent', fontFamily: 'inherit' }} />
            {query && <button onClick={() => setQuery('')} aria-label={tr('Borrar')} style={{ border: 'none', background: 'none', color: 'var(--text-muted)', fontSize: 16, cursor: 'pointer' }}>✕</button>}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, overflowX: 'auto' }}>
            {FILTERS.map(([key, label]) => (
              <button key={key} onClick={() => setFilter(key)} style={{
                border: 'none', borderRadius: 20, padding: '6px 13px', fontSize: 12, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap',
                background: filter === key ? RED : 'white', color: filter === key ? 'white' : MUTED, boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
              }}>{tr(label)}</button>
            ))}
          </div>
        </div>
      )}

      {loading && <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40, fontSize: 13 }}>{tr('Cargando…')}</p>}
      {!loading && !list.length && (
        <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '50px 24px', fontSize: 14, fontWeight: 600 }}>
          {recordings.length ? tr('No hay vídeos que coincidan') : emptyText}
        </p>
      )}

      {!loading && list.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '0 12px' }}>
          {list.map((r, i) => (
            <div key={r.id}>
              <button onClick={() => onOpen(list, i)} aria-label={tr('Ver grabación')} style={{
                position: 'relative', display: 'block', width: '100%', aspectRatio: '9 / 16', borderRadius: 14, overflow: 'hidden',
                background: '#0A0D25', border: 'none', padding: 0, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              }}>
                <Cover rec={r} blur={r.locked} />
                {r.locked && (
                  <span style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'white' }}>
                    <span style={{ fontSize: 28 }}>🔒</span>
                    <span style={{ fontSize: 13, fontWeight: 900, background: 'rgba(0,0,0,0.45)', borderRadius: 20, padding: '4px 10px' }}>{formatMoney(r.price)}</span>
                  </span>
                )}
                <span style={{ position: 'absolute', right: 6, top: 6, background: 'rgba(0,0,0,0.6)', color: 'white', fontSize: 10, fontWeight: 800, borderRadius: 6, padding: '2px 6px' }}>
                  {formatDuration(r.duration)}
                </span>
                {!r.locked && r.price > 0 && r.ownerId === myId && (
                  <span style={{ position: 'absolute', left: 6, top: 6, background: 'rgba(250,204,21,0.25)', color: TEXT, fontSize: 10, fontWeight: 900, borderRadius: 6, padding: '2px 6px' }}>{formatMoney(r.price)}</span>
                )}
                <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '28px 8px 8px', textAlign: 'left',
                               background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)', color: 'white' }}>
                  <span style={{ fontSize: 12, fontWeight: 800, lineHeight: 1.25, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{r.title}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, opacity: 0.85, marginTop: 3 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
                    {r.views || 0}{showOwner && r.ownerName ? ` · ${r.ownerName}` : ''}
                  </span>
                </span>
              </button>
              {r.ownerId === myId && (onEdit || !r.published || r.hiddenByAdmin) && (
                <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                  {!r.published && <Badge bg="#f1f5f9" color={MUTED}>{tr('Oculta')}</Badge>}
                  {r.hiddenByAdmin && <Badge bg="#fee2e2" color={RED}>{tr('Retirada por el administrador')}</Badge>}
                  {onEdit && <button onClick={() => onEdit(r)} style={{ marginLeft: 'auto', background: 'var(--accent-dim)', color: 'var(--accent-text)', border: 'none', borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>{tr('Editar')}</button>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Reproductor a pantalla completa con desplazamiento vertical ─────────────
/** recordings: la lista visible · startIndex: la que se ha tocado · onChanged(rec): una se ha desbloqueado */
export function RecordingFeed({ recordings, startIndex = 0, onClose, onOpenChannel, onChanged }) {
  useBackClose(true, onClose);
  const [items, setItems]   = useState(recordings);
  const [active, setActive] = useState(startIndex);
  const [muted, setMuted]   = useState(false);
  const [paying, setPaying] = useState(null);
  const box = useRef(null);

  useLayoutEffect(() => { if (box.current) box.current.scrollTop = startIndex * box.current.clientHeight; }, []); // eslint-disable-line
  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    const i = Math.round(el.scrollTop / Math.max(1, el.clientHeight));
    if (i !== active && i >= 0 && i < items.length) setActive(i);
  };

  // Tras pagar o canjear: se pide otra vez para recibir el enlace del vídeo
  const unlocked = async (rec) => {
    setPaying(null);
    try {
      const { recordings: fresh = [] } = await listRecordings(rec.ownerId);
      const r = fresh.find(x => x.id === rec.id);
      if (r) { setItems(l => l.map(x => (x.id === r.id ? r : x))); onChanged?.(r); }
    } catch { /* se verá al volver a entrar */ }
    // Al cerrarse la hoja de pago la lista puede moverse: se vuelve al vídeo recién desbloqueado
    const i = items.findIndex(x => x.id === rec.id);
    requestAnimationFrame(() => { if (box.current && i >= 0) { box.current.scrollTop = i * box.current.clientHeight; setActive(i); } });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 700, background: '#000' }}>
      <div ref={box} onScroll={onScroll} style={{ position: 'absolute', inset: 0, overflowY: 'auto', scrollSnapType: 'y mandatory', overscrollBehavior: 'contain', scrollbarWidth: 'none' }}>
        {items.map((r, i) => (
          <FeedItem key={r.id} rec={r} active={i === active} near={Math.abs(i - active) <= 1} muted={muted}
            onMuted={setMuted} onOpenChannel={onOpenChannel} onPay={() => setPaying(r)} />
        ))}
      </div>
      <button onClick={onClose} aria-label={tr('Cerrar')} style={{ position: 'absolute', top: 'calc(var(--sat, 0px) + 10px)', left: 10, zIndex: 2,
                                                                  background: 'rgba(0,0,0,0.35)', border: 'none', borderRadius: '50%', width: 38, height: 38, cursor: 'pointer',
                                                                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M15 19l-7-7 7-7" /></svg>
      </button>
      {paying && <PaySheet kind="recording" id={paying.id} price={paying.price} title={paying.title} ownerName={paying.ownerName}
        onClose={() => setPaying(null)} onUnlocked={() => unlocked(paying)} />}
    </div>
  );
}

function FeedItem({ rec, active, near, muted, onMuted, onOpenChannel, onPay }) {
  const video = useRef(null);
  const counted = useRef(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fit, setFit] = useState('cover');   // vertical: pantalla completa (como Reels) · horizontal: entero

  // Solo se reproduce la que está en pantalla; las vecinas quedan preparadas y las demás ni se cargan
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (active) {
      v.muted = muted;
      v.play().then(() => setPaused(false)).catch(() => {
        v.muted = true; onMuted(true);           // el móvil no deja sonar sin tocar: arranca en silencio
        v.play().then(() => setPaused(false)).catch(() => setPaused(true));
      });
      if (!counted.current) { counted.current = true; countView(rec.id); }
    } else { v.pause(); }
  }, [active, rec.url]); // eslint-disable-line
  useEffect(() => { if (video.current) video.current.muted = muted; }, [muted]);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) { v.play().catch(() => {}); setPaused(false); } else { v.pause(); setPaused(true); }
  };

  return (
    <section style={{ position: 'relative', height: '100%', minHeight: '100%', scrollSnapAlign: 'start', scrollSnapStop: 'always', overflow: 'hidden', background: '#000' }}>
      {rec.locked ? (
        <>
          <Cover rec={rec} blur />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'white', padding: 24, textAlign: 'center' }}>
            <span style={{ fontSize: 44 }}>🔒</span>
            <p style={{ margin: 0, fontSize: 17, fontWeight: 900 }}>{tr('Directo de pago')}</p>
            <button onClick={onPay} style={{ border: 'none', borderRadius: 26, padding: '13px 26px', background: RED, color: 'white', fontSize: 15, fontWeight: 900, cursor: 'pointer', boxShadow: '0 6px 20px rgba(239,68,68,0.45)' }}>
              {tr('Ver por {p0}', { p0: formatMoney(rec.price) })}
            </button>
            <button onClick={onPay} style={{ border: 'none', background: 'none', color: 'white', fontSize: 13, fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}>{tr('Tengo un código')}</button>
          </div>
        </>
      ) : (
        <>
          {/* Vídeo nativo: la portada se ve al instante y el vídeo sigue encima sin imagen de carga */}
          {near
            ? <video ref={video} src={rec.url} poster={rec.poster || NO_POSTER} preload={active ? 'auto' : 'metadata'} playsInline loop
                onClick={toggle} onTimeUpdate={e => setProgress(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)}
                onLoadedMetadata={e => setFit(e.currentTarget.videoWidth > e.currentTarget.videoHeight ? 'contain' : 'cover')}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: fit, background: '#000' }} />
            : <Cover rec={rec} />}
          {paused && active && (
            <span onClick={toggle} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ width: 70, height: 70, borderRadius: '50%', background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="30" height="30" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
              </span>
            </span>
          )}
          <button onClick={() => onMuted(!muted)} aria-label={muted ? tr('Activar sonido') : tr('Silenciar')}
            style={{ position: 'absolute', top: 'calc(var(--sat, 0px) + 10px)', right: 10, background: 'rgba(0,0,0,0.35)', border: 'none', borderRadius: '50%', width: 38, height: 38, color: 'white', fontSize: 17, cursor: 'pointer' }}>
            {muted ? '🔇' : '🔊'}
          </button>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, background: 'rgba(255,255,255,0.25)' }}>
            <div style={{ height: '100%', width: `${progress * 100}%`, background: 'white' }} />
          </div>
        </>
      )}

      {/* Datos de la grabación */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 3, padding: '40px 16px calc(14px + env(safe-area-inset-bottom, 0px))', color: 'white',
                    background: 'linear-gradient(to top, rgba(0,0,0,0.75), transparent)', pointerEvents: 'none' }}>
        <button onClick={() => onOpenChannel?.(rec.ownerId)} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'white', pointerEvents: 'auto' }}>
          <Avatar name={rec.ownerName} src={rec.ownerAvatar} size={34} />
          <span style={{ fontWeight: 800, fontSize: 14 }}>{rec.ownerName}</span>
        </button>
        <p style={{ fontSize: 15, fontWeight: 800, margin: '8px 0 0' }}>{rec.title}</p>
        <p style={{ fontSize: 12, color: '#cbd5e1', margin: '4px 0 0' }}>{fmtDate(rec.createdAt)} · {tr('{n} vistas', { n: rec.views || 0 })} · {formatDuration(rec.duration)}</p>
        {rec.description && <p style={{ fontSize: 13, color: 'var(--border-strong)', margin: '6px 0 0', whiteSpace: 'pre-wrap', maxHeight: 60, overflow: 'hidden' }}>{rec.description}</p>}
      </div>
    </section>
  );
}

// ── Editar una grabación propia ──────────────────────────────────────────────
export function RecordingEditSheet({ rec, onClose, onSaved, onDeleted }) {
  useBackClose(true, onClose);
  const [title, setTitle]             = useState(rec.title || '');
  const [description, setDescription] = useState(rec.description || '');
  const [published, setPublished]     = useState(!!rec.published);
  const [confirmDel, setConfirmDel]   = useState(false);
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState('');

  const save = async () => {
    if (!title.trim()) { setError(tr('El título es obligatorio')); return; }
    setBusy(true); setError('');
    try { onSaved(await saveRecording(rec.id, { title: title.trim(), description, published })); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError('');
    try { await deleteRecording(rec.id); onDeleted(rec.id); }
    catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 720, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', background: 'var(--bg-surface)', borderRadius: '24px 24px 0 0', maxHeight: '92vh', overflowY: 'auto',
                                                        padding: '18px 16px calc(18px + env(safe-area-inset-bottom, 0px))', boxSizing: 'border-box' }}>
        <h2 style={{ fontSize: 16, fontWeight: 900, color: TEXT, margin: '0 0 14px' }}>{tr('Editar grabación')}</h2>
        <p style={labelStyle}>{tr('TÍTULO')}</p>
        <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} style={inputStyle} />
        <p style={labelStyle}>{tr('DESCRIPCIÓN')}</p>
        <textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} rows={3} style={{ ...inputStyle, resize: 'none' }} />

        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 0', cursor: 'pointer' }}>
          <span>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 800, color: TEXT }}>{tr('Publicada en mi canal')}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{published ? tr('Tus contactos pueden verla') : tr('Oculta: solo la ves tú')}</span>
          </span>
          <input type="checkbox" checked={published} onChange={e => setPublished(e.target.checked)} style={{ width: 22, height: 22, accentColor: BRAND }} />
        </label>
        <p style={{ fontSize: 12, color: MUTED, margin: '0 0 4px', lineHeight: 1.5 }}>
          {rec.price > 0
            ? tr('Solo la ven tus contactos que han pagado el directo ({p0}) o han usado uno de tus códigos.', { p0: formatMoney(rec.price) })
            : tr('Solo la ven tus contactos (o los que elegiste para el directo).')}
        </p>

        {error && <p style={{ fontSize: 12, color: RED, background: 'rgba(239,68,68,0.14)', padding: '10px 14px', borderRadius: 10, margin: '10px 0 0' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onClose} style={{ ...btn, flex: 1, background: 'var(--bg-hover)', color: MUTED }}>{tr('Cancelar')}</button>
          <button onClick={save} disabled={busy} style={{ ...btn, flex: 2, background: BRAND, color: 'white', opacity: busy ? 0.7 : 1 }}>{busy ? tr('Guardando...') : tr('Guardar cambios')}</button>
        </div>
        {!confirmDel
          ? <button onClick={() => setConfirmDel(true)} style={{ ...btn, width: '100%', marginTop: 10, background: 'rgba(239,68,68,0.14)', color: RED }}>{tr('Eliminar grabación')}</button>
          : <div style={{ marginTop: 10, padding: 12, background: 'rgba(239,68,68,0.14)', borderRadius: 14 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: RED, margin: '0 0 10px' }}>{tr('¿Eliminar esta grabación para siempre? No se puede deshacer.')}</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setConfirmDel(false)} style={{ ...btn, flex: 1, background: 'var(--bg-surface)', color: MUTED }}>{tr('No')}</button>
                <button onClick={remove} disabled={busy} style={{ ...btn, flex: 1, background: RED, color: 'white' }}>{tr('Sí, eliminar')}</button>
              </div>
            </div>}
      </div>
    </div>
  );
}

// ── Canal de un usuario (sus grabaciones) ────────────────────────────────────
export function ChannelView({ ownerId, embedded = false, onClose }) {
  const myId = useAuthStore(s => s.user?.id);
  const own = ownerId === myId;
  const [data, setData]       = useState({ recordings: [], channel: null });
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [feed, setFeed]       = useState(null);     // { list, index }
  const [editing, setEditing] = useState(null);
  const [earnings, setEarnings] = useState(false);
  useBackClose(!embedded, () => onClose?.());

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await listRecordings(ownerId)); setError(''); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [ownerId]);
  useEffect(() => { load(); }, [load]);

  const replace = (r) => setData(d => ({ ...d, recordings: d.recordings.map(x => (x.id === r.id ? r : x)) }));
  const name = data.channel?.name || data.recordings[0]?.ownerName || '';

  const body = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }}>
        <Avatar name={name} src={data.channel?.avatar} size={52} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ fontSize: 17, fontWeight: 900, color: TEXT, margin: 0 }}>{own ? tr('Mi canal') : name}</p>
          <p style={{ fontSize: 12, color: MUTED, margin: '2px 0 0' }}>{tr('{n} grabaciones', { n: data.recordings.length })}</p>
        </div>
        {own && (
          <button onClick={() => setEarnings(true)} style={{ background: `linear-gradient(135deg, ${RED}, #ec4899)`, color: 'white', border: 'none', borderRadius: 20,
                                                            padding: '8px 14px', fontSize: 12, fontWeight: 900, cursor: 'pointer' }}>💶 {tr('Ganancias')}</button>
        )}
      </div>
      {own && <p style={{ fontSize: 12, color: MUTED, margin: '0 16px 12px', lineHeight: 1.5 }}>{tr('Tus directos se graban solos y aparecen aquí al terminar. Solo los ven tus contactos; si tienen precio, solo quien ha pagado o ha usado un código.')}</p>}
      {error && <p style={{ fontSize: 12, color: RED, margin: '0 16px 12px' }}>{error}</p>}
      <RecordingsGrid recordings={data.recordings} loading={loading} showOwner={false}
        emptyText={own ? tr('Todavía no tienes grabaciones. Cuando termines un directo aparecerá aquí.') : tr('Este canal todavía no tiene grabaciones')}
        onOpen={(list, index) => setFeed({ list, index })} onEdit={own ? setEditing : undefined} />
      {feed && <RecordingFeed recordings={feed.list} startIndex={feed.index} onClose={() => setFeed(null)} onOpenChannel={() => setFeed(null)} onChanged={replace} />}
      {editing && <RecordingEditSheet rec={editing} onClose={() => setEditing(null)}
        onSaved={(r) => { replace(r); setEditing(null); }}
        onDeleted={(id) => { setData(d => ({ ...d, recordings: d.recordings.filter(x => x.id !== id) })); setEditing(null); }} />}
      {earnings && <EarningsSheet onClose={() => setEarnings(false)} />}
    </>
  );
  if (embedded) return body;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 650, background: 'var(--bg-section)', overflowY: 'auto', paddingTop: 'var(--sat)' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <button onClick={onClose} aria-label={tr('Atrás')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={TEXT} strokeWidth="2.5" strokeLinecap="round"><path d="M15 19l-7-7 7-7" /></svg>
        </button>
        <p style={{ margin: 0, fontWeight: 900, fontSize: 16, color: TEXT }}>{tr('Canal')}</p>
      </div>
      <div style={{ paddingBottom: 24 }}>{body}</div>
    </div>
  );
}

const labelStyle = { fontSize: 11, fontWeight: 800, color: MUTED, letterSpacing: '0.4px', margin: '12px 0 6px' };
const inputStyle = { width: '100%', padding: '11px 14px', borderRadius: 12, border: '1.5px solid var(--border-strong)', fontSize: 14, color: TEXT,
                     background: 'var(--bg-surface)', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' };
const btn = { padding: '13px', border: 'none', borderRadius: 14, fontWeight: 800, fontSize: 14, cursor: 'pointer' };
