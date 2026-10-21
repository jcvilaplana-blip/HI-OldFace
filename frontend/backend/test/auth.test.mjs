// Fase 0: sesión obligatoria. Cada ruta de usuario: sin token → 401, token de otro → 403, chat/grupo ajeno → 403,
// con su sesión → OK. Uso: npm test (desde frontend/backend) · node test/auth.test.mjs registro (modo de emergencia)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODE = process.argv[2] || 'exigir';
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), `oldface-auth-${MODE}-`));
fs.mkdirSync(path.join(DIR, 'data'));
fs.mkdirSync(path.join(DIR, 'uploads'));
fs.cpSync(path.join(SRC, 'ai'), path.join(DIR, 'ai'), { recursive: true });
fs.cpSync(path.join(SRC, 'db'), path.join(DIR, 'db'), { recursive: true });
fs.cpSync(path.join(SRC, 'payments'), path.join(DIR, 'payments'), { recursive: true });
fs.copyFileSync(path.join(SRC, 'server.js'), path.join(DIR, 'server.js'));
fs.copyFileSync(path.join(SRC, 'admin.html'), path.join(DIR, 'admin.html'));

const id = (n) => `user_3460000000${n}`;
const ph = (n) => `+3460000000${n}`;
const [A, B, C, D] = [1, 2, 3, 4].map(id);   // Ana y Bea chatean; Carlos es ajeno; Dani sin dispositivos
const users = Object.fromEntries([1, 2, 3, 4].map(n => [ph(n), { userId: id(n), name: `U${n}`, phone: ph(n) }]));
const write = (f, v) => fs.writeFileSync(path.join(DIR, 'data', f), JSON.stringify(v));
const CHAT = `chat_${[A, B].sort().join('_')}`;
const GID = 'group_1_test', GCHAT = `group_${GID}`;
write('users.json', users);
write('chats.json', {
  [CHAT]: { id: CHAT, participants: [A, B], name: 'Chat', createdAt: 1, lastMessage: 'hola', lastTime: 1 },
  [GCHAT]: { id: GCHAT, isGroup: true, groupId: GID, participants: [A, B], name: 'G', createdAt: 1, lastMessage: '', lastTime: 1 },
});
write('messages.json', { [CHAT]: [
  { id: 'm1', chatId: CHAT, senderId: A, text: 'secreto de Ana', type: 'text', createdAt: Date.now() },
  { id: 'm2', chatId: CHAT, senderId: B, text: 'respuesta de Bea', type: 'text', createdAt: Date.now() },
] });
write('groups.json', { [GID]: { id: GID, name: 'G', adminId: A, members: [A, B], memberNames: {}, createdAt: 1, updatedAt: 1 } });
write('devices.json', { byUser: { [A]: [{ deviceId: 'devA', name: 'Móvil', platform: 'android', linkedAt: 1, lastSeen: 1 }] }, revoked: {} });
write('call_log.json', { [A]: [{ id: 'call_1', userId: A, contactId: B, direction: 'outgoing' }] });
write('stickers.json', { [A]: ['https://x/files/s.png'] });
write('poll_profiles.json', { [A]: { age: 30, sex: 'F', postalCode: '28001', nationality: 'España' } });

const SECRET = 'test-secret';
const tokenAt = (uid, exp) => `${uid}.${exp}.${crypto.createHmac('sha256', SECRET).update(`${uid}.${exp}`).digest('base64url')}`;
const token = (uid) => tokenAt(uid, Math.floor(Date.now() / 1000) + 3600);
const PORT = MODE === 'exigir' ? 3996 : 3995, BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, PORT, RTC_SECRET: SECRET, NODE_PATH: path.join(SRC, 'node_modules'), ADMIN_EMAIL: 'a@x.com', ADMIN_PASSWORD: 'pw', AUTH_MODE: MODE, DB_SOURCE: 'off' };
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

