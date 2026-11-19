// Mensajes urgentes y notas de vídeo: validación, lo que se guarda, vista previa y accesos no autorizados.
// Uso: node test/urgent-videonote.test.mjs (desde frontend/backend)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'oldface-urgent-'));
fs.mkdirSync(path.join(DIR, 'data'));
fs.mkdirSync(path.join(DIR, 'uploads'));
for (const d of ['ai', 'db', 'payments', 'social']) fs.cpSync(path.join(SRC, d), path.join(DIR, d), { recursive: true });
fs.copyFileSync(path.join(SRC, 'server.js'), path.join(DIR, 'server.js'));
fs.copyFileSync(path.join(SRC, 'admin.html'), path.join(DIR, 'admin.html'));
fs.writeFileSync(path.join(DIR, 'uploads', 'nota.mp4'), 'x');

const id = (n) => `user_3462000000${n}`;
const ph = (n) => `+3462000000${n}`;
const [A, B, C] = [1, 2, 3].map(id);   // Ana y Bea chatean; Carlos es ajeno
const write = (f, v) => fs.writeFileSync(path.join(DIR, 'data', f), JSON.stringify(v));
const CHAT = `chat_${[A, B].sort().join('_')}`;
const SELF = `chat_${A}_${A}`;
const GID = 'group_1_urg', GCHAT = `group_${GID}`;
write('users.json', Object.fromEntries([1, 2, 3].map(n => [ph(n), { userId: id(n), name: `U${n}`, phone: ph(n) }])));
write('chats.json', {
  [CHAT]:  { id: CHAT, participants: [A, B], name: 'Chat', createdAt: 1, lastMessage: '', lastTime: 1 },
  [SELF]:  { id: SELF, participants: [A, A], name: 'Tú', createdAt: 1, lastMessage: '', lastTime: 1 },
  [GCHAT]: { id: GCHAT, isGroup: true, groupId: GID, participants: [A, B], name: 'G', createdAt: 1, lastMessage: '', lastTime: 1 },
});
write('messages.json', {});
write('groups.json', { [GID]: { id: GID, name: 'G', adminId: A, members: [A, B], memberNames: {}, createdAt: 1, updatedAt: 1 } });

