// Mensajes sin leer de la lista de chats (GET /chats → unread, lastFromMe, lastType, lastRead).
// Cuenta solo mensajes de otros sin leer; no cuenta ocultos, eliminados ni propios; exige sesión y no da chats ajenos.
// Uso: node test/unread.test.mjs (desde frontend/backend)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'oldface-unread-'));
fs.mkdirSync(path.join(DIR, 'data'));
fs.mkdirSync(path.join(DIR, 'uploads'));
for (const d of ['ai', 'db', 'payments']) fs.cpSync(path.join(SRC, d), path.join(DIR, d), { recursive: true });
fs.copyFileSync(path.join(SRC, 'server.js'), path.join(DIR, 'server.js'));
fs.copyFileSync(path.join(SRC, 'admin.html'), path.join(DIR, 'admin.html'));

const id = (n) => `user_3460000000${n}`;
const ph = (n) => `+3460000000${n}`;
const [A, B, C] = [1, 2, 3].map(id);   // Ana y Bea chatean; Carlos solo está en el grupo
const write = (f, v) => fs.writeFileSync(path.join(DIR, 'data', f), JSON.stringify(v));
const CHAT = `chat_${[A, B].sort().join('_')}`;
const GID = 'group_1_test', GCHAT = `group_${GID}`;
write('users.json', Object.fromEntries([1, 2, 3].map(n => [ph(n), { userId: id(n), name: `U${n}`, phone: ph(n) }])));
write('chats.json', {
  [CHAT]:  { id: CHAT, participants: [A, B], name: 'Chat', createdAt: 1, lastMessage: 'x', lastTime: 2 },
  [GCHAT]: { id: GCHAT, isGroup: true, groupId: GID, participants: [A, B, C], name: 'G', createdAt: 1, lastMessage: '📷 Foto', lastTime: 1 },
});
const t = Date.now();
const m = (n, senderId, extra = {}) => ({ id: `m${n}`, chatId: CHAT, senderId, text: `texto ${n}`, type: 'text', createdAt: t + n, ...extra });
write('messages.json', {
  [CHAT]: [
    m(1, A, { readBy: [B] }),                 // mío (Ana): no cuenta
    m(2, B),                                  // sin leer
    m(3, B, { type: 'image' }),               // sin leer
    m(4, B, { hiddenFor: [A] }),              // oculto para Ana: no cuenta
    m(5, B, { deleted: true }),               // eliminado: no cuenta
    m(6, B, { type: 'deleted' }),             // eliminado para todos: no cuenta
    m(7, B, { type: 'image', viewOnce: true, openedBy: [] }),   // "ver una vez" sin abrir: cuenta (sin dar contenido)
    m(8, B, { readBy: [A] }),                 // ya leído
    m(9, A),                                  // último: mío, Bea aún no lo ha leído
  ],
  [GCHAT]: [{ id: 'g1', chatId: GCHAT, senderId: C, text: '', type: 'image', createdAt: t }],
});
write('groups.json', { [GID]: { id: GID, name: 'G', adminId: A, members: [A, B, C], memberNames: {}, createdAt: 1, updatedAt: 1 } });

