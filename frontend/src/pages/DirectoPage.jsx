/**
 * DirectoPage — Directos en vivo, grabaciones y canal.
 *   · Directos: en vivo y programados que puedo ver (públicos, de mis contactos y los míos).
 *   · Grabaciones: los directos terminados de todos los canales que puedo ver (se graban solos en el servidor).
 *   · Mi canal: mis grabaciones (editar, publicar/ocultar, borrar). Solo si puedo emitir.
 * Emitir: de momento solo las cuentas autorizadas en el Administrador (GET /directos/permissions).
 * Cada directo es SOLO para mis contactos (todos o los que elija). Si tiene precio, cada contacto lo paga (o canjea
 * un código que le mando) para verlo en vivo y su grabación.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useContacts } from '../hooks/useContacts';
import { onRtc } from '../utils/rtcClient';
import { useBackClose } from '../utils/backHandler';
import { getPermissions, listDirectos, saveDirecto, deleteDirecto, listRecordings, formatMoney } from '../utils/directos';
import { RecordingsGrid, RecordingFeed, ChannelView } from '../components/LiveRecordings';
import { PaySheet, CodesSheet } from '../components/LivePay';
import { tr, LOCALE } from '../i18n';

const BRAND = '#3D5A80';
const RED   = '#ef4444';

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatScheduled(iso) {
  if (!iso) return tr('Sin programar');
  const d = new Date(iso);
  return d.toLocaleString(LOCALE, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function statusLabel(status) {
  if (status === 'live')      return { text: '● EN VIVO',    color: RED,     bg: '#fee2e2' };
  if (status === 'ended')     return { text: tr('Finalizado'),   color: '#94a3b8', bg: '#f1f5f9' };
  return                             { text: tr('Programado'),   color: BRAND,    bg: '#E3EDF2' };
}

const visibilityLabel = (d) => (d.contacts?.length ? tr('{n} contactos', { n: d.contacts.length }) : tr('Mis contactos'));

// ── Componente principal ──────────────────────────────────────────────────────
export default function DirectoPage() {
  const navigate   = useNavigate();
  const { user }   = useAuthStore();
  const [canCreate, setCanCreate] = useState(false);
  const [tab, setTab]             = useState('live');      // live | recordings | mine

  const [directos, setDirectos]     = useState([]);
  const [loading,  setLoading]      = useState(true);
  const [showForm, setShowForm]     = useState(false);
  const [editing,  setEditing]      = useState(null); // directo being edited
  const [error,    setError]        = useState('');

  const [recs, setRecs]               = useState([]);
  const [recsLoading, setRecsLoading] = useState(false);
  const [feed, setFeed]               = useState(null);    // { list, index } reproductor a pantalla completa
  const [channel, setChannel]         = useState(null);    // userId del canal abierto
  const [paying, setPaying]           = useState(null);    // directo de pago que quiero ver
  const [codesFor, setCodesFor]       = useState(null);    // directo mío del que gestiono los códigos

  useEffect(() => { getPermissions().then(p => setCanCreate(!!p.canBroadcast)).catch(() => setCanCreate(false)); }, []);

  const loadDirectos = useCallback(async () => {
    try { setDirectos(await listDirectos()); }
    catch (err) { console.warn('[DirectoPage] load error:', err.message); }
    finally { setLoading(false); }
  }, []);

  const loadRecs = useCallback(async () => {
    setRecsLoading(true);
    try { setRecs((await listRecordings()).recordings || []); }
    catch { setRecs([]); }
    finally { setRecsLoading(false); }
  }, []);

  useEffect(() => {
    loadDirectos();
    // Refrescar la lista cuando alguien empieza un directo (servidor RTC propio)
    const off = onRtc('live:started', () => loadDirectos());
    const t = setInterval(loadDirectos, 20000);
    return () => { off(); clearInterval(t); };
  }, []);
  useEffect(() => { if (tab === 'recordings') loadRecs(); }, [tab]);

  // "En directo ahora": primero se elige si es gratis o de pago (para mis contactos) y se empieza a emitir al instante
  const [quickLive, setQuickLive] = useState(false);
  const [goingLive, setGoingLive] = useState(false);
  const goLiveNow = async (price) => {
    if (goingLive) return;
    setGoingLive(true);
    setError('');
    try {
      const d = await saveDirecto(null, { title: tr('Directo de {p0}', { p0: user.name || 'OldFace' }), visibility: 'contacts', price });
      setQuickLive(false);
      navigate(`/directo/${d.id}/live`);
    } catch (e) {
      setError(e.message || tr('No se pudo crear el directo. Inténtalo de nuevo.'));
      setQuickLive(false);
    } finally {
      setGoingLive(false);
    }
  };

  /** Ver un directo: si es de pago y no lo tengo, primero pagar o canjear un código */
  const watch = (d) => (d.locked ? setPaying(d) : navigate(`/directo/${d.id}/live`));

  const handleDelete = async (id) => {
    if (!window.confirm(tr('¿Eliminar este directo?'))) return;
    try { await deleteDirecto(id); setDirectos(prev => prev.filter(d => d.id !== id)); }
    catch (e) { setError(e.message); }
  };

  const handleGoLive = async (directo) => {
    try {
      const updated = await saveDirecto(directo.id, { status: 'live' });
      setDirectos(prev => prev.map(d => d.id === updated.id ? updated : d));
      navigate(`/directo/${directo.id}/live`);
    } catch (e) { setError(e.message); }
  };

  const handleEnd = async (directo) => {
    try {
      const updated = await saveDirecto(directo.id, { status: 'ended' });
      setDirectos(prev => prev.map(d => d.id === updated.id ? updated : d));
    } catch (e) { setError(e.message); }
  };

  const tabs = [['live', tr('Directos')], ['recordings', tr('Grabaciones')], ...(canCreate ? [['mine', tr('Mi canal')]] : [])];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: '#f8fafc' }}>

      {/* Header */}
      <div style={{
        background: RED, color: 'white', flexShrink: 0,
        paddingTop: 'var(--sat)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px 10px' }}>
          <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 19l-7-7 7-7"/>
            </svg>
          </button>

          {/* Antena pulsante */}
          <div style={{ position: 'relative', width: 36, height: 36 }}>
            <div style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              background: 'rgba(255,255,255,0.3)',
              animation: 'pulse 1.8s ease-in-out infinite',
            }}/>
            <div style={{
              position: 'relative', width: 36, height: 36, borderRadius: '50%',
              background: 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <img src="/emblema-directos.png" alt="" style={{ width: 26, height: 26, objectFit: 'contain' }} />
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 18, fontWeight: 900, margin: 0, lineHeight: 1.1 }}>{tr('DIRECTO')}</h1>
            <p style={{ fontSize: 11, margin: 0, opacity: 0.8 }}>
              {canCreate ? tr('Crea y gestiona tus directos') : tr('Directos disponibles')}
            </p>
          </div>

          {canCreate && tab === 'live' && (
            <button
              onClick={() => { setEditing(null); setShowForm(true); }}
              style={{
                background: 'rgba(255,255,255,0.25)', border: 'none', borderRadius: 20,
                padding: '6px 14px', color: 'white', fontWeight: 800, fontSize: 13, cursor: 'pointer',
              }}
            >{tr('+ Nuevo')}</button>
          )}
        </div>

        {/* Pestañas */}
        <div style={{ display: 'flex', gap: 4, padding: '0 10px' }}>
          {tabs.map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{
              flex: 1, background: 'none', border: 'none', color: 'white', cursor: 'pointer',
              padding: '8px 4px 10px', fontSize: 13, fontWeight: tab === key ? 900 : 600, opacity: tab === key ? 1 : 0.75,
              borderBottom: `3px solid ${tab === key ? 'white' : 'transparent'}`,
            }}>{label}</button>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100% { transform: scale(1); opacity:0.6 } 50% { transform: scale(1.5); opacity:0 } }
        @keyframes spin { to { transform: rotate(360deg) } }
      `}</style>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
        {error && (
          <p style={{ fontSize: 12, color: RED, background: '#fee2e2', padding: '10px 14px', borderRadius: 10, margin: '0 12px 12px' }}>{error}</p>
        )}

        {/* ── Directos ── */}
        {tab === 'live' && (
          <>
            {canCreate && (
              <button onClick={() => setQuickLive(true)} disabled={goingLive} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                width: 'calc(100% - 24px)', margin: '0 12px 14px', padding: '16px',
                background: `linear-gradient(135deg, ${RED}, #ec4899)`, color: 'white', border: 'none',
                borderRadius: 18, fontSize: 16, fontWeight: 900, cursor: 'pointer',
                boxShadow: '0 6px 20px rgba(239,68,68,0.35)', opacity: goingLive ? 0.7 : 1,
              }}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', background: 'white', animation: 'pulse 1.4s ease-in-out infinite' }} />
                {goingLive ? tr('Preparando…') : tr('En directo ahora')}
              </button>
            )}
            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  border: `3px solid #fecaca`, borderTopColor: RED,
                  animation: 'spin 0.8s linear infinite',
                }}/>
              </div>
            )}

            {!loading && directos.length === 0 && (
              <div style={{ textAlign: 'center', padding: '60px 24px', color: '#94a3b8' }}>
                <img src="/emblema-directos.png" alt="" style={{ width: 64, height: 64, objectFit: 'contain', margin: '0 auto 16px', display: 'block', opacity: 0.45 }} />
                <p style={{ fontWeight: 700, fontSize: 15, color: '#64748b', margin: '0 0 6px' }}>
                  {canCreate ? tr('Ningún directo creado') : tr('No hay directos disponibles')}
                </p>
                <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>
                  {canCreate ? tr('Pulsa "+ Nuevo" para crear tu primer directo') : tr('Mira las grabaciones de los directos anteriores en "Grabaciones"')}
                </p>
              </div>
            )}

            {!loading && directos.map(d => (
              <DirectoCard
                key={d.id}
                directo={d}
                canManage={canCreate && d.creatorId === user?.id}
                onEdit={() => { setEditing(d); setShowForm(true); }}
                onDelete={() => handleDelete(d.id)}
                onGoLive={() => handleGoLive(d)}
                onEnd={() => handleEnd(d)}
                onWatch={() => watch(d)}
                onPay={() => setPaying(d)}
                onCodes={() => setCodesFor(d)}
                onOpenChannel={() => setChannel(d.creatorId)}
              />
            ))}
          </>
        )}

        {/* ── Grabaciones de todos los canales que puedo ver (2 columnas, 9:16) ── */}
        {tab === 'recordings' && (
          <RecordingsGrid recordings={recs} loading={recsLoading}
            emptyText={tr('Todavía no hay grabaciones de directos')}
            onOpen={(list, index) => setFeed({ list, index })} />
        )}

        {/* ── Mi canal ── */}
        {tab === 'mine' && user?.id && <ChannelView ownerId={user.id} embedded />}
      </div>

      {/* Modal crear/editar */}
      {showForm && (
        <DirectoForm
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={(d) => {
            setDirectos(prev => {
              const idx = prev.findIndex(x => x.id === d.id);
              return idx >= 0 ? prev.map(x => x.id === d.id ? d : x) : [d, ...prev];
            });
            setShowForm(false);
            setEditing(null);
          }}
        />
      )}

      {quickLive && <QuickLiveSheet busy={goingLive} onClose={() => setQuickLive(false)} onChoose={goLiveNow} />}
      {feed && <RecordingFeed recordings={feed.list} startIndex={feed.index} onClose={() => setFeed(null)}
        onOpenChannel={(id) => { setFeed(null); setChannel(id); }}
        onChanged={(r) => setRecs(l => l.map(x => (x.id === r.id ? r : x)))} />}
      {channel && <ChannelView ownerId={channel} onClose={() => setChannel(null)} />}
      {paying && <PaySheet kind="directo" id={paying.id} price={paying.price} title={paying.title} ownerName={paying.creatorName}
        onClose={() => setPaying(null)}
        onUnlocked={() => { const d = paying; setPaying(null); loadDirectos(); if (d.status === 'live') navigate(`/directo/${d.id}/live`); }} />}
      {codesFor && <CodesSheet directo={codesFor} onClose={() => setCodesFor(null)} />}
    </div>
  );
}