// Búsquedas de usuarios: no actúan en nombre de nadie → basta con tener sesión
const ANY_USER = new Set(['buscar usuario', 'buscar por id', 'agenda']);
// [nombre, método, ruta, cuerpo] — todas en nombre de Ana (A)
const ROUTES = [
  ['chats', 'GET', `/chats?userId=${A}`],
  ['abrir chat', 'POST', '/chats', { userId1: A, userId2: B }],
  ['mensajes', 'GET', `/messages/${CHAT}?userId=${A}`],
  ['enviar', 'POST', '/messages', { chatId: CHAT, senderId: A, text: 'x' }],
  ['editar', 'POST', `/messages/${CHAT}/m1/edit`, { userId: A, text: 'editado' }],
  ['fijar', 'POST', `/messages/${CHAT}/m1/flags`, { userId: A, starred: true }],
  ['leído', 'POST', `/messages/${CHAT}/mark-read`, { userId: A }],
  ['presencia', 'POST', '/presence', { userId: A }],
  ['ver presencia', 'GET', `/presence/${B}?viewerId=${A}`],
  ['avatar', 'POST', '/user/avatar', { userId: A, avatar: 'data:image/png;base64,AAAA' }],
  ['stickers', 'GET', `/stickers/${A}`],
  ['prefs', 'POST', '/user/prefs', { userId: A, lang: 'es' }],
  ['token aviso', 'POST', '/register-fcm-token', { userId: A, token: 'fcm-A' }],
  ['buscar usuario', 'GET', `/find-user?phone=${encodeURIComponent(ph(2))}`],
  ['buscar por id', 'GET', `/find-user-by-id?userId=${B}`],
  ['agenda', 'POST', '/check-users', { phones: [ph(2)] }],
  ['estados', 'GET', `/stories?userId=${A}`],
  ['privacidad estados', 'GET', `/stories/privacy?userId=${A}`],
  ['grupos', 'GET', `/groups?userId=${A}`],
  ['grupo', 'GET', `/groups/${GID}?userId=${A}`],
  ['llamada grupo', 'GET', `/groups/${GID}/call?userId=${A}`],
  ['registro llamadas', 'GET', `/call-log?userId=${A}`],
  ['aviso llamada', 'POST', '/call-notification', { callerId: A, calleeId: B }],
  ['cancelar llamada', 'POST', '/call-cancel', { callerId: A, calleeId: B }],
  ['directos', 'GET', `/directos?userId=${A}`],
  ['permiso directos', 'GET', `/directos/permissions?userId=${A}`],
  ['grabaciones', 'GET', `/directos/recordings?userId=${A}`],
  ['encuestas', 'GET', `/poll/polls?userId=${A}`],
  ['perfil encuesta', 'GET', `/poll/profile/${A}`],
  ['historial encuestas', 'GET', `/poll/history?userId=${A}`],
  ['karaoke', 'GET', `/karaoke/recordings?userId=${A}`],
  ['dúos', 'GET', `/karaoke/duets?userId=${A}`],
];

