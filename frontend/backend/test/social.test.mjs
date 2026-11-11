// Social: canales, publicaciones públicas o solo para contactos, seguir, me gusta, comentarios, guardados, avisos,
// bloqueos, denuncias, moderación del administrador, eliminar cuenta y miniatura + vídeo 720p de las publicaciones.
// Comprueba los accesos no autorizados (sin token, token de otro, contenido de contactos, bloqueos, retirado).
// Uso: npm test (desde frontend/backend) · node test/social.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FF = process.env.FFMPEG_PATH || path.join(SRC, '..', '..', 'rtc-server', 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const FFMPEG = fs.existsSync(FF) ? FF : null;

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'oldface-social-'));
const UP = path.join(DIR, 'uploads');
fs.mkdirSync(path.join(DIR, 'data'));
fs.mkdirSync(UP);
for (const d of ['ai', 'db', 'payments', 'social']) fs.cpSync(path.join(SRC, d), path.join(DIR, d), { recursive: true });
fs.copyFileSync(path.join(SRC, 'server.js'), path.join(DIR, 'server.js'));
fs.copyFileSync(path.join(SRC, 'admin.html'), path.join(DIR, 'admin.html'));

const id = (n) => `user_3462000000${n}`;
const ph = (n) => `+3462000000${n}`;
const [A, B, C, D] = [1, 2, 3, 4].map(id);   // Ana publica; Bea es contacto de Ana; Carlos y David no lo son
const write = (f, v) => fs.writeFileSync(path.join(DIR, 'data', f), JSON.stringify(v));
const NAMES = { 1: 'Ana López', 2: 'Bea', 3: 'Carlos', 4: 'David' };
write('users.json', Object.fromEntries([1, 2, 3, 4].map(n => [ph(n), { userId: id(n), name: NAMES[n], phone: ph(n), email: `u${n}@x.com` }])));
write('user_contacts.json', { [A]: [B] });

// Archivos subidos (como hace la app con /chat/upload)
const ff = (args) => spawnSync(FFMPEG, ['-y', '-loglevel', 'error', ...args]);
if (FFMPEG) {
  ff(['-f', 'lavfi', '-i', 'testsrc=size=1280x960', '-frames:v', '1', path.join(UP, 'f1.jpg')]);
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '5',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '12M', '-c:a', 'aac', path.join(UP, 'v1.mp4')]);
} else {
  fs.writeFileSync(path.join(UP, 'f1.jpg'), Buffer.alloc(500, 1));
  fs.writeFileSync(path.join(UP, 'v1.mp4'), Buffer.alloc(500, 2));
}
for (const n of ['f2.jpg', 'f3.jpg', 'del.jpg', 'cover.jpg']) fs.copyFileSync(path.join(UP, 'f1.jpg'), path.join(UP, n));
fs.copyFileSync(path.join(UP, 'v1.mp4'), path.join(UP, 'v2.mp4'));
fs.writeFileSync(path.join(UP, 'live_x.webm'), Buffer.alloc(500, 3));
fs.writeFileSync(path.join(UP, 'doc.pdf'), Buffer.alloc(500, 4));

const SECRET = 'test-secret';
const token = (uid) => { const exp = Math.floor(Date.now() / 1000) + 3600; return `${uid}.${exp}.${crypto.createHmac('sha256', SECRET).update(`${uid}.${exp}`).digest('base64url')}`; };
const PORT = 3994, BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, PORT, RTC_SECRET: SECRET, NODE_PATH: path.join(SRC, 'node_modules'), ADMIN_EMAIL: 'a@x.com', ADMIN_PASSWORD: 'pw',
              AUTH_MODE: 'exigir', DB_SOURCE: 'off', FFMPEG_PATH: FFMPEG || 'none', AI_MEDIA: 'off', PUBLIC_FILES_URL: `${BASE}/files/` };
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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const f = (n) => `${BASE}/files/${n}`;
const post = (uid, body) => call('POST', '/social/posts', { userId: uid, ...body }, as(uid));
const feed = async (uid, tab = 'foryou') => (await call('GET', `/social/feed?userId=${uid}&tab=${tab}`, null, as(uid))).body.posts || [];
const ids = (list) => (list || []).map(p => p.id);
const readData = (file) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, 'data', file), 'utf8')); } catch { return {}; } };

