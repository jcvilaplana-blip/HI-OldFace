/**
 * CustomerTabs — pestañas del cliente: Mis viajes · Monedero · Perfil
 * (datos, idioma, contacto de emergencia, invita y gana, ayuda/soporte, preguntas frecuentes, acerca de).
 * Page, useLoad, Loading, Line, Support, Faqs, About y shareText también los usa la app del conductor.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { taxiApi, tx, money, dateTime, taxiUrl } from '../../utils/taxiApi';
import { BRAND, C, Header, Btn, Card, Field, inputStyle, Spinner, Center, Stars } from './ui.jsx';
import CardPay from './CardPay.jsx';

const STATUS = {
  awaiting_payment: ['Esperando pago con tarjeta', '#d97706'], searching: ['Buscando conductor', '#3D5A80'], accepted: ['Conductor en camino', '#3D5A80'], arrived: ['Conductor en la recogida', '#3D5A80'],
  started: ['En viaje', '#3D5A80'], completed: ['Completado', '#16a34a'], cancelled: ['Cancelado', '#dc2626'], expired: ['Sin conductor', '#64748b'],
};
const PAY = { cash: 'Efectivo', wallet: 'Monedero', stripe: 'Tarjeta de crédito' };

export function Page({ title, onBack, children }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: C.bg, zIndex: 7 }}>
      <Header title={title} onBack={onBack} />
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>{children}</div>
    </div>
  );
}

export function useLoad(fn, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try { setData(await fn()); } catch (e) { setError(e.message); }
  }, deps); // eslint-disable-line
  useEffect(() => { load(); }, [load]);
  return { data, error, load };
}

export const Loading = ({ error, retry }) => (
  <Center>{error ? <><p style={{ fontWeight: 700 }}>{error}</p><div style={{ width: 200 }}><Btn onClick={retry}>{tx('Reintentar')}</Btn></div></> : <Spinner />}</Center>
);

// ══ Mis viajes ═══════════════════════════════════════════════════════════════
export function TripsTab({ notify }) {
  const { data, error, load } = useLoad(() => taxiApi('/customer/bookings'));
  const [open, setOpen] = useState(null);
  if (open) return <TripDetail code={open} notify={notify} onBack={() => { setOpen(null); load(); }} />;
  return (
    <Page title={tx('Mis viajes')}>
      {!data ? <Loading error={error} retry={load} /> : !data.bookings.length ? (
        <Center><span style={{ fontSize: 44 }}>🧾</span><p style={{ fontWeight: 700 }}>{tx('Todavía no has hecho ningún viaje')}</p></Center>
      ) : data.bookings.map(b => (
        <Card key={b.code} onClick={() => setOpen(b.code)} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>{dateTime(b.created_at)} · {b.ride_type}</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: STATUS[b.status]?.[1] || C.muted }}>{tx(STATUS[b.status]?.[0] || b.status)}</span>
          </div>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🟢 {b.pickup_address}</p>
          <p style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🟦 {b.dropoff_address}</p>
          <p style={{ margin: '6px 0 0', fontSize: 15, fontWeight: 900, textAlign: 'right' }}>{money(b.status === 'completed' ? b.total_amount : b.estimated_fare, b.currency)}</p>
        </Card>
      ))}
    </Page>
  );
}

function TripDetail({ code, notify, onBack }) {
  const { data, error, load } = useLoad(() => taxiApi(`/customer/bookings/${code}`), [code]);
  const [mode, setMode] = useState(null);   // refund · help · rate
  const [text, setText] = useState('');
  const [stars, setStars] = useState(0);
  const [busy, setBusy] = useState(false);
  const b = data?.booking;

  const send = async () => {
    setBusy(true);
    try {
      if (mode === 'refund') await taxiApi('/customer/refunds', { method: 'POST', body: { code, reason: text } });
      if (mode === 'help') await taxiApi('/support/tickets', { method: 'POST', body: { code, subject: `${tx('Ayuda con el viaje')} ${code}`, message: text } });
      if (mode === 'rate') await taxiApi(`/customer/bookings/${code}/rate`, { method: 'POST', body: { stars, comment: text } });
      notify(mode === 'refund' ? tx('Solicitud de reembolso enviada') : mode === 'help' ? tx('Mensaje enviado al equipo de soporte') : tx('¡Gracias por tu valoración!'));
      setMode(null); setText(''); load();
    } catch (e) { notify(e.message, true); }
    setBusy(false);
  };

  return (
    <Page title={tx('Detalle del viaje')} onBack={onBack}>
      {!b ? <Loading error={error} retry={load} /> : (
        <>
          <Card style={{ marginBottom: 12 }}>
            <p style={{ margin: '0 0 8px', fontSize: 12, color: C.muted, fontWeight: 700 }}>{b.code} · {dateTime(b.created_at)}</p>
            <p style={{ margin: 0, fontWeight: 700 }}>🟢 {b.pickup_address}</p>
            <p style={{ margin: '4px 0 0', fontWeight: 700 }}>🟦 {b.dropoff_address}</p>
            <p style={{ margin: '10px 0 0', fontSize: 13, color: C.muted }}>{b.distance_km} km · {Math.round(b.duration_min || 0)} min · {b.rideType?.name}</p>
            {b.driver && <p style={{ margin: '4px 0 0', fontSize: 13, color: C.muted }}>{tx('Conductor')}: {b.driver.name}{b.vehicle?.plate ? ` · ${b.vehicle.plate}` : ''}</p>}
          </Card>
          <Card style={{ marginBottom: 12 }}>
            <Line label={tx('Estado')} value={tx(STATUS[b.status]?.[0] || b.status)} />
            <Line label={tx('Forma de pago')} value={tx(PAY[b.payment_method] || b.payment_method)} />
            {b.discount > 0 && <Line label={tx('Descuento')} value={`−${money(b.discount, b.currency)}`} />}
            {b.cancel_fee > 0 && <Line label={tx('Gastos de cancelación')} value={money(b.cancel_fee, b.currency)} />}
            <Line label={tx('Total')} value={money(b.status === 'completed' ? b.total_amount : b.estimated_fare, b.currency)} bold />
          </Card>
          {b.status === 'completed' && !b.ratings?.some(r => r.from_type === 'customer') && mode !== 'rate' && <Btn variant="soft" onClick={() => setMode('rate')} style={{ marginBottom: 8 }}>⭐ {tx('Valorar el viaje')}</Btn>}
          {b.status === 'completed' && mode !== 'refund' && <Btn variant="ghost" onClick={() => setMode('refund')} style={{ marginBottom: 8 }}>{tx('Pedir un reembolso')}</Btn>}
          {mode !== 'help' && <Btn variant="ghost" onClick={() => setMode('help')}>{tx('Necesito ayuda con este viaje')}</Btn>}
          {mode && (
            <Card style={{ marginTop: 12 }}>
              {mode === 'rate' && <div style={{ marginBottom: 10 }}><Stars value={stars} onChange={setStars} /></div>}
              <textarea value={text} onChange={e => setText(e.target.value)} rows={3} maxLength={1000} style={{ ...inputStyle, resize: 'none' }}
                placeholder={mode === 'refund' ? tx('Cuéntanos por qué pides el reembolso') : mode === 'help' ? tx('Escribe tu mensaje') : tx('Comentario (opcional)')} />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <Btn variant="ghost" onClick={() => setMode(null)} style={{ flex: 1 }}>{tx('Cancelar')}</Btn>
                <Btn onClick={send} disabled={busy || (mode === 'rate' ? !stars : !text.trim())} style={{ flex: 1 }}>{tx('Enviar')}</Btn>
              </div>
            </Card>
          )}
        </>
      )}
    </Page>
  );
}

export const Line = ({ label, value, bold }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: bold ? 16 : 14, fontWeight: bold ? 900 : 600 }}>
    <span style={{ color: bold ? C.text : C.muted }}>{label}</span><span>{value}</span>
  </div>
);

// ══ Monedero ═════════════════════════════════════════════════════════════════
export function WalletTab({ boot, notify }) {
  const { data, error, load } = useLoad(() => taxiApi('/customer/wallet'));
  const pay = boot?.settings?.payments || {};
  const [amount, setAmount] = useState('20');
  const [topup, setTopup] = useState(null);           // { card } mientras se confirma la tarjeta
  const [busy, setBusy] = useState(false);
  const startTopup = async () => {
    setBusy(true);
    try { const { card } = await taxiApi('/customer/wallet/topup', { method: 'POST', body: { amount: Number(String(amount).replace(',', '.')) } }); setTopup(card); }
    catch (e) { notify?.(e.message, true); }
    setBusy(false);
  };
  const topupDone = async () => {
    await taxiApi(`/customer/wallet/topup/${topup.intentId}`, { method: 'POST' });
    setTopup(null); notify?.(tx('Monedero recargado')); load();
  };
  return (
    <Page title={tx('Monedero')}>
      {!data ? <Loading error={error} retry={load} /> : (
        <>
          <div style={{ background: `linear-gradient(135deg, ${BRAND}, #293241)`, color: 'white', borderRadius: 20, padding: 20, marginBottom: 16 }}>
            <p style={{ margin: 0, opacity: 0.8, fontWeight: 700, fontSize: 13 }}>{tx('Saldo disponible')}</p>
            <p style={{ margin: '6px 0 0', fontSize: 34, fontWeight: 900 }}>{money(data.wallet.balance, data.wallet.currency)}</p>
            <p style={{ margin: '8px 0 0', opacity: 0.8, fontSize: 12 }}>{tx('Úsalo para pagar tus viajes. Aquí también recibes reembolsos y premios por invitar.')}</p>
          </div>
          {pay.stripe && (
            <Card style={{ marginBottom: 16 }}>
              <p style={{ fontWeight: 900, margin: '0 0 10px' }}>💳 {tx('Recargar con tarjeta de crédito')}</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                {[10, 20, 50].map(n => (
                  <button key={n} onClick={() => setAmount(String(n))} style={{ padding: '8px 14px', borderRadius: 20, fontWeight: 800, cursor: 'pointer',
                    border: `1.5px solid ${String(n) === amount ? BRAND : C.line}`, background: String(n) === amount ? '#E3EDF2' : 'white', color: String(n) === amount ? BRAND : C.text }}>
                    {money(n, data.wallet.currency)}
                  </button>
                ))}
                <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.,]/g, ''))} inputMode="decimal" aria-label={tx('Otro importe')}
                       style={{ ...inputStyle, width: 90, padding: '8px 10px' }} />
              </div>
              <p style={{ fontSize: 12, color: C.muted, margin: '0 0 10px' }}>{tx('De {min} a {max}', { min: money(pay.topupMin || 5, data.wallet.currency), max: money(pay.topupMax || 500, data.wallet.currency) })}</p>
              <Btn onClick={startTopup} disabled={busy || !Number(String(amount).replace(',', '.'))}>{busy ? tx('Un momento…') : tx('Recargar')}</Btn>
            </Card>
          )}
          <p style={{ fontWeight: 900, margin: '0 0 8px' }}>{tx('Movimientos')}</p>
          {!data.transactions.length ? <p style={{ color: C.muted }}>{tx('Sin movimientos todavía')}</p> : (
            <Card style={{ padding: '4px 14px' }}>
              {data.transactions.map(t => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 0', borderBottom: `1px solid ${C.line}` }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>{t.description || t.type}</span>
                    <span style={{ display: 'block', color: C.muted, fontSize: 12 }}>{dateTime(t.created_at)}</span>
                  </span>
                  <span style={{ fontWeight: 900, color: t.type === 'debit' ? C.danger : C.ok, whiteSpace: 'nowrap' }}>{t.type === 'debit' ? '−' : '+'}{money(Math.abs(t.amount), data.wallet.currency)}</span>
                </div>
              ))}
            </Card>
          )}
          {topup && (
            <CardPay card={topup} lang={boot?.language?.code || 'es'} title={tx('Recargar con tarjeta de crédito')}
              payLabel={`${tx('Pagar')} ${money(topup.amount, topup.currency)}`} onPaid={topupDone} onCancel={() => setTopup(null)} />
          )}
        </>
      )}
    </Page>
  );
}

// ══ Perfil ═══════════════════════════════════════════════════════════════════
export function ProfileTab({ boot, notify, reload, onExit }) {
  const [sub, setSub] = useState(null);
  const p = boot.profile || {};
  const back = () => setSub(null);
  if (sub === 'data') return <ProfileData boot={boot} notify={notify} reload={reload} onBack={back} />;
  if (sub === 'invite') return <Invite boot={boot} onBack={back} />;
  if (sub === 'support') return <Support notify={notify} onBack={back} />;
  if (sub === 'faq') return <Faqs onBack={back} />;
  if (sub === 'about') return <About boot={boot} onBack={back} />;

  const item = (key, icon, label, onClick) => (
    <button key={key} onClick={onClick || (() => setSub(key))} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 4px', background: 'none', border: 'none',
      borderBottom: `1px solid ${C.line}`, cursor: 'pointer', textAlign: 'left', fontSize: 15, fontWeight: 700, color: C.text }}>
      <span style={{ fontSize: 20, width: 28, textAlign: 'center' }}>{icon}</span><span style={{ flex: 1 }}>{label}</span><span style={{ color: '#94a3b8' }}>›</span>
    </button>
  );

  return (
    <Page title={tx('Perfil')}>
      <Card style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
        <span style={{ width: 58, height: 58, borderRadius: '50%', background: '#D5E6F0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, overflow: 'hidden', flexShrink: 0 }}>
          {p.photo ? <img src={taxiUrl(p.photo)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🙋'}
        </span>
        <span>
          <span style={{ display: 'block', fontWeight: 900, fontSize: 18 }}>{p.name}</span>
          <span style={{ display: 'block', color: C.muted, fontSize: 13 }}>{tx('Cliente')} · ★ {Number(p.rating || 5).toFixed(1)}</span>
        </span>
      </Card>
      <Card style={{ padding: '0 12px' }}>
        {item('data', '👤', tx('Mis datos, idioma y contacto de emergencia'))}
        {item('invite', '🎁', tx('Invita y gana'))}
        {item('support', '💬', tx('Ayuda y soporte'))}
        {item('faq', '❓', tx('Preguntas frecuentes'))}
        {item('about', 'ℹ️', tx('Acerca de'))}
        {item('exit', '🚪', tx('Salir del taxi'), onExit)}
      </Card>
    </Page>
  );
}

function ProfileData({ boot, notify, reload, onBack }) {
  const p = boot.profile || {};
  let ec = {}; try { ec = JSON.parse(p.emergency_contact || '{}') || {}; } catch { ec = {}; }
  const [f, setF] = useState({ name: p.name || '', email: p.email || '', phone: p.phone || '', language: p.language || boot.language?.code || 'es',
                               countryId: p.country_id || '', ecName: ec.name || '', ecPhone: ec.phone || '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF(v => ({ ...v, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    try {
      await taxiApi('/customer/profile', { method: 'PUT', body: { name: f.name, email: f.email, phone: f.phone, language: f.language, countryId: f.countryId || undefined,
        emergencyContact: f.ecName || f.ecPhone ? { name: f.ecName, phone: f.ecPhone } : undefined } });
      notify(tx('Datos guardados'));
      await reload();
    } catch (e) { notify(e.message, true); }
    setBusy(false);
  };
  return (
    <Page title={tx('Mis datos')} onBack={onBack}>
      <Card>
        <Field label={tx('Nombre')}><input style={inputStyle} value={f.name} onChange={set('name')} maxLength={80} /></Field>
        <Field label={tx('Email')}><input style={inputStyle} value={f.email} onChange={set('email')} type="email" maxLength={120} /></Field>
        <Field label={tx('Teléfono')}><input style={inputStyle} value={f.phone} onChange={set('phone')} inputMode="tel" maxLength={30} /></Field>
        <Field label={tx('País')}>
          <select style={inputStyle} value={f.countryId} onChange={set('countryId')}>
            {boot.countries.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label={tx('Idioma')}>
          <select style={inputStyle} value={f.language} onChange={set('language')}>
            {boot.languages.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </Field>
      </Card>
      <p style={{ fontWeight: 900, margin: '16px 4px 8px' }}>🆘 {tx('Contacto de emergencia')}</p>
      <Card>
        <Field label={tx('Nombre')}><input style={inputStyle} value={f.ecName} onChange={set('ecName')} maxLength={80} /></Field>
        <Field label={tx('Teléfono')}><input style={inputStyle} value={f.ecPhone} onChange={set('ecPhone')} inputMode="tel" maxLength={30} /></Field>
      </Card>
      <Btn onClick={save} disabled={busy || !f.name.trim()} style={{ marginTop: 16 }}>{busy ? tx('Guardando…') : tx('Guardar')}</Btn>
    </Page>
  );
}

export async function shareText(text) {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) { const { Share } = await import('@capacitor/share'); await Share.share({ text }); return; }
  } catch { /* web */ }
  try { if (navigator.share) await navigator.share({ text }); else await navigator.clipboard.writeText(text); } catch { /* cancelado */ }
}

