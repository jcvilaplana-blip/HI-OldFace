// Editar fotos y vídeos: POST /media/edit-video (ffmpeg real), POST /messages/:chatId/:messageId/media y
// PUT /stories/:storyId/media. Incluye los accesos no autorizados (sin token, otro usuario, chat ajeno, ver una vez).
// Uso: node test/media-edit.test.mjs (desde frontend/backend). Necesita ffmpeg (el de rtc-server o FFMPEG_PATH).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FFMPEG = [process.env.FFMPEG_PATH, path.join(SRC, '..', '..', 'rtc-server', 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')]
  .find(p => p && fs.existsSync(p));
if (!FFMPEG) { console.log('SIN ffmpeg: se omite la prueba de edición'); process.exit(0); }

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'oldface-mediaedit-'));
const UP = path.join(DIR, 'uploads');
fs.mkdirSync(path.join(DIR, 'data')); fs.mkdirSync(UP);
for (const d of ['ai', 'db', 'payments', 'social']) fs.cpSync(path.join(SRC, d), path.join(DIR, d), { recursive: true });
fs.copyFileSync(path.join(SRC, 'server.js'), path.join(DIR, 'server.js'));
fs.copyFileSync(path.join(SRC, 'admin.html'), path.join(DIR, 'admin.html'));

function png(w, h, rgba) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 4).map((_, i) => rgba[i % 4])]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}
const name = (ext) => `${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
const VID = name('mp4'), VID2 = name('mp4'), IMG_A = name('png'), IMG_A2 = name('png'), IMG_B = name('png'), ONCE = name('png'), ST = name('png'), ST2 = name('png');
// Vídeo de prueba: 320x240, 2 s, con sonido
spawnSync(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(UP, VID)]);
fs.copyFileSync(path.join(UP, VID), path.join(UP, VID2));
for (const f of [IMG_A, IMG_A2, IMG_B, ONCE, ST, ST2]) fs.writeFileSync(path.join(UP, f), png(40, 30, [200, 30, 30, 255]));

const id = (n) => `user_3463000000${n}`, ph = (n) => `+3463000000${n}`;
const [A, B, C] = [1, 2, 3].map(id);
const write = (f, v) => fs.writeFileSync(path.join(DIR, 'data', f), JSON.stringify(v));
const CHAT = `chat_${[A, B].sort().join('_')}`;
write('users.json', Object.fromEntries([1, 2, 3].map(n => [ph(n), { userId: id(n), name: `U${n}`, phone: ph(n) }])));
write('chats.json', { [CHAT]: { id: CHAT, participants: [A, B], name: 'Chat', createdAt: 1, lastMessage: '', lastTime: 2 } });
const t = Date.now();
const m = (mid, senderId, type, url, extra = {}) => ({ id: mid, chatId: CHAT, senderId, type, text: '[x]', url, createdAt: t, ...extra });
write('messages.json', { [CHAT]: [
  m('mv', A, 'video', `/files/${VID}`), m('mi', A, 'image', `/files/${IMG_A}`), m('mb', B, 'image', `/files/${IMG_B}`),
  m('mo', A, 'image', `/files/${ONCE}`, { viewOnce: true, openedBy: [] }),
] });
write('stories.json', [{ id: 'st1', userId: A, userName: 'U1', mediaType: 'image', content: `http://127.0.0.1:3994/files/${ST}`, bgColor: '#000',
  createdAt: t, expiresAt: t + 86400000, viewers: [], privacy: { mode: 'contacts', userIds: [] }, allowed: [B], prepared: true, thumb: `/files/${ST}` }]);

const SECRET = 'test-secret';
const token = (uid) => { const exp = Math.floor(Date.now() / 1000) + 3600; return `${uid}.${exp}.${crypto.createHmac('sha256', SECRET).update(`${uid}.${exp}`).digest('base64url')}`; };
const PORT = 3994, BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, PORT, RTC_SECRET: SECRET, NODE_PATH: path.join(SRC, 'node_modules'), ADMIN_EMAIL: 'a@x.com', ADMIN_PASSWORD: 'pw',
  AUTH_MODE: 'exigir', DB_SOURCE: 'off', FFMPEG_PATH: FFMPEG, PUBLIC_URL: BASE };