const SECRET = 'test-secret';
const token = (uid) => { const exp = Math.floor(Date.now() / 1000) + 3600; return `${uid}.${exp}.${crypto.createHmac('sha256', SECRET).update(`${uid}.${exp}`).digest('base64url')}`; };
const PORT = 3991, BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, PORT, RTC_SECRET: SECRET, NODE_PATH: path.join(SRC, 'node_modules'), ADMIN_EMAIL: 'a@x.com', ADMIN_PASSWORD: 'pw', AUTH_MODE: 'exigir', DB_SOURCE: 'off' };
delete env.RTC_INTERNAL_URL;
const srv = spawn(process.execPath, ['server.js'], { cwd: DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => { cond ? ok++ : fail++; console.log(`${cond ? 'OK ' : 'FALLO'}  ${name}${cond ? '' : '  ' + extra}`); };
const call = async (method, p, body, headers = {}) => {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const as = (uid) => ({ Authorization: `Bearer ${token(uid)}` });
const chatsOf = async (uid) => (await call('GET', `/chats?userId=${uid}`, null, as(uid))).body.chats || [];
const find = (list, cid) => list.find(c => c.id === cid) || {};

try {
  for (let i = 0; i < 50; i++) { try { await fetch(`${BASE}/health`); break; } catch { await new Promise(r => setTimeout(r, 200)); } }

  // ── Autorización ──
  check('sin token → 401', (await call('GET', `/chats?userId=${A}`)).status === 401);
  check('token de otro usuario → 403', (await call('GET', `/chats?userId=${A}`, null, as(B))).status === 403);
  const cList = await chatsOf(C);
  check('Carlos no ve el chat de Ana y Bea', !cList.some(c => c.id === CHAT) && cList.some(c => c.id === GCHAT));

  // ── Recuento de Ana ──
  let a = await chatsOf(A);
  let ab = find(a, CHAT);
  check('Ana: 3 sin leer (no cuenta propios, ocultos, eliminados ni leídos)', ab.unread === 3, `unread=${ab.unread}`);
  check('Ana: último mensaje es suyo, de texto y sin leer por Bea', ab.lastFromMe === true && ab.lastType === 'text' && ab.lastRead === false,
    JSON.stringify({ f: ab.lastFromMe, t: ab.lastType, r: ab.lastRead }));
  const g = find(a, GCHAT);
  check('Ana: grupo con 1 sin leer y último de tipo foto de otro', g.unread === 1 && g.lastType === 'image' && g.lastFromMe === false && !('lastRead' in g),
    JSON.stringify({ u: g.unread, t: g.lastType, f: g.lastFromMe }));
  check('la lista no trae el texto de los mensajes', !JSON.stringify(a).includes('texto 2'));

  // ── Recuento de Bea (ve el mensaje oculto para Ana) ──
  let b = await chatsOf(B);
  check('Bea: 1 sin leer (el último de Ana)', find(b, CHAT).unread === 1, `unread=${find(b, CHAT).unread}`);
  check('Bea: último mensaje no es suyo', find(b, CHAT).lastFromMe === false && !('lastRead' in find(b, CHAT)));

  // ── Al leer baja a 0 y el otro ve ✓✓ azul ──
  check('Ana marca leído', (await call('POST', `/messages/${CHAT}/mark-read`, { userId: A }, as(A))).status === 200);
  check('Ana: 0 sin leer tras leer', find(await chatsOf(A), CHAT).unread === 0);
  check('Ana: aún sin ✓✓ azul (Bea no ha leído)', find(await chatsOf(A), CHAT).lastRead === false);
  await call('POST', `/messages/${CHAT}/mark-read`, { userId: B }, as(B));
  check('Ana: ✓✓ azul cuando Bea lee', find(await chatsOf(A), CHAT).lastRead === true);
  check('Bea: 0 sin leer tras leer', find(await chatsOf(B), CHAT).unread === 0);
  check('no puede marcar leído un chat ajeno → 403', (await call('POST', `/messages/${CHAT}/mark-read`, { userId: C }, as(C))).status === 403);

  // ── Un mensaje nuevo vuelve a contar ──
  check('Bea envía', (await call('POST', '/messages', { chatId: CHAT, senderId: B, text: 'nuevo' }, as(B))).status === 200);
  a = await chatsOf(A); ab = find(a, CHAT);
  check('Ana: 1 sin leer tras mensaje nuevo', ab.unread === 1 && ab.lastFromMe === false, `unread=${ab.unread}`);
} catch (e) {
  fail++; console.log('ERROR', e.stack);
} finally {
  srv.kill();
  console.log(`\n${ok} OK · ${fail} fallos`);
  if (fail) console.log(log.split('\n').filter(l => /error|❌|warn/i.test(l)).slice(-15).join('\n'));
  process.exit(fail ? 1 : 0);
}