function Invite({ boot, onBack }) {
  const { data, error, load } = useLoad(() => taxiApi('/customer/referrals'));
  const cur = boot.settings.currency?.code || 'EUR';
  const share = () => shareText(tx('Usa mi código {code} al entrar en el taxi de OldFace y consigue tu regalo.', { code: data.code })
                               + (boot.settings.app?.shareLink ? ` ${boot.settings.app.shareLink}` : ''));
  return (
    <Page title={tx('Invita y gana')} onBack={onBack}>
      {!data ? <Loading error={error} retry={load} /> : (
        <>
          <Card style={{ textAlign: 'center', marginBottom: 12 }}>
            <p style={{ fontSize: 44, margin: 0 }}>🎁</p>
            <p style={{ fontWeight: 800, margin: '6px 0' }}>{tx('Invita a tus amigos')}</p>
            {data.settings?.userReferrer > 0 && <p style={{ color: C.muted, margin: '0 0 12px', fontSize: 14 }}>{tx('Ganas {amount} por cada amigo que haga su primer viaje.', { amount: money(data.settings.userReferrer, cur) })}</p>}
            <p style={{ fontSize: 28, fontWeight: 900, letterSpacing: 3, color: BRAND, background: '#E3EDF2', borderRadius: 14, padding: 12, margin: '0 0 12px' }}>{data.code}</p>
            <Btn onClick={share}>{tx('Compartir mi código')}</Btn>
          </Card>
          <Card>
            <Line label={tx('Amigos invitados')} value={data.invited} />
            <Line label={tx('Ganado')} value={money(data.earned, cur)} bold />
          </Card>
        </>
      )}
    </Page>
  );
}

