/**
 * DriverTabs — pestañas del conductor:
 *   Ganancias: hoy / semana / mes, aceptación, monedero, deuda de efectivo, retiradas (IBAN) y movimientos.
 *   Viajes:    historial con lo ganado en cada uno.
 *   Cuenta:    mis datos, vehículos, documentos, incentivos, puntos de cobro, invita y gana, ayuda, preguntas, acerca de.
 */
import React, { useState } from 'react';
import { taxiApi, tx, money, dateTime, taxiUrl } from '../../utils/taxiApi';
import { BRAND, C, Btn, Card, Field, inputStyle } from './ui.jsx';
import { Page, useLoad, Loading, Line, Support, Faqs, About, shareText } from './CustomerTabs.jsx';

const STATUS = {
  completed: ['Completado', '#16a34a'], cancelled: ['Cancelado', '#dc2626'], accepted: ['En curso', '#3D5A80'],
  arrived: ['En curso', '#3D5A80'], started: ['En curso', '#3D5A80'], expired: ['Sin conductor', '#64748b'], searching: ['Buscando', '#3D5A80'],
};
const REVIEW = { pending: ['En revisión', '#f59e0b'], approved: ['Aprobado', '#16a34a'], active: ['Aprobado', '#16a34a'], rejected: ['Rechazado', '#dc2626'],
                 blocked: ['Bloqueado', '#dc2626'], paid: ['Pagado', '#16a34a'] };
const Badge = ({ s }) => {
  const [label, color] = REVIEW[s] || [s, C.muted];
  return <span style={{ fontSize: 12, fontWeight: 800, color, background: `${color}1a`, borderRadius: 8, padding: '3px 8px', whiteSpace: 'nowrap' }}>{tx(label)}</span>;
};