// ── "En directo ahora": ¿gratis o de pago? (siempre solo para mis contactos) ──
function QuickLiveSheet({ busy, onClose, onChoose }) {
  useBackClose(true, onClose);
  const [paid, setPaid]   = useState(false);
  const [price, setPrice] = useState('3');
  const option = (isPaid, title, sub) => (
    <button onClick={() => setPaid(isPaid)} disabled={busy} style={{
      display: 'block', width: '100%', textAlign: 'left', padding: '14px 16px', marginBottom: 10,
      background: paid === isPaid ? '#fee2e2' : '#f8fafc', border: `1.5px solid ${paid === isPaid ? RED : '#e2e8f0'}`, borderRadius: 14, cursor: 'pointer',
    }}>
      <span style={{ display: 'block', fontSize: 15, fontWeight: 900, color: '#293241' }}>{title}</span>
      <span style={{ fontSize: 12, color: '#64748b' }}>{sub}</span>
    </button>
  );
  const value = Number(String(price).replace(',', '.')) || 0;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', background: 'white', borderRadius: '24px 24px 0 0', padding: '18px 16px calc(18px + env(safe-area-inset-bottom, 0px))', boxSizing: 'border-box' }}>
        <h2 style={{ fontSize: 16, fontWeight: 900, color: '#293241', margin: '0 0 4px' }}>{tr('Tu directo para tus contactos')}</h2>
        <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 14px' }}>{tr('Solo lo ven tus contactos. Se graba solo y al terminar queda en tu canal con las mismas condiciones.')}</p>
        {option(false, tr('Gratis'), tr('Todos tus contactos pueden verlo y reciben el aviso'))}
        {option(true, tr('De pago'), tr('Tus contactos pagan para verlo (o usan un código que les envíes)'))}
        {paid && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0 12px' }}>
            <input value={price} onChange={e => setPrice(e.target.value)} inputMode="decimal" style={{ ...inputStyle, width: 100 }} />
            <span style={{ fontSize: 12, color: '#64748b' }}>{tr('€ por persona (de 1 a 200 €)')}</span>
          </div>
        )}
        <button onClick={() => onChoose(paid ? value : 0)} disabled={busy || (paid && !(value >= 1 && value <= 200))} style={{
          width: '100%', padding: 15, border: 'none', borderRadius: 14, background: RED, color: 'white', fontSize: 15, fontWeight: 900, cursor: 'pointer',
          opacity: busy || (paid && !(value >= 1 && value <= 200)) ? 0.6 : 1,
        }}>{busy ? tr('Preparando…') : paid ? tr('Empezar directo · {p0}', { p0: formatMoney(value) }) : tr('Empezar directo gratis')}</button>
      </div>
    </div>
  );
}

