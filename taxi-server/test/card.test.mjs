// Prueba del pago con TARJETA DE CRÉDITO contra un Stripe simulado (sin red ni claves reales):
// reserva al pedir → confirmación → búsqueda → cobro al terminar + ganancia del conductor · cancelación libera la reserva ·
// recarga del monedero (app y webhook firmado, sin abonar dos veces) · panel: comprobar claves y crear el webhook.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import { io } from 'socket.io-client';

// ── Stripe simulado ──
const intents = new Map(), calls = [], hooks = [];
let seq = 0;
const fake = createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    const p = Object.fromEntries(new URLSearchParams(body));
    const url = new URL(req.url, 'http://x');
    calls.push({ method: req.method, path: url.pathname, p, auth: req.headers.authorization });
    const send = (code, d) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
    const m = url.pathname.match(/^\/v1\/payment_intents\/([^/]+)(?:\/(capture|cancel))?$/);
    if (req.method === 'POST' && url.pathname === '/v1/payment_intents') {
      const id = `pi_fake_${++seq}`;
      const pi = { id, object: 'payment_intent', amount: Number(p.amount), currency: p.currency, capture_method: p.capture_method,
                   status: 'requires_payment_method', client_secret: `${id}_secret_x`, amount_received: 0, metadata: { kind: p['metadata[kind]'] } };
      intents.set(id, pi); return send(200, pi);
    }
    if (m && req.method === 'GET') return intents.has(m[1]) ? send(200, intents.get(m[1])) : send(404, { error: { message: 'No such intent' } });
    if (m && m[2] === 'capture') { const pi = intents.get(m[1]); pi.status = 'succeeded'; pi.amount_received = Number(p.amount_to_capture || pi.amount); return send(200, pi); }
    if (m && m[2] === 'cancel') { const pi = intents.get(m[1]); pi.status = 'canceled'; return send(200, pi); }
    if (url.pathname === '/v1/balance') return send(200, { object: 'balance', livemode: false });
    if (url.pathname === '/v1/webhook_endpoints' && req.method === 'GET') return send(200, { data: hooks });
    if (url.pathname === '/v1/webhook_endpoints' && req.method === 'POST') { const w = { id: `we_${hooks.length + 1}`, url: p.url, secret: 'whsec_simulado' }; hooks.push(w); return send(200, w); }
    if (url.pathname.startsWith('/v1/webhook_endpoints/') && req.method === 'DELETE') return send(200, { deleted: true });
    send(404, { error: { message: 'ruta no simulada' } });
  });
});
await new Promise(r => fake.listen(4196, '127.0.0.1', r));

const dir = mkdtempSync(join(tmpdir(), 'taxi-card-'));
const PORT = 4197, ORIGIN = `http://127.0.0.1:${PORT}`, B = `${ORIGIN}/taxi`, SECRET = 'test-secret';
const env = { ...process.env, TAXI_DB: join(dir, 'taxi.db'), TAXI_PORT: String(PORT), ENV_FILE: join(dir, 'none.env'),
              ADMIN_EMAIL: 'admin@test.es', ADMIN_PASSWORD: 'Clave-segura-1', RTC_SECRET: SECRET, STRIPE_API_BASE: 'http://127.0.0.1:4196',
              VALHALLA_URL: 'http://127.0.0.1:9', PHOTON_URL: 'http://127.0.0.1:9', OLDFACE_API_URL: '' };
