// Directos solo para contactos y de pago: acceso (contactos, pase), enlaces firmados de las grabaciones, pagos con
// tarjeta (Stripe simulado + aviso firmado), códigos de un uso, ganancias, retiradas y devoluciones del administrador.
// Uso: npm test (desde frontend/backend) · node test/directos.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'oldface-directos-'));
fs.mkdirSync(path.join(DIR, 'data'));
fs.mkdirSync(path.join(DIR, 'uploads'));
for (const d of ['ai', 'db', 'payments']) fs.cpSync(path.join(SRC, d), path.join(DIR, d), { recursive: true });
fs.copyFileSync(path.join(SRC, 'server.js'), path.join(DIR, 'server.js'));
fs.copyFileSync(path.join(SRC, 'admin.html'), path.join(DIR, 'admin.html'));

const id = (n) => `user_3461000000${n}`;
const ph = (n) => `+3461000000${n}`;
const [H, C1, C2, C3, X] = [1, 2, 3, 4, 5].map(id);   // H emite; C1-C3 son sus contactos; X no lo es
const write = (f, v) => fs.writeFileSync(path.join(DIR, 'data', f), JSON.stringify(v));
write('users.json', Object.fromEntries([1, 2, 3, 4, 5].map(n => [ph(n), { userId: id(n), name: `U${n}`, phone: ph(n) }])));
write('user_contacts.json', { [H]: [C1, C2, C3] });
write('live_settings.json', { mode: 'admin', broadcasters: [H.toLowerCase()] });
write('directos.json', {
  d1: { id: 'd1', creatorId: H, title: 'De pago', visibility: 'public', contacts: [], price: 3, status: 'live', createdAt: 2 },
  d0: { id: 'd0', creatorId: H, title: 'Gratis', visibility: 'contacts', contacts: [], price: 0, status: 'live', createdAt: 1 },
});
write('live_recordings.json', {
  r1: { id: 'r1', directoId: 'd1', ownerId: H, file: 'live_d1.webm', title: 'De pago', visibility: 'public', contacts: [],
        published: true, hiddenByAdmin: false, views: 0, createdAt: 2, duration: 10 },
});
write('live_earnings.json', { [H]: { balance: 50, earned: 50, withdrawn: 0, moves: [] } });
fs.writeFileSync(path.join(DIR, 'uploads', 'live_d1.webm'), Buffer.alloc(2048, 7));
fs.writeFileSync(path.join(DIR, 'uploads', 'm_publico.png'), Buffer.alloc(200, 1));

// ── Stripe simulado ──
const intents = new Map();
let refunds = 0;
const stripeSrv = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => {
    const send = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers.authorization !== 'Bearer sk_test_x') return send({ error: { message: 'bad key' } }, 401);
    if (req.method === 'POST' && req.url === '/v1/payment_intents') {
      const p = new URLSearchParams(body);
      const pi = { id: `pi_${intents.size + 1}`, client_secret: `pi_${intents.size + 1}_secret`, status: 'requires_payment_method',
                   amount: Number(p.get('amount')), metadata: { app: p.get('metadata[app]') } };
      intents.set(pi.id, pi);
      return send(pi);
    }
    const m = req.url.match(/^\/v1\/payment_intents\/([^/?]+)$/);
    if (req.method === 'GET' && m) return intents.has(m[1]) ? send(intents.get(m[1])) : send({ error: { message: 'no' } }, 404);
    if (req.method === 'POST' && req.url === '/v1/refunds') { refunds++; return send({ id: 're_1', status: 'succeeded' }); }
    send({ error: { message: 'ruta' } }, 404);
  });
});
await new Promise(r => stripeSrv.listen(0, '127.0.0.1', r));

const SECRET = 'test-secret', WHSEC = 'whsec_test';
const token = (uid) => { const exp = Math.floor(Date.now() / 1000) + 3600; return `${uid}.${exp}.${crypto.createHmac('sha256', SECRET).update(`${uid}.${exp}`).digest('base64url')}`; };
const PORT = 3993, BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, PORT, RTC_SECRET: SECRET, NODE_PATH: path.join(SRC, 'node_modules'), ADMIN_EMAIL: 'a@x.com', ADMIN_PASSWORD: 'pw',
              DB_SOURCE: 'off', FFMPEG_PATH: 'none', AI_MEDIA: 'off', PUBLIC_FILES_URL: `${BASE}/files/`,
              STRIPE_API_BASE: `http://127.0.0.1:${stripeSrv.address().port}`, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PUBLISHABLE_KEY: 'pk_test_x',
              STRIPE_WEBHOOK_SECRET: WHSEC };