// ══ Ganancias ════════════════════════════════════════════════════════════════
export function EarningsTab({ dash, loadDash, notify, openAccount }) {
  const { data, error, load } = useLoad(() => taxiApi('/driver/wallet'));
  const [f, setF] = useState({ amount: '', accountDetails: '' });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const cur = dash.wallet?.currency || 'EUR';
  const acc = dash.acceptance || {};
  const rate = acc.offers ? Math.round((acc.accepted || 0) / acc.offers * 100) : null;

  const withdraw = async () => {
    setBusy(true);
    try {
      await taxiApi('/driver/withdrawals', { method: 'POST', body: { amount: Number(String(f.amount).replace(',', '.')), accountDetails: f.accountDetails, method: 'bank' } });
      notify(tx('Solicitud de retirada enviada')); setOpen(false); setF({ amount: '', accountDetails: '' }); load(); loadDash();
    } catch (e) { notify(e.message, true); }
    setBusy(false);
  };

  return (
    <Page title={tx('Ganancias')}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginBottom: 12 }}>
        {[['Hoy', dash.today], ['7 días', dash.week], ['30 días', dash.month]].map(([l, s]) => (
          <Card key={l} style={{ padding: 10, textAlign: 'center' }}>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 800, color: C.muted }}>{tx(l)}</span>
            <span style={{ display: 'block', fontSize: 17, fontWeight: 900 }}>{money(s?.earnings, cur)}</span>
            <span style={{ display: 'block', fontSize: 11, color: C.muted }}>{tx((s?.trips || 0) === 1 ? '1 viaje' : '{n} viajes', { n: s?.trips || 0 })}</span>
          </Card>
        ))}
      </div>
      {rate !== null && <Card style={{ marginBottom: 12 }}><Line label={tx('Tasa de aceptación (30 días)')} value={`${rate}%`} bold /></Card>}

      <div style={{ background: `linear-gradient(135deg, ${BRAND}, #293241)`, color: 'white', borderRadius: 20, padding: 18, marginBottom: 12 }}>
        <p style={{ margin: 0, opacity: 0.8, fontWeight: 700, fontSize: 13 }}>{tx('Saldo del monedero')}</p>
        <p style={{ margin: '4px 0 0', fontSize: 32, fontWeight: 900 }}>{money(dash.wallet?.balance, cur)}</p>
        {Number(dash.driver.debt) > 0 && <p style={{ margin: '6px 0 0', fontSize: 13, fontWeight: 700, color: '#fde68a' }}>{tx('Deuda de viajes en efectivo')}: {money(dash.driver.debt, cur)}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={() => setOpen(v => !v)} style={{ flex: 1, background: 'white', color: BRAND, border: 'none', borderRadius: 12, padding: 10, fontWeight: 800, cursor: 'pointer' }}>{tx('Retirar dinero')}</button>
          <button onClick={() => openAccount('cash')} style={{ flex: 1, background: 'rgba(255,255,255,0.15)', color: 'white', border: 'none', borderRadius: 12, padding: 10, fontWeight: 800, cursor: 'pointer' }}>{tx('Puntos de cobro')}</button>
        </div>
      </div>

      {open && (
        <Card style={{ marginBottom: 12 }}>
          <Field label={tx('Importe')}><input style={inputStyle} value={f.amount} onChange={e => setF(v => ({ ...v, amount: e.target.value }))} inputMode="decimal" placeholder="0,00" /></Field>
          <Field label={tx('Cuenta (IBAN y titular)')}><input style={inputStyle} value={f.accountDetails} onChange={e => setF(v => ({ ...v, accountDetails: e.target.value }))} maxLength={200} placeholder="ES00 0000 0000 0000 0000 0000" /></Field>
          <Btn onClick={withdraw} disabled={busy || !f.amount || !f.accountDetails.trim()}>{tx('Solicitar retirada')}</Btn>
        </Card>
      )}

      {!data ? <Loading error={error} retry={load} /> : (
        <>
          {data.withdrawals.length > 0 && (
            <>
              <p style={{ fontWeight: 900, margin: '4px 4px 8px' }}>{tx('Retiradas')}</p>
              <Card style={{ padding: '4px 14px', marginBottom: 12 }}>
                {data.withdrawals.map(w => (
                  <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: `1px solid ${C.line}` }}>
                    <span><span style={{ display: 'block', fontWeight: 800 }}>{money(w.amount, cur)}</span><span style={{ fontSize: 12, color: C.muted }}>{dateTime(w.created_at)}</span></span>
                    <Badge s={w.status} />
                  </div>
                ))}
              </Card>
            </>
          )}
          <p style={{ fontWeight: 900, margin: '4px 4px 8px' }}>{tx('Movimientos')}</p>
          {!data.transactions.length ? <p style={{ color: C.muted, margin: '0 4px' }}>{tx('Sin movimientos todavía')}</p> : (
            <Card style={{ padding: '4px 14px' }}>
              {data.transactions.map(t => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 0', borderBottom: `1px solid ${C.line}` }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>{t.description || t.type}</span>
                    <span style={{ display: 'block', color: C.muted, fontSize: 12 }}>{dateTime(t.created_at)}</span>
                  </span>
                  <span style={{ fontWeight: 900, color: t.type === 'debit' ? C.danger : C.ok, whiteSpace: 'nowrap' }}>{t.type === 'debit' ? '−' : '+'}{money(Math.abs(t.amount), cur)}</span>
                </div>
              ))}
            </Card>
          )}
        </>
      )}
    </Page>
  );
}

// ══ Viajes ═══════════════════════════════════════════════════════════════════
export function DriverTripsTab() {
  const { data, error, load } = useLoad(() => taxiApi('/driver/bookings'));
  return (
    <Page title={tx('Mis viajes')}>
      {!data ? <Loading error={error} retry={load} /> : !data.bookings.length ? (
        <p style={{ color: C.muted, textAlign: 'center', marginTop: 40 }}>🧾<br />{tx('Todavía no has hecho ningún viaje')}</p>
      ) : data.bookings.map(b => (
        <Card key={b.code} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>{dateTime(b.created_at)} · {b.ride_type}</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: STATUS[b.status]?.[1] || C.muted }}>{tx(STATUS[b.status]?.[0] || b.status)}</span>
          </div>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🟢 {b.pickup_address}</p>
          <p style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🟦 {b.dropoff_address}</p>
          {b.status === 'completed' && (
            <p style={{ margin: '6px 0 0', fontSize: 13, textAlign: 'right', color: C.muted }}>
              {tx('Total')} {money(b.total_amount, b.currency)} · <b style={{ color: C.ok, fontSize: 15 }}>{tx('Ganado')} {money(b.driver_earning, b.currency)}</b>
            </p>
          )}
        </Card>
      ))}
    </Page>
  );
}

