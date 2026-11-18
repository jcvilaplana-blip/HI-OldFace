// Opciones del chat: bloquear, vaciar, chat "Tú" (contigo mismo) y recordatorios que llegan a ese chat.
// Comprueba también la vista previa por usuario en GET /chats y los accesos no autorizados.
// Uso: node test/chat-options.test.mjs (desde frontend/backend)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'oldface-chatopts-'));
fs.mkdirSync(path.join(DIR, 'data'));
fs.mkdirSync(path.join(DIR, 'uploads'));
for (const d of ['ai', 'db', 'payments', 'social']) fs.cpSync(path.join(SRC, d), path.join(DIR, d), { recursive: true });
fs.copyFileSync(path.join(SRC, 'server.js'), path.join(DIR, 'server.js'));
fs.copyFileSync(path.join(SRC, 'admin.html'), path.join(DIR, 'admin.html'));

const id = (n) => `user_3461000000${n}`;
const ph = (n) => `+3461000000${n}`;
const [A, B, C] = [1, 2, 3].map(id);   // Ana y Bea chatean; Carlos es ajeno; grupo de los tres
const write = (f, v) => fs.writeFileSync(path.join(DIR, 'data', f), JSON.stringify(v));
const CHAT = `chat_${[A, B].sort().join('_')}`;
const GID = 'group_1_opts', GCHAT = `group_${GID}`;
write('users.json', Object.fromEntries([1, 2, 3].map(n => [ph(n), { userId: id(n), name: `U${n}`, phone: ph(n) }])));
write('chats.json', {
  [CHAT]:  { id: CHAT, participants: [A, B], name: 'Chat', createdAt: 1, lastMessage: 'hola', lastTime: 2 },
  [GCHAT]: { id: GCHAT, isGroup: true, groupId: GID, participants: [A, B, C], name: 'G', createdAt: 1, lastMessage: '', lastTime: 1 },
});
const t = Date.now();
write('messages.json', {
  [CHAT]: [
    { id: 'm1', chatId: CHAT, senderId: A, text: 'hola', type: 'text', createdAt: t },
    { id: 'm2', chatId: CHAT, senderId: B, text: 'qué tal', type: 'text', createdAt: t + 1 },
  ],
});
write('groups.json', { [GID]: { id: GID, name: 'G', adminId: A, members: [A, B, C], memberNames: {}, createdAt: 1, updatedAt: 1 } });

const SECRET = 'test-secret';
const token = (uid) => { const exp = Math.floor(Date.now() / 1000) + 3600; return `${uid}.${exp}.${crypto.createHmac('sha256', SECRET).update(`${uid}.${exp}`).digest('base64url')}`; };
const PORT = 3993, BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, PORT, RTC_SECRET: SECRET, NODE_PATH: path.join(SRC, 'node_modules'), ADMIN_EMAIL: 'a@x.com', ADMIN_PASSWORD: 'pw',
  AUTH_MODE: 'exigir', DB_SOURCE: 'off', REMINDER_TICK_MS: '300' };
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
const msgsOf = async (uid, cid = CHAT) => (await call('GET', `/messages/${cid}?userId=${uid}`, null, as(uid))).body.messages || [];
const chatsOf = async (uid) => (await call('GET', `/chats?userId=${uid}`, null, as(uid))).body.chats || [];
const find = (list, cid) => list.find(c => c.id === cid) || {};
const send = (uid, text, cid = CHAT) => call('POST', '/messages', { chatId: cid, senderId: uid, text }, as(uid));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