delete env.RTC_INTERNAL_URL;
const srv = spawn(process.execPath, ['server.js'], { cwd: DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => { cond ? ok++ : fail++; console.log(`${cond ? 'OK ' : 'FALLO'}  ${name}${cond ? '' : '  ' + extra}`); };
const call = async (method, p, body, headers = {}) => {
  const r = await fetch(p.startsWith('http') ? p : BASE + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const as = (uid) => ({ Authorization: `Bearer ${token(uid)}` });
const internal = { 'x-internal-secret': SECRET };
const webhook = (event, secret = WHSEC) => {
  const raw = JSON.stringify(event), t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return fetch(`${BASE}/api/payments/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${sig}` }, body: raw });
};
const recOf = async (uid) => (await call('GET', `/directos/recordings?userId=${uid}`, null, as(uid))).body.recordings || [];
const earnings = async () => (await call('GET', `/directos/earnings?userId=${H}`, null, as(H))).body;

try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* aún arrancando */ } await new Promise(r => setTimeout(r, 250)); }

  // ── Solo contactos ──
  const dirH = (await call('GET', `/directos?userId=${H}`, null, as(H))).body.directos || [];
  check('los directos públicos pasan a "solo contactos"', dirH.every(d => d.visibility === 'contacts') && dirH.length === 2);
  check('X (no contacto) no ve ningún directo', ((await call('GET', `/directos?userId=${X}`, null, as(X))).body.directos || []).length === 0);
  check('X: GET /directos/d1 → 404', (await call('GET', `/directos/d1?userId=${X}`, null, as(X))).status === 404);
  check('X: el servidor RTC tampoco lo obtiene (404)', (await call('GET', `/directos/d1?userId=${X}`, null, internal)).status === 404);
  check('X: no ve la grabación', (await recOf(X)).length === 0);
  check('crear un directo "público" lo deja en contactos', (await call('POST', '/directos', { userId: H, title: 'P', visibility: 'public', price: 0 }, as(H))).body.visibility === 'contacts');

  // ── De pago sin pase ──
  const d1C1 = (await call('GET', `/directos/d1?userId=${C1}`, null, internal)).body;
  check('C1 ve d1 bloqueado (precio 3, canWatch false)', d1C1.locked === true && d1C1.price === 3 && d1C1.canWatch === false);
  check('C1 puede ver d0 (gratis)', (await call('GET', `/directos/d0?userId=${C1}`, null, internal)).body.canWatch === true);
  check('el emisor ve d1 (canWatch)', (await call('GET', `/directos/d1?userId=${H}`, null, internal)).body.canWatch === true);
  let r1 = (await recOf(C1))[0];
  check('C1: grabación bloqueada sin enlace al vídeo', r1 && r1.locked === true && r1.url === null && r1.price === 3);
  check('C1: no cuenta vista en grabación bloqueada (404)', (await call('POST', '/directos/recordings/r1/view', { userId: C1 }, as(C1))).status === 404);

  // ── Enlaces firmados ──
  const urlH = (await recOf(H))[0]?.url || '';
  check('el emisor recibe enlace firmado', /\/files\/live_d1\.webm\?e=\d+&s=/.test(urlH), urlH);
  check('vídeo con firma → 200', (await fetch(urlH)).status === 200);
  check('vídeo sin firma → 403', (await fetch(`${BASE}/files/live_d1.webm`)).status === 403);
  check('vídeo con firma cambiada → 403', (await fetch(urlH.replace(/s=.{4}/, 's=AAAA'))).status === 403);
  const e = Number(new URL(urlH).searchParams.get('e'));
  check('vídeo con caducidad cambiada → 403', (await fetch(urlH.replace(`e=${e}`, `e=${e + 3600}`))).status === 403);
  check('los demás archivos siguen igual (200)', (await fetch(`${BASE}/files/m_publico.png`)).status === 200);

  // ── Precio ──
  check('precio 0,50 € → 400', (await call('POST', '/directos', { userId: H, title: 'x', price: 0.5 }, as(H))).status === 400);
  check('precio 250 € → 400', (await call('POST', '/directos', { userId: H, title: 'x', price: 250 }, as(H))).status === 400);
  check('precio 5 € → 201', (await call('POST', '/directos', { userId: H, title: 'x', price: 5 }, as(H))).status === 201);
  check('editar a precio no válido → 400', (await call('PUT', '/directos/d1', { userId: H, price: -3 }, as(H))).status === 400);

  // ── Pago con tarjeta ──
  const cfg = (await call('GET', `/directos/pay/config?userId=${C1}`, null, as(C1))).body;
  check('config: lista, modo pruebas, comisión 20 %', cfg.ready && cfg.testMode && cfg.publishableKey === 'pk_test_x' && cfg.feePercent === 20);
  check('pagar sin sesión → 401', (await call('POST', '/directos/pay', { userId: C1, id: 'd1' })).status === 401);
  check('pagar con sesión de otro → 401', (await call('POST', '/directos/pay', { userId: C1, id: 'd1' }, as(C2))).status === 401);
  check('X (no contacto) no puede pagar → 404', (await call('POST', '/directos/pay', { userId: X, id: 'd1' }, as(X))).status === 404);
  check('el emisor no paga lo suyo', (await call('POST', '/directos/pay', { userId: H, id: 'd1' }, as(H))).body.already === true);
  check('directo gratis: no hay que pagar', (await call('POST', '/directos/pay', { userId: C1, id: 'd0' }, as(C1))).body.already === true);
  const pay = (await call('POST', '/directos/pay', { userId: C1, kind: 'recording', id: 'r1' }, as(C1))).body;
  check('C1 empieza el pago (3 €)', pay.clientSecret && pay.amount === 3 && [...intents.values()].at(-1)?.amount === 300, JSON.stringify(pay));
  check('confirmar sin pagar → 402', (await call('POST', '/directos/pay/confirm', { userId: C1, paymentId: pay.paymentId }, as(C1))).status === 402);
  check('otro no puede confirmar el pago de C1 → 404', (await call('POST', '/directos/pay/confirm', { userId: C2, paymentId: pay.paymentId }, as(C2))).status === 404);
  const pi = [...intents.values()].at(-1);
  pi.status = 'succeeded';
  check('confirmar tras pagar → ok', (await call('POST', '/directos/pay/confirm', { userId: C1, paymentId: pay.paymentId }, as(C1))).body.ok === true);
  check('confirmar otra vez → ok', (await call('POST', '/directos/pay/confirm', { userId: C1, paymentId: pay.paymentId }, as(C1))).body.ok === true);
  check('aviso de Stripe del mismo pago → 200', (await webhook({ type: 'payment_intent.succeeded', data: { object: { id: pi.id, metadata: { app: 'oldface-live' } } } })).status === 200);
  const earn = await earnings();
  check('el emisor recibe 2,40 € una sola vez (3 € − 20 %)', earn.balance === 52.4 && earn.moves.filter(m => m.kind === 'sale').length === 1, JSON.stringify(earn.balance));
  check('C1 ya puede ver d1 (canWatch, también en vivo)', (await call('GET', `/directos/d1?userId=${C1}`, null, internal)).body.canWatch === true);
  r1 = (await recOf(C1))[0];
  check('C1 recibe el enlace de la grabación', r1.locked === false && /live_d1\.webm\?e=/.test(r1.url || ''));
  check('C2 sigue bloqueado', (await call('GET', `/directos/d1?userId=${C2}`, null, internal)).body.canWatch === false);
  check('aviso con firma falsa → 400', (await webhook({ type: 'payment_intent.succeeded', data: { object: { id: pi.id } } }, 'whsec_otro')).status === 400);
  check('aviso de un cobro ajeno (taxi) → 200 y se ignora', (await webhook({ type: 'payment_intent.succeeded', data: { object: { id: 'pi_taxi', metadata: { kind: 'topup' } } } })).status === 200
        && (await earnings()).balance === 52.4);

  // ── Códigos ──
  check('C1 no puede crear códigos de d1 → 404', (await call('POST', '/directos/d1/codes', { userId: C1, count: 1 }, as(C1))).status === 404);
  check('crear 0 códigos → 400', (await call('POST', '/directos/d1/codes', { userId: H, count: 0 }, as(H))).status === 400);
  const codes = (await call('POST', '/directos/d1/codes', { userId: H, count: 2 }, as(H))).body.codes || [];
  check('el emisor crea 2 códigos de 8 caracteres', codes.length === 2 && codes.every(c => /^[A-Z2-9]{8}$/.test(c.code)));
  check('X no puede canjear (no es contacto) → 404', (await call('POST', '/directos/redeem', { userId: X, id: 'd1', code: codes[0].code }, as(X))).status === 404);
  check('código falso → 400', (await call('POST', '/directos/redeem', { userId: C2, id: 'd1', code: 'ZZZZZZZZ' }, as(C2))).status === 400);
  check('C2 canjea el código (en minúsculas también vale)', (await call('POST', '/directos/redeem', { userId: C2, id: 'd1', code: codes[0].code.toLowerCase() }, as(C2))).body.ok === true);
  check('C2 ya puede ver d1', (await call('GET', `/directos/d1?userId=${C2}`, null, internal)).body.canWatch === true);
  check('C3 no puede usar un código ya usado → 400', (await call('POST', '/directos/redeem', { userId: C3, id: 'd1', code: codes[0].code }, as(C3))).status === 400);
  const list = (await call('GET', `/directos/d1/codes?userId=${H}`, null, as(H))).body.codes || [];
  check('el emisor ve quién usó el código', list.find(c => c.code === codes[0].code)?.usedByName === 'U3');
  check('no se puede anular un código usado → 400', (await call('DELETE', `/directos/d1/codes/${codes[0].code}?userId=${H}`, null, as(H))).status === 400);
  check('anular un código sin usar', (await call('DELETE', `/directos/d1/codes/${codes[1].code}?userId=${H}`, null, as(H))).body.success === true);
  check('C3 no puede usar el código anulado → 400', (await call('POST', '/directos/redeem', { userId: C3, id: 'd1', code: codes[1].code }, as(C3))).status === 400);
  let limited = false;
  for (let i = 0; i < 12; i++) if ((await call('POST', '/directos/redeem', { userId: C3, id: 'd1', code: 'AAAAAAA' + i }, as(C3))).status === 429) limited = true;
  check('demasiados intentos de código → 429', limited);

  // ── Retiradas ──
  const IBAN = 'ES91 2100 0418 4502 0005 1332';
  check('retirada < 10 € → 400', (await call('POST', '/directos/earnings/withdraw', { userId: H, amount: 5, holder: 'Hugo H', iban: IBAN }, as(H))).status === 400);
  check('retirada > saldo → 400', (await call('POST', '/directos/earnings/withdraw', { userId: H, amount: 500, holder: 'Hugo H', iban: IBAN }, as(H))).status === 400);
  check('IBAN no válido → 400', (await call('POST', '/directos/earnings/withdraw', { userId: H, amount: 20, holder: 'Hugo H', iban: 'ES0000000000000000000000' }, as(H))).status === 400);
  const wd = await call('POST', '/directos/earnings/withdraw', { userId: H, amount: 20, holder: 'Hugo H', iban: IBAN }, as(H));
  check('retirada de 20 € con la cuenta tapada', wd.status === 201 && wd.body.account === 'ES91 •••• 1332', JSON.stringify(wd.body));
  check('segunda retirada pendiente → 409', (await call('POST', '/directos/earnings/withdraw', { userId: H, amount: 10, holder: 'Hugo H', iban: IBAN }, as(H))).status === 409);
  check('el saldo baja a 32,40 €', (await earnings()).balance === 32.4);
  const raw = fs.readFileSync(path.join(DIR, 'data', 'live_withdrawals.json'), 'utf8');
  check('la cuenta bancaria está cifrada en el archivo', !raw.includes('2100') && raw.includes('v1:'));

  // ── Administrador ──
  check('admin sin sesión → 401', (await call('GET', '/admin/live/payments')).status === 401);
  const adm = { 'x-admin-token': (await call('POST', '/admin/login', { email: 'a@x.com', password: 'pw' })).body.token };
  const ap = (await call('GET', '/admin/live/payments', null, adm)).body;
  check('admin ve el cobro y la comisión, sin la clave', ap.payments?.length === 1 && ap.totals?.fee === 0.6 && !JSON.stringify(ap).includes('pk_test_x'));
  const aw = (await call('GET', '/admin/live/withdrawals', null, adm)).body.withdrawals || [];
  check('admin ve la cuenta completa', aw[0]?.account === 'ES9121000418450200051332');
  check('admin rechaza la retirada → vuelve al saldo', (await call('PUT', `/admin/live/withdrawals/${wd.body.id}`, { status: 'rejected', note: 'IBAN de prueba' }, adm)).body.status === 'rejected'
        && (await earnings()).balance === 52.4);
  check('no se puede resolver dos veces → 409', (await call('PUT', `/admin/live/withdrawals/${wd.body.id}`, { status: 'paid' }, adm)).status === 409);
  check('admin devuelve el pago de C1', (await call('POST', `/admin/live/payments/${pay.paymentId}/refund`, null, adm)).body.success === true && refunds === 1);
  check('C1 pierde el pase', (await call('GET', `/directos/d1?userId=${C1}`, null, internal)).body.canWatch === false);
  check('al emisor se le descuentan 2,40 €', (await earnings()).balance === 50);
  check('no se devuelve dos veces → 404', (await call('POST', `/admin/live/payments/${pay.paymentId}/refund`, null, adm)).status === 404);
  const ar = (await call('GET', '/admin/live/recordings', null, adm)).body.recordings || [];
  check('admin recibe la grabación con enlace firmado', /live_d1\.webm\?e=/.test(ar[0]?.url || ''));
} catch (e) {
  fail++; console.log('FALLO  excepción', e.stack);
} finally {
  srv.kill(); stripeSrv.close();
  if (fail) console.log(log.slice(-3000));
  console.log(`\n${ok} OK · ${fail} fallos`);
  await new Promise(r => setTimeout(r, 500));
  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* Windows: el proceso aún la tiene abierta */ }
  process.exit(fail ? 1 : 0);
}