try {
  for (let i = 0; i < 50; i++) { try { await fetch(`${BASE}/health`); break; } catch { await new Promise(r => setTimeout(r, 200)); } }

  if (MODE === 'registro') {
    // Salida de emergencia: sin token funciona como antes y queda anotado; con token de otro, nunca
    const r = await call('GET', `/messages/${CHAT}?userId=${A}`);
    check('registro: sin token se acepta', r.status === 200 && r.body.messages?.length === 2);
    check('registro: queda anotado en el log', /\[auth\] sin sesión: GET/.test(log));
    check('registro: token de otro → 403', (await call('GET', `/messages/${CHAT}?userId=${A}`, null, as(C))).status === 403);
    check('registro: ajeno al chat → 403', (await call('GET', `/messages/${CHAT}?userId=${C}`)).status === 403);
    check('registro: sin token ni userId → 401', (await call('GET', '/chats')).status === 401);
  } else {
    for (const [name, m, p, body] of ROUTES) {
      const none = await call(m, p, body);
      check(`${name}: sin token → 401`, none.status === 401, `(${none.status})`);
      if (!ANY_USER.has(name)) {
        const other = await call(m, p, body, as(C));
        check(`${name}: token de otro → 403`, other.status === 403, `(${other.status})`);
      }
      const mine = await call(m, p, body, as(A));
      check(`${name}: con su sesión → OK`, mine.status < 300, `(${mine.status} ${JSON.stringify(mine.body).slice(0, 80)})`);
    }

    // Token falso / caducado
    check('token con firma falsa → 401', (await call('GET', `/chats?userId=${A}`, null, { Authorization: `Bearer ${A}.9999999999.falsa` })).status === 401);
    check('token caducado → 401', (await call('GET', `/chats?userId=${A}`, null, { Authorization: `Bearer ${tokenAt(A, 1000)}` })).status === 401);
    check('token de cuenta inexistente → 401', (await call('GET', '/chats', null, as('user_999'))).status === 401);
    check('solo con token (sin userId) → sus chats', (await call('GET', '/chats', null, as(A))).body.chats?.length === 2);

    // Pertenencia: Carlos con SU sesión no entra en el chat ni en el grupo de Ana y Bea
    const leer = await call('GET', `/messages/${CHAT}`, null, as(C));
    check('ajeno lee el chat → 403', leer.status === 403 && !JSON.stringify(leer.body).includes('secreto'));
    check('ajeno escribe en el chat → 403', (await call('POST', '/messages', { chatId: CHAT, text: 'intruso' }, as(C))).status === 403);
    check('ajeno borra el chat → 403', (await call('DELETE', `/chats/${CHAT}`, null, as(C))).status === 403);
    check('ajeno borra un mensaje → 403', (await call('DELETE', `/messages/${CHAT}/m1`, null, as(C))).status === 403);
    check('ajeno marca leído → 403', (await call('POST', `/messages/${CHAT}/mark-read`, {}, as(C))).status === 403);
    check('ajeno ve el grupo → 403', (await call('GET', `/groups/${GID}`, null, as(C))).status === 403);
    check('ajeno escribe en el grupo → 403', (await call('POST', '/messages', { chatId: GCHAT, text: 'x' }, as(C))).status === 403);
    check('miembro escribe en el grupo → OK', (await call('POST', '/messages', { chatId: GCHAT, text: 'hola grupo' }, as(B))).status === 200);
    check('remitente sale de la sesión (no del cuerpo)', (await call('POST', '/messages', { chatId: CHAT, text: 'y' }, as(B))).body.senderId === B);
    check('Bea borra (sin scope) un mensaje de Ana → 403', (await call('DELETE', `/messages/${CHAT}/m1`, null, as(B))).status === 403);
    check('Bea borra para todos un mensaje de Ana → 403', (await call('DELETE', `/messages/${CHAT}/m1?scope=all`, null, as(B))).status === 403);
    check('Bea lo oculta para ella → OK', (await call('DELETE', `/messages/${CHAT}/m1?scope=me`, null, as(B))).status === 200);
    check('…y ya no lo ve', !(await call('GET', `/messages/${CHAT}`, null, as(B))).body.messages.some(m => m.id === 'm1'));
    check('…pero Ana sí', (await call('GET', `/messages/${CHAT}`, null, as(A))).body.messages.some(m => m.id === 'm1'));
    check('Bea no edita el mensaje de Ana → 403', (await call('POST', `/messages/${CHAT}/m1/edit`, { text: 'hack' }, as(B))).status === 403);

    // Datos personales de otros
    check('stickers de otro → 403', (await call('GET', `/stickers/${A}`, null, as(B))).status === 403);
    check('perfil de encuesta de otro → 403', (await call('GET', `/poll/profile/${A}`, null, as(B))).status === 403);
    check('registro de llamadas: solo el suyo', (await call('GET', '/call-log', null, as(B))).body.calls?.length === 0);
    check('Carlos no registra su móvil en la cuenta de Ana → 403', (await call('POST', '/register-fcm-token', { userId: A, token: 'fcm-C' }, as(C))).status === 403);

    // Renovar la sesión (/rtc-token)
    const rt = (body, h) => call('POST', '/rtc-token', body, h);
    check('rtc-token sin dispositivo ni token (cuenta sin dispositivos) → 401', (await rt({ userId: D })).status === 401);
    check('rtc-token con su token caducado (cuenta sin dispositivos) → OK', (await rt({ userId: D }, { Authorization: `Bearer ${tokenAt(D, Math.floor(Date.now() / 1000) - 86400)}` })).status === 200);
    check('rtc-token con token de otra cuenta → 401', (await rt({ userId: D }, as(C))).status === 401);
    check('rtc-token con token caducado hace > 90 días → 401', (await rt({ userId: D }, { Authorization: `Bearer ${tokenAt(D, 1000)}` })).status === 401);
    check('rtc-token desde su dispositivo → OK', (await rt({ userId: A, deviceId: 'devA' })).status === 200);
    check('rtc-token desde otro dispositivo → 401', (await rt({ userId: A, deviceId: 'otro' })).status === 401);

    // Interno (rtc-server) y públicas
    check('GET /directos/:id sin sesión → 401', (await call('GET', `/directos/x?userId=${A}`)).status === 401);
    check('GET /directos/:id con secreto interno llega a buscarlo', (await call('GET', `/directos/x?userId=${A}`, null, { 'x-internal-secret': SECRET })).body.error === 'Directo no encontrado');
    check('GET /directos/:id con secreto falso → 401', (await call('GET', `/directos/x?userId=${A}`, null, { 'x-internal-secret': 'mal' })).status === 401);
    for (const p of ['/health', '/poll/meta', '/karaoke/songs', '/karaoke/genres'])
      check(`${p} sigue público`, (await call('GET', p)).status === 200);
    check('/link/start sigue público', (await call('POST', '/link/start', { deviceName: 'PC' })).status === 200);
    check('/user/avatar (nativo, sin token) sigue respondiendo', (await call('GET', `/user/avatar/${A}?viewerId=${B}`)).status === 200);
  }
} catch (e) {
  fail++; console.log('ERROR', e.stack);
} finally {
  srv.kill();
  console.log(`\n${ok} OK · ${fail} fallos  (modo ${MODE})`);
  if (fail) console.log(log.split('\n').filter(l => /error|❌|warn/i.test(l)).slice(-15).join('\n'));
  process.exit(fail ? 1 : 0);
}
