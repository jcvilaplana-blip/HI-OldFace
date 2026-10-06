/** Pages — inicio de sesión, dashboard, ajustes y mapa en vivo */
import React, { useEffect, useState } from 'react';
import { api, session } from './api';
import { t, money, dateTime } from './i18n';

// ── Inicio de sesión ─────────────────────────────────────────────────────────
export function Login({ onLogin }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { const d = await api('/login', { method: 'POST', body: { email, password } }); session.set(d); onLogin(d); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="brand" style={{ color: 'var(--primary)', padding: '0 0 10px' }}><span className="brand-logo" style={{ background: 'var(--primary)', color: '#fff' }}>🚕</span> OldFace Taxi</div>
        <h1>{t('Panel de administración')}</h1>
        <p className="muted" style={{ marginTop: 0 }}>{t('Entra con tu cuenta de administrador')}</p>
        <div className="field" style={{ marginBottom: 10 }}><label>{t('Email')}</label><input className="input" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></div>
        <div className="field" style={{ marginBottom: 14 }}><label>{t('Contraseña')}</label><input className="input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></div>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" style={{ width: '100%', justifyContent: 'center', padding: 11 }} disabled={busy}>{busy ? t('Entrando…') : t('Entrar')}</button>
      </form>
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────
const Stat = ({ label, value, hint }) => (
  <div className="card stat"><div className="label">{label}</div><div className="value">{value}</div>{hint && <div className="hint">{hint}</div>}</div>
);

export function Dashboard({ notify, go }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    const load = () => api('/dashboard').then(setD).catch(e => notify(e.message, true));
    load();
    const i = setInterval(load, 30000);
    return () => clearInterval(i);
  }, []); // eslint-disable-line
  if (!d) return <p className="muted">{t('Cargando…')}</p>;
  const s = d.currency?.symbol || '€';
  const max = Math.max(1, ...d.trend.map(x => x.bookings));
  return (
    <>
      <div className="grid stats">
        <Stat label={t('Comisión de hoy')} value={money(d.commission.today, s)} hint={t('De {n} viajes', { n: d.commission.rides })} />
        <Stat label={t('Ganancias de conductores hoy')} value={money(d.driverEarnings.today, s)} hint={t('Tras comisión e impuestos')} />
        <Stat label={t('Retiradas pendientes')} value={money(d.pendingPayouts.amount, s)} hint={t('{n} solicitudes', { n: d.pendingPayouts.count })} />
        <Stat label={t('Promociones usadas hoy')} value={d.promo.usesToday} hint={t('{x} de descuento', { x: money(d.promo.discountToday, s) })} />
        <Stat label={t('Códigos promocionales activos')} value={d.promo.active} hint={t('Válidos ahora')} />
        <Stat label={t('Bonos de invitación pendientes')} value={d.referralPending.count} hint={money(d.referralPending.amount, s)} />
      </div>
      <div className="section-title">{t('Soporte')}</div>
      <div className="grid stats">
        <Stat label={t('Conversaciones')} value={d.support.conversations} hint={t('{n} abiertas', { n: d.support.open })} />
        <Stat label={t('Mensajes sin leer')} value={d.support.unread} hint={t('{n} urgentes', { n: d.support.urgent })} />
        <Stat label={t('Mensajes hoy / semana / mes')} value={`${d.support.today} / ${d.support.week} / ${d.support.month}`} />
        <Stat label={t('Tickets abiertos')} value={d.support.openTickets} hint={t('{a} sin respuesta en 24 h · {u} sin asignar', { a: d.support.needsAttention, u: d.support.unassigned })} />
      </div>
      <div className="section-title">{t('Plataforma')}</div>
      <div className="grid stats">
        <Stat label={t('Saldo total en monederos')} value={money(d.transactions.totalBalance, s)} />
        <Stat label={t('Abonos de hoy')} value={money(d.transactions.credits.s, s)} hint={t('{n} movimientos', { n: d.transactions.credits.c })} />
        <Stat label={t('Cargos de hoy')} value={money(d.transactions.debits.s, s)} hint={t('{n} movimientos', { n: d.transactions.debits.c })} />
        <Stat label={t('Clientes')} value={d.totals.users} />
        <Stat label={t('Conductores conectados')} value={d.totals.activeDrivers} hint={t('de {n} conductores', { n: d.totals.drivers })} />
        <Stat label={t('Reservas de hoy')} value={d.totals.bookingsToday} />
        <Stat label={t('Vehículos activos')} value={d.totals.activeVehicles} />
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr)', marginTop: 14 }}>
        <div className="card">
          <b>{t('Reservas de los últimos 30 días')}</b>
          {d.trend.length === 0 ? <p className="muted">{t('Aún no hay reservas')}</p> : (
            <div className="bars">{d.trend.map(x => <div key={x.day} title={`${x.day}: ${x.bookings} (${x.completed} completadas)`} style={{ height: `${(x.bookings / max) * 100}%` }} />)}</div>
          )}
        </div>
      </div>
      <div className="section-title">{t('Últimas reservas')} <button className="btn small" onClick={() => go('r/bookings')}>{t('Ver todas')}</button></div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>{t('Código')}</th><th>{t('Cliente')}</th><th>{t('Conductor')}</th><th>{t('Recogida')}</th><th>{t('Destino')}</th><th>{t('Importe')}</th><th>{t('Estado')}</th><th>{t('Creada')}</th></tr></thead>
          <tbody>
            {d.latestBookings.length === 0 && <tr><td colSpan={8} className="muted">{t('Aún no hay reservas')}</td></tr>}
            {d.latestBookings.map(b => (
              <tr key={b.code}>
                <td><b>{b.code}</b></td><td>{b.customer}</td><td>{b.driver || '—'}</td>
                <td className="muted">{(b.pickup_address || '').slice(0, 40)}</td><td className="muted">{(b.dropoff_address || '').slice(0, 40)}</td>
                <td>{money(b.total_amount ?? b.estimated_fare, s)}</td><td><span className="badge">{b.status}</span></td><td>{dateTime(b.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Ajustes (pantallas de configuración del PDF) ────────────────────────────
const F = (path, label, type = 'text', extra = {}) => ({ path, label, type, ...extra });
export const SETTINGS = {
  app: { title: 'Ajustes de la app', icon: '⚙️', fields: [
    F('appName', 'Nombre de la app'), F('supportEmail', 'Email de soporte', 'email'), F('supportPhone', 'Teléfono de soporte'),
    F('maintenanceMode', 'Modo mantenimiento (las apps muestran un aviso)', 'bool'), F('adminLogo', 'Logo del panel (URL)'),
    F('androidVersion', 'Versión Android'), F('androidForceUpdate', 'Forzar actualización en Android', 'bool'),
    F('iosVersion', 'Versión iOS'), F('iosForceUpdate', 'Forzar actualización en iOS', 'bool'),
    F('androidShareLink', 'Enlace para compartir (Android)'), F('appleShareLink', 'Enlace para compartir (iOS)'),
    F('adminPrimaryColor', 'Color principal del panel', 'color'), F('appPrimaryColor', 'Color principal de la app', 'color')] },
  payments: { title: 'Métodos de pago', icon: '💳', fields: [
    F('cash.enabled', 'Efectivo', 'bool'), F('wallet.enabled', 'Monedero', 'bool'),
    F('stripe.enabled', 'Tarjeta de crédito', 'bool'),
    F('stripe.mode', 'Tarjeta de crédito: modo', 'select', { options: [['sandbox', 'Pruebas (no se cobra de verdad)'], ['live', 'Real (cobros de verdad)']] }),
    F('stripe.publishableKey', 'Tarjeta de crédito: clave pública', 'text', { help: 'De tu cuenta de Stripe → Desarrolladores → Claves de API. En pruebas empieza por pk_test_' }),
    F('stripe.secretKey', 'Tarjeta de crédito: clave secreta', 'secret', { help: 'En pruebas empieza por sk_test_. Después pulsa "Configurar avisos automáticamente".' }),
    F('stripe.webhookSecret', 'Tarjeta de crédito: secreto de los avisos', 'secret', { help: 'Se rellena solo con el botón "Configurar avisos automáticamente"' }),
    F('razorpay.enabled', 'Razorpay', 'bool'), F('razorpay.keyId', 'Razorpay key ID'), F('razorpay.currency', 'Moneda de Razorpay'),
    F('razorpay.secretKey', 'Clave secreta de Razorpay', 'secret'), F('razorpay.webhookSecret', 'Secreto del webhook de Razorpay', 'secret')] },
  referral: { title: 'Importes de invitación', icon: '🎁', fields: [
    F('driverReferrer', 'Conductor que invita (premio)', 'number'), F('driverReferred', 'Conductor invitado (premio)', 'number'),
    F('userReferrer', 'Cliente que invita (premio)', 'number'), F('userReferred', 'Cliente invitado (premio)', 'number'),
    F('userFriendDiscount', 'Descuento al amigo (%)', 'number')] },
  currency: { title: 'Moneda', icon: '💶', fields: [F('code', 'Código ISO (EUR, USD…)'), F('symbol', 'Símbolo'), F('name', 'Nombre')] },
  otp: { title: 'Códigos de acceso y notificaciones', icon: '🔐', fields: [
    F('provider', 'Proveedor de códigos (OTP)', 'select', { options: [['email', 'Email propio de OldFace (gratis)'], ['firebase', 'Firebase Phone Auth'], ['msg91', 'MSG91 SMS'], ['whatsapp', 'WhatsApp']] }),
    F('fcmEnabled', 'Notificaciones push (FCM)', 'bool'),
    F('msg91.authKey', 'MSG91 Auth key', 'secret'), F('msg91.templateId', 'MSG91 plantilla / flow ID'), F('msg91.senderId', 'MSG91 Sender ID'),
    F('whatsapp.apiUrl', 'WhatsApp: URL de la API'), F('whatsapp.securityKey', 'WhatsApp: clave de seguridad', 'secret'), F('whatsapp.template', 'WhatsApp: plantilla')] },
  integrations: { title: 'Integraciones', icon: '🔌', fields: [
    F('maps.provider', 'Mapas', 'select', { options: [['oldface', 'Propios de OldFace (gratis)'], ['google', 'Google Maps']] }),
    F('maps.googleKey', 'Clave de Google Maps', 'secret'),
    F('mail.mailer', 'Correo: sistema', 'select', { options: [['smtp', 'SMTP'], ['sendmail', 'Sendmail']] }), F('mail.host', 'SMTP: servidor'), F('mail.port', 'SMTP: puerto', 'number'),
    F('mail.username', 'SMTP: usuario'), F('mail.password', 'SMTP: contraseña', 'secret'),
    F('mail.encryption', 'SMTP: cifrado', 'select', { options: [['tls', 'TLS'], ['ssl', 'SSL'], ['none', 'Ninguno']] }),
    F('mail.fromAddress', 'Remitente (email)'), F('mail.fromName', 'Remitente (nombre)'),
    F('pusher.appId', 'Pusher App ID'), F('pusher.key', 'Pusher key'), F('pusher.secret', 'Pusher secret', 'secret'), F('pusher.cluster', 'Pusher cluster')] },
  refund: { title: 'Reembolsos', icon: '↩️', fields: [F('requiredHours', 'Plazo de revisión de reembolsos (horas)', 'number', { help: 'Se muestra a los clientes al pedir un reembolso' })] },
  driverSearch: { title: 'Radio de búsqueda de conductores', icon: '📡', fields: [
    F('round1Km', 'Ronda 1 (km)', 'number'), F('round2Km', 'Ronda 2 (km)', 'number'), F('round3Km', 'Ronda 3 (km)', 'number'),
    F('offerSeconds', 'Segundos para aceptar cada oferta', 'number'), F('active', 'Activo', 'bool')] },
  booking: { title: 'Reservas', icon: '🚕', fields: [
    F('otpRequired', 'Pedir el código de 4 cifras para empezar el viaje', 'bool'),
    F('searchTimeoutSec', 'Tiempo máximo buscando conductor (segundos)', 'number'), F('scheduleMaxDays', 'Días máximos para reservar con antelación', 'number')] },
};

const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const setPath = (o, p, v) => {
  const keys = p.split('.'), copy = structuredClone(o || {});
  let cur = copy;
  keys.slice(0, -1).forEach(k => { cur[k] = cur[k] && typeof cur[k] === 'object' ? cur[k] : {}; cur = cur[k]; });
  cur[keys.at(-1)] = v;
  return copy;
};

export function SettingsPage({ skey, canEdit, notify }) {
  const def = SETTINGS[skey];
  const [value, setValue] = useState(null), [busy, setBusy] = useState(false);
  useEffect(() => { setValue(null); api(`/settings/${skey}`).then(d => setValue(d.value)).catch(e => notify(e.message, true)); }, [skey]); // eslint-disable-line
  if (!def) return <p>{t('Ajuste no encontrado')}</p>;
  if (!value) return <p className="muted">{t('Cargando…')}</p>;
  const save = async () => {
    setBusy(true);
    try { setValue((await api(`/settings/${skey}`, { method: 'PUT', body: { value } })).value); notify(t('Ajustes guardados')); }
    catch (e) { notify(e.message, true); } finally { setBusy(false); }
  };
  return (
    <div className="card" style={{ maxWidth: 900 }}>
      <div className="form-grid">
        {def.fields.map(f => {
          const v = getPath(value, f.path);
          const set = (x) => setValue(o => setPath(o, f.path, x));
          return (
            <div key={f.path} className="field">
              <label>{t(f.label)}</label>
              {f.type === 'bool' ? <label className="switch"><input type="checkbox" disabled={!canEdit} checked={!!v} onChange={e => set(e.target.checked)} /> {v ? t('Activado') : t('Desactivado')}</label>
               : f.type === 'select' ? <select className="select" disabled={!canEdit} value={v ?? ''} onChange={e => set(e.target.value)}>{f.options.map(([a, b]) => <option key={a} value={a}>{t(b)}</option>)}</select>
               : f.type === 'number' ? <input className="input" type="number" step="any" disabled={!canEdit} value={v ?? ''} onChange={e => set(e.target.value === '' ? null : Number(e.target.value))} />
               : f.type === 'color' ? <input className="input" type="color" style={{ height: 38, padding: 3 }} disabled={!canEdit} value={v || '#3D5A80'} onChange={e => set(e.target.value)} />
               : <input className="input" type={f.type === 'secret' ? 'password' : f.type === 'email' ? 'email' : 'text'} autoComplete="off" disabled={!canEdit}
                        value={v ?? ''} placeholder={f.type === 'secret' ? t('Sin configurar') : ''} onChange={e => set(e.target.value)} />}
              {f.help && <div className="help">{t(f.help)}</div>}
            </div>
          );
        })}
      </div>
      {canEdit && <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}><button className="btn primary" disabled={busy} onClick={save}>{busy ? t('Guardando…') : t('Guardar ajustes')}</button></div>}
      {skey === 'payments' && <CardTools canEdit={canEdit} notify={notify} refresh={value} />}
    </div>
  );
}

/** Tarjeta de crédito: estado, comprobar la conexión con la pasarela y configurar los avisos (webhook) con un botón */
function CardTools({ canEdit, notify, refresh }) {
  const [s, setS] = useState(null), [busy, setBusy] = useState('');
  const load = () => api('/payments/card').then(setS).catch(() => {});
  useEffect(() => { load(); }, [refresh]); // eslint-disable-line
  const run = async (what) => {
    setBusy(what);
    try {
      const r = await api(`/payments/card/${what}`, { method: 'POST' });
      notify(what === 'check' ? t(r.testMode ? 'Conexión correcta (modo pruebas)' : 'Conexión correcta (modo real)') : t('Avisos configurados'));
      load();
    } catch (e) { notify(e.message, true); }
    setBusy('');
  };
  if (!s) return null;
  const color = s.ready ? (s.webhook ? '#16a34a' : '#d97706') : '#64748b';
  return (
    <div style={{ marginTop: 20, borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
      <h3 style={{ margin: '0 0 8px' }}>💳 {t('Tarjeta de crédito')}</h3>
      <p style={{ margin: '0 0 6px', color, fontWeight: 700 }}>
        {!s.enabled ? t('Desactivada') : !s.configured ? t(s.problem) : s.webhook ? t('Activa y lista para cobrar') : t('Activa, falta configurar los avisos')}
        {s.configured && ` · ${s.testMode ? t('MODO PRUEBAS') : t('MODO REAL')}`}
      </p>
      {s.testMode && (
        <p className="muted" style={{ margin: '0 0 10px' }}>
          {t('En modo pruebas no se cobra dinero real. Tarjeta de prueba: 4242 4242 4242 4242, cualquier fecha futura y cualquier CVC. Para probar la verificación del banco: 4000 0027 6000 3184.')}
        </p>
      )}
      <p className="muted" style={{ margin: '0 0 10px', wordBreak: 'break-all' }}>{t('Dirección de los avisos')}: {s.webhookUrl}</p>
      {canEdit && s.configured && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" disabled={!!busy} onClick={() => run('check')}>{busy === 'check' ? t('Comprobando…') : t('Comprobar conexión')}</button>
          <button className="btn primary" disabled={!!busy} onClick={() => run('webhook')}>{busy === 'webhook' ? t('Configurando…') : t('Configurar avisos automáticamente')}</button>
        </div>
      )}
    </div>
  );
}

// ── Mapa en vivo (listado mientras se publica el mapa vectorial propio) ────
export function LivePage({ notify }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    const load = () => api('/live').then(setD).catch(e => notify(e.message, true));
    load();
    const i = setInterval(load, 10000);
    return () => clearInterval(i);
  }, []); // eslint-disable-line
  if (!d) return <p className="muted">{t('Cargando…')}</p>;
  const osm = (lat, lng) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
  return (
    <>
      <div className="grid stats">
        <div className="card stat"><div className="label">{t('Conductores conectados')}</div><div className="value">{d.drivers.length}</div><div className="hint">{t('{n} libres', { n: d.drivers.filter(x => x.available).length })}</div></div>
        <div className="card stat"><div className="label">{t('Viajes activos')}</div><div className="value">{d.bookings.length}</div></div>
      </div>
      <div className="section-title">{t('Conductores conectados')} <span className="muted" style={{ fontWeight: 400 }}>· {t('se actualiza cada 10 s')}</span></div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>{t('Conductor')}</th><th>{t('Tipo')}</th><th>{t('Matrícula')}</th><th>{t('Estado')}</th><th>{t('Última posición')}</th><th>{t('Ubicación')}</th></tr></thead>
          <tbody>
            {d.drivers.length === 0 && <tr><td colSpan={6} className="muted">{t('No hay conductores conectados')}</td></tr>}
            {d.drivers.map(x => (
              <tr key={x.id}><td><b>{x.name}</b></td><td>{x.ride_type || '—'}</td><td>{x.plate || '—'}</td>
                <td>{x.available ? <span className="badge green">{t('Libre')}</span> : <span className="badge amber">{t('En viaje')}</span>}</td>
                <td>{dateTime(x.location_at)}</td><td><a href={osm(x.lat, x.lng)} target="_blank" rel="noreferrer">{x.lat.toFixed(5)}, {x.lng.toFixed(5)}</a></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="section-title">{t('Viajes activos')}</div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>{t('Código')}</th><th>{t('Cliente')}</th><th>{t('Estado')}</th><th>{t('Recogida')}</th><th>{t('Destino')}</th></tr></thead>
          <tbody>
            {d.bookings.length === 0 && <tr><td colSpan={5} className="muted">{t('No hay viajes activos')}</td></tr>}
            {d.bookings.map(b => <tr key={b.code}><td><b>{b.code}</b></td><td>{b.customer}</td><td><span className="badge">{b.status}</span></td>
              <td className="muted">{b.pickup_address}</td><td className="muted">{b.dropoff_address}</td></tr>)}
          </tbody>
        </table>
      </div>
    </>
  );
}
