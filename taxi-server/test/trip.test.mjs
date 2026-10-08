// Prueba de extremo a extremo de un viaje: cliente + 2 conductores, API y tiempo real (base de datos temporal)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import { io } from 'socket.io-client';
import { DatabaseSync } from 'node:sqlite';

const dir = mkdtempSync(join(tmpdir(), 'taxi-trip-'));
const PORT = 4198, ORIGIN = `http://127.0.0.1:${PORT}`, B = `${ORIGIN}/taxi`, SECRET = 'test-secret';
const env = { ...process.env, TAXI_DB: join(dir, 'taxi.db'), TAXI_PORT: String(PORT), ENV_FILE: join(dir, 'none.env'),
              ADMIN_EMAIL: 'admin@test.es', ADMIN_PASSWORD: 'Clave-segura-1', RTC_SECRET: SECRET,
              VALHALLA_URL: 'http://127.0.0.1:9', PHOTON_URL: 'http://127.0.0.1:9' };   // sin mapas: estimación en línea recta
const srv = spawn(process.execPath, ['server.js'], { cwd: join(dirname(fileURLToPath(import.meta.url)), '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
let errOut = ''; srv.stderr.on('data', d => { errOut += d; });

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond ? '' : ' → ' + JSON.stringify(extra)?.slice(0, 300)}`); };
const tok = (uid) => { const exp = Math.floor(Date.now() / 1000) + 3600; return `${uid}.${exp}.${createHmac('sha256', SECRET).update(`${uid}.${exp}`).digest('base64url')}`; };
const req = async (method, path, body, token) => {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, d: await r.json().catch(() => null) };
};
const sock = (token) => new Promise((res, rej) => {
  const s = io(ORIGIN, { path: '/taxi/socket.io', auth: { token }, transports: ['websocket'] });
  s.once('connect', () => res(s)); s.once('connect_error', rej);
});
const waitEvent = (s, ev, pred = () => true, ms = 5000) => new Promise((res) => {
  const h = (p) => { if (pred(p)) { clearTimeout(t); s.off(ev, h); res(p); } };
  const t = setTimeout(() => { s.off(ev, h); res(null); }, ms);
  s.on(ev, h);
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const C = tok('user_cliente1'), D1 = tok('user_conductor1'), D2 = tok('user_conductor2');
const MADRID = { lat: 40.4168, lng: -3.7038, address: 'Puerta del Sol, Madrid' };
const ATOCHA = { lat: 40.4065, lng: -3.6895, address: 'Estación de Atocha, Madrid' };
const sockets = [];

try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(B + '/health')).ok) break; } catch {} await sleep(100); }
  const A = (await req('POST', '/api/admin/login', { email: 'admin@test.es', password: 'Clave-segura-1' })).d.token;
  const spain = (await req('GET', '/api/admin/r/countries?f_code=ES', null, A)).d.rows[0];
  await req('POST', '/api/admin/r/cities', { name: 'Madrid', country_id: spain.id, lat: MADRID.lat, lng: MADRID.lng }, A);
  const economy = (await req('GET', '/api/admin/r/ride_types?search=economy', null, A)).d.rows[0];

  // ── Roles exclusivos ──
  ok('sin token de OldFace → 401', (await req('GET', '/api/app/bootstrap')).s === 401);
  const boot = (await req('GET', '/api/app/bootstrap', null, C)).d;
  ok('primera vez: aún sin rol, con países e idioma', boot.role === null && boot.countries.length === 18 && boot.language.code === 'es', boot);
  ok('elegir rol cliente', (await req('POST', '/api/app/role', { role: 'customer', name: 'Lucía Cliente', countryId: spain.id }, C)).s === 201);
  const again = await req('POST', '/api/app/role', { role: 'driver', name: 'Lucía' }, C);
  ok('un cliente NO puede hacerse conductor (409)', again.s === 409 && /no puede/.test(again.d.error), again);
  ok('el cliente no puede usar la parte de conductor (403)', (await req('GET', '/api/app/driver/dashboard', null, C)).s === 403);
  const c1 = (await req('GET', '/api/app/bootstrap', null, C)).d.profile;
  // Foto de OldFace (base64): se guarda entera; lo que no es imagen se descarta
  const avatar = 'data:image/jpeg;base64,' + 'A'.repeat(20000);
  const ph = await req('PUT', '/api/app/customer/profile', { photo: avatar }, C);
  ok('la foto de OldFace (base64) se guarda entera en el perfil del cliente', ph.s === 200 && ph.d.profile.photo === avatar, ph.d.profile?.photo?.length);
  const bad = await req('PUT', '/api/app/customer/profile', { photo: 'javascript:alert(1)' }, C);
  ok('una "foto" que no es imagen no sustituye a la buena', bad.d.profile.photo === avatar);
  ok('conductor 1 con código de invitación del cliente', (await req('POST', '/api/app/role', { role: 'driver', name: 'Pedro Conductor', referralCode: c1.referral_code }, D1)).s === 201);
  ok('un conductor NO puede hacerse cliente (409)', (await req('POST', '/api/app/role', { role: 'customer' }, D1)).s === 409);
  ok('el conductor no puede pedir viajes (403)', (await req('POST', '/api/app/customer/quote', { pickup: MADRID, dropoff: ATOCHA }, D1)).s === 403);
  ok('código de invitación inexistente → 400', (await req('POST', '/api/app/role', { role: 'driver', name: 'X', referralCode: 'NOEXISTE' }, D2)).s === 400);
  ok('conductor 2', (await req('POST', '/api/app/role', { role: 'driver', name: 'Marta Conductora' }, D2)).s === 201);

  // ── Alta del conductor ──
  let dash = (await req('GET', '/api/app/driver/dashboard', null, D1)).d;
  ok('conductor nuevo: pendiente, con documentos que faltan', !dash.onboarding.canGoOnline && dash.onboarding.missingDocuments.length === 6, dash.onboarding);
  ok('sin verificar no puede conectarse (403)', (await req('POST', '/api/app/driver/online', { online: true }, D1)).s === 403);
  const png = new Uint8Array(300).fill(7);
  const up = await (await fetch(B + '/api/app/upload', { method: 'POST', headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${D1}` }, body: png })).json();
  ok('subir foto de documento', /^\/taxi\/files\/.+\.png$/.test(up.url), up);
  ok('el archivo se sirve', (await fetch(ORIGIN + up.url)).ok);
  const dt = (await req('GET', '/api/app/driver/document-types', null, D1)).d.documentTypes[0];
  ok('enviar documento', (await req('POST', '/api/app/driver/documents', { documentTypeId: dt.id, fileUrl: up.url, expiresAt: '2030-01-01' }, D1)).s === 201);
  const v1 = (await req('POST', '/api/app/driver/vehicles', { rideTypeId: economy.id, plate: '1234abc', brand: 'Toyota', model: 'Corolla', color: 'Blanco' }, D1)).d.vehicle;
  ok('registrar vehículo (matrícula en mayúsculas)', v1.plate === '1234ABC' && v1.status === 'pending', v1);
  const v2 = (await req('POST', '/api/app/driver/vehicles', { rideTypeId: economy.id, plate: '9999XYZ' }, D2)).d.vehicle;
  const drivers = (await req('GET', '/api/admin/r/drivers', null, A)).d.rows;
  for (const d of drivers) await req('PUT', `/api/admin/r/drivers/${d.id}`, { status: 'active', verified: 1 }, A);
  for (const v of [v1, v2]) await req('PUT', `/api/admin/r/vehicles/${v.id}`, { status: 'active' }, A);
  dash = (await req('GET', '/api/app/driver/dashboard', null, D1)).d;
  ok('verificado por el administrador → ya puede conectarse', dash.onboarding.canGoOnline, dash.onboarding);

  // ── Conectarse (D2 más cerca que D1) ──
  const s1 = await sock(D1), s2 = await sock(D2), sc = await sock(C); sockets.push(s1, s2, sc);
  ok('sockets de conductor y cliente conectados', s1.connected && s2.connected && sc.connected);
  ok('conductor 1 se conecta (a ~1,5 km)', (await req('POST', '/api/app/driver/online', { online: true, lat: 40.4300, lng: -3.7038 }, D1)).d.online === true);
  ok('conductor 2 se conecta (a ~0,5 km)', (await req('POST', '/api/app/driver/online', { online: true, lat: 40.4210, lng: -3.7038 }, D2)).d.online === true);

  // ── Presupuesto ──
  const q = (await req('POST', '/api/app/customer/quote', { pickup: MADRID, dropoff: ATOCHA }, C)).d;
  const eco = q.options.find(o => o.rideType.code === 'economy');
  ok(`presupuesto en Madrid: ${q.options.length} tipos, Económico ${eco?.price.total} € (llegada ~${eco?.etaMin} min)`,
     q.served && q.city.name === 'Madrid' && q.options.length === 4 && eco.price.total > 0 && eco.etaMin >= 2 && q.currency.code === 'EUR', q);
  ok('precio con IVA del 10 %', Math.abs(eco.price.tax - (eco.price.subtotal * 0.10)) < 0.02, eco.price);
  ok('fuera de cobertura → sin servicio', (await req('POST', '/api/app/customer/quote', { pickup: { lat: 41.39, lng: 2.17 }, dropoff: { lat: 41.40, lng: 2.18 } }, C)).d.served === false);
  await req('POST', '/api/admin/r/promo_codes', { code: 'HOLA10', type: 'percent', value: 10 }, A);
  const qp = (await req('POST', '/api/app/customer/quote', { pickup: MADRID, dropoff: ATOCHA, promoCode: 'hola10' }, C)).d;
  ok('código promocional aplicado', qp.options.find(o => o.rideType.code === 'economy').price.discount > 0 && !qp.promoError, qp.options[1]?.price);
  ok('código promocional falso → aviso', (await req('POST', '/api/app/customer/quote', { pickup: MADRID, dropoff: ATOCHA, promoCode: 'FALSO' }, C)).d.promoError === 'Código promocional no válido');

  // ── Pedir: la oferta va primero al más cercano (D2), rechaza → pasa a D1, acepta ──
  const offer2 = waitEvent(s2, 'offer:new');
  const bk = await req('POST', '/api/app/customer/bookings', { pickup: MADRID, dropoff: ATOCHA, rideTypeId: economy.id, paymentMethod: 'cash', promoCode: 'HOLA10' }, C);
  ok('reserva creada (buscando conductor)', bk.s === 201 && bk.d.booking.status === 'searching' && /^BK\d{6}[0-9A-F]{4}$/.test(bk.d.booking.code), bk);
  const code = bk.d.booking.code;
  ok('no puede pedir dos viajes a la vez (409)', (await req('POST', '/api/app/customer/bookings', { pickup: MADRID, dropoff: ATOCHA, rideTypeId: economy.id }, C)).s === 409);
  const o2 = await offer2;
  ok('la oferta llega primero al conductor más cercano (tiempo real)', o2?.code === code && o2.pickupKm < 1 && o2.expiresIn === 20, o2);
  const pend = await req('GET', `/api/app/driver/offers/${code}`, null, D2);
  ok('al reabrir la app, el conductor recupera su oferta pendiente', pend.s === 200 && pend.d.offer.code === code && pend.d.offer.expiresIn > 0 && pend.d.offer.expiresIn <= 20, pend);
  ok('otro conductor no ve esa oferta (404)', (await req('GET', `/api/app/driver/offers/${code}`, null, D1)).s === 404);
  const offer1 = waitEvent(s1, 'offer:new');
  ok('conductor 2 rechaza', (await req('POST', `/api/app/driver/offers/${code}/reject`, null, D2)).d?.success);
  const o1 = await offer1;
  ok('…y la oferta pasa al siguiente conductor', o1?.code === code, o1);
  ok('el que rechazó ya no puede aceptar (409)', (await req('POST', `/api/app/driver/offers/${code}/accept`, null, D2)).s === 409);
  const accepted = waitEvent(sc, 'booking:update', p => p.status === 'accepted');
  const acc = await req('POST', `/api/app/driver/offers/${code}/accept`, null, D1);
  ok('conductor 1 acepta (sin ver el código del cliente)', acc.s === 200 && acc.d.booking.status === 'accepted' && !('start_otp' in acc.d.booking), acc.d);
  ok('el cliente recibe "va de camino" al instante', !!(await accepted));
  const cb = (await req('GET', `/api/app/customer/bookings/${code}`, null, C)).d.booking;
  ok('el cliente ve conductor, coche y su código de 4 cifras', cb.driver.name === 'Pedro Conductor' && cb.vehicle.plate === '1234ABC' && /^\d{4}$/.test(cb.start_otp), cb);

  // ── Seguimiento en directo ──
  const loc = waitEvent(sc, 'trip:location');
  s1.emit('driver:location', { lat: 40.425, lng: -3.7038, heading: 180 });
  const l = await loc;
  ok('el cliente ve la posición del conductor en directo', l?.code === code && l.lat === 40.425, l);
  await sleep(1600);                                   // límite de ~1 posición cada 1,5 s
  const loc2 = waitEvent(sc, 'trip:location');
  ok('posición por HTTP (móvil bloqueado, servicio en segundo plano)', (await req('POST', '/api/app/driver/location', { lat: 40.424, lng: -3.7038, heading: 90 }, D1)).d?.ok === true);
  ok('…y también le llega al cliente', (await loc2)?.lat === 40.424);
  ok('posición no válida → 400', (await req('POST', '/api/app/driver/location', { lat: 999, lng: 0 }, D1)).s === 400);

  // ── Llegada, inicio con código, fin ──
  ok('no puede empezar sin haber llegado (409)', (await req('POST', `/api/app/driver/bookings/${code}/start`, { otp: cb.start_otp }, D1)).s === 409);
  ok('he llegado', (await req('POST', `/api/app/driver/bookings/${code}/arrived`, null, D1)).d.booking.status === 'arrived');
  ok('código incorrecto → 400', (await req('POST', `/api/app/driver/bookings/${code}/start`, { otp: '0000' }, D1)).s === 400);
  ok('empezar con el código del cliente', (await req('POST', `/api/app/driver/bookings/${code}/start`, { otp: cb.start_otp }, D1)).d.booking.status === 'started');
  ok('el cliente ya no puede cancelar un viaje en curso (409)', (await req('POST', `/api/app/customer/bookings/${code}/cancel`, null, C)).s === 409);

  // ── Mensajes entre cliente y conductor durante el viaje ──
  const toDriver = waitEvent(s1, 'trip:message');
  const sent = await req('POST', `/api/app/trip-chat/${code}`, { message: 'Ya estoy en el coche, ¿vamos por la M-30?' }, C);
  ok('el cliente escribe al conductor en pleno viaje', sent.s === 201 && sent.d.message.sender_type === 'customer', sent);
  ok('…y le llega al conductor al instante', (await toDriver)?.message?.message === 'Ya estoy en el coche, ¿vamos por la M-30?');
  ok('el conductor tiene 1 mensaje sin leer', (await req('GET', `/api/app/trip-chat/${code}/unread`, null, D1)).d.unread === 1);
  const toCustomer = waitEvent(sc, 'trip:message');
  await req('POST', `/api/app/trip-chat/${code}`, { message: 'Sí, perfecto' }, D1);
  ok('el conductor contesta y le llega al cliente', (await toCustomer)?.message?.sender_type === 'driver');
  const hist = (await req('GET', `/api/app/trip-chat/${code}`, null, C)).d;
  ok('historial con los 2 mensajes en orden y el del conductor ya leído', hist.open && hist.messages.length === 2 && hist.messages[0].sender_type === 'customer' && hist.messages[1].read_at > 0, hist);
  ok('otro conductor no puede leer ese chat (404)', (await req('GET', `/api/app/trip-chat/${code}`, null, D2)).s === 404);
  ok('mensaje vacío → 400', (await req('POST', `/api/app/trip-chat/${code}`, { message: '  ' }, C)).s === 400);

  const done = waitEvent(sc, 'booking:update', p => p.status === 'completed');
  const fin = (await req('POST', `/api/app/driver/bookings/${code}/complete`, null, D1)).d.booking;
  ok('viaje completado y cobrado en efectivo', fin.status === 'completed' && fin.payment_status === 'paid', fin);
  ok('el cliente recibe "viaje finalizado"', !!(await done));
  ok('con el viaje terminado ya no se pueden enviar mensajes (409)', (await req('POST', `/api/app/trip-chat/${code}`, { message: 'hola' }, C)).s === 409);
  const expectCommission = Math.round((fin.total_amount - fin.tax_amount) * 0.15 * 100) / 100;
  ok(`comisión 15 % (${fin.commission_amount} €) y ganancia del conductor (${fin.driver_earning} €)`,
     fin.commission_amount === expectCommission && Math.abs(fin.total_amount - fin.tax_amount - fin.commission_amount - fin.driver_earning) < 0.011, fin);

  const w1 = (await req('GET', '/api/app/driver/wallet', null, D1)).d;
  ok('efectivo: el conductor debe comisión + IVA', w1.debt === Math.round((fin.commission_amount + fin.tax_amount) * 100) / 100, w1);
  ok('factura generada', (await req('GET', '/api/admin/r/invoices', null, A)).d.rows.some(i => i.booking_id === fin.id && i.amount === fin.total_amount));
  ok('uso de la promoción registrado', (await req('GET', '/api/admin/r/promo_codes?search=HOLA10', null, A)).d.rows[0].used === 1);
  ok('bono de invitación pagado a quien invitó (cliente)', (await req('GET', '/api/app/customer/wallet', null, C)).d.wallet.balance === 5);
  ok('…y al conductor invitado', w1.transactions.some(t => /bienvenida/.test(t.description) && t.amount === 5));

  // ── Valoraciones ──
  ok('el cliente valora al conductor', (await req('POST', `/api/app/customer/bookings/${code}/rate`, { stars: 4, comment: 'Muy amable' }, C)).d?.success);
  ok('no se puede valorar dos veces (409)', (await req('POST', `/api/app/customer/bookings/${code}/rate`, { stars: 5 }, C)).s === 409);
  ok('el conductor valora al cliente', (await req('POST', `/api/app/driver/bookings/${code}/rate`, { stars: 5 }, D1)).d?.success);
  dash = (await req('GET', '/api/app/driver/dashboard', null, D1)).d;
  ok('la nota media del conductor se actualiza', dash.driver.rating === 4, dash.driver.rating);
  ok('panel del conductor: 1 viaje y ganancias de hoy', dash.today.trips === 1 && dash.today.earnings === fin.driver_earning && !dash.activeTrip, dash.today);

  // ── Monedero insuficiente, cancelación y caducidad ──
  ok('pagar con monedero sin saldo suficiente → 402', (await req('POST', '/api/app/customer/bookings', { pickup: MADRID, dropoff: ATOCHA, rideTypeId: economy.id, paymentMethod: 'wallet' }, C)).s === 402);
  const bk2 = (await req('POST', '/api/app/customer/bookings', { pickup: MADRID, dropoff: ATOCHA, rideTypeId: economy.id }, C)).d.booking;
  await sleep(300);
  const c2 = await req('POST', `/api/app/customer/bookings/${bk2.code}/cancel`, { reason: 'Ya no lo necesito' }, C);
  ok('cancelar mientras busca: gratis', c2.d?.success && c2.d.fee === 0, c2);
  await req('PUT', '/api/admin/settings/booking', { value: { otpRequired: true, scheduleMaxDays: 7, searchTimeoutSec: 2 } }, A);
  await req('POST', '/api/app/driver/online', { online: false }, D1); await req('POST', '/api/app/driver/online', { online: false }, D2);
  const expired = waitEvent(sc, 'booking:update', p => p.status === 'expired', 15000);
  await req('POST', '/api/app/customer/bookings', { pickup: MADRID, dropoff: ATOCHA, rideTypeId: economy.id }, C);
  ok('sin conductores: la reserva caduca y se avisa al cliente', (await expired)?.message?.includes('No hay conductores'));

  // ── Soporte y panel ──
  ok('el cliente abre un ticket de soporte', (await req('POST', '/api/app/support/tickets', { subject: 'Objeto perdido', message: 'Me dejé el paraguas', code }, C)).s === 201);
  const d2 = (await req('GET', '/api/admin/dashboard', null, A)).d;
  ok(`dashboard del panel: comisión de hoy ${d2.commission.today} €, 1 ticket abierto`, d2.commission.today === fin.commission_amount && d2.support.openTickets === 1 && d2.totals.bookingsToday === 3, d2);
  // ── Acciones de administración con dinero ──
  const wd1 = (await req('GET', '/api/admin/r/wallets?f_owner_type=driver', null, A)).d.rows.find(w => w.owner_id === dash.driver.id);
  const debtBefore = w1.debt;
  const adj = await req('POST', `/api/admin/wallets/${wd1.id}/adjust`, { type: 'credit', amount: 50, description: 'Pago en punto de cobro', settlesDebt: true }, A);
  ok('ajuste manual: el conductor salda su deuda en un punto de cobro', adj.s === 200 && (await req('GET', '/api/app/driver/wallet', null, D1)).d.debt === 0 && debtBefore > 0, adj.d);
  ok('ajuste sin motivo → 400', (await req('POST', `/api/admin/wallets/${wd1.id}/adjust`, { type: 'credit', amount: 5 }, A)).s === 400);
  const balBefore = (await req('GET', '/api/app/driver/wallet', null, D1)).d.wallet.balance;
  ok('el conductor pide una retirada', (await req('POST', '/api/app/driver/withdrawals', { amount: 10, accountDetails: 'ES00 0000 0000 0000' }, D1)).s === 201);
  ok('no puede retirar más de su saldo', (await req('POST', '/api/app/driver/withdrawals', { amount: 99999, accountDetails: 'ES00' }, D1)).s === 400);
  const wr = (await req('GET', '/api/admin/r/withdrawal_requests', null, A)).d.rows[0];
  ok('el administrador marca la retirada como pagada', (await req('PUT', `/api/admin/r/withdrawal_requests/${wr.id}`, { status: 'paid' }, A)).s === 200);
  ok('…y se descuenta del monedero del conductor', (await req('GET', '/api/app/driver/wallet', null, D1)).d.wallet.balance === Math.round((balBefore - 10) * 100) / 100);
  ok('una retirada pagada no se puede cambiar', (await req('PUT', `/api/admin/r/withdrawal_requests/${wr.id}`, { status: 'rejected' }, A)).s === 400);
  const cBal = (await req('GET', '/api/app/customer/wallet', null, C)).d.wallet.balance;
  ok('el cliente pide un reembolso', (await req('POST', '/api/app/customer/refunds', { code, reason: 'Ruta más larga de lo normal', amount: 2 }, C)).s === 201);
  const rr = (await req('GET', '/api/admin/r/refund_requests', null, A)).d.rows[0];
  ok('el administrador aprueba el reembolso', (await req('PUT', `/api/admin/r/refund_requests/${rr.id}`, { status: 'approved' }, A)).d?.row?.amount_approved === 2);
  ok('…y se abona al monedero del cliente', (await req('GET', '/api/app/customer/wallet', null, C)).d.wallet.balance === cBal + 2);
  const tk = (await req('GET', '/api/admin/r/support_tickets', null, A)).d.rows[0];
  ok('el administrador responde al ticket', (await req('POST', `/api/admin/tickets/${tk.id}/messages`, { message: 'Lo hemos encontrado, te lo enviamos' }, A)).s === 201);
  const conv = (await req('GET', `/api/app/support/tickets/${tk.id}`, null, C)).d;
  ok('el cliente ve la respuesta', conv.messages.length === 2 && conv.messages[1].sender_type === 'admin', conv);
  const live = (await req('GET', '/api/admin/live', null, A)).d;
  ok('mapa en vivo del panel responde', Array.isArray(live.drivers) && Array.isArray(live.bookings), live);
  const icon = await (await fetch(B + '/api/admin/upload', { method: 'POST', headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${A}` }, body: png })).json();
  ok('subir un icono desde el panel', /^\/taxi\/files\/.+\.png$/.test(icon.url), icon);

  // ── Móvil del conductor dormido (ahorro de batería, pantalla apagada, app cerrada): sigue recibiendo ofertas ──
  await req('POST', '/api/app/driver/online', { online: true, lat: 40.4210, lng: -3.7038 }, D2);
  const db = new DatabaseSync(env.TAXI_DB);
  db.prepare('UPDATE drivers SET location_at = ? WHERE online = 1').run(Date.now() - 30 * 60000);   // última posición hace 30 min
  db.close();
  const sleepy = waitEvent(s2, 'offer:new');
  const bk3 = await req('POST', '/api/app/customer/bookings', { pickup: MADRID, dropoff: ATOCHA, rideTypeId: economy.id, paymentMethod: 'cash' }, C);
  const o3 = await sleepy;
  ok('conductor conectado sin ubicación reciente (móvil dormido) → recibe la oferta con tiempo extra', bk3.s === 201 && o3?.code === bk3.d.booking.code && o3.expiresIn === 40, { bk3: bk3.d, o3 });
  const closed = waitEvent(s2, 'offer:expired');
  await req('POST', `/api/app/customer/bookings/${bk3.d.booking.code}/cancel`, { reason: 'prueba' }, C);
  ok('el cliente cancela mientras se busca → al conductor se le cierra la oferta (deja de sonar)', (await closed)?.code === bk3.d.booking.code);

  const role = await req('PUT', '/api/admin/accounts/user_cliente1/role', { role: 'driver' }, A);
  ok('solo el administrador puede cambiar el rol de una cuenta', role.d?.role === 'driver' && (await req('GET', '/api/app/bootstrap', null, C)).d.role === 'driver', role);
} catch (e) {
  fail++; console.log('FAIL excepción', e.stack);
} finally {
  sockets.forEach(s => s.close());
  srv.kill();
  const errs = errOut.split('\n').filter(l => l.trim() && !/ExperimentalWarning|trace-warnings/.test(l)).join('\n');
  if (errs) console.log('stderr del servidor:\n' + errs);
  setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} console.log(`\n${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0); }, 300);
}