export function Support({ notify, onBack }) {
  const { data, error, load } = useLoad(() => taxiApi('/support/tickets'));
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ subject: '', message: '' });
  const [busy, setBusy] = useState(false);
  if (open) return <Ticket id={open} notify={notify} onBack={() => { setOpen(null); load(); }} />;
  const create = async () => {
    setBusy(true);
    try { await taxiApi('/support/tickets', { method: 'POST', body: f }); notify(tx('Mensaje enviado al equipo de soporte')); setCreating(false); setF({ subject: '', message: '' }); load(); }
    catch (e) { notify(e.message, true); }
    setBusy(false);
  };
  const solved = (s) => s === 'closed' || s === 'resolved';
  return (
    <Page title={tx('Ayuda y soporte')} onBack={onBack}>
      {creating ? (
        <Card style={{ marginBottom: 12 }}>
          <Field label={tx('Asunto')}><input style={inputStyle} value={f.subject} onChange={e => setF(v => ({ ...v, subject: e.target.value }))} maxLength={200} /></Field>
          <Field label={tx('Mensaje')}><textarea style={{ ...inputStyle, resize: 'none' }} rows={4} value={f.message} onChange={e => setF(v => ({ ...v, message: e.target.value }))} maxLength={4000} /></Field>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="ghost" onClick={() => setCreating(false)} style={{ flex: 1 }}>{tx('Cancelar')}</Btn>
            <Btn onClick={create} disabled={busy || !f.subject.trim() || !f.message.trim()} style={{ flex: 1 }}>{tx('Enviar')}</Btn>
          </div>
        </Card>
      ) : <Btn onClick={() => setCreating(true)} style={{ marginBottom: 12 }}>✉️ {tx('Escribir al soporte')}</Btn>}
      {!data ? <Loading error={error} retry={load} /> : data.tickets.map(t => (
        <Card key={t.id} onClick={() => setOpen(t.id)} style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontWeight: 800 }}>{t.subject}</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: solved(t.status) ? C.ok : '#3D5A80' }}>{tx(solved(t.status) ? 'Resuelto' : 'Abierto')}</span>
          </div>
          <span style={{ fontSize: 12, color: C.muted }}>{t.number} · {dateTime(t.created_at)}</span>
        </Card>
      ))}
    </Page>
  );
}