const SECRET = 'test-secret';
const token = (uid) => { const exp = Math.floor(Date.now() / 1000) + 3600; return `${uid}.${exp}.${crypto.createHmac('sha256', SECRET).update(`${uid}.${exp}`).digest('base64url')}`; };
const PORT = 3994, BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, PORT, RTC_SECRET: SECRET, NODE_PATH: path.join(SRC, 'node_modules'), ADMIN_EMAIL: 'a@x.com', ADMIN_PASSWORD: 'pw',
  AUTH_MODE: 'exigir', DB_SOURCE: 'off' };
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
const post = (uid, body) => call('POST', '/messages', { senderId: uid, ...body }, as(uid));
const msgsOf = async (uid, cid = CHAT) => (await call('GET', `/messages/${cid}?userId=${uid}`, null, as(uid))).body.messages || [];
const chatsOf = async (uid) => (await call('GET', `/chats?userId=${uid}`, null, as(uid))).body.chats || [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const FILE = `${BASE}/files/nota.mp4`;

try {
  for (let i = 0; i < 50; i++) { try { await fetch(`${BASE}/health`); break; } catch { await sleep(200); } }

  // ── Accesos no autorizados ──
  check('urgente sin token → 401', (await call('POST', '/messages', { chatId: CHAT, senderId: A, text: 'x', urgent: true })).status === 401);
  check('urgente con token de otro (Carlos haciéndose pasar por Ana) → 403',
    (await call('POST', '/messages', { chatId: CHAT, senderId: A, text: 'x', urgent: true }, as(C))).status === 403);
  check('urgente a un chat ajeno → 403', (await post(C, { chatId: CHAT, text: 'x', urgent: true })).status === 403);
  check('nota de vídeo a un chat ajeno → 403',
    (await post(C, { chatId: CHAT, text: '🎥', type: 'video', url: FILE, videoNote: true })).status === 403);

  // ── Parámetros fuera de esquema ──
  check('urgent no booleano → 400', (await post(A, { chatId: CHAT, text: 'x', urgent: 'si' })).status === 400);
  check('videoNote no booleano → 400', (await post(A, { chatId: CHAT, text: 'x', type: 'video', url: FILE, videoNote: 1 })).status === 400);
  check('nota de vídeo con tipo texto → 400', (await post(A, { chatId: CHAT, text: 'x', videoNote: true })).status === 400);
  check('nota de vídeo sin archivo subido → 400',
    (await post(A, { chatId: CHAT, text: '🎥', type: 'video', url: 'https://otro.sitio/v.mp4', videoNote: true })).status === 400);
  check('nota de vídeo de "ver una vez" → 400',
    (await post(A, { chatId: CHAT, text: '🎥', type: 'video', url: FILE, videoNote: true, viewOnce: true })).status === 400);
  check('nada guardado tras los rechazos', (await msgsOf(A)).length === 0);

  // ── Urgente válido ──
  const u = await post(A, { chatId: CHAT, text: 'Llámame ya', urgent: true });
  check('urgente válido → 200 y marcado', u.status === 200 && u.body.urgent === true, JSON.stringify(u.body));
  const bm = await msgsOf(B);
  check('Bea lo recibe como urgente', bm.length === 1 && bm[0].urgent === true && bm[0].text === 'Llámame ya');
  const prevB = (await chatsOf(B)).find(c => c.id === CHAT) || {};
  check('vista previa con 🔴', String(prevB.lastMessage).startsWith('🔴 '), prevB.lastMessage);
  const n = await post(A, { chatId: CHAT, text: 'normal', urgent: false });
  check('urgent:false → mensaje normal sin marca', n.status === 200 && !('urgent' in n.body));
  const plain = await post(A, { chatId: CHAT, text: 'sin campo' });
  check('mensaje sin el campo (apps antiguas) sigue igual', plain.status === 200 && !('urgent' in plain.body) && !('videoNote' in plain.body));

  // Silenciado: el urgente se guarda y entrega igual (el aviso salta el silencio)
  check('Bea silencia el chat', (await call('PUT', `/mutes/${encodeURIComponent(CHAT)}`, { userId: B, until: 0 }, as(B))).status === 200);
  const um = await post(A, { chatId: CHAT, text: 'urgente con el chat silenciado', urgent: true });
  check('urgente con chat silenciado → 200 y urgente', um.status === 200 && um.body.urgent === true);

  // Chat "Tú": no se marca como urgente
  const self = await post(A, { chatId: SELF, text: 'nota para mí', urgent: true });
  check('en el chat "Tú" no queda urgente', self.status === 200 && !self.body.urgent, JSON.stringify(self.body));

  // Grupo: urgente válido
  const g = await post(B, { chatId: GCHAT, text: 'reunión ya', urgent: true });
  check('urgente en grupo → 200 y marcado', g.status === 200 && g.body.urgent === true);

  // ── Nota de vídeo válida ──
  const v = await post(A, { chatId: CHAT, text: '🎥', type: 'video', url: FILE, videoNote: true, duration: 12 });
  check('nota de vídeo → 200 y marcada', v.status === 200 && v.body.videoNote === true && v.body.type === 'video', JSON.stringify(v.body));
  const last = (await msgsOf(B)).at(-1) || {};
  check('Bea recibe la nota de vídeo con su enlace', last.videoNote === true && /\/files\/nota\.mp4$/.test(last.url || ''));
  const prevV = (await chatsOf(B)).find(c => c.id === CHAT) || {};
  check('vista previa "⭕ Nota de vídeo"', prevV.lastMessage === '⭕ Nota de vídeo', prevV.lastMessage);
  const vu = await post(A, { chatId: CHAT, text: '🎥', type: 'video', url: FILE, videoNote: true, urgent: true });
  check('nota de vídeo urgente → las dos marcas', vu.status === 200 && vu.body.videoNote === true && vu.body.urgent === true);

  // Carlos no ve nada del chat
  check('Carlos no puede leer el chat → 403', (await call('GET', `/messages/${CHAT}?userId=${C}`, null, as(C))).status === 403);

  // Bloqueo: lo urgente de quien está bloqueado tampoco llega
  check('Bea bloquea a Ana', (await call('PUT', `/blocks/${A}`, { userId: B, blocked: true }, as(B))).status === 200);
  const before = (await msgsOf(B)).length;
  const blk = await post(A, { chatId: CHAT, text: 'urgente bloqueado', urgent: true });
  check('urgente de bloqueado → Ana lo ve enviado', blk.status === 200);
  check('… pero Bea no lo recibe', (await msgsOf(B)).length === before);

  // Nunca se registra el contenido de los mensajes
  check('el log no contiene el texto de los mensajes', !log.includes('Llámame ya') && !log.includes('reunión ya'));
} catch (e) {
  fail++; console.log('FALLO  excepción', e.message, log.slice(-1500));
} finally {
  srv.kill();
  console.log(`\n${ok} OK, ${fail} fallos`);
  setTimeout(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch {} process.exit(fail ? 1 : 0); }, 300);
}