delete env.RTC_INTERNAL_URL;
const srv = spawn(process.execPath, ['server.js'], { cwd: DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);

let ok = 0, fail = 0;
const check = (n, cond, extra = '') => { cond ? ok++ : fail++; console.log(`${cond ? 'OK ' : 'FALLO'}  ${n}${cond ? '' : '  ' + extra}`); };
const call = async (method, p, body, headers = {}) => {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const as = (uid) => ({ Authorization: `Bearer ${token(uid)}` });
const exists = (f) => fs.existsSync(path.join(UP, f));
const probe = (f) => spawnSync(FFMPEG, ['-hide_banner', '-i', path.join(UP, f)], { encoding: 'utf8' }).stderr || '';
const duration = (info) => { const d = info.match(/Duration: (\d+):(\d+):([\d.]+)/); return d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0; };
const edit = (uid, body) => call('POST', '/media/edit-video', { userId: uid, ...body }, as(uid));
const overlay = 'data:image/png;base64,' + png(64, 48, [255, 255, 255, 120]).toString('base64');

try {
  for (let i = 0; i < 50; i++) { try { await fetch(`${BASE}/health`); break; } catch { await new Promise(r => setTimeout(r, 200)); } }

  // ── Editar vídeo: parámetros y permisos ──
  check('editar vídeo sin token → 401', (await call('POST', '/media/edit-video', { userId: A, url: `/files/${VID}`, start: 0, end: 1 })).status === 401);
  check('editar vídeo con token de otro → 403', (await call('POST', '/media/edit-video', { userId: A, url: `/files/${VID}`, start: 0, end: 1 }, as(B))).status === 403);
  check('archivo inexistente → 400', (await edit(A, { url: '/files/1700000000000_deadbeef.mp4', start: 0, end: 1 })).status === 400);
  check('ruta con ../ → 400', (await edit(A, { url: '/files/../server.js', start: 0, end: 1 })).status === 400);
  check('una foto no es un vídeo → 400', (await edit(A, { url: `/files/${IMG_A}`, start: 0, end: 1 })).status === 400);
  check('recorte de menos de medio segundo → 400', (await edit(A, { url: `/files/${VID}`, start: 1, end: 1.2 })).status === 400);
  check('fin antes que inicio → 400', (await edit(A, { url: `/files/${VID}`, start: 1.5, end: 0.5 })).status === 400);
  check('giro raro → 400', (await edit(A, { url: `/files/${VID}`, start: 0, end: 1, rotate: 45 })).status === 400);
  check('capa que no es PNG → 400', (await edit(A, { url: `/files/${VID}`, start: 0, end: 1, overlay: 'data:image/jpeg;base64,AAAA' })).status === 400);

  // ── Editar vídeo de verdad: recorte 0,2–1,5 s, girado 90°, sin sonido, con capa ──
  const ev = await edit(A, { url: `/files/${VID}`, start: 0.2, end: 1.5, rotate: 90, mute: true, overlay });
  const outName = String(ev.body.url || '').replace('/files/', '');
  check('vídeo editado → 200 con archivo nuevo', ev.status === 200 && /^\/files\/\d+_[0-9a-f]{8}\.mp4$/.test(ev.body.url || '') && exists(outName), JSON.stringify(ev.body));
  const info = probe(outName);
  check('dura lo recortado (~1,3 s)', Math.abs(duration(info) - 1.3) < 0.35, `duración=${duration(info)}`);
  check('está girado (240x320)', /Video: h264[^\n]*\b240x320\b/.test(info), info.match(/Video:[^\n]*/)?.[0]);
  check('sin sonido', !/Audio:/.test(info));
  check('el original no se toca', exists(VID));
  const keep = await edit(A, { url: `/files/${VID}`, start: 0, end: 1, discardSource: true });
  check('discardSource no borra un vídeo que ya usa un mensaje', keep.status === 200 && exists(VID));
  const withAudio = probe(String(keep.body.url).replace('/files/', ''));
  check('sin "mute" conserva el sonido', /Audio:/.test(withAudio));
  const disc = await edit(A, { url: `/files/${VID2}`, start: 0, end: 1, discardSource: true });
  check('discardSource borra el original sin usar (vídeo aún sin enviar)', disc.status === 200 && !exists(VID2));

  // ── Cambiar la foto/vídeo de un mensaje ──
  const rep = (uid, mid, url) => call('POST', `/messages/${CHAT}/${mid}/media`, { userId: uid, url }, as(uid));
  check('cambiar sin token → 401', (await call('POST', `/messages/${CHAT}/mi/media`, { userId: A, url: `/files/${IMG_A2}` })).status === 401);
  check('cambiar con token de otro → 403', (await call('POST', `/messages/${CHAT}/mi/media`, { userId: A, url: `/files/${IMG_A2}` }, as(B))).status === 403);
  check('chat ajeno → 403', (await rep(C, 'mi', `/files/${IMG_A2}`)).status === 403);
  check('Bea no puede cambiar la foto de Ana → 403', (await rep(B, 'mi', `/files/${IMG_A2}`)).status === 403);
  check('mensaje inexistente → 404', (await rep(A, 'nada', `/files/${IMG_A2}`)).status === 404);
  check('"ver una vez" no se edita → 400', (await rep(A, 'mo', `/files/${IMG_A2}`)).status === 400);
  check('vídeo en un mensaje de foto → 400', (await rep(A, 'mi', `/files/${outName}`)).status === 400);
  check('archivo inventado → 400', (await rep(A, 'mi', '/files/../data/users.json')).status === 400);
  const ri = await rep(A, 'mi', `/files/${IMG_A2}`);
  check('Ana cambia su foto', ri.status === 200 && String(ri.body.url).endsWith(`/files/${IMG_A2}`));
  check('sin marca de "editado" ni hiddenFor en la respuesta', !('editedAt' in ri.body) && !('hiddenFor' in ri.body));
  check('la foto vieja se borra (nadie la usa)', !exists(IMG_A));
  const bMsgs = (await call('GET', `/messages/${CHAT}?userId=${B}`, null, as(B))).body.messages || [];
  check('Bea ve la foto nueva', String(bMsgs.find(x => x.id === 'mi')?.url).endsWith(`/files/${IMG_A2}`));
  const rv = await rep(A, 'mv', `/files/${outName}`);
  check('Ana cambia su vídeo por el editado', rv.status === 200 && String(rv.body.url).endsWith(`/files/${outName}`));
  check('el vídeo original se borra al dejar de usarse', !exists(VID));

  // ── Cambiar la foto de un estado publicado ──
  const st = (uid, content) => call('PUT', '/stories/st1/media', { userId: uid, content }, as(uid));
  check('estado sin token → 401', (await call('PUT', '/stories/st1/media', { userId: A, content: `/files/${ST2}` })).status === 401);
  check('estado de otro → 404', (await st(B, `/files/${ST2}`)).status === 404);
  check('vídeo en un estado de foto → 400', (await st(A, `/files/${outName}`)).status === 400);
  const rs = await st(A, `/files/${ST2}`);
  check('Ana cambia la foto de su estado', rs.status === 200 && String(rs.body.content).endsWith(`/files/${ST2}`) && !rs.body.thumb, JSON.stringify(rs.body).slice(0, 200));
  const bStories = (await call('GET', `/stories?userId=${B}`, null, as(B))).body;
  check('Bea ve el estado con la foto nueva', JSON.stringify(bStories).includes(ST2));
} catch (e) {
  fail++; console.log('ERROR', e.stack);
} finally {
  srv.kill();
  console.log(`\n${ok} OK · ${fail} fallos`);
  if (fail) console.log(log.split('\n').filter(l => /error|❌|warn|ffmpeg/i.test(l)).slice(-15).join('\n'));
  process.exit(fail ? 1 : 0);
}