function Ticket({ id, notify, onBack }) {
  const { data, error, load } = useLoad(() => taxiApi(`/support/tickets/${id}`), [id]);
  const [msg, setMsg] = useState('');
  const send = async () => {
    try { await taxiApi(`/support/tickets/${id}/messages`, { method: 'POST', body: { message: msg } }); setMsg(''); load(); }
    catch (e) { notify(e.message, true); }
  };
  return (
    <Page title={data?.ticket?.subject || tx('Soporte')} onBack={onBack}>
      {!data ? <Loading error={error} retry={load} /> : (
        <>
          {data.messages.map((m, i) => {
            const mine = m.sender_type !== 'admin';
            return (
              <div key={i} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                <div style={{ maxWidth: '80%', background: mine ? BRAND : 'white', color: mine ? 'white' : C.text, borderRadius: 14, padding: '8px 12px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                  <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap' }}>{m.message}</p>
                  <p style={{ margin: '4px 0 0', fontSize: 10, opacity: 0.7 }}>{mine ? tx('Tú') : tx('Soporte')} · {dateTime(m.created_at)}</p>
                </div>
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input value={msg} onChange={e => setMsg(e.target.value)} placeholder={tx('Escribe tu mensaje')} style={inputStyle} maxLength={4000} />
            <button onClick={send} disabled={!msg.trim()} style={{ padding: '0 16px', borderRadius: 12, border: 'none', background: BRAND, color: 'white', fontWeight: 800, cursor: 'pointer' }}>{tx('Enviar')}</button>
          </div>
        </>
      )}
    </Page>
  );
}

export function Faqs({ onBack }) {
  const { data, error, load } = useLoad(() => taxiApi('/faqs'));
  const [openId, setOpenId] = useState(null);
  return (
    <Page title={tx('Preguntas frecuentes')} onBack={onBack}>
      {!data ? <Loading error={error} retry={load} /> : !data.categories.length ? <p style={{ color: C.muted }}>{tx('Todavía no hay preguntas frecuentes')}</p>
        : data.categories.map(c => (
          <div key={c.id} style={{ marginBottom: 14 }}>
            <p style={{ fontWeight: 900, margin: '0 4px 8px' }}>{c.title}</p>
            <Card style={{ padding: '0 12px' }}>
              {c.faqs.map(q => (
                <div key={q.id} style={{ borderBottom: `1px solid ${C.line}` }}>
                  <button onClick={() => setOpenId(openId === q.id ? null : q.id)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '12px 0', fontWeight: 700, fontSize: 14, cursor: 'pointer', color: C.text }}>{q.question}</button>
                  {openId === q.id && <p style={{ margin: '0 0 12px', color: C.muted, fontSize: 14, whiteSpace: 'pre-wrap' }}>{q.answer}</p>}
                </div>
              ))}
            </Card>
          </div>
        ))}
    </Page>
  );
}

export function About({ boot, onBack }) {
  const a = boot.settings.app || {};
  return (
    <Page title={tx('Acerca de')} onBack={onBack}>
      <Card style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 48, margin: 0 }}>🚕</p>
        <p style={{ fontWeight: 900, fontSize: 20, margin: '6px 0' }}>{a.name || 'OldFace Taxi'}</p>
        {a.supportEmail && <p style={{ margin: '4px 0', color: C.muted }}>✉️ {a.supportEmail}</p>}
        {a.supportPhone && <p style={{ margin: '4px 0', color: C.muted }}>📞 {a.supportPhone}</p>}
        <p style={{ margin: '14px 0 0', fontSize: 12, color: C.muted }}>{tx('Mapas')} © OpenStreetMap</p>
      </Card>
    </Page>
  );
}