// ── Tarjeta de directo ────────────────────────────────────────────────────────
function DirectoCard({ directo: d, canManage, onEdit, onDelete, onGoLive, onEnd, onWatch, onPay, onCodes, onOpenChannel }) {
  const st = statusLabel(d.status);

  const handleShare = async () => {
    const when = d.scheduledAt ? tr('\nCuándo: {p0}', { p0: formatScheduled(d.scheduledAt) }) : '';
    const price = d.price > 0 ? tr('\nPrecio: {price}€', { price: d.price }) : `\n${tr('Gratis')}`;
    const link = `https://oldface.app/directo/${d.id}/live`;
    const text = `${d.title}${d.description ? ' — ' + d.description : ''}${when}${price}\n${link}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: d.title, text, url: link });
      } else {
        // Fallback: abrir WhatsApp con el texto
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
      }
    } catch { /* cancelled */ }
  };
  return (
    <div style={{
      margin: '0 12px 10px', background: 'white', borderRadius: 16,
      boxShadow: '0 1px 6px rgba(0,0,0,0.07)', overflow: 'hidden',
    }}>
      {/* Franja de estado */}
      <div style={{ background: d.status === 'live' ? RED : d.status === 'ended' ? '#f1f5f9' : '#E3EDF2', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: d.status === 'live' ? 'white' : st.color, letterSpacing: '0.5px' }}>{st.text}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: d.status === 'live' ? 'white' : '#64748b', opacity: 0.9 }}>· {visibilityLabel(d)}</span>
        {d.price > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, color: '#293241', background: '#fef9c3', borderRadius: 20, padding: '2px 8px' }}>
            {d.locked ? '🔒 ' : ''}{formatMoney(d.price)}{' '}{tr('/ acceso')}</span>
        )}
      </div>

      <div style={{ padding: '12px 14px' }}>
        <p style={{ fontSize: 15, fontWeight: 900, color: '#293241', margin: '0 0 4px' }}>{d.title}</p>
        {!canManage && d.creatorName && (
          <button onClick={onOpenChannel} style={{ background: 'none', border: 'none', padding: 0, margin: '0 0 4px', color: BRAND, fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
            {d.creatorName} ›
          </button>
        )}
        {d.description && (
          <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 8px' }}>{d.description}</p>
        )}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            {formatScheduled(d.scheduledAt)}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {/* Botones del creador */}
          {canManage && d.status === 'scheduled' && (
            <button onClick={onGoLive} style={btnStyle(RED, 'white')}>{tr('● Iniciar ahora')}</button>
          )}
          {canManage && d.status === 'live' && (
            <>
              <button onClick={onGoLive} style={btnStyle(RED, 'white')}>{tr('● Volver al directo')}</button>
              <button onClick={onEnd} style={btnStyle('#64748b', 'white')}>{tr('Finalizar')}</button>
            </>
          )}
          {canManage && d.status !== 'live' && (
            <button onClick={onEdit} style={btnStyle('#e2e8f0', '#293241')}>{tr('Editar')}</button>
          )}
          {canManage && d.price > 0 && (
            <button onClick={onCodes} style={btnStyle('#fef9c3', '#293241')}>🎟️ {tr('Códigos')}</button>
          )}
          {canManage && (
            <button onClick={onDelete} style={btnStyle('#fee2e2', RED)}>{tr('Eliminar')}</button>
          )}

          {/* Botones para la audiencia */}
          {!canManage && d.status === 'live' && (
            <button onClick={onWatch} style={btnStyle(RED, 'white')}>
              {d.locked ? `🔒 ${tr('Ver por {p0}', { p0: formatMoney(d.price) })}` : tr('● Ver directo')}
            </button>
          )}
          {!canManage && d.status === 'scheduled' && d.locked && (
            <button onClick={onPay} style={btnStyle(RED, 'white')}>{tr('Comprar entrada · {p0}', { p0: formatMoney(d.price) })}</button>
          )}
          {!canManage && d.price > 0 && !d.locked && d.status !== 'ended' && (
            <span style={{ fontSize: 11, color: '#15803d', padding: '6px 0', fontWeight: 800 }}>✓ {tr('Tienes acceso')}</span>
          )}
          {!canManage && d.status === 'scheduled' && (
            <button onClick={handleShare} style={btnStyle(BRAND, 'white')}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/>
                </svg>{tr('Compartir')}</span>
            </button>
          )}
          {!canManage && d.status === 'ended' && (
            <span style={{ fontSize: 11, color: '#94a3b8', padding: '6px 0', fontWeight: 600 }}>{tr('Este directo ha finalizado')}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function btnStyle(bg, color) {
  return {
    background: bg, color, border: 'none', borderRadius: 20,
    padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  };
}

// ── Formulario crear / editar directo ─────────────────────────────────────────
function DirectoForm({ initial, onClose, onSaved }) {
  const { contacts, loadContacts } = useContacts();
  useBackClose(true, onClose);

  const [title,       setTitle]       = useState(initial?.title       || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [scheduledAt, setScheduledAt] = useState(
    initial?.scheduledAt ? new Date(initial.scheduledAt).toISOString().slice(0, 16) : ''
  );
  const [price,       setPrice]       = useState(initial?.price       ?? 0);
  // Siempre solo para mis contactos (todos o los que elija)
  const visibility = 'contacts';
  const [selected,    setSelected]    = useState(new Set(initial?.contacts || []));
  // Sin contactos elegidos = lo ven todos mis contactos (nunca nadie más)
  const [shareAll,    setShareAll]    = useState(!initial?.contacts?.length);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');

  useEffect(() => { loadContacts(); }, []);

  const toggleContact = (phone) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(phone) ? n.delete(phone) : n.add(phone);
      return n;
    });
  };

  const handleSave = async () => {
    if (!title.trim()) { setError(tr('El nombre del directo es obligatorio')); return; }
    if (!shareAll && selected.size === 0) { setError(tr('Elige al menos un contacto')); return; }
    const p = Number(String(price).replace(',', '.')) || 0;
    if (p < 0 || (p > 0 && (p < 1 || p > 200))) { setError(tr('El precio debe ser 0 (gratis) o de 1 a 200 €')); return; }
    setSaving(true);
    setError('');
    try {
      onSaved(await saveDirecto(initial?.id || null, {
        title:       title.trim(),
        description: description.trim(),
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        visibility,
        contacts:    !shareAll ? [...selected] : [],
        price:       Number(String(price).replace(',', '.')) || 0,
      }));
    } catch (e) {
      setError(e.message || tr('Error guardando el directo'));
    } finally {
      setSaving(false);
    }
  };

  const oldFaceContacts = contacts.filter(c => c.usesOldFace);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60,
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'flex-end',
    }}>
      <div style={{
        width: '100%', background: 'white', borderRadius: '24px 24px 0 0',
        maxHeight: '92vh', overflowY: 'auto',
        paddingBottom: 'env(safe-area-inset-bottom, 24px)',
      }}>
        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
          <div style={{ width: 40, height: 4, background: '#cbd5e1', borderRadius: 2 }}/>
        </div>

        {/* Title bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 16px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/emblema-directos.png" alt="" style={{ width: 32, height: 32, objectFit: 'contain' }} />
            <h2 style={{ fontSize: 16, fontWeight: 900, color: '#293241', margin: 0 }}>
              {initial ? tr('Editar directo') : tr('Nuevo directo')}
            </h2>
          </div>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', borderRadius: '50%', width: 30, height: 30, cursor: 'pointer', fontSize: 16, fontWeight: 800, color: '#64748b' }}>
            ✕
          </button>
        </div>

        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Nombre */}
          <Field label={tr('Nombre del directo *')}>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={tr('Ej: Clase de cocina en vivo')}
              maxLength={120}
              style={inputStyle}
            />
          </Field>

          {/* Descripción */}
          <Field label={tr('Descripción')}>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={tr('Cuéntales de qué va...')}
              rows={3}
              maxLength={1000}
              style={{ ...inputStyle, resize: 'none' }}
            />
          </Field>

          {/* Fecha y hora */}
          <Field label={tr('Fecha y hora de inicio')}>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
              style={inputStyle}
            />
          </Field>

          {/* Precio */}
          <Field label={tr('Precio de acceso (€)')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="number"
                min="0"
                step="0.50"
                value={price}
                onChange={e => setPrice(e.target.value)}
                style={{ ...inputStyle, width: 100 }}
              />
              <span style={{ fontSize: 12, color: '#64748b' }}>
                {!(Number(String(price).replace(',', '.')) > 0) ? tr('Gratis para tus contactos')
                  : tr('{p0} por persona · mínimo 1 €', { p0: formatMoney(Number(String(price).replace(',', '.'))) })}
              </span>
            </div>
            {Number(String(price).replace(',', '.')) > 0 && (
              <p style={{ fontSize: 11, color: '#94a3b8', margin: '6px 0 0', lineHeight: 1.4 }}>
                {tr('Tus contactos pagan con tarjeta o usan un código que les envíes. Pagar da acceso al directo y a su grabación.')}
              </p>
            )}
          </Field>

          {/* Quién puede verlo: solo contactos */}
          <Field label={tr('Quién puede verlo')}>
            <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 4px' }}>{tr('Solo tus contactos lo verán y recibirán el aviso.')}</p>

            {visibility === 'contacts' && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 12px', margin: '4px 0 8px' }}>
                  <input
                    type="checkbox"
                    checked={shareAll}
                    onChange={e => setShareAll(e.target.checked)}
                    style={{ width: 18, height: 18, accentColor: RED }}
                  />
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 700, color: '#293241', margin: 0 }}>{tr('Todos mis contactos')}</p>
                    <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>{tr('Desmárcalo para elegir solo algunos')}</p>
                  </div>
                </label>

                {!shareAll && (
                  <>
                    {oldFaceContacts.length > 0 && (
                      <>
                        <p style={{ fontSize: 10, fontWeight: 800, color: RED, letterSpacing: '0.5px', margin: '8px 0 4px' }}>{tr('EN OLDFACE')}</p>
                        {oldFaceContacts.map(c => (
                          <ContactCheck
                            key={c.id}
                            contact={c}
                            checked={selected.has(c.phone)}
                            onChange={() => toggleContact(c.phone)}
                          />
                        ))}
                      </>
                    )}
                    {oldFaceContacts.length === 0 && (
                      <p style={{ fontSize: 12, color: '#94a3b8', padding: '8px 0' }}>
                        {contacts.length === 0 ? tr('Los contactos solo están disponibles en la app Android/iOS') : tr('No hay contactos en OldFace todavía')}
                      </p>
                    )}
                  </>
                )}
              </>
            )}
          </Field>

          {error && (
            <p style={{ fontSize: 12, color: RED, background: '#fee2e2', padding: '10px 14px', borderRadius: 10, margin: 0 }}>
              {error}
            </p>
          )}

          {/* Botones */}
          <div style={{ display: 'flex', gap: 10, paddingBottom: 8 }}>
            <button onClick={onClose} style={{ flex: 1, padding: '14px', background: '#f1f5f9', border: 'none', borderRadius: 14, fontWeight: 700, fontSize: 14, cursor: 'pointer', color: '#64748b' }}>{tr('Cancelar')}</button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ flex: 2, padding: '14px', background: saving ? '#fca5a5' : RED, border: 'none', borderRadius: 14, fontWeight: 800, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer', color: 'white', boxShadow: '0 4px 14px rgba(239,68,68,0.35)' }}
            >
              {saving ? tr('Guardando...') : initial ? tr('Guardar cambios') : tr('Crear directo')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-componentes utilitarios ───────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <div>
      <p style={{ fontSize: 11, fontWeight: 800, color: '#64748b', letterSpacing: '0.4px', margin: '0 0 6px' }}>{label.toUpperCase()}</p>
      {children}
    </div>
  );
}

function ContactCheck({ contact, checked, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', cursor: 'pointer', borderBottom: '0.5px solid #f1f5f9' }}>
      <input type="checkbox" checked={checked} onChange={onChange} style={{ width: 16, height: 16, accentColor: RED }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: '#293241', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contact.name}</p>
        <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>{contact.phone}</p>
      </div>
    </label>
  );
}

const inputStyle = {
  width: '100%',
  padding: '11px 14px',
  borderRadius: 12,
  border: '1.5px solid #e2e8f0',
  fontSize: 14,
  color: '#293241',
  background: 'white',
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};