const srv = spawn(process.execPath, ['server.js'], { cwd: join(dirname(fileURLToPath(import.meta.url)), '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
let errOut = ''; srv.stderr.on('data', d => { errOut += d; });

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond ? '' : ' → ' + JSON.stringify(extra)?.slice(0, 300)}`); };
const tok = (uid) => { const exp = Math.floor(Date.now() / 1000) + 3600; return `${uid}.${exp}.${createHmac('sha256', SECRET).update(`${uid}.${exp}`).digest('base64url')}`; };
const req = async (method, path, body, token, headers = {}) => {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
  return { s: r.status, d: await r.json().catch(() => null) };
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const waitEvent = (s, ev, pred = () => true, ms = 4000) => new Promise((res) => {
  const h = (p) => { if (pred(p)) { clearTimeout(t); s.off(ev, h); res(p); } };
  const t = setTimeout(() => { s.off(ev, h); res(null); }, ms);
  s.on(ev, h);
});
const signed = (payload, secret) => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`; };

const C = tok('user_cliente_card'), D = tok('user_conductor_card');
const MADRID = { lat: 40.4168, lng: -3.7038, address: 'Puerta del Sol, Madrid' };
const ATOCHA = { lat: 40.4065, lng: -3.6895, address: 'Estación de Atocha, Madrid' };
let sock;

try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(B + '/health')).ok) break; } catch {} await sleep(100); }
  const A = (await req('POST', '/api/admin/login', { email: 'admin@test.es', password: 'Clave-segura-1' })).d.token;
  const spain = (await req('GET', '/api/admin/r/countries?f_code=ES', null, A)).d.rows[0];
  await req('POST', '/api/admin/r/cities', { name: 'Madrid', country_id: spain.id, lat: MADRID.lat, lng: MADRID.lng }, A);
  const economy = (await req('GET', '/api/admin/r/ride_types?search=economy', null, A)).d.rows[0];

  // ── Panel: claves y modo ──
  const pay = (await req('GET', '/api/admin/settings/payments', null, A)).d.value;
  pay.stripe = { ...pay.stripe, enabled: true, mode: 'sandbox', publishableKey: 'pk_live_mal', secretKey: 'sk_live_mal' };
  await req('PUT', '/api/admin/settings/payments', { value: pay }, A);
  let st = (await req('GET', '/api/admin/payments/card', null, A)).d;
  ok('modo pruebas con claves reales → no se activa la tarjeta', !st.ready && /sk_test_/.test(st.problem), st);
  pay.stripe = { ...pay.stripe, publishableKey: 'pk_test_123', secretKey: 'sk_test_123' };
  await req('PUT', '/api/admin/settings/payments', { value: pay }, A);
  st = (await req('GET', '/api/admin/payments/card', null, A)).d;
  ok('claves de pruebas → tarjeta lista, modo pruebas', st.ready && st.testMode && /\/taxi\/api\/payments\/stripe\/webhook$/.test(st.webhookUrl), st);
  ok('comprobar conexión con la pasarela', (await req('POST', '/api/admin/payments/card/check', null, A)).d?.testMode === true);
  ok('crear el webhook automáticamente', (await req('POST', '/api/admin/payments/card/webhook', null, A)).d?.ok === true && hooks.length === 1);
  ok('el secreto del webhook queda guardado (oculto en el panel)', (await req('GET', '/api/admin/settings/payments', null, A)).d.value.stripe.webhookSecret === '••••••••');

  // ── Cliente y conductor ──
  await req('POST', '/api/app/role', { role: 'customer', name: 'Carla Tarjeta' }, C);
  const boot = (await req('GET', '/api/app/bootstrap', null, C)).d;
  ok('la app ofrece "tarjeta de crédito" en modo pruebas', boot.settings.payments.stripe === true && boot.settings.payments.cardTestMode === true && boot.settings.payments.stripePublishableKey === 'pk_test_123', boot.settings.payments);
  await req('POST', '/api/app/role', { role: 'driver', name: 'Diego Conductor' }, D);
  await req('POST', '/api/app/driver/vehicles', { plate: '9999ZZZ', rideTypeId: economy.id }, D);
  const drv = (await req('GET', '/api/app/bootstrap', null, D)).d.profile;
  await req('PUT', `/api/admin/r/drivers/${drv.id}`, { verified: 1, status: 'active' }, A);
  const veh = (await req('GET', '/api/app/driver/vehicles', null, D)).d.vehicles[0];
  await req('PUT', `/api/admin/r/vehicles/${veh.id}`, { status: 'active' }, A);
  await req('POST', '/api/app/driver/online', { online: true, lat: 40.4180, lng: -3.7038 }, D);
  sock = io(ORIGIN, { path: '/taxi/socket.io', auth: { token: D }, transports: ['websocket'] });
  await new Promise(r => sock.once('connect', r));

  // ── Viaje con tarjeta ──
  let offer = waitEvent(sock, 'offer:new', () => true, 1500);
  const bk = await req('POST', '/api/app/customer/bookings', { pickup: MADRID, dropoff: ATOCHA, rideTypeId: economy.id, paymentMethod: 'stripe' }, C);
  const code = bk.d?.booking?.code, pi = intents.get(bk.d?.card?.intentId);
  ok('pedir con tarjeta → "esperando pago" y datos para confirmar la tarjeta', bk.s === 201 && bk.d.booking.status === 'awaiting_payment' && bk.d.card.clientSecret && bk.d.card.testMode === true, bk);
  ok('se RESERVA el precio cerrado (captura manual, en céntimos)', pi?.capture_method === 'manual' && pi.amount === Math.round(bk.d.booking.estimated_fare * 100), pi);
  ok('sin tarjeta confirmada no se busca conductor', (await offer) === null);
  ok('confirmar sin haber autorizado la tarjeta → 402', (await req('POST', `/api/app/customer/bookings/${code}/card`, null, C)).s === 402);
  pi.status = 'requires_capture';                              // la tarjeta se autoriza en la app (Stripe.js)
  offer = waitEvent(sock, 'offer:new');
  const conf = await req('POST', `/api/app/customer/bookings/${code}/card`, null, C);
  ok('tarjeta confirmada → empieza la búsqueda de conductor', conf.d?.booking?.status === 'searching' && conf.d.booking.payment_status === 'authorized', conf);
  ok('…y la oferta llega al conductor', (await offer)?.code === code);
  await req('POST', `/api/app/driver/offers/${code}/accept`, null, D);
  await req('POST', `/api/app/driver/bookings/${code}/arrived`, null, D);
  const otp = (await req('GET', `/api/app/customer/bookings/${code}`, null, C)).d.booking.start_otp;
  await req('POST', `/api/app/driver/bookings/${code}/start`, { otp }, D);
  const done = await req('POST', `/api/app/driver/bookings/${code}/complete`, null, D);
  await sleep(500);
  const fin = (await req('GET', `/api/app/customer/bookings/${code}`, null, C)).d.booking;
  ok('al terminar se COBRA el total en la tarjeta', pi.status === 'succeeded' && pi.amount_received === Math.round(fin.total_amount * 100), { pi, total: fin.total_amount });
  ok('el viaje queda pagado', fin.payment_status === 'paid', fin.payment_status);
  const dw = (await req('GET', '/api/app/driver/wallet', null, D)).d;
  ok('la ganancia del conductor va a su monedero', dw.wallet.balance === done.d.booking.driver_earning && dw.debt === 0, { wallet: dw.wallet, earning: done.d.booking.driver_earning });

  // ── Cancelar → se libera la reserva ──
  const bk2 = await req('POST', '/api/app/customer/bookings', { pickup: MADRID, dropoff: ATOCHA, rideTypeId: economy.id, paymentMethod: 'stripe' }, C);
  const pi2 = intents.get(bk2.d.card.intentId); pi2.status = 'requires_capture';
  await req('POST', `/api/app/customer/bookings/${bk2.d.booking.code}/card`, null, C);
  await req('POST', `/api/app/customer/bookings/${bk2.d.booking.code}/cancel`, { reason: 'prueba' }, C);
  await sleep(300);
  ok('cancelar sin gastos → se LIBERA la reserva de la tarjeta', pi2.status === 'canceled' && (await req('GET', `/api/app/customer/bookings/${bk2.d.booking.code}`, null, C)).d.booking.payment_status === 'released', pi2);

  // ── Pedido abandonado (no confirmó la tarjeta) → se anula al pedir otro ──
  const bk3 = await req('POST', '/api/app/customer/bookings', { pickup: MADRID, dropoff: ATOCHA, rideTypeId: economy.id, paymentMethod: 'stripe' }, C);
  const bk4 = await req('POST', '/api/app/customer/bookings', { pickup: MADRID, dropoff: ATOCHA, rideTypeId: economy.id, paymentMethod: 'stripe' }, C);
  await sleep(300);
  ok('el pedido sin confirmar se anula al pedir otro', (await req('GET', `/api/app/customer/bookings/${bk3.d.booking.code}`, null, C)).d.booking.status === 'cancelled' && intents.get(bk3.d.card.intentId).status === 'canceled' && bk4.s === 201);
  await req('POST', `/api/app/customer/bookings/${bk4.d.booking.code}/cancel`, {}, C);

  // ── Recargar el monedero ──
  ok('recarga fuera de límites → 400', (await req('POST', '/api/app/customer/wallet/topup', { amount: 1 }, C)).s === 400);
  const tu = await req('POST', '/api/app/customer/wallet/topup', { amount: 20 }, C);
  const tpi = intents.get(tu.d?.card?.intentId);
  ok('recarga de 20 → cobro automático de 2000 céntimos', tu.s === 201 && tpi?.capture_method === 'automatic' && tpi.amount === 2000, tu);
  ok('confirmar sin pagar → 402', (await req('POST', `/api/app/customer/wallet/topup/${tpi.id}`, null, C)).s === 402);
  tpi.status = 'succeeded';
  const evt = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: tpi.id, status: 'succeeded' } } });
  ok('webhook con firma falsa → 400', (await req('POST', '/api/payments/stripe/webhook', evt, null, { 'Stripe-Signature': signed(evt, 'whsec_otro') })).s === 400);
  ok('webhook firmado → aceptado', (await req('POST', '/api/payments/stripe/webhook', evt, null, { 'Stripe-Signature': signed(evt, 'whsec_simulado') })).d?.received === true);
  ok('la app confirma después (no se abona dos veces)', (await req('POST', `/api/app/customer/wallet/topup/${tpi.id}`, null, C)).d?.wallet?.balance === 20);
  await req('POST', '/api/payments/stripe/webhook', evt, null, { 'Stripe-Signature': signed(evt, 'whsec_simulado') });
  const cw = (await req('GET', '/api/app/customer/wallet', null, C)).d;
  ok('webhook repetido: el saldo sigue en 20 (un solo abono)', cw.wallet.balance === 20 && cw.transactions.filter(t => /tarjeta/.test(t.description)).length === 1, cw.wallet);
} catch (e) {
  fail++; console.log('FAIL excepción:', e.stack, errOut.slice(-800));
} finally {
  sock?.disconnect(); srv.kill(); fake.close();
  await sleep(200); try { rmSync(dir, { recursive: true, force: true }); } catch {}
  console.log(`\n${pass} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}
