/**
 * Grabaciones de directos: lista, reproductor, canal de un usuario y hoja de edición.
 * Las grabaciones las hace el servidor al terminar cada directo y quedan publicadas en el canal del anfitrión.
 * Solo el dueño ve los botones de gestión (el servidor lo comprueba igualmente con su sesión).
 */
import { useEffect, useState, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { useBackClose } from '../utils/backHandler';
import { listRecordings, saveRecording, deleteRecording, countView, formatDuration } from '../utils/directos';
import { tr, LOCALE } from '../i18n';

const BRAND = '#3D5A80';
const RED   = '#ef4444';
const TEXT  = '#293241';
const MUTED = '#64748b';

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

// ── Lista de grabaciones ─────────────────────────────────────────────────────
export function RecordingsList({ recordings, loading, emptyText, showOwner = true, onOpen, onOpenChannel, onEdit }) {
  const myId = useAuthStore(s => s.user?.id);
  if (loading) return <p style={{ textAlign: 'center', color: '#94a3b8', padding: 40, fontSize: 13 }}>{tr('Cargando…')}</p>;
  if (!recordings.length) return <p style={{ textAlign: 'center', color: '#94a3b8', padding: '50px 24px', fontSize: 14, fontWeight: 600 }}>{emptyText}</p>;
  return recordings.map(r => (
    <div key={r.id} style={{ margin: '0 12px 12px', background: 'white', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 6px rgba(0,0,0,0.07)' }}>
      <button onClick={() => onOpen(r)} aria-label={tr('Ver grabación')}
        style={{ position: 'relative', display: 'block', width: '100%', aspectRatio: '16 / 9', background: '#0A0D25', border: 'none', padding: 0, cursor: 'pointer' }}>
        <video src={`${r.url}#t=1`} preload="metadata" muted playsInline
          style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />
        <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
          </span>
        </span>
        <span style={{ position: 'absolute', right: 8, bottom: 8, background: 'rgba(0,0,0,0.75)', color: 'white', fontSize: 11, fontWeight: 700, borderRadius: 6, padding: '2px 6px' }}>
          {formatDuration(r.duration)}
        </span>
      </button>
      <div style={{ padding: '10px 14px 12px', display: 'flex', gap: 10 }}>
        {showOwner && (
          <button onClick={() => onOpenChannel?.(r.ownerId)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }} aria-label={tr('Ver canal')}>
            <Avatar name={r.ownerName} src={r.ownerAvatar} size={36} />
          </button>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 800, color: TEXT, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</p>
          <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>
            {showOwner && <button onClick={() => onOpenChannel?.(r.ownerId)} style={{ background: 'none', border: 'none', padding: 0, color: MUTED, fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>{r.ownerName}</button>}
            {showOwner && ' · '}{fmtDate(r.createdAt)} · {tr('{n} vistas', { n: r.views || 0 })}
          </p>
          {r.ownerId === myId && (
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {r.published ? <Badge bg="#dcfce7" color="#15803d">{tr('Publicada')}</Badge> : <Badge bg="#f1f5f9" color={MUTED}>{tr('Oculta')}</Badge>}
              <Badge bg="#E3EDF2" color={BRAND}>{r.visibility === 'public' ? tr('Pública') : tr('Mis contactos')}</Badge>
              {r.hiddenByAdmin && <Badge bg="#fee2e2" color={RED}>{tr('Retirada por el administrador')}</Badge>}
            </div>
          )}
        </div>
        {onEdit && r.ownerId === myId && (
          <button onClick={() => onEdit(r)} style={{ alignSelf: 'flex-start', background: '#E3EDF2', color: BRAND, border: 'none', borderRadius: 20, padding: '6px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
            {tr('Editar')}
          </button>
        )}
      </div>
    </div>
  ));
}

// ── Reproductor a pantalla completa ──────────────────────────────────────────
export function RecordingPlayer({ rec, onClose, onOpenChannel }) {
  useBackClose(true, onClose);
  useEffect(() => { countView(rec.id); }, [rec.id]);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 700, background: '#000', display: 'flex', flexDirection: 'column', paddingTop: 'var(--sat)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', color: 'white' }}>
        <button onClick={onClose} aria-label={tr('Cerrar')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M15 19l-7-7 7-7" /></svg>
        </button>
        <p style={{ flex: 1, minWidth: 0, margin: 0, fontWeight: 800, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rec.title}</p>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
        <video src={rec.url} controls autoPlay playsInline style={{ width: '100%', maxHeight: '100%', background: '#000' }} />
      </div>
      <div style={{ padding: '12px 16px calc(16px + env(safe-area-inset-bottom, 0px))', color: 'white' }}>
        <button onClick={() => onOpenChannel?.(rec.ownerId)} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'white' }}>
          <Avatar name={rec.ownerName} src={rec.ownerAvatar} size={32} />
          <span style={{ fontWeight: 800, fontSize: 14 }}>{rec.ownerName}</span>
        </button>
        <p style={{ fontSize: 12, color: '#cbd5e1', margin: '8px 0 0' }}>{fmtDate(rec.createdAt)} · {tr('{n} vistas', { n: rec.views || 0 })}</p>
        {rec.description && <p style={{ fontSize: 13, color: '#e2e8f0', margin: '6px 0 0', whiteSpace: 'pre-wrap', maxHeight: 120, overflowY: 'auto' }}>{rec.description}</p>}
      </div>
    </div>
  );
}

// ── Editar una grabación propia ──────────────────────────────────────────────
export function RecordingEditSheet({ rec, onClose, onSaved, onDeleted }) {
  useBackClose(true, onClose);
  const [title, setTitle]             = useState(rec.title || '');
  const [description, setDescription] = useState(rec.description || '');
  const [published, setPublished]     = useState(!!rec.published);
  const [visibility, setVisibility]   = useState(rec.visibility === 'public' ? 'public' : 'contacts');
  const [confirmDel, setConfirmDel]   = useState(false);
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState('');

  const save = async () => {
    if (!title.trim()) { setError(tr('El título es obligatorio')); return; }
    setBusy(true); setError('');
    try { onSaved(await saveRecording(rec.id, { title: title.trim(), description, published, visibility })); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError('');
    try { await deleteRecording(rec.id); onDeleted(rec.id); }
    catch (e) { setError(e.message); setBusy(false); }
  };

  const radio = (key, label, sub) => (
    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: visibility === key ? '#E3EDF2' : '#f8fafc', borderRadius: 12, marginBottom: 6, cursor: 'pointer' }}>
      <input type="radio" name="rec-vis" checked={visibility === key} onChange={() => setVisibility(key)} style={{ width: 18, height: 18, accentColor: BRAND }} />
      <span><span style={{ display: 'block', fontSize: 13, fontWeight: 800, color: TEXT }}>{label}</span><span style={{ fontSize: 11, color: '#94a3b8' }}>{sub}</span></span>
    </label>
  );

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 720, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', background: 'white', borderRadius: '24px 24px 0 0', maxHeight: '92vh', overflowY: 'auto',
                                                        padding: '18px 16px calc(18px + env(safe-area-inset-bottom, 0px))', boxSizing: 'border-box' }}>
        <h2 style={{ fontSize: 16, fontWeight: 900, color: TEXT, margin: '0 0 14px' }}>{tr('Editar grabación')}</h2>
        <p style={labelStyle}>{tr('TÍTULO')}</p>
        <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} style={inputStyle} />
        <p style={labelStyle}>{tr('DESCRIPCIÓN')}</p>
        <textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} rows={3} style={{ ...inputStyle, resize: 'none' }} />

        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 0', cursor: 'pointer' }}>
          <span>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 800, color: TEXT }}>{tr('Publicada en mi canal')}</span>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>{published ? tr('Los demás pueden verla') : tr('Oculta: solo la ves tú')}</span>
          </span>
          <input type="checkbox" checked={published} onChange={e => setPublished(e.target.checked)} style={{ width: 22, height: 22, accentColor: BRAND }} />
        </label>

        <p style={labelStyle}>{tr('QUIÉN PUEDE VERLA')}</p>
        {radio('public', tr('Todo OldFace'), tr('Cualquier usuario de OldFace'))}
        {radio('contacts', tr('Mis contactos'), tr('Solo tus contactos (o los que elegiste para el directo)'))}

        {error && <p style={{ fontSize: 12, color: RED, background: '#fee2e2', padding: '10px 14px', borderRadius: 10, margin: '10px 0 0' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onClose} style={{ ...btn, flex: 1, background: '#f1f5f9', color: MUTED }}>{tr('Cancelar')}</button>
          <button onClick={save} disabled={busy} style={{ ...btn, flex: 2, background: BRAND, color: 'white', opacity: busy ? 0.7 : 1 }}>{busy ? tr('Guardando...') : tr('Guardar cambios')}</button>
        </div>
        {!confirmDel
          ? <button onClick={() => setConfirmDel(true)} style={{ ...btn, width: '100%', marginTop: 10, background: '#fee2e2', color: RED }}>{tr('Eliminar grabación')}</button>
          : <div style={{ marginTop: 10, padding: 12, background: '#fee2e2', borderRadius: 14 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: RED, margin: '0 0 10px' }}>{tr('¿Eliminar esta grabación para siempre? No se puede deshacer.')}</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setConfirmDel(false)} style={{ ...btn, flex: 1, background: 'white', color: MUTED }}>{tr('No')}</button>
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
  const [playing, setPlaying] = useState(null);
  const [editing, setEditing] = useState(null);
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
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 17, fontWeight: 900, color: TEXT, margin: 0 }}>{own ? tr('Mi canal') : name}</p>
          <p style={{ fontSize: 12, color: MUTED, margin: '2px 0 0' }}>{tr('{n} grabaciones', { n: data.recordings.length })}</p>
        </div>
      </div>
      {own && <p style={{ fontSize: 12, color: MUTED, margin: '0 16px 12px', lineHeight: 1.5 }}>{tr('Tus directos se graban solos y aparecen aquí al terminar. Solo tú puedes editarlos, ocultarlos o borrarlos.')}</p>}
      {error && <p style={{ fontSize: 12, color: RED, margin: '0 16px 12px' }}>{error}</p>}
      <RecordingsList recordings={data.recordings} loading={loading} showOwner={false}
        emptyText={own ? tr('Todavía no tienes grabaciones. Cuando termines un directo aparecerá aquí.') : tr('Este canal todavía no tiene grabaciones')}
        onOpen={setPlaying} onEdit={own ? setEditing : undefined} />
      {playing && <RecordingPlayer rec={playing} onClose={() => setPlaying(null)} onOpenChannel={() => setPlaying(null)} />}
      {editing && <RecordingEditSheet rec={editing} onClose={() => setEditing(null)}
        onSaved={(r) => { replace(r); setEditing(null); }}
        onDeleted={(id) => { setData(d => ({ ...d, recordings: d.recordings.filter(x => x.id !== id) })); setEditing(null); }} />}
    </>
  );
  if (embedded) return body;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 650, background: '#f8fafc', overflowY: 'auto', paddingTop: 'var(--sat)' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 1, background: 'white', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
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
const inputStyle = { width: '100%', padding: '11px 14px', borderRadius: 12, border: '1.5px solid #e2e8f0', fontSize: 14, color: TEXT,
                     background: 'white', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' };
const btn = { padding: '13px', border: 'none', borderRadius: 14, fontWeight: 800, fontSize: 14, cursor: 'pointer' };
