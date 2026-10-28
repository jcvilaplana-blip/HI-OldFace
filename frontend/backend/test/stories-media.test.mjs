// Estados más ligeros: miniatura de fotos y vídeos, vídeo en 720p con el índice al principio y caché de /files.
// Comprueba también que sin sesión o sin permiso no se ve nada. Necesita ffmpeg (el de rtc-server/node_modules/ffmpeg-static).
// Uso: node test/stories-media.test.mjs (desde frontend/backend)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FFMPEG = process.env.FFMPEG_PATH || path.join(SRC, '..', '..', 'rtc-server', 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
if (!fs.existsSync(FFMPEG)) { console.log('SIN ffmpeg: prueba omitida'); process.exit(0); }

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'oldface-stories-'));
const UP = path.join(DIR, 'uploads');
fs.mkdirSync(path.join(DIR, 'data'));
fs.mkdirSync(UP);
for (const d of ['ai', 'db', 'payments']) fs.cpSync(path.join(SRC, d), path.join(DIR, d), { recursive: true });
fs.copyFileSync(path.join(SRC, 'server.js'), path.join(DIR, 'server.js'));
fs.copyFileSync(path.join(SRC, 'admin.html'), path.join(DIR, 'admin.html'));

const id = (n) => `user_3460000000${n}`;
const ph = (n) => `+3460000000${n}`;
const [A, B, C] = [1, 2, 3].map(id);   // Ana publica solo para Bea; Carlos no puede ver nada
fs.writeFileSync(path.join(DIR, 'data', 'users.json'), JSON.stringify(Object.fromEntries([1, 2, 3].map(n => [ph(n), { userId: id(n), name: `U${n}`, phone: ph(n) }]))));