// ══ Cuenta ═══════════════════════════════════════════════════════════════════
export function AccountTab({ boot, dash, loadDash, notify, reload, onExit, sub, setSub }) {
  const d = dash.driver;
  const back = () => { setSub(null); loadDash(); };
  if (sub === 'data') return <DriverProfile boot={boot} dash={dash} notify={notify} reload={reload} onBack={back} />;
  if (sub === 'vehicles') return <Vehicles notify={notify} onBack={back} />;
  if (sub === 'documents') return <Documents notify={notify} onBack={back} />;
  if (sub === 'incentives') return <Incentives dash={dash} onBack={back} />;
  if (sub === 'cash') return <CashPoints dash={dash} onBack={back} />;
  if (sub === 'invite') return <DriverInvite boot={boot} onBack={back} />;
  if (sub === 'support') return <Support notify={notify} onBack={back} />;
  if (sub === 'faq') return <Faqs onBack={back} />;
  if (sub === 'about') return <About boot={boot} onBack={back} />;

  const item = (key, icon, label, onClick) => (
    <button key={key} onClick={onClick || (() => setSub(key))} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 4px', background: 'none', border: 'none',
      borderBottom: `1px solid ${C.line}`, cursor: 'pointer', textAlign: 'left', fontSize: 15, fontWeight: 700, color: C.text }}>
      <span style={{ flex: 1, paddingLeft: 8 }}>{label}</span><span style={{ color: '#94a3b8' }}>›</span>
    </button>
  );

  return (
    <Page title={tx('Cuenta')}>
      <Card style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
        <span style={{ width: 58, height: 58, borderRadius: '50%', background: '#D5E6F0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, overflow: 'hidden', flexShrink: 0 }}>
          {d.photo ? <img src={taxiUrl(d.photo)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🧑‍✈️'}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 900, fontSize: 18 }}>{d.name}</span>
          <span style={{ display: 'block', color: C.muted, fontSize: 13 }}>{tx('Conductor')} · ★ {Number(d.rating || 5).toFixed(1)} ({d.rating_count || 0})</span>
        </span>
        <Badge s={d.verified && d.status === 'active' ? 'active' : d.status === 'blocked' ? 'blocked' : 'pending'} />
      </Card>
      <Card style={{ padding: '0 12px' }}>
        {item('data', '👤', tx('Mis datos e idioma'))}
        {item('vehicles', '🚗', tx('Vehículos'))}
        {item('documents', '📄', tx('Documentos'))}
        {item('incentives', '🏆', tx('Incentivos'))}
        {item('cash', '🏧', tx('Puntos de cobro'))}
        {item('invite', '🎁', tx('Invita y gana'))}
        {item('support', '💬', tx('Ayuda y soporte'))}
        {item('faq', '❓', tx('Preguntas frecuentes'))}
        {item('about', 'ℹ️', tx('Acerca de'))}
        {item('exit', '🚪', tx('Salir del taxi'), onExit)}
      </Card>
    </Page>
  );
}

function DriverProfile({ boot, dash, notify, reload, onBack }) {
  const d = dash.driver;
  const [f, setF] = useState({ name: d.name || '', email: d.email || '', phone: d.phone || '', language: d.language || 'es' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF(v => ({ ...v, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    try { await taxiApi('/driver/profile', { method: 'PUT', body: f }); notify(tx('Datos guardados')); await reload(); }
    catch (e) { notify(e.message, true); }
    setBusy(false);
  };
  return (
    <Page title={tx('Mis datos')} onBack={onBack}>
      <Card>
        <p style={{ fontSize: 12, color: C.muted, margin: '0 0 12px' }}>{tx('La foto es la de tu perfil de OldFace (cámbiala en Ajustes).')}</p>
        <Field label={tx('Nombre')}><input style={inputStyle} value={f.name} onChange={set('name')} maxLength={80} /></Field>
        <Field label={tx('Email')}><input style={inputStyle} value={f.email} onChange={set('email')} type="email" maxLength={120} /></Field>
        <Field label={tx('Teléfono')}><input style={inputStyle} value={f.phone} onChange={set('phone')} inputMode="tel" maxLength={30} /></Field>
        <Field label={tx('Idioma')}>
          <select style={inputStyle} value={f.language} onChange={set('language')}>
            {boot.languages.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </Field>
      </Card>
      <Btn onClick={save} disabled={busy || !f.name.trim()} style={{ marginTop: 16 }}>{busy ? tx('Guardando…') : tx('Guardar')}</Btn>
    </Page>
  );
}

/** Elegir un archivo y subirlo al servidor del taxi → URL /taxi/files/… */
function FilePick({ accept = 'image/*,application/pdf', value, onUploaded, notify, label }) {
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) { notify(tx('El archivo es demasiado grande (máximo 12 MB)'), true); return; }
    setBusy(true);
    try { const { url } = await taxiApi('/upload', { method: 'POST', raw: file }); onUploaded(url); }
    catch (err) { notify(err.message, true); }
    setBusy(false);
  };
  const isImg = value && !/\.pdf$/i.test(value);
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
      {value ? (isImg ? <img src={taxiUrl(value)} alt="" style={{ width: 56, height: 56, borderRadius: 10, objectFit: 'cover' }} /> : <span style={{ fontSize: 34 }}>📄</span>) : null}
      <span style={{ background: '#D5E6F0', color: BRAND, borderRadius: 10, padding: '9px 12px', fontWeight: 800, fontSize: 14 }}>
        {busy ? tx('Subiendo…') : value ? tx('Cambiar archivo') : (label || tx('Elegir archivo'))}
      </span>
      <input type="file" accept={accept} onChange={pick} style={{ display: 'none' }} disabled={busy} />
    </label>
  );
}

function Vehicles({ notify, onBack }) {
  const { data, error, load } = useLoad(async () => {
    const [v, r] = await Promise.all([taxiApi('/driver/vehicles'), taxiApi('/driver/ride-types')]);
    return { vehicles: v.vehicles, rideTypes: r.rideTypes };
  });
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ rideTypeId: '', brand: '', model: '', color: '', plate: '', year: '', seats: '4', photo: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF(v => ({ ...v, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    try { await taxiApi('/driver/vehicles', { method: 'POST', body: f }); notify(tx('Vehículo enviado para revisión')); setAdding(false); load(); }
    catch (e) { notify(e.message, true); }
    setBusy(false);
  };
  return (
    <Page title={tx('Vehículos')} onBack={onBack}>
      {!data ? <Loading error={error} retry={load} /> : (
        <>
          {data.vehicles.map(v => (
            <Card key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              {v.photo ? <img src={taxiUrl(v.photo)} alt="" style={{ width: 56, height: 42, borderRadius: 8, objectFit: 'cover' }} /> : <span style={{ fontSize: 30 }}>🚗</span>}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 900 }}>{v.plate}</span>
                <span style={{ display: 'block', fontSize: 13, color: C.muted }}>{[v.brand, v.model, v.color, v.year].filter(Boolean).join(' · ')} · {v.ride_type}</span>
              </span>
              <Badge s={v.status} />
            </Card>
          ))}
          {!adding ? <Btn onClick={() => setAdding(true)} style={{ marginTop: 6 }}>＋ {tx('Añadir vehículo')}</Btn> : (
            <Card style={{ marginTop: 6 }}>
              <Field label={tx('Tipo de viaje')}>
                <select style={inputStyle} value={f.rideTypeId} onChange={set('rideTypeId')}>
                  <option value="">{tx('Elige un tipo')}</option>
                  {data.rideTypes.map(r => <option key={r.id} value={r.id}>{r.name} ({r.seats} {tx('plazas')})</option>)}
                </select>
              </Field>
              <Field label={tx('Matrícula')}><input style={{ ...inputStyle, textTransform: 'uppercase' }} value={f.plate} onChange={set('plate')} maxLength={20} /></Field>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 8 }}>
                <Field label={tx('Marca')}><input style={inputStyle} value={f.brand} onChange={set('brand')} maxLength={40} /></Field>
                <Field label={tx('Modelo')}><input style={inputStyle} value={f.model} onChange={set('model')} maxLength={40} /></Field>
                <Field label={tx('Color')}><input style={inputStyle} value={f.color} onChange={set('color')} maxLength={30} /></Field>
                <Field label={tx('Año')}><input style={inputStyle} value={f.year} onChange={set('year')} inputMode="numeric" maxLength={4} /></Field>
              </div>
              <Field label={tx('Plazas')}><input style={inputStyle} value={f.seats} onChange={set('seats')} inputMode="numeric" maxLength={2} /></Field>
              <Field label={tx('Foto del vehículo (opcional)')}><FilePick accept="image/*" value={f.photo} onUploaded={(url) => setF(v => ({ ...v, photo: url }))} notify={notify} /></Field>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn variant="ghost" onClick={() => setAdding(false)} style={{ flex: 1 }}>{tx('Cancelar')}</Btn>
                <Btn onClick={save} disabled={busy || !f.plate.trim() || !f.rideTypeId} style={{ flex: 1 }}>{tx('Guardar')}</Btn>
              </div>
            </Card>
          )}
        </>
      )}
    </Page>
  );
}

function Documents({ notify, onBack }) {
  const { data, error, load } = useLoad(async () => {
    const [t, d] = await Promise.all([taxiApi('/driver/document-types'), taxiApi('/driver/documents')]);
    return { types: t.documentTypes, docs: d.documents };
  });
  const [editing, setEditing] = useState(null);   // id del tipo que se está enviando
  const [f, setF] = useState({ fileUrl: '', number: '', expiresAt: '' });
  const [busy, setBusy] = useState(false);
  const send = async (typeId) => {
    setBusy(true);
    try {
      await taxiApi('/driver/documents', { method: 'POST', body: { documentTypeId: typeId, fileUrl: f.fileUrl, number: f.number || undefined, expiresAt: f.expiresAt || undefined } });
      notify(tx('Documento enviado para revisión')); setEditing(null); setF({ fileUrl: '', number: '', expiresAt: '' }); load();
    } catch (e) { notify(e.message, true); }
    setBusy(false);
  };
  return (
    <Page title={tx('Documentos')} onBack={onBack}>
      {!data ? <Loading error={error} retry={load} /> : data.types.map(t => {
        const last = data.docs.find(d => d.document_type_id === t.id);     // el más reciente (vienen ordenados)
        const open = editing === t.id;
        return (
          <Card key={t.id} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 900 }}>{t.name}{t.required ? ' *' : ''}</span>
                <span style={{ display: 'block', fontSize: 12, color: C.muted }}>
                  {last ? `${tx('Enviado')} ${dateTime(last.created_at)}${last.expires_at ? ` · ${tx('caduca')} ${last.expires_at}` : ''}` : tx('Sin enviar')}
                </span>
                {last?.status === 'rejected' && last.note && <span style={{ display: 'block', fontSize: 12, color: C.danger, fontWeight: 700 }}>{last.note}</span>}
              </span>
              {last ? <Badge s={last.status} /> : null}
              {!open && (!last || last.status === 'rejected' || !!t.has_expiry) && (
                <button onClick={() => { setEditing(t.id); setF({ fileUrl: '', number: '', expiresAt: '' }); }} style={{ background: last ? '#D5E6F0' : BRAND, color: last ? BRAND : 'white', border: 'none', borderRadius: 10, padding: '8px 10px', fontWeight: 800, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>
                  {last ? tx('Actualizar') : tx('Subir')}
                </button>
              )}
            </div>
            {open && (
              <div style={{ marginTop: 12 }}>
                <Field label={tx('Foto o PDF del documento')}><FilePick value={f.fileUrl} onUploaded={(url) => setF(v => ({ ...v, fileUrl: url }))} notify={notify} /></Field>
                <Field label={tx('Número (opcional)')}><input style={inputStyle} value={f.number} onChange={e => setF(v => ({ ...v, number: e.target.value }))} maxLength={40} /></Field>
                {!!t.has_expiry && <Field label={tx('Fecha de caducidad')}><input type="date" style={inputStyle} value={f.expiresAt} onChange={e => setF(v => ({ ...v, expiresAt: e.target.value }))} /></Field>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <Btn variant="ghost" onClick={() => setEditing(null)} style={{ flex: 1 }}>{tx('Cancelar')}</Btn>
                  <Btn onClick={() => send(t.id)} disabled={busy || !f.fileUrl || (!!t.has_expiry && !f.expiresAt)} style={{ flex: 1 }}>{tx('Enviar')}</Btn>
                </div>
              </div>
            )}
          </Card>
        );
      })}
      {data && <p style={{ fontSize: 12, color: C.muted, margin: '4px' }}>* {tx('Obligatorio para poder conectarte')}</p>}
    </Page>
  );
}

function Incentives({ dash, onBack }) {
  const { data, error, load } = useLoad(() => taxiApi('/driver/incentives'));
  const cur = dash.wallet?.currency || 'EUR';
  const UNIT = { rides: 'viajes', earnings: '', hours: 'horas' };
  return (
    <Page title={tx('Incentivos')} onBack={onBack}>
      {!data ? <Loading error={error} retry={load} /> : !data.incentives.length ? <p style={{ color: C.muted, textAlign: 'center', marginTop: 40 }}>🏆<br />{tx('Ahora mismo no hay incentivos en tu ciudad')}</p>
        : data.incentives.map(i => {
          const pct = i.target > 0 ? Math.min(100, Math.round((i.progress || 0) / i.target * 100)) : 0;
          const fmt = (n) => (i.type === 'earnings' ? money(n, cur) : `${Math.round(n || 0)} ${tx(UNIT[i.type] || '')}`);
          return (
            <Card key={i.id} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontWeight: 900 }}>{i.title}</span>
                <span style={{ fontWeight: 900, color: C.ok, whiteSpace: 'nowrap' }}>+{money(i.reward, cur)}</span>
              </div>
              {i.description && <p style={{ margin: '4px 0 0', fontSize: 13, color: C.muted }}>{i.description}</p>}
              <div style={{ height: 10, background: '#e2e8f0', borderRadius: 6, margin: '10px 0 6px', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? C.ok : BRAND }} />
              </div>
              <p style={{ margin: 0, fontSize: 12, color: C.muted }}>{fmt(i.progress)} / {fmt(i.target)}{i.end_time ? ` · ${tx('hasta')} ${i.end_time.replace('T', ' ')}` : ''}</p>
            </Card>
          );
        })}
    </Page>
  );
}

function CashPoints({ dash, onBack }) {
  const { data, error, load } = useLoad(() => taxiApi('/driver/cash-points'));
  const cur = dash.wallet?.currency || 'EUR';
  return (
    <Page title={tx('Puntos de cobro')} onBack={onBack}>
      {Number(dash.driver.debt) > 0 && (
        <Card style={{ marginBottom: 12, background: '#fef3c7' }}>
          <p style={{ margin: 0, fontWeight: 800, color: '#92400e' }}>{tx('Deuda de viajes en efectivo')}: {money(dash.driver.debt, cur)}</p>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#92400e' }}>{tx('Es la comisión de los viajes que cobraste en efectivo. Puedes pagarla en estos puntos.')}</p>
        </Card>
      )}
      {!data ? <Loading error={error} retry={load} /> : !data.points.length ? <p style={{ color: C.muted, textAlign: 'center', marginTop: 40 }}>🏧<br />{tx('Todavía no hay puntos de cobro en tu ciudad')}</p>
        : data.points.map(p => (
          <Card key={p.id} style={{ marginBottom: 10 }}>
            <p style={{ margin: 0, fontWeight: 900 }}>{p.name}</p>
            {p.address && <p style={{ margin: '2px 0 0', fontSize: 13, color: C.muted }}>📍 {p.address}</p>}
            {p.opening_hours && <p style={{ margin: '2px 0 0', fontSize: 13, color: C.muted }}>🕒 {p.opening_hours}</p>}
            {(p.contact_person || p.phone) && <p style={{ margin: '2px 0 0', fontSize: 13, color: C.muted }}>👤 {[p.contact_person, p.phone].filter(Boolean).join(' · ')}</p>}
          </Card>
        ))}
    </Page>
  );
}

function DriverInvite({ boot, onBack }) {
  const { data, error, load } = useLoad(() => taxiApi('/driver/referrals'));
  const cur = boot.settings.currency?.code || 'EUR';
  const share = () => shareText(tx('Conduce con OldFace Taxi: usa mi código {code} al registrarte como conductor.', { code: data.code })
                               + (boot.settings.app?.shareLink ? ` ${boot.settings.app.shareLink}` : ''));
  return (
    <Page title={tx('Invita y gana')} onBack={onBack}>
      {!data ? <Loading error={error} retry={load} /> : (
        <>
          <Card style={{ textAlign: 'center', marginBottom: 12 }}>
            <p style={{ fontSize: 44, margin: 0 }}>🎁</p>
            <p style={{ fontWeight: 800, margin: '6px 0' }}>{tx('Invita a otros conductores y a clientes')}</p>
            {data.settings?.driverReferrer > 0 && <p style={{ color: C.muted, margin: '0 0 12px', fontSize: 14 }}>{tx('Ganas {amount} cuando tu invitado complete su primer viaje.', { amount: money(data.settings.driverReferrer, cur) })}</p>}
            <p style={{ fontSize: 28, fontWeight: 900, letterSpacing: 3, color: BRAND, background: '#E3EDF2', borderRadius: 14, padding: 12, margin: '0 0 12px' }}>{data.code}</p>
            <Btn onClick={share}>{tx('Compartir mi código')}</Btn>
          </Card>
          <Card><Line label={tx('Ganado')} value={money(data.earned, cur)} bold /></Card>
        </>
      )}
    </Page>
  );
}