try {
  for (let i = 0; i < 50; i++) { try { await fetch(`${BASE}/health`); break; } catch { await sleep(200); } }

  // ── Bloquear: autorización y parámetros ──
  check('bloquear sin token → 401', (await call('PUT', `/blocks/${B}`, { userId: A, blocked: true })).status === 401);
  check('bloquear con token de otro → 403', (await call('PUT', `/blocks/${B}`, { userId: A, blocked: true }, as(C))).status === 403);
  check('bloquear con blocked no booleano → 400', (await call('PUT', `/blocks/${B}`, { userId: A, blocked: 'si' }, as(A))).status === 400);
  check('bloquearse a uno mismo → 404', (await call('PUT', `/blocks/${A}`, { userId: A, blocked: true }, as(A))).status === 404);
  check('bloquear a quien no existe → 404', (await call('PUT', '/blocks/user_nadie', { userId: A, blocked: true }, as(A))).status === 404);
  check('ver bloqueados sin token → 401', (await call('GET', `/blocks?userId=${A}`)).status === 401);
  check('ver bloqueados de otro → 403', (await call('GET', `/blocks?userId=${A}`, null, as(B))).status === 403);

  // ── Ana bloquea a Bea ──
  check('Ana bloquea a Bea', (await call('PUT', `/blocks/${B}`, { userId: A, blocked: true }, as(A))).status === 200);
  const bl = (await call('GET', `/blocks?userId=${A}`, null, as(A))).body.blocked || [];
  check('Ana ve a Bea en su lista de bloqueados', bl.length === 1 && bl[0].userId === B && bl[0].name === 'U2');
  check('Bea no ve bloqueados suyos', ((await call('GET', `/blocks?userId=${B}`, null, as(B))).body.blocked || []).length === 0);
  check('Ana no puede escribir a Bea → 403', (await send(A, 'no debería')).status === 403);
  const sent = await send(B, 'mensaje oculto para Ana');
  check('Bea sí puede enviar (lo ve enviado)', sent.status === 200 && sent.body.text === 'mensaje oculto para Ana');
  check('la respuesta no delata el bloqueo (sin hiddenFor)', sent.status === 200 && !('hiddenFor' in sent.body));
  check('Bea ve su mensaje en el chat', (await msgsOf(B)).some(m => m.text === 'mensaje oculto para Ana'));
  check('Ana NO ve el mensaje de Bea', !(await msgsOf(A)).some(m => m.text === 'mensaje oculto para Ana'));
  check('ningún mensaje entregado lleva hiddenFor', (await msgsOf(B)).every(m => !('hiddenFor' in m)));
  const aChat = find(await chatsOf(A), CHAT);
  check('vista previa de Ana: no muestra el mensaje bloqueado', aChat.lastMessage === 'qué tal' && aChat.unread === 1, JSON.stringify({ l: aChat.lastMessage, u: aChat.unread }));
  check('vista previa de Bea: su último mensaje', find(await chatsOf(B), CHAT).lastMessage === 'mensaje oculto para Ana');
  check('en el grupo Ana sí puede escribir', (await send(A, 'en el grupo', GCHAT)).status === 200);
  check('en el grupo Ana sí ve a Bea', (await send(B, 'grupo de Bea', GCHAT)).status === 200 && (await msgsOf(A, GCHAT)).some(m => m.text === 'grupo de Bea'));
  check('Ana no puede llamar a Bea → 403', (await call('POST', '/call-notification', { callerId: A, calleeId: B, callType: 'voice' }, as(A))).status === 403);
  const callB = await call('POST', '/call-notification', { callerId: B, calleeId: A, callType: 'voice' }, as(B));
  check('la llamada de Bea a Ana no suena', callB.status === 200 && callB.body.success === false);

  // ── Desbloquear ──
  check('Ana desbloquea a Bea', (await call('PUT', `/blocks/${B}`, { userId: A, blocked: false }, as(A))).status === 200);
  check('Ana vuelve a poder escribir', (await send(A, 'ya te escribo')).status === 200);
  await send(B, 'ahora sí');
  check('Ana ve lo nuevo de Bea', (await msgsOf(A)).some(m => m.text === 'ahora sí'));
  check('lo enviado mientras estaba bloqueada sigue oculto para Ana', !(await msgsOf(A)).some(m => m.text === 'mensaje oculto para Ana'));

  // ── Vaciar chat ──
  check('vaciar sin token → 401', (await call('POST', `/chats/${CHAT}/clear`, { userId: A })).status === 401);
  check('vaciar con token de otro → 403', (await call('POST', `/chats/${CHAT}/clear`, { userId: A }, as(B))).status === 403);
  check('vaciar un chat ajeno → 403', (await call('POST', `/chats/${CHAT}/clear`, { userId: C }, as(C))).status === 403);
  const cl = await call('POST', `/chats/${CHAT}/clear`, { userId: A }, as(A));
  check('Ana vacía el chat', cl.status === 200 && cl.body.cleared > 0);
  check('Ana ya no ve mensajes', (await msgsOf(A)).length === 0);
  check('Bea los sigue viendo todos', (await msgsOf(B)).length >= 5);
  const aClear = find(await chatsOf(A), CHAT);
  check('Ana: el chat sigue en su lista, sin vista previa ni sin leer', aClear.id === CHAT && aClear.lastMessage === '' && aClear.unread === 0,
    JSON.stringify({ l: aClear.lastMessage, u: aClear.unread }));
  check('vaciar dos veces no falla', (await call('POST', `/chats/${CHAT}/clear`, { userId: A }, as(A))).body.cleared === 0);
  await send(B, 'tras vaciar');
  check('lo nuevo tras vaciar sí le llega a Ana', (await msgsOf(A)).map(m => m.text).join() === 'tras vaciar');

  // ── Chat "Tú" ──
  const SELF = `chat_${A}_${A}`;
  check('abrir chat Tú sin token → 401', (await call('POST', '/chats/self', { userId: A })).status === 401);
  check('abrir chat Tú de otro → 403', (await call('POST', '/chats/self', { userId: A }, as(B))).status === 403);
  const self = await call('POST', '/chats/self', { userId: A }, as(A));
  check('Ana abre su chat Tú', self.status === 200 && self.body.id === SELF && self.body.self === true);
  check('abrirlo otra vez devuelve el mismo', (await call('POST', '/chats/self', { userId: A }, as(A))).body.id === SELF);
  check('Ana escribe una nota en su chat Tú', (await send(A, 'nota para mí', SELF)).status === 200);
  const aSelf = find(await chatsOf(A), SELF);
  check('aparece en su lista como "Tú", sin sin leer', aSelf.self === true && aSelf.name === 'Tú' && aSelf.unread === 0 && aSelf.lastMessage === 'nota para mí');
  check('Bea no ve el chat Tú de Ana', !(await chatsOf(B)).some(c => c.id === SELF));
  check('Bea no puede leer el chat Tú de Ana → 403', (await call('GET', `/messages/${SELF}?userId=${B}`, null, as(B))).status === 403);
  check('Bea no puede escribir en el chat Tú de Ana → 403', (await send(B, 'intruso', SELF)).status === 403);
  check('Bea no puede vaciar el chat Tú de Ana → 403', (await call('POST', `/chats/${SELF}/clear`, { userId: B }, as(B))).status === 403);

  // ── Recordatorio → chat Tú (el de Bea aún no existe: se crea) ──
  const rem = await call('POST', '/reminders', { userId: B, text: 'llamar al médico', at: Date.now() + 400 }, as(B));
  check('Bea crea un recordatorio', rem.status === 201);
  let bSelf = [];
  for (let i = 0; i < 20 && !bSelf.length; i++) { await sleep(300); bSelf = await msgsOf(B, `chat_${B}_${B}`); }
  check('el recordatorio llega al chat Tú de Bea', bSelf.length === 1 && bSelf[0].text === '⏰ llamar al médico' && bSelf[0].reminder === true,
    JSON.stringify(bSelf.map(m => m.text)));
  check('el chat Tú de Bea aparece en su lista', find(await chatsOf(B), `chat_${B}_${B}`).self === true);
  check('Ana no ve el recordatorio de Bea', !(await chatsOf(A)).some(c => c.id === `chat_${B}_${B}`));
} catch (e) {
  fail++; console.log('ERROR', e.stack);
} finally {
  srv.kill();
  console.log(`\n${ok} OK · ${fail} fallos`);
  if (fail) console.log(log.split('\n').filter(l => /error|❌|warn/i.test(l)).slice(-15).join('\n'));
  process.exit(fail ? 1 : 0);
}