// Archivos de prueba: una foto 1280×960 y un vídeo vertical 1080×1920 de 6 s con sonido (índice al final, como Android)
const ff = (args) => spawnSync(FFMPEG, ['-y', '-loglevel', 'error', ...args]);
ff(['-f', 'lavfi', '-i', 'testsrc=size=1280x960', '-frames:v', '1', path.join(UP, 'foto.jpg')]);
ff(['-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '6',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '12M', '-c:a', 'aac', path.join(UP, 'video.mp4')]);
const videoSize = fs.statSync(path.join(UP, 'video.mp4')).size;
fs.writeFileSync(path.join(UP, 'live_x.webm'), Buffer.alloc(200, 1));

const SECRET = 'test-secret';
const token = (uid) => { const exp = Math.floor(Date.now() / 1000) + 3600; return `${uid}.${exp}.${crypto.createHmac('sha256', SECRET).update(`${uid}.${exp}`).digest('base64url')}`; };
const PORT = 3993, BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, PORT, RTC_SECRET: SECRET, NODE_PATH: path.join(SRC, 'node_modules'), ADMIN_EMAIL: 'a@x.com', ADMIN_PASSWORD: 'pw',
  AUTH_MODE: 'exigir', DB_SOURCE: 'off', FFMPEG_PATH: FFMPEG };
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
const storiesOf = async (uid) => (await call('GET', `/stories?userId=${uid}`, null, as(uid))).body.stories || [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fileOf = (url) => path.join(UP, String(url).split('/files/')[1] || '-');
const post = (body) => call('POST', '/stories', { userId: A, userName: 'U1', privacy: { mode: 'only', userIds: [B] }, ...body }, as(A));

try {
  for (let i = 0; i < 50; i++) { try { await fetch(`${BASE}/health`); break; } catch { await sleep(200); } }

  // ── Autorización ──
  check('sin token → 401', (await call('GET', `/stories?userId=${A}`)).status === 401);
  check('token de otro usuario → 403', (await call('GET', `/stories?userId=${A}`, null, as(B))).status === 403);

  // ── Publicar ──
  const img = await post({ mediaType: 'image', content: `${BASE}/files/foto.jpg` });
  const vid = await post({ mediaType: 'video', content: `${BASE}/files/video.mp4` });
  const txt = await post({ mediaType: 'text', content: 'hola' });
  check('publicar foto, vídeo y texto → 201', img.status === 201 && vid.status === 201 && txt.status === 201);

  // Esperar a que el servidor prepare los archivos (de uno en uno)
  let mine = [];
  for (let i = 0; i < 120; i++) {
    mine = await storiesOf(A);
    if (mine.filter(s => s.prepared).length >= 2) break;
    await sleep(500);
  }
  const sImg = mine.find(s => s.id === img.body.id) || {};
  const sVid = mine.find(s => s.id === vid.body.id) || {};
  const sTxt = mine.find(s => s.id === txt.body.id) || {};

  check('foto: tiene miniatura y existe', !!sImg.thumb && fs.existsSync(fileOf(sImg.thumb)), JSON.stringify(sImg));
  check('foto: la miniatura pesa poco (< 60 KB)', sImg.thumb && fs.statSync(fileOf(sImg.thumb)).size < 60_000);
  check('foto: el archivo original no cambia', sImg.content === `${BASE}/files/foto.jpg`);
  check('texto: sin miniatura ni proceso', !sTxt.thumb && !sTxt.prepared);

  check('vídeo: tiene miniatura', !!sVid.thumb && fs.existsSync(fileOf(sVid.thumb)), JSON.stringify(sVid));
  check('vídeo: pasa a la versión ligera _s.mp4', /_s\.mp4$/.test(sVid.content || ''), sVid.content);
  const out = fileOf(sVid.content);
  const outSize = fs.existsSync(out) ? fs.statSync(out).size : 0;
  check('vídeo: pesa menos que el original', outSize > 0 && outSize < videoSize, `${outSize} vs ${videoSize}`);
  const buf = outSize ? fs.readFileSync(out) : Buffer.alloc(0);
  check('vídeo: índice (moov) antes de los datos (mdat)', buf.indexOf('moov') > 0 && buf.indexOf('moov') < buf.indexOf('mdat'));
  const info = spawnSync(FFMPEG, ['-i', out]).stderr.toString();
  check('vídeo: 720×1280 (vertical a 720p)', /720x1280/.test(info), (info.match(/Video: .*/) || [''])[0]);
  check('vídeo: conserva el sonido', /Audio: aac/.test(info));
  check('vídeo: el original sigue (se borra más tarde si nadie lo usa)', fs.existsSync(path.join(UP, 'video.mp4')));

  // ── Quién lo ve ──
  const bea = await storiesOf(B);
  check('Bea ve los 3 estados con la miniatura', bea.length === 3 && !!bea.find(s => s.id === vid.body.id)?.thumb);
  check('Carlos (sin permiso) no ve nada', (await storiesOf(C)).length === 0);

  // ── Caché de /files ──
  const r1 = await fetch(`${BASE}/files/foto.jpg`);
  check('/files: se puede guardar en el móvil (private, immutable)', /private/.test(r1.headers.get('cache-control')) && /immutable/.test(r1.headers.get('cache-control')),
    r1.headers.get('cache-control'));
  check('/files de directos sin firma → 403', (await fetch(`${BASE}/files/live_x.webm`)).status === 403);
  const r3 = await fetch(`${BASE}/files/${path.basename(out)}`, { headers: { Range: 'bytes=0-999' } });
  check('/files: el vídeo se puede pedir por trozos (206)', r3.status === 206);

  // ── Borrar ──
  check('Bea no puede borrar el estado de Ana', (await call('DELETE', `/stories/${vid.body.id}`, { userId: B }, as(B))).status === 404);
  check('Ana borra el vídeo', (await call('DELETE', `/stories/${vid.body.id}`, { userId: A }, as(A))).status === 200);
  check('ya no sale', !(await storiesOf(B)).some(s => s.id === vid.body.id));

  // ── Apps del menú (Social y Karaoke) que se ocultan desde /admin ──
  const feats = async () => (await call('GET', '/app/features')).body;
  let f = await feats();
  check('menú: Social y Karaoke ocultas por defecto', f.social === false && f.karaoke === false, JSON.stringify(f));
  check('admin/features sin token de administrador → 401', (await call('PUT', '/admin/features', { social: true })).status === 401);
  check('admin/features con sesión de usuario normal → 401', (await call('PUT', '/admin/features', { social: true }, as(A))).status === 401);
  const adm = { 'x-admin-token': (await call('POST', '/admin/login', { email: 'a@x.com', password: 'pw' })).body.token };
  check('admin/features: clave desconocida → 400', (await call('PUT', '/admin/features', { taxi: false }, adm)).status === 400);
  check('admin/features: valor que no es sí/no → 400', (await call('PUT', '/admin/features', { social: 'si' }, adm)).status === 400);
  check('admin/features: vacío → 400', (await call('PUT', '/admin/features', {}, adm)).status === 400);
  check('admin muestra Social', (await call('PUT', '/admin/features', { social: true }, adm)).body.social === true);
  f = await feats();
  check('la app ve Social visible y Karaoke oculta', f.social === true && f.karaoke === false, JSON.stringify(f));
  await call('PUT', '/admin/features', { social: false, karaoke: true }, adm);
  f = await feats();
  check('admin oculta Social y muestra Karaoke', f.social === false && f.karaoke === true, JSON.stringify(f));
  check('se guarda en data/app_features.json', JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'app_features.json'), 'utf8')).karaoke === true);
} catch (e) {
  fail++; console.log('ERROR', e);
} finally {
  srv.kill();
  await sleep(300);
  if (fail) console.log(log.slice(-2000));
  fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`\n${ok} OK · ${fail} fallos`);
  process.exit(fail ? 1 : 0);
}