try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* aún arrancando */ } await sleep(250); }

  // ── Sesión obligatoria ──
  check('sin token → 401', (await call('GET', `/social/feed?userId=${A}`)).status === 401);
  check('token de otro usuario → 403', (await call('GET', `/social/feed?userId=${A}`, null, as(B))).status === 403);
  check('publicar sin token → 401', (await call('POST', '/social/posts', { userId: A, text: 'x' })).status === 401);
  check('publicar en nombre de otro → 403', (await call('POST', '/social/posts', { userId: A, text: 'x' }, as(C))).status === 403);
  check('token falso → 401', (await call('GET', `/social/me?userId=${A}`, null, { Authorization: 'Bearer user_x.9999999999.abc' })).status === 401);

  // ── Mi canal ──
  const meA = (await call('GET', `/social/me?userId=${A}`, null, as(A))).body;
  check('canal creado con @usuario a partir del nombre', meA.handle === 'analopez' && meA.name === 'Ana López' && meA.isMe === true, JSON.stringify(meA));
  check('el canal no enseña teléfono ni email', !JSON.stringify(meA).includes(ph(1)) && !JSON.stringify(meA).includes('u1@x.com'));
  check('sin foto de canal por defecto (la de perfil es privada)', meA.avatar === null);
  await call('GET', `/social/me?userId=${B}`, null, as(B));
  await call('GET', `/social/me?userId=${C}`, null, as(C));
  check('@usuario no válido → 400', (await call('PUT', '/social/me', { userId: B, handle: 'a b!' }, as(B))).status === 400);
  check('@usuario demasiado corto → 400', (await call('PUT', '/social/me', { userId: B, handle: 'ab' }, as(B))).status === 400);
  check('@usuario reservado → 409', (await call('PUT', '/social/me', { userId: B, handle: 'oldface' }, as(B))).status === 409);
  check('@usuario de otro → 409', (await call('PUT', '/social/me', { userId: B, handle: 'analopez' }, as(B))).status === 409);
  check('nombre vacío → 400', (await call('PUT', '/social/me', { userId: B, name: '   ' }, as(B))).status === 400);
  check('portada que no es imagen → 400', (await call('PUT', '/social/me', { userId: A, cover: f('doc.pdf') }, as(A))).status === 400);
  check('portada de un directo → 400', (await call('PUT', '/social/me', { userId: A, cover: f('live_x.webm') }, as(A))).status === 400);
  const upd = (await call('PUT', '/social/me', { userId: A, handle: '@Ana.Oficial', bio: 'Música y buena vibra', cover: f('cover.jpg'),
    avatar: `data:image/png;base64,${Buffer.alloc(300, 9).toString('base64')}` }, as(A))).body;
  check('editar canal: @usuario en minúsculas, bio, portada y foto propia', upd.handle === 'ana.oficial' && upd.bio === 'Música y buena vibra'
        && /cover\.jpg$/.test(upd.cover || '') && /\/files\/sch_.*\.png$/.test(upd.avatar || ''), JSON.stringify(upd));
  const avatarFile = path.join(UP, String(upd.avatar).split('/files/')[1] || '-');
  check('la foto del canal es un archivo propio', fs.existsSync(avatarFile));
  check('canal por @usuario', (await call('GET', `/social/channels/@ana.oficial?userId=${C}`, null, as(C))).body.userId === A);
  check('canal que no existe → 404', (await call('GET', `/social/channels/nadie?userId=${C}`, null, as(C))).status === 404);

  // ── Publicar: validación ──
  check('vacía → 400', (await post(A, { text: '  ' })).status === 400);
  check('visibilidad no válida → 400', (await post(A, { text: 'x', visibility: 'todos' })).status === 400);
  check('categoría no válida → 400', (await post(A, { text: 'x', category: 'politica' })).status === 400);
  check('archivo que no existe → 400', (await post(A, { media: [f('nada.jpg')] })).status === 400);
  check('archivo de un directo → 400', (await post(A, { media: [f('live_x.webm')] })).status === 400);
  check('archivo que no es foto ni vídeo → 400', (await post(A, { media: [f('doc.pdf')] })).status === 400);
  check('ruta con ../ → 400', (await post(A, { media: [`${BASE}/files/../data/users.json`] })).status === 400);
  check('más de 10 fotos → 400', (await post(A, { media: Array(11).fill(f('f1.jpg')) })).status === 400);
  check('vídeo con fotos → 400', (await post(A, { media: [f('v1.mp4'), f('f1.jpg')] })).status === 400);
  check('dos vídeos → 400', (await post(A, { media: [f('v1.mp4'), f('v2.mp4')] })).status === 400);
  check('media que no es lista → se ignora (solo texto)', (await post(C, { text: 'hola desde Carlos', media: 'x' })).status === 201);

  const pPub = (await post(A, { text: 'Atardecer en la costa 🌅', media: [f('f1.jpg'), f('f2.jpg')], category: 'viajes', visibility: 'public' })).body.post;
  const pCon = (await post(A, { text: 'Solo para mis contactos', media: [f('f3.jpg')], visibility: 'contacts' })).body.post;
  const pVid = (await post(A, { text: 'Rutina de fitness', media: [f('v1.mp4')], category: 'fitness' })).body.post;
  check('publicar fotos (público), foto (contactos) y vídeo → 201', pPub?.id && pCon?.id && pVid?.id);
  const pB = (await post(B, { text: 'Hola' })).body.post;
  check('por defecto: público y categoría "otros"', pB?.visibility === 'public' && pB?.category === 'otros');
  check('la publicación trae URLs completas', /^http:\/\/127\.0\.0\.1:3994\/files\/f1\.jpg$/.test(pPub.media[0].url), pPub.media[0].url);

  // ── Quién ve qué ──
  check('Carlos (no contacto) ve la pública', (await call('GET', `/social/posts/${pPub.id}?userId=${C}`, null, as(C))).status === 200);
  check('Carlos NO ve la de contactos (404)', (await call('GET', `/social/posts/${pCon.id}?userId=${C}`, null, as(C))).status === 404);
  check('Bea (contacto) ve la de contactos', (await call('GET', `/social/posts/${pCon.id}?userId=${B}`, null, as(B))).status === 200);
  const feedC = ids(await feed(C));
  check('Carlos: la de contactos no sale en su feed', !feedC.includes(pCon.id) && feedC.includes(pPub.id));
  check('Bea: sí sale en su feed', ids(await feed(B)).includes(pCon.id));
  check('Carlos no puede dar me gusta a la de contactos (404)', (await call('POST', `/social/posts/${pCon.id}/like`, { userId: C }, as(C))).status === 404);
  check('Carlos no puede comentar la de contactos (404)', (await call('POST', `/social/posts/${pCon.id}/comments`, { userId: C, text: 'hola' }, as(C))).status === 404);
  check('Carlos no puede leer sus comentarios (404)', (await call('GET', `/social/posts/${pCon.id}/comments?userId=${C}`, null, as(C))).status === 404);
  check('Carlos no puede guardarla (404)', (await call('POST', `/social/posts/${pCon.id}/save`, { userId: C }, as(C))).status === 404);
  check('Carlos no puede denunciarla (404)', (await call('POST', '/social/report', { userId: C, kind: 'post', targetId: pCon.id }, as(C))).status === 404);
  const chanC = ids((await call('GET', `/social/channels/${A}/posts?userId=${C}`, null, as(C))).body.posts);
  check('canal de Ana visto por Carlos: sin la de contactos', !chanC.includes(pCon.id) && chanC.includes(pPub.id));
  check('canal: filtro de vídeos', ids((await call('GET', `/social/channels/${A}/posts?userId=${C}&type=video`, null, as(C))).body.posts).join() === pVid.id);
  check('canal: filtro de fotos', !ids((await call('GET', `/social/channels/${A}/posts?userId=${B}&type=photo`, null, as(B))).body.posts).includes(pVid.id));
  check('canal: filtro de públicos', !ids((await call('GET', `/social/channels/${A}/posts?userId=${B}&visibility=public`, null, as(B))).body.posts).includes(pCon.id));
  check('reels: solo vídeos', ids(await feed(C, 'reels')).join() === pVid.id);
  const expC = (await call('GET', `/social/explore?userId=${C}&scope=public`, null, as(C))).body;
  check('explorar público: vídeo y fotos de Ana', ids(expC.videos).includes(pVid.id) && ids(expC.photos).includes(pPub.id) && !ids(expC.photos).includes(pCon.id));
  check('explorar por categoría', ids((await call('GET', `/social/explore?userId=${C}&category=fitness`, null, as(C))).body.videos).join() === pVid.id);
  check('explorar privado (contactos) de Carlos: nada de Ana', (await call('GET', `/social/explore?userId=${C}&scope=contacts`, null, as(C))).body.photos.length === 0);
  check('explorar privado de Bea: sí la de contactos', ids((await call('GET', `/social/explore?userId=${B}&scope=contacts`, null, as(B))).body.photos).includes(pCon.id));
  check('buscar por texto', ids((await call('GET', `/social/search?userId=${C}&q=costa`, null, as(C))).body.posts).join() === pPub.id);
  check('buscar canal por @usuario', (await call('GET', `/social/search?userId=${C}&q=@ana`, null, as(C))).body.channels.some(c => c.userId === A));
  check('buscar no encuentra lo de contactos', !(await call('GET', `/social/search?userId=${C}&q=contactos`, null, as(C))).body.posts.length);

  // ── Editar y borrar ──
  check('Carlos no puede editar lo de Ana (404)', (await call('PUT', `/social/posts/${pPub.id}`, { userId: C, text: 'hackeado' }, as(C))).status === 404);
  check('Carlos no puede borrar lo de Ana (404)', (await call('DELETE', `/social/posts/${pPub.id}?userId=${C}`, null, as(C))).status === 404);
  check('editar con categoría no válida → 400', (await call('PUT', `/social/posts/${pPub.id}`, { userId: A, category: 'x' }, as(A))).status === 400);
  const ed = (await call('PUT', `/social/posts/${pCon.id}`, { userId: A, visibility: 'public' }, as(A))).body.post;
  check('Ana la pasa a pública → Carlos la ve', ed?.visibility === 'public' && (await call('GET', `/social/posts/${pCon.id}?userId=${C}`, null, as(C))).status === 200);
  await call('PUT', `/social/posts/${pCon.id}`, { userId: A, visibility: 'contacts' }, as(A));
  check('y otra vez a contactos → Carlos ya no', (await call('GET', `/social/posts/${pCon.id}?userId=${C}`, null, as(C))).status === 404);
  const pDel = (await post(A, { text: 'para borrar', media: [f('del.jpg')] })).body.post;
  check('Ana borra una publicación → desaparece y su archivo también', (await call('DELETE', `/social/posts/${pDel.id}?userId=${A}`, null, as(A))).status === 200
        && (await call('GET', `/social/posts/${pDel.id}?userId=${A}`, null, as(A))).status === 404 && !fs.existsSync(path.join(UP, 'del.jpg')));

  // ── Seguir ──
  check('seguirse a uno mismo → 404', (await call('POST', `/social/follow/${C}`, { userId: C }, as(C))).status === 404);
  check('seguir a quien no tiene canal → 404', (await call('POST', `/social/follow/${D}`, { userId: C }, as(C))).status === 404);
  const fol = (await call('POST', `/social/follow/${A}`, { userId: C, bell: true }, as(C))).body;
  check('Carlos sigue a Ana con campana', fol.followed === true && fol.bell === true && fol.followers === 1, JSON.stringify(fol));
  check('seguir dos veces no duplica', (await call('POST', `/social/follow/${A}`, { userId: C }, as(C))).body.followers === 1);
  check('la campana se mantiene si no se manda', (await call('GET', `/social/channels/${A}?userId=${C}`, null, as(C))).body.bell === true);
  const folC = ids(await feed(C, 'following'));
  check('Siguiendo: Carlos ve lo público de Ana', folC.includes(pPub.id) && !folC.includes(pCon.id));
  check('lista de seguidores de Ana', (await call('GET', `/social/channels/${A}/followers?userId=${B}`, null, as(B))).body.channels.map(c => c.userId).join() === C);
  check('Ana tiene un aviso de nuevo seguidor', (await call('GET', `/social/notifications?userId=${A}`, null, as(A))).body.notifications.some(n => n.type === 'follow' && n.fromId === C));
  const pBell = (await post(A, { text: 'Nuevo para mis seguidores' })).body.post;
  check('con campana: aviso de publicación nueva', (await call('GET', `/social/notifications?userId=${C}`, null, as(C))).body.notifications.some(n => n.type === 'post' && n.postId === pBell.id));
  const pBellC = (await post(A, { text: 'Nuevo solo contactos', visibility: 'contacts' })).body.post;
  check('…pero no de las que no puede ver', !(await call('GET', `/social/notifications?userId=${C}`, null, as(C))).body.notifications.some(n => n.postId === pBellC.id));
  check('dejar de seguir', (await call('DELETE', `/social/follow/${A}?userId=${C}`, null, as(C))).body.followers === 0);
  await call('POST', `/social/follow/${A}`, { userId: C }, as(C));

  // ── Me gusta, guardados, vistas ──
  check('me gusta', (await call('POST', `/social/posts/${pPub.id}/like`, { userId: C }, as(C))).body.likes === 1);
  check('me gusta dos veces cuenta una', (await call('POST', `/social/posts/${pPub.id}/like`, { userId: C }, as(C))).body.likes === 1);
  await call('POST', `/social/posts/${pPub.id}/like`, { userId: B }, as(B));
  const seenC = (await call('GET', `/social/posts/${pPub.id}?userId=${C}`, null, as(C))).body.post;
  check('Carlos ve liked=true y 2 me gusta', seenC.liked === true && seenC.likes === 2);
  check('quitar me gusta', (await call('DELETE', `/social/posts/${pPub.id}/like?userId=${B}`, null, as(B))).body.likes === 1);
  await call('POST', `/social/posts/${pPub.id}/like`, { userId: B }, as(B));
  await call('DELETE', `/social/posts/${pPub.id}/like?userId=${B}`, null, as(B));
  check('un solo aviso de me gusta por persona', (await call('GET', `/social/notifications?userId=${A}`, null, as(A))).body.notifications.filter(n => n.type === 'like' && n.fromId === B).length === 1);
  check('guardar', (await call('POST', `/social/posts/${pPub.id}/save`, { userId: C }, as(C))).body.saved === true);
  check('mis guardados', ids((await call('GET', `/social/saved?userId=${C}`, null, as(C))).body.posts).join() === pPub.id);
  check('vista: cuenta una por persona', (await call('POST', `/social/posts/${pVid.id}/view`, { userId: C }, as(C))).body.views === 1
        && (await call('POST', `/social/posts/${pVid.id}/view`, { userId: C }, as(C))).body.views === 1);
  check('las vistas de la autora no cuentan', (await call('POST', `/social/posts/${pVid.id}/view`, { userId: A }, as(A))).body.views === 1);
  const chA = (await call('GET', `/social/channels/${A}?userId=${C}`, null, as(C))).body;
  check('números del canal: seguidores, vídeos y visualizaciones', chA.followers === 1 && chA.videos === 1 && chA.views === 1, JSON.stringify(chA));

  // ── Comentarios ──
  check('comentario vacío → 400', (await call('POST', `/social/posts/${pPub.id}/comments`, { userId: C, text: ' ' }, as(C))).status === 400);
  const cm = (await call('POST', `/social/posts/${pPub.id}/comments`, { userId: C, text: '¡Qué bonito!' }, as(C))).body;
  check('comentar → 201 y el contador sube', cm.comment?.id && cm.comments === 1);
  const cmB = (await call('POST', `/social/posts/${pPub.id}/comments`, { userId: B, text: 'Precioso' }, as(B))).body.comment;
  const list = (await call('GET', `/social/posts/${pPub.id}/comments?userId=${A}`, null, as(A))).body;
  check('lista de comentarios en orden y sin datos privados', list.total === 2 && list.comments[0].id === cm.comment.id && !JSON.stringify(list).includes(ph(3)));
  check('la autora puede borrar cualquier comentario de su publicación', list.comments.every(c => c.canDelete));
  check('Bea no puede borrar el comentario de Carlos (404)', (await call('DELETE', `/social/comments/${cm.comment.id}?userId=${B}`, null, as(B))).status === 404);
  check('Bea borra el suyo', (await call('DELETE', `/social/comments/${cmB.id}?userId=${B}`, null, as(B))).status === 200);
  check('Ana tiene aviso de comentario', (await call('GET', `/social/notifications?userId=${A}`, null, as(A))).body.notifications.some(n => n.type === 'comment' && n.fromId === C));
  const unread = (await call('GET', `/social/me?userId=${A}`, null, as(A))).body.unread;
  check('avisos sin leer en mi canal y marcar como leídos', unread > 0 && (await call('POST', '/social/notifications/read', { userId: A }, as(A))).body.unread === 0
        && (await call('GET', `/social/notifications?userId=${A}`, null, as(A))).body.unread === 0);

  // ── Bloquear ──
  check('bloquear a alguien que no existe → 404', (await call('POST', '/social/block/user_nadie', { userId: A }, as(A))).status === 404);
  check('Ana bloquea a Carlos', (await call('POST', `/social/block/${C}`, { userId: A }, as(A))).body.blocked === true);
  check('Carlos ya no ve el canal de Ana (404)', (await call('GET', `/social/channels/${A}?userId=${C}`, null, as(C))).status === 404);
  check('ni sus publicaciones (404) ni en su feed', (await call('GET', `/social/posts/${pPub.id}?userId=${C}`, null, as(C))).status === 404 && !ids(await feed(C)).includes(pPub.id));
  check('ni en sus guardados', !(await call('GET', `/social/saved?userId=${C}`, null, as(C))).body.posts.length);
  check('el bloqueo deja de seguir', (await call('GET', `/social/channels/${A}?userId=${B}`, null, as(B))).body.followers === 0);
  check('Carlos no puede volver a seguirla (404)', (await call('POST', `/social/follow/${A}`, { userId: C }, as(C))).status === 404);
  check('Ana ya no ve el comentario de Carlos', (await call('GET', `/social/posts/${pPub.id}/comments?userId=${A}`, null, as(A))).body.total === 0);
  check('Bea sí lo sigue viendo', (await call('GET', `/social/posts/${pPub.id}/comments?userId=${B}`, null, as(B))).body.total === 1);
  check('Ana no ve a Carlos en la búsqueda', !(await call('GET', `/social/search?userId=${A}&q=carlos`, null, as(A))).body.channels.length);
  check('lista de bloqueados de Ana', (await call('GET', `/social/blocked?userId=${A}`, null, as(A))).body.users.map(u => u.userId).join() === C);
  await call('DELETE', `/social/block/${C}?userId=${A}`, null, as(A));
  check('desbloquear → Carlos vuelve a ver la pública', (await call('GET', `/social/posts/${pPub.id}?userId=${C}`, null, as(C))).status === 200);

  // ── Denunciar ──
  check('denuncia de tipo no válido → 400', (await call('POST', '/social/report', { userId: C, kind: 'chat', targetId: pPub.id }, as(C))).status === 400);
  check('denunciar algo que no existe → 404', (await call('POST', '/social/report', { userId: C, kind: 'post', targetId: 'sp_x' }, as(C))).status === 404);
  check('denunciar su propio canal → 404', (await call('POST', '/social/report', { userId: C, kind: 'channel', targetId: C }, as(C))).status === 404);
  check('Carlos denuncia la publicación', (await call('POST', '/social/report', { userId: C, kind: 'post', targetId: pPub.id, reason: 'spam' }, as(C))).status === 201);

  // ── Administrador ──
  check('admin sin sesión → 401', (await call('GET', '/admin/social/reports')).status === 401);
  check('admin con sesión de usuario → 401', (await call('GET', '/admin/social/reports', null, as(A))).status === 401);
  const adm = { 'x-admin-token': (await call('POST', '/admin/login', { email: 'a@x.com', password: 'pw' })).body.token };
  const reps = (await call('GET', '/admin/social/reports', null, adm)).body.reports || [];
  check('admin ve la denuncia con lo denunciado', reps[0]?.targetId === pPub.id && reps[0]?.status === 'open' && !!reps[0]?.preview?.text, JSON.stringify(reps[0]));
  check('estado de denuncia no válido → 400', (await call('PUT', `/admin/social/reports/${reps[0]?.id}`, { status: 'x' }, adm)).status === 400);
  check('admin resuelve la denuncia', (await call('PUT', `/admin/social/reports/${reps[0]?.id}`, { status: 'done' }, adm)).body.success === true);
  check('admin: resumen', (await call('GET', '/admin/social/summary', null, adm)).body.openReports === 0);
  check('admin retira la publicación', (await call('PUT', `/admin/social/posts/${pPub.id}`, { hidden: true }, adm)).body.hiddenByAdmin === true);
  check('retirada: Bea y Carlos ya no la ven', (await call('GET', `/social/posts/${pPub.id}?userId=${B}`, null, as(B))).status === 404 && !ids(await feed(C)).includes(pPub.id));
  check('retirada: Ana la sigue viendo y sabe que está retirada', (await call('GET', `/social/posts/${pPub.id}?userId=${A}`, null, as(A))).body.post?.hiddenByAdmin === true);
  await call('PUT', `/admin/social/posts/${pPub.id}`, { hidden: false }, adm);
  check('verificado: datos no válidos → 400', (await call('PUT', `/admin/social/channels/${A}`, { verified: 'si' }, adm)).status === 400);
  check('admin da la insignia de verificado', (await call('PUT', `/admin/social/channels/${A}`, { verified: true }, adm)).body.verified === true
        && (await call('GET', `/social/channels/${A}?userId=${C}`, null, as(C))).body.verified === true);
  check('admin suspende a Carlos', (await call('PUT', `/admin/social/channels/${C}`, { banned: true }, adm)).body.banned === true);
  check('suspendido no puede publicar (403)', (await post(C, { text: 'spam' })).status === 403);
  check('ni comentar (403)', (await call('POST', `/social/posts/${pPub.id}/comments`, { userId: C, text: 'spam' }, as(C))).status === 403);
  check('su canal y sus comentarios desaparecen para los demás', (await call('GET', `/social/channels/${C}?userId=${B}`, null, as(B))).status === 404
        && (await call('GET', `/social/posts/${pPub.id}/comments?userId=${B}`, null, as(B))).body.total === 0);
  await call('PUT', `/admin/social/channels/${C}`, { banned: false }, adm);
  check('admin ve los canales', ((await call('GET', '/admin/social/channels', null, adm)).body.channels || []).length >= 3);
  check('admin ve las publicaciones con su autor', ((await call('GET', '/admin/social/posts', null, adm)).body.posts || []).some(p => p.id === pPub.id && p.author?.userId === A));

  // ── Archivos: miniatura y vídeo ligero ──
  if (FFMPEG) {
    let v = null, p = null;
    for (let i = 0; i < 160; i++) {
      v = (await call('GET', `/social/posts/${pVid.id}?userId=${A}`, null, as(A))).body.post;
      p = (await call('GET', `/social/posts/${pPub.id}?userId=${A}`, null, as(A))).body.post;
      if (v?.media[0].thumb && /_s\.mp4$/.test(v.media[0].url) && p?.media.every(m => m.thumb)) break;
      await sleep(500);
    }
    check('fotos: miniatura de cada una', p.media.every(m => /_th\.jpg$/.test(m.thumb || '')), JSON.stringify(p.media));
    check('vídeo: miniatura y versión 720p', /_th\.jpg$/.test(v.media[0].thumb || '') && /_s\.mp4$/.test(v.media[0].url), JSON.stringify(v.media));
    check('vídeo: duración (5 s)', v.media[0].duration === 5, String(v.media[0].duration));
    const info = spawnSync(FFMPEG, ['-i', path.join(UP, v.media[0].url.split('/files/')[1])]).stderr.toString();
    check('vídeo: 720×1280', /720x1280/.test(info));
  } else console.log('SIN ffmpeg: se omiten las miniaturas');

  // ── Eliminar cuenta ──
  check('antes: Ana tiene publicaciones guardadas', Object.values(readData('social_posts.json')).some(p => p.userId === A));
  check('Bea elimina su cuenta', (await call('POST', '/account/delete', { userId: B, confirm: 'DELETE' }, as(B))).body.success === true);
  check('Bea: sin canal ni publicaciones', !readData('social_profiles.json')[B] && !Object.values(readData('social_posts.json')).some(p => p.userId === B));
  check('Bea: sin me gusta ni comentarios ni avisos suyos', !Object.keys(readData('social_likes.json')).some(k => k.endsWith(`|${B}`))
        && !Object.values(readData('social_comments.json')).some(c => c.userId === B)
        && !Object.values(readData('social_notifications.json')).flat().some(n => n.fromId === B));
  const files = Object.values(readData('social_posts.json')).filter(p => p.userId === A).flatMap(p => p.media.flatMap(m => [m.file, m.thumb, m.original].filter(Boolean)));
  check('Ana elimina su cuenta', (await call('POST', '/account/delete', { userId: A, confirm: 'DELETE' }, as(A))).body.success === true);
  check('Ana: sin canal, publicaciones ni seguidores', !readData('social_profiles.json')[A] && !Object.values(readData('social_posts.json')).some(p => p.userId === A)
        && !Object.values(readData('social_follows.json')).some(x => x.targetId === A || x.followerId === A));
  check('Ana: sus archivos se borran (foto del canal incluida)', files.length > 0 && files.every(n => !fs.existsSync(path.join(UP, n))) && !fs.existsSync(avatarFile));
  check('Carlos ya no ve nada de Ana', !(await feed(C)).some(p => p.userId === A));
} catch (e) {
  fail++; console.log('FALLO  excepción', e.stack);
} finally {
  srv.kill();
  if (fail) console.log(log.slice(-3000));
  console.log(`\n${ok} OK · ${fail} fallos`);
  await sleep(500);
  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* Windows: el proceso aún la tiene abierta */ }
  process.exit(fail ? 1 : 0);
}
