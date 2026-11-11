/**
 * Social — canales, seguir, publicaciones (fotos o un vídeo), me gusta, comentarios, guardados, avisos,
 * bloqueos, denuncias y moderación desde /admin.
 *
 * Reglas (decididas 2026-11-10):
 *   · Cada publicación elige "Público" (cualquier usuario de OldFace con sesión) o "Solo mis contactos".
 *   · Publicar puede cualquiera; los directos siguen siendo solo de las cuentas autorizadas (server.js).
 *   · El canal tiene su propia foto y portada, públicas: la foto de perfil del chat sigue con su privacidad.
 *   · Un bloqueo (en cualquier sentido) esconde canal, publicaciones y comentarios entre los dos.
 *   · Retirado por el administrador → solo lo ve su autor. Canal suspendido → no puede publicar ni comentar.
 * Datos: data/social_profiles.json · social_follows.json · social_posts.json · social_likes.json ·
 *        social_comments.json · social_saves.json · social_blocks.json · social_reports.json · social_notifications.json
 * Archivos: los sube la app con POST /chat/upload; aquí se preparan miniatura y vídeo 720p (como los estados).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CATEGORIES = ['musica', 'juegos', 'deportes', 'viajes', 'cocina', 'belleza', 'animales', 'fitness', 'charla', 'otros'];
const VISIBILITY = ['public', 'contacts'];
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const VIDEO_EXT = ['.mp4', '.webm', '.3gp', '.mov'];
const MAX_MEDIA = 10, MAX_TEXT = 2200, MAX_COMMENT = 500, MAX_BIO = 300, PAGE = 20;
const DAILY = { post: 30, comment: 300, report: 30 };
const RESERVED = ['oldface', 'admin', 'administrador', 'soporte', 'support', 'willy', 'directo', 'directos', 'social'];
const FILE_RE = /\/files\/([\w.-]+)$/;

const TEXT = {
  es: { follow: (n) => `👤 ${n} ha empezado a seguirte`, comment: (n) => `💬 ${n} ha comentado tu publicación`,
        post: (n) => `🆕 ${n} ha publicado algo nuevo`, live: (n) => `🔴 ${n} está en directo`, tap: 'Toca para verlo' },
  en: { follow: (n) => `👤 ${n} started following you`, comment: (n) => `💬 ${n} commented on your post`,
        post: (n) => `🆕 ${n} posted something new`, live: (n) => `🔴 ${n} is live`, tap: 'Tap to watch' },
};

module.exports = function social({ router, authUser, adminAuth, loadJSON, saveJSON, findUserById, isContactOf,
                                   contactsOf, pushToUser, userLang, rtcEmit, absFileUrl, uploadsDir, ffmpeg,
                                   fileInUse = () => false, channelExtras = () => ({ videos: 0, views: 0 }) }) {
  const store = (file) => {
    const map = new Map(Object.entries(loadJSON(file, {})));
    return { map, save: () => saveJSON(file, Object.fromEntries(map)) };
  };
  const profiles = store('social_profiles.json');     // userId → { handle, name, bio, avatar, cover, verified, banned, createdAt, updatedAt }
  const follows = store('social_follows.json');       // `${seguidor}|${seguido}` → { followerId, targetId, bell, at }
  const posts = store('social_posts.json');           // sp_… → { id, userId, text, category, visibility, media: [], likes, comments, views, … }
  const likes = store('social_likes.json');           // `${postId}|${userId}` → { at }
  const comments = store('social_comments.json');     // sc_… → { id, postId, userId, text, createdAt }
  const saves = store('social_saves.json');           // `${userId}|${postId}` → { at }
  const blocks = store('social_blocks.json');         // `${quien}|${bloqueado}` → { at }
  const reports = store('social_reports.json');       // sr_… → { id, reporterId, kind, targetId, reason, status, createdAt }
  const notes = store('social_notifications.json');   // userId → [{ id, type, fromId, postId, at, read }]

  // ── Índices en memoria (se rehacen al arrancar) ──
  const followersOf = new Map(), followingOf = new Map(), commentsOf = new Map();
  const addTo = (m, k, v) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(v); };
  const delFrom = (m, k, v) => { m.get(k)?.delete(v); };
  for (const f of follows.map.values()) { addTo(followersOf, f.targetId, f.followerId); addTo(followingOf, f.followerId, f.targetId); }
  for (const c of comments.map.values()) addTo(commentsOf, c.postId, c.id);
  // Contadores al día con lo guardado (por si un archivo se quedó a medias)
  for (const p of posts.map.values()) { p.likes = 0; p.comments = commentsOf.get(p.id)?.size || 0; }
  for (const k of likes.map.keys()) { const p = posts.map.get(k.split('|')[0]); if (p) p.likes++; }

  const id = (prefix) => `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const cleanText = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, max);
  const fileUrl = (name) => (name ? absFileUrl(`/files/${name}`) : null);
  const T = (uid) => TEXT[userLang(uid)] || TEXT.es;

  // ── Límites diarios por usuario (contra el spam) ──
  const usage = new Map();   // `${tipo}|${userId}|${día}` → n
  function overLimit(kind, uid) {
    const k = `${kind}|${uid}|${new Date().toISOString().slice(0, 10)}`;
    const n = (usage.get(k) || 0) + 1;
    if (n > DAILY[kind]) return true;
    usage.set(k, n);
    if (usage.size > 20000) usage.clear();
    return false;
  }

  // ── Bloqueos ──
  const blocked = (a, b) => blocks.map.has(`${a}|${b}`);
  const blockedEither = (a, b) => !!a && !!b && (blocked(a, b) || blocked(b, a));

  // ── Canales ──
  const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9._]+/g, '').replace(/^[._]+|[._]+$/g, '').slice(0, 18);
  const handleTaken = (h, exceptUid) => RESERVED.includes(h)
    || [...profiles.map.entries()].some(([uid, p]) => p.handle === h && uid !== exceptUid);
  function freeHandle(name) {
    const base = slug(name).length >= 3 ? slug(name) : 'canal';
    if (!handleTaken(base)) return base;
    for (let i = 0; i < 50; i++) {
      const h = `${base}${Math.floor(100 + Math.random() * 9900)}`;
      if (!handleTaken(h)) return h;
    }
    return `canal${crypto.randomBytes(3).toString('hex')}`;
  }
  /** Canal del usuario (se crea la primera vez que entra en Social o publica) */
  function ensureProfile(uid) {
    let p = profiles.map.get(uid);
    if (p) return p;
    const u = findUserById(uid);
    p = { handle: freeHandle(u?.name), name: cleanText(u?.name, 60) || 'OldFace', bio: '', avatar: null, cover: null,
          verified: false, banned: false, createdAt: Date.now(), updatedAt: Date.now() };
    profiles.map.set(uid, p);
    profiles.save();
    return p;
  }
  const userIdOf = (key) => {
    if (profiles.map.has(key)) return key;
    const h = String(key || '').replace(/^@/, '').toLowerCase();
    for (const [uid, p] of profiles.map) if (p.handle === h) return uid;
    return null;
  };
  /** Datos públicos del autor (sin teléfono ni email) */
  const authorOf = (uid) => {
    const p = profiles.map.get(uid);
    return p ? { userId: uid, name: p.name, handle: p.handle, avatar: fileUrl(p.avatar), verified: !!p.verified } : null;
  };

  // ── Quién ve qué ──
  function canSeePost(p, viewerId) {
    if (!p || !viewerId) return false;
    if (p.userId === viewerId) return true;
    if (p.hiddenByAdmin || profiles.map.get(p.userId)?.banned) return false;
    if (blockedEither(p.userId, viewerId)) return false;
    return p.visibility === 'public' || isContactOf(p.userId, viewerId);
  }
  function postFor(p, viewerId) {
    return {
      id: p.id, userId: p.userId, text: p.text, category: p.category, visibility: p.visibility,
      media: p.media.map(m => ({ type: m.type, url: fileUrl(m.file), thumb: fileUrl(m.thumb), duration: m.duration || null })),
      createdAt: p.createdAt, editedAt: p.editedAt || null, likes: p.likes || 0, comments: p.comments || 0, views: p.views || 0,
      liked: likes.map.has(`${p.id}|${viewerId}`), saved: saves.map.has(`${viewerId}|${p.id}`), mine: p.userId === viewerId,
      ...(p.userId === viewerId && p.hiddenByAdmin ? { hiddenByAdmin: true } : {}),
    };
  }
  /** { posts, authors, next } de una lista ya filtrada y ordenada */
  function pageOf(list, viewerId, page) {
    const n = Math.max(0, Number(page) || 0);
    const slice = list.slice(n * PAGE, n * PAGE + PAGE);
    const authors = {};
    for (const p of slice) {
      if (!authors[p.userId]) authors[p.userId] = { ...authorOf(p.userId), followed: follows.map.has(`${viewerId}|${p.userId}`) };
    }
    return { posts: slice.map(p => postFor(p, viewerId)), authors, next: list.length > (n + 1) * PAGE ? n + 1 : null };
  }
  const visiblePosts = (viewerId) => [...posts.map.values()].filter(p => canSeePost(p, viewerId));
  const recent = (a, b) => b.createdAt - a.createdAt;
  /** Para ti: lo reciente pesa más; me gusta y comentarios suben; de quien sigues o tus contactos, un poco más */
  function score(p, viewerId) {
    const hours = (Date.now() - p.createdAt) / 3_600_000;
    const near = followingOf.get(viewerId)?.has(p.userId) || isContactOf(p.userId, viewerId) ? 1.5 : 1;
    return near * (1 + (p.likes || 0) * 2 + (p.comments || 0) * 3 + (p.views || 0) * 0.05) / Math.pow(hours + 2, 1.4);
  }
  const isVideo = (p) => p.media[0]?.type === 'video';

  // ── Avisos (campana de Social) ──
  function notify(uid, type, fromId, extra = {}) {
    if (!uid || uid === fromId || blockedEither(uid, fromId) || !findUserById(uid)) return;
    let list = notes.map.get(uid) || [];
    // Un solo aviso por "me gusta" de la misma persona a la misma publicación
    if (type === 'like' && list.some(n => n.type === 'like' && n.fromId === fromId && n.postId === extra.postId)) return;
    list = [{ id: id('sn'), type, fromId, ...extra, at: Date.now(), read: false }, ...list].slice(0, 200);
    notes.map.set(uid, list);
    notes.save();
    rtcEmit(uid, 'social:notification', { type, unread: list.filter(n => !n.read).length });
  }

  // ── Archivos de las publicaciones ──
  /** URL de /files/ que mandó la app → nombre del archivo (tiene que existir y no ser de un directo) */
  function mediaItem(url) {
    const name = String(url || '').split('?')[0].match(FILE_RE)?.[1];
    if (!name || name.startsWith('live_') || !fs.existsSync(path.join(uploadsDir, name))) return null;
    const ext = path.extname(name).toLowerCase();
    const type = IMAGE_EXT.includes(ext) ? 'image' : VIDEO_EXT.includes(ext) ? 'video' : null;
    return type ? { type, file: name, thumb: null, duration: null } : null;
  }
  function dropUpload(name) {
    if (!name || fileInUse(name)) return;
    try { fs.unlinkSync(path.join(uploadsDir, path.basename(name))); } catch { /* ya no estaba */ }
  }
  const dropPostFiles = (p) => { for (const m of p.media) { dropUpload(m.file); dropUpload(m.thumb); dropUpload(m.original); } };

  // Miniatura (400 px) de cada foto o vídeo y vídeo en 720p con el índice al principio (de uno en uno, prioridad baja)
  function runFfmpeg(args, timeoutMs) {
    return new Promise((resolve) => {
      let err = '';
      const p = require('child_process').spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      try { require('os').setPriority(p.pid, 15); } catch { /* sin permiso: prioridad normal */ }
      p.stderr.on('data', d => { if (err.length < 20000) err += d; });
      const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
      p.on('close', (code) => { clearTimeout(t); resolve({ ok: code === 0, err }); });
      p.on('error', () => { clearTimeout(t); resolve({ ok: false, err }); });
    });
  }
  const size = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
  async function prepareItem(p, m) {
    const input = path.join(uploadsDir, m.file);
    if (!fs.existsSync(input)) return;
    const base = m.file.replace(/\.[^.]+$/, '');
    const alive = () => posts.map.get(p.id) === p;
    if (!m.thumb) {
      const thumbName = `${base}_th.jpg`, thumb = path.join(uploadsDir, thumbName);
      const frame = (at) => runFfmpeg(['-y', ...(at != null ? ['-ss', String(at)] : []), '-i', input, '-frames:v', '1',
        '-vf', 'scale=400:-2', '-q:v', '5', thumb], 60_000);
      const r = m.type === 'video' ? ((await frame(0.5)).ok ? { ok: true } : await frame(0)) : await frame(null);
      if (r.ok && size(thumb) > 0 && alive()) m.thumb = thumbName;
      else if (r.ok) dropUpload(thumbName);
    }
    if (m.type !== 'video' || !alive()) return;
    const outName = `${base}_s.mp4`, out = path.join(uploadsDir, outName);
    const r = await runFfmpeg(['-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', "scale='if(gt(iw,ih),-2,min(720,iw))':'if(gt(iw,ih),min(720,ih),-2)'",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27', '-maxrate', '2500k', '-bufsize', '5000k', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-threads', '2', out], 10 * 60_000);
    const d = r.err.match(/Duration: (\d+):(\d+):(\d+)/);
    if (d) m.duration = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
    if (r.ok && alive() && size(out) > 0 && size(out) < size(input)) {
      m.original = m.file;   // se borra al borrar la publicación (por si alguien lo está viendo justo ahora)
      m.file = outName;
    } else dropUpload(outName);
  }
  const queue = [];
  let busy = false;
  function queueMedia(p) {
    if (!ffmpeg || p.prepared) return;
    queue.push(p);
    if (busy) return;
    busy = true;
    (async () => {
      while (queue.length) {
        const x = queue.shift();
        if (posts.map.get(x.id) !== x) continue;
        for (const m of x.media) await prepareItem(x, m).catch((e) => console.error('[social] No se pudo preparar un archivo:', e.message));
        x.prepared = true;
        if (posts.map.get(x.id) === x) posts.save();
      }
      busy = false;
    })();
  }
  setTimeout(() => { for (const p of posts.map.values()) queueMedia(p); }, 25_000).unref?.();

  /** Imagen del canal: /files/… subido por la app, o la foto de perfil (data:image…) copiada como archivo propio */
  function channelImage(v) {
    if (v === null) return { name: null };
    const s = String(v || '');
    const m = s.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/s);
    if (m) {
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length < 100 || buf.length > 5_000_000) return null;
      const name = `sch_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
      fs.writeFileSync(path.join(uploadsDir, name), buf);
      return { name };
    }
    const item = mediaItem(s);
    return item?.type === 'image' ? { name: item.file } : null;
  }

  // ═══ Rutas de la app (todas con sesión) ═══

  /** GET /social/categories — categorías de las publicaciones */
  router.get('/social/categories', (req, res) => {
    if (!authUser(req, res, req.query.userId)) return;
    res.json({ categories: CATEGORIES });
  });

  /** GET /social/me — mi canal (se crea la primera vez) con avisos sin leer */
  router.get('/social/me', (req, res) => {
    const uid = authUser(req, res, req.query.userId);
    if (!uid) return;
    ensureProfile(uid);
    res.json({ ...channelFor(uid, uid), unread: (notes.map.get(uid) || []).filter(n => !n.read).length });
  });

  function channelFor(uid, viewerId) {
    const p = profiles.map.get(uid);
    const extra = channelExtras(uid, viewerId) || {};
    const own = [...posts.map.values()].filter(x => x.userId === uid && !x.hiddenByAdmin);
    return {
      ...authorOf(uid), bio: p.bio, cover: fileUrl(p.cover), banned: !!p.banned, createdAt: p.createdAt,
      followers: followersOf.get(uid)?.size || 0, following: followingOf.get(uid)?.size || 0,
      posts: own.length, videos: own.filter(isVideo).length + (extra.videos || 0),
      views: own.reduce((n, x) => n + (x.views || 0), 0) + (extra.views || 0),
      isMe: uid === viewerId, isContact: uid !== viewerId && isContactOf(uid, viewerId),
      followed: follows.map.has(`${viewerId}|${uid}`), bell: !!follows.map.get(`${viewerId}|${uid}`)?.bell,
      blockedByMe: blocked(viewerId, uid),
    };
  }

  /** GET /social/channels/:key — canal por userId o @nombre (no existe para quien lo ha bloqueado) */
  router.get('/social/channels/:key', (req, res) => {
    const viewerId = authUser(req, res, req.query.userId);
    if (!viewerId) return;
    const uid = userIdOf(req.params.key);
    if (!uid || blocked(uid, viewerId) || (profiles.map.get(uid)?.banned && uid !== viewerId))
      return res.status(404).json({ error: 'Canal no encontrado' });
    res.json(channelFor(uid, viewerId));
  });

  /** PUT /social/me — { handle?, name?, bio?, avatar?, cover? } (avatar/cover: /files/…, data:image… o null) */
  router.put('/social/me', (req, res) => {
    const uid = authUser(req, res, req.body?.userId);
    if (!uid) return;
    const p = ensureProfile(uid);
    const { handle, name, bio, avatar, cover } = req.body || {};
    if (handle !== undefined) {
      const h = String(handle || '').replace(/^@/, '').trim().toLowerCase();
      if (!/^[a-z0-9._]{3,24}$/.test(h)) return res.status(400).json({ error: 'El nombre de usuario debe tener de 3 a 24 letras, números, punto o guion bajo' });
      if (handleTaken(h, uid)) return res.status(409).json({ error: 'Ese nombre de usuario ya está cogido' });
    }
    if (name !== undefined && !cleanText(name, 60)) return res.status(400).json({ error: 'El nombre no puede estar vacío' });
    const img = {};
    for (const [k, v] of [['avatar', avatar], ['cover', cover]]) {
      if (v === undefined) continue;
      const r = channelImage(v);
      if (!r) return res.status(400).json({ error: 'Imagen no válida' });
      img[k] = r.name;
    }
    if (handle !== undefined) p.handle = String(handle).replace(/^@/, '').trim().toLowerCase();
    if (name !== undefined) p.name = cleanText(name, 60);
    if (bio !== undefined) p.bio = cleanText(bio, MAX_BIO);
    for (const k of Object.keys(img)) {
      if (p[k] && p[k] !== img[k]) dropUpload(p[k]);
      p[k] = img[k];
    }
    p.updatedAt = Date.now();
    profiles.save();
    res.json(channelFor(uid, uid));
  });

  /** GET /social/channels/:key/posts?type=all|video|photo&visibility=all|public&sort=recent|popular&page= */
  router.get('/social/channels/:key/posts', (req, res) => {
    const viewerId = authUser(req, res, req.query.userId);
    if (!viewerId) return;
    const uid = userIdOf(req.params.key);
    if (!uid || blocked(uid, viewerId)) return res.status(404).json({ error: 'Canal no encontrado' });
    const { type = 'all', visibility = 'all', sort = 'recent' } = req.query;
    const list = visiblePosts(viewerId).filter(p => p.userId === uid
      && (type === 'video' ? isVideo(p) : type === 'photo' ? p.media.length && !isVideo(p) : true)
      && (visibility === 'public' ? p.visibility === 'public' : true))
      .sort(sort === 'popular' ? (a, b) => (b.views + b.likes * 5) - (a.views + a.likes * 5) : recent);
    res.json(pageOf(list, viewerId, req.query.page));
  });

  /** GET /social/feed?tab=foryou|following|reels&page= */
  router.get('/social/feed', (req, res) => {
    const viewerId = authUser(req, res, req.query.userId);
    if (!viewerId) return;
    const tab = ['following', 'reels'].includes(req.query.tab) ? req.query.tab : 'foryou';
    const mine = followingOf.get(viewerId) || new Set();
    let list = visiblePosts(viewerId);
    if (tab === 'following') list = list.filter(p => mine.has(p.userId)).sort(recent);
    else {
      if (tab === 'reels') list = list.filter(isVideo);
      const s = new Map(list.map(p => [p.id, score(p, viewerId)]));
      list.sort((a, b) => s.get(b.id) - s.get(a.id));
    }
    res.json(pageOf(list, viewerId, req.query.page));
  });

  /** GET /social/explore?scope=public|contacts&category=&type=video|photo&page= — "Privado" = de mis contactos */
  router.get('/social/explore', (req, res) => {
    const viewerId = authUser(req, res, req.query.userId);
    if (!viewerId) return;
    const scope = req.query.scope === 'contacts' ? 'contacts' : 'public';
    const cat = CATEGORIES.includes(req.query.category) ? req.query.category : null;
    const mine = scope === 'contacts' ? contactsOf(viewerId) : null;
    const base = visiblePosts(viewerId).filter(p => p.userId !== viewerId && (!cat || p.category === cat)
      && (scope === 'public' ? p.visibility === 'public' : mine.has(p.userId) || isContactOf(p.userId, viewerId)))
      .sort(recent);
    if (req.query.type === 'video' || req.query.type === 'photo') {
      const want = req.query.type === 'video';
      return res.json(pageOf(base.filter(p => p.media.length && isVideo(p) === want), viewerId, req.query.page));
    }
    const videos = pageOf(base.filter(isVideo), viewerId, 0);
    const photos = pageOf(base.filter(p => p.media.length && !isVideo(p)), viewerId, 0);
    res.json({ videos: videos.posts.slice(0, 12), photos: photos.posts.slice(0, 12), authors: { ...videos.authors, ...photos.authors } });
  });

  /** GET /social/search?q= — canales (nombre o @usuario) y publicaciones (texto) */
  router.get('/social/search', (req, res) => {
    const viewerId = authUser(req, res, req.query.userId);
    if (!viewerId) return;
    const q = cleanText(req.query.q, 60).toLowerCase().replace(/^@/, '');
    if (q.length < 2) return res.json({ channels: [], posts: [], authors: {} });
    const channels = [...profiles.map.entries()]
      .filter(([uid, p]) => !p.banned && !blockedEither(uid, viewerId)
        && (p.handle.includes(q) || p.name.toLowerCase().includes(q)))
      .slice(0, 20).map(([uid]) => channelFor(uid, viewerId));
    const found = pageOf(visiblePosts(viewerId).filter(p => p.text.toLowerCase().includes(q)).sort(recent), viewerId, 0);
    res.json({ channels, posts: found.posts, authors: found.authors });
  });

  /** POST /social/posts — { text, media: [url /files/…], category, visibility } hasta 10 fotos o 1 vídeo */
  router.post('/social/posts', (req, res) => {
    const uid = authUser(req, res, req.body?.userId);
    if (!uid) return;
    const prof = ensureProfile(uid);
    if (prof.banned) return res.status(403).json({ error: 'Tu canal está suspendido' });
    const text = cleanText(req.body?.text, MAX_TEXT);
    const urls = Array.isArray(req.body?.media) ? req.body.media : [];
    if (urls.length > MAX_MEDIA) return res.status(400).json({ error: `Máximo ${MAX_MEDIA} fotos por publicación` });
    const media = urls.map(mediaItem);
    if (media.some(m => !m)) return res.status(400).json({ error: 'Archivo no válido' });
    const videos = media.filter(m => m.type === 'video').length;
    if (videos > 1 || (videos === 1 && media.length > 1)) return res.status(400).json({ error: 'Un vídeo va solo en su publicación' });
    if (!text && !media.length) return res.status(400).json({ error: 'Escribe algo o añade una foto o un vídeo' });
    const visibility = req.body?.visibility ?? 'public';
    if (!VISIBILITY.includes(visibility)) return res.status(400).json({ error: 'Visibilidad no válida' });
    const category = req.body?.category ?? 'otros';
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Categoría no válida' });
    if (overLimit('post', uid)) return res.status(429).json({ error: 'Has llegado al máximo de publicaciones de hoy' });
    const p = { id: id('sp'), userId: uid, text, category, visibility, media, likes: 0, comments: 0, views: 0,
                prepared: !media.length, hiddenByAdmin: false, createdAt: Date.now() };
    posts.map.set(p.id, p);
    posts.save();
    queueMedia(p);
    // Quien tiene la campana activada recibe un aviso (si puede verla)
    for (const fid of followersOf.get(uid) || []) {
      if (!follows.map.get(`${fid}|${uid}`)?.bell || !canSeePost(p, fid)) continue;
      notify(fid, 'post', uid, { postId: p.id });
      pushToUser(fid, T(fid).post(prof.name), text.slice(0, 80) || T(fid).tap, { type: 'social', postId: p.id });
    }
    res.status(201).json({ post: postFor(p, uid), authors: { [uid]: authorOf(uid) } });
  });

  /** GET /social/posts/:id — una publicación (no existe para quien no puede verla) */
  router.get('/social/posts/:id', (req, res) => {
    const viewerId = authUser(req, res, req.query.userId);
    if (!viewerId) return;
    const p = posts.map.get(req.params.id);
    if (!canSeePost(p, viewerId)) return res.status(404).json({ error: 'Publicación no encontrada' });
    res.json({ post: postFor(p, viewerId), authors: { [p.userId]: authorOf(p.userId) } });
  });

  /** PUT /social/posts/:id — { text?, category?, visibility? } solo el autor */
  router.put('/social/posts/:id', (req, res) => {
    const uid = authUser(req, res, req.body?.userId);
    if (!uid) return;
    const p = posts.map.get(req.params.id);
    if (!p || p.userId !== uid) return res.status(404).json({ error: 'Publicación no encontrada' });
    const { text, category, visibility } = req.body || {};
    if (category !== undefined && !CATEGORIES.includes(category)) return res.status(400).json({ error: 'Categoría no válida' });
    if (visibility !== undefined && !VISIBILITY.includes(visibility)) return res.status(400).json({ error: 'Visibilidad no válida' });
    if (text !== undefined && !cleanText(text, MAX_TEXT) && !p.media.length) return res.status(400).json({ error: 'Escribe algo' });
    if (text !== undefined) p.text = cleanText(text, MAX_TEXT);
    if (category !== undefined) p.category = category;
    if (visibility !== undefined) p.visibility = visibility;
    p.editedAt = Date.now();
    posts.save();
    res.json({ post: postFor(p, uid) });
  });

  function deletePost(p) {
    posts.map.delete(p.id);
    for (const cid of commentsOf.get(p.id) || []) comments.map.delete(cid);
    commentsOf.delete(p.id);
    for (const k of [...likes.map.keys()]) if (k.startsWith(`${p.id}|`)) likes.map.delete(k);
    for (const k of [...saves.map.keys()]) if (k.endsWith(`|${p.id}`)) saves.map.delete(k);
    for (const [uid, list] of notes.map) {
      const kept = list.filter(n => n.postId !== p.id);
      if (kept.length !== list.length) notes.map.set(uid, kept);
    }
    posts.save(); comments.save(); likes.save(); saves.save(); notes.save();
    dropPostFiles(p);
  }

  /** DELETE /social/posts/:id — solo el autor; borra también sus archivos, comentarios y me gusta */
  router.delete('/social/posts/:id', (req, res) => {
    const uid = authUser(req, res, req.query.userId || req.body?.userId);
    if (!uid) return;
    const p = posts.map.get(req.params.id);
    if (!p || p.userId !== uid) return res.status(404).json({ error: 'Publicación no encontrada' });
    deletePost(p);
    res.json({ success: true });
  });

  /** POST /social/posts/:id/view — una visualización más (una por persona mientras el servidor sigue en marcha) */
  const seen = new Set();
  router.post('/social/posts/:id/view', (req, res) => {
    const viewerId = authUser(req, res, req.body?.userId);
    if (!viewerId) return;
    const p = posts.map.get(req.params.id);
    if (!canSeePost(p, viewerId)) return res.status(404).json({ error: 'Publicación no encontrada' });
    const k = `${p.id}|${viewerId}`;
    if (viewerId !== p.userId && !seen.has(k)) {
      seen.add(k);
      if (seen.size > 200000) seen.clear();
      p.views = (p.views || 0) + 1;
      posts.save();
    }
    res.json({ views: p.views || 0 });
  });

  /** POST /social/posts/:id/like y DELETE — me gusta / quitarlo */
  router.post('/social/posts/:id/like', (req, res) => likeRoute(req, res, true));
  router.delete('/social/posts/:id/like', (req, res) => likeRoute(req, res, false));
  function likeRoute(req, res, on) {
    const uid = authUser(req, res, req.body?.userId || req.query.userId);
    if (!uid) return;
    const p = posts.map.get(req.params.id);
    if (!canSeePost(p, uid)) return res.status(404).json({ error: 'Publicación no encontrada' });
    const k = `${p.id}|${uid}`;
    if (on && !likes.map.has(k)) {
      likes.map.set(k, { at: Date.now() }); p.likes = (p.likes || 0) + 1;
      likes.save(); posts.save();
      notify(p.userId, 'like', uid, { postId: p.id });
    } else if (!on && likes.map.has(k)) {
      likes.map.delete(k); p.likes = Math.max(0, (p.likes || 0) - 1);
      likes.save(); posts.save();
    }
    res.json({ liked: on, likes: p.likes || 0 });
  }

  /** POST /social/posts/:id/save y DELETE — guardar / quitar de guardados */
  router.post('/social/posts/:id/save', (req, res) => saveRoute(req, res, true));
  router.delete('/social/posts/:id/save', (req, res) => saveRoute(req, res, false));
  function saveRoute(req, res, on) {
    const uid = authUser(req, res, req.body?.userId || req.query.userId);
    if (!uid) return;
    const p = posts.map.get(req.params.id);
    if (!canSeePost(p, uid)) return res.status(404).json({ error: 'Publicación no encontrada' });
    if (on) saves.map.set(`${uid}|${p.id}`, { at: Date.now() }); else saves.map.delete(`${uid}|${p.id}`);
    saves.save();
    res.json({ saved: on });
  }

  /** GET /social/saved?page= — mis guardados (los que ya no puedo ver no salen) */
  router.get('/social/saved', (req, res) => {
    const uid = authUser(req, res, req.query.userId);
    if (!uid) return;
    const list = [...saves.map.entries()].filter(([k]) => k.startsWith(`${uid}|`))
      .sort((a, b) => b[1].at - a[1].at).map(([k]) => posts.map.get(k.slice(uid.length + 1)))
      .filter(p => canSeePost(p, uid));
    res.json(pageOf(list, uid, req.query.page));
  });

  // ── Comentarios ──
  const commentFor = (c, viewerId, p) => ({ id: c.id, postId: c.postId, text: c.text, createdAt: c.createdAt,
    author: authorOf(c.userId), mine: c.userId === viewerId, canDelete: c.userId === viewerId || p?.userId === viewerId });

  /** GET /social/posts/:id/comments?page= — de más antiguo a más nuevo (sin los de quien me bloquea o bloqueo) */
  router.get('/social/posts/:id/comments', (req, res) => {
    const viewerId = authUser(req, res, req.query.userId);
    if (!viewerId) return;
    const p = posts.map.get(req.params.id);
    if (!canSeePost(p, viewerId)) return res.status(404).json({ error: 'Publicación no encontrada' });
    const all = [...(commentsOf.get(p.id) || [])].map(cid => comments.map.get(cid))
      .filter(c => c && !blockedEither(c.userId, viewerId) && !profiles.map.get(c.userId)?.banned)
      .sort((a, b) => a.createdAt - b.createdAt);
    const n = Math.max(0, Number(req.query.page) || 0), size = 50;
    res.json({ comments: all.slice(n * size, n * size + size).map(c => commentFor(c, viewerId, p)),
               next: all.length > (n + 1) * size ? n + 1 : null, total: all.length });
  });

  /** POST /social/posts/:id/comments — { text } */
  router.post('/social/posts/:id/comments', (req, res) => {
    const uid = authUser(req, res, req.body?.userId);
    if (!uid) return;
    const p = posts.map.get(req.params.id);
    if (!canSeePost(p, uid)) return res.status(404).json({ error: 'Publicación no encontrada' });
    if (ensureProfile(uid).banned) return res.status(403).json({ error: 'Tu canal está suspendido' });
    const text = cleanText(req.body?.text, MAX_COMMENT);
    if (!text) return res.status(400).json({ error: 'El comentario está vacío' });
    if (overLimit('comment', uid)) return res.status(429).json({ error: 'Has llegado al máximo de comentarios de hoy' });
    const c = { id: id('sc'), postId: p.id, userId: uid, text, createdAt: Date.now() };
    comments.map.set(c.id, c); addTo(commentsOf, p.id, c.id);
    p.comments = (p.comments || 0) + 1;
    comments.save(); posts.save();
    if (p.userId !== uid) {
      notify(p.userId, 'comment', uid, { postId: p.id, commentId: c.id });
      if (!blockedEither(p.userId, uid))
        pushToUser(p.userId, T(p.userId).comment(profiles.map.get(uid).name), text.slice(0, 80), { type: 'social', postId: p.id });
    }
    res.status(201).json({ comment: commentFor(c, uid, p), comments: p.comments });
  });

  function deleteComment(c) {
    comments.map.delete(c.id); delFrom(commentsOf, c.postId, c.id);
    const p = posts.map.get(c.postId);
    if (p) { p.comments = Math.max(0, (p.comments || 0) - 1); posts.save(); }
    comments.save();
  }

  /** DELETE /social/comments/:id — su autor o el autor de la publicación */
  router.delete('/social/comments/:id', (req, res) => {
    const uid = authUser(req, res, req.query.userId || req.body?.userId);
    if (!uid) return;
    const c = comments.map.get(req.params.id);
    const p = c && posts.map.get(c.postId);
    if (!c || (c.userId !== uid && p?.userId !== uid)) return res.status(404).json({ error: 'Comentario no encontrado' });
    deleteComment(c);
    res.json({ success: true });
  });

  // ── Seguir ──
  /** POST /social/follow/:userId — { bell? } seguir un canal (o cambiar la campana) */
  router.post('/social/follow/:userId', (req, res) => {
    const uid = authUser(req, res, req.body?.userId);
    if (!uid) return;
    const target = userIdOf(req.params.userId);
    if (!target || target === uid || blockedEither(uid, target) || profiles.map.get(target)?.banned)
      return res.status(404).json({ error: 'Canal no encontrado' });
    ensureProfile(uid);
    const k = `${uid}|${target}`;
    const isNew = !follows.map.has(k);
    const bell = req.body?.bell !== undefined ? !!req.body.bell : !!follows.map.get(k)?.bell;
    follows.map.set(k, { followerId: uid, targetId: target, bell, at: follows.map.get(k)?.at || Date.now() });
    addTo(followersOf, target, uid); addTo(followingOf, uid, target);
    follows.save();
    if (isNew) {
      notify(target, 'follow', uid);
      pushToUser(target, T(target).follow(profiles.map.get(uid).name), T(target).tap, { type: 'social', channelId: uid });
    }
    res.json({ followed: true, bell, followers: followersOf.get(target).size });
  });

  /** DELETE /social/follow/:userId — dejar de seguir */
  router.delete('/social/follow/:userId', (req, res) => {
    const uid = authUser(req, res, req.query.userId || req.body?.userId);
    if (!uid) return;
    const target = userIdOf(req.params.userId) || req.params.userId;
    follows.map.delete(`${uid}|${target}`);
    delFrom(followersOf, target, uid); delFrom(followingOf, uid, target);
    follows.save();
    res.json({ followed: false, bell: false, followers: followersOf.get(target)?.size || 0 });
  });

  /** GET /social/channels/:key/followers y /following?page= — listas de canales */
  for (const kind of ['followers', 'following']) {
    router.get(`/social/channels/:key/${kind}`, (req, res) => {
      const viewerId = authUser(req, res, req.query.userId);
      if (!viewerId) return;
      const uid = userIdOf(req.params.key);
      if (!uid || blocked(uid, viewerId)) return res.status(404).json({ error: 'Canal no encontrado' });
      const ids = [...((kind === 'followers' ? followersOf : followingOf).get(uid) || [])]
        .filter(x => profiles.map.has(x) && !profiles.map.get(x).banned && !blockedEither(x, viewerId));
      const n = Math.max(0, Number(req.query.page) || 0), size = 50;
      res.json({ channels: ids.slice(n * size, n * size + size).map(x => ({ ...authorOf(x), followed: follows.map.has(`${viewerId}|${x}`) })),
                 next: ids.length > (n + 1) * size ? n + 1 : null, total: ids.length });
    });
  }

  // ── Bloquear y denunciar ──
  /** POST /social/block/:userId — bloquear (también deja de seguirse en los dos sentidos) */
  router.post('/social/block/:userId', (req, res) => {
    const uid = authUser(req, res, req.body?.userId);
    if (!uid) return;
    const target = req.params.userId;
    if (target === uid || !findUserById(target)) return res.status(404).json({ error: 'Usuario no encontrado' });
    blocks.map.set(`${uid}|${target}`, { at: Date.now() });
    for (const [a, b] of [[uid, target], [target, uid]]) {
      follows.map.delete(`${a}|${b}`); delFrom(followersOf, b, a); delFrom(followingOf, a, b);
    }
    blocks.save(); follows.save();
    res.json({ blocked: true });
  });

  /** DELETE /social/block/:userId — desbloquear */
  router.delete('/social/block/:userId', (req, res) => {
    const uid = authUser(req, res, req.query.userId || req.body?.userId);
    if (!uid) return;
    blocks.map.delete(`${uid}|${req.params.userId}`);
    blocks.save();
    res.json({ blocked: false });
  });

  /** GET /social/blocked — a quién he bloqueado */
  router.get('/social/blocked', (req, res) => {
    const uid = authUser(req, res, req.query.userId);
    if (!uid) return;
    const ids = [...blocks.map.keys()].filter(k => k.startsWith(`${uid}|`)).map(k => k.slice(uid.length + 1));
    res.json({ users: ids.map(x => authorOf(x) || { userId: x, name: findUserById(x)?.name || 'OldFace' }) });
  });

  const REPORT_KINDS = ['post', 'comment', 'channel'];
  /** POST /social/report — { kind: post|comment|channel, targetId, reason } (solo lo que el usuario puede ver) */
  router.post('/social/report', (req, res) => {
    const uid = authUser(req, res, req.body?.userId);
    if (!uid) return;
    const { kind, targetId } = req.body || {};
    if (!REPORT_KINDS.includes(kind)) return res.status(400).json({ error: 'Denuncia no válida' });
    const ok = kind === 'post' ? canSeePost(posts.map.get(targetId), uid)
      : kind === 'comment' ? !!comments.map.get(targetId) && canSeePost(posts.map.get(comments.map.get(targetId).postId), uid)
      : profiles.map.has(targetId) && targetId !== uid;
    if (!ok) return res.status(404).json({ error: 'No encontrado' });
    if (overLimit('report', uid)) return res.status(429).json({ error: 'Has enviado muchas denuncias hoy' });
    const r = { id: id('sr'), reporterId: uid, kind, targetId, reason: cleanText(req.body?.reason, 500), status: 'open', createdAt: Date.now() };
    reports.map.set(r.id, r);
    reports.save();
    res.status(201).json({ success: true });
  });

  // ── Avisos ──
  /** GET /social/notifications — mis avisos de Social (nuevos seguidores, me gusta, comentarios, directos) */
  router.get('/social/notifications', (req, res) => {
    const uid = authUser(req, res, req.query.userId);
    if (!uid) return;
    const list = (notes.map.get(uid) || []).filter(n => !blockedEither(uid, n.fromId) && profiles.map.has(n.fromId));
    res.json({ notifications: list.map(n => ({ ...n, from: authorOf(n.fromId) })), unread: list.filter(n => !n.read).length });
  });

  /** POST /social/notifications/read — marcar todos como leídos */
  router.post('/social/notifications/read', (req, res) => {
    const uid = authUser(req, res, req.body?.userId);
    if (!uid) return;
    const list = notes.map.get(uid) || [];
    if (list.some(n => !n.read)) { list.forEach(n => { n.read = true; }); notes.save(); }
    res.json({ unread: 0 });
  });

  // ═══ Administración (/admin → Social) ═══
  const userLabel = (uid) => {
    const u = findUserById(uid), p = profiles.map.get(uid);
    return { userId: uid, name: p?.name || u?.name || uid, handle: p?.handle || null, phone: u?.phone || null };
  };

  /** GET /admin/social/summary — números de Social */
  router.get('/admin/social/summary', adminAuth, (_req, res) => {
    const list = [...posts.map.values()];
    res.json({ channels: profiles.map.size, posts: list.length, videos: list.filter(isVideo).length,
               hidden: list.filter(p => p.hiddenByAdmin).length, comments: comments.map.size, follows: follows.map.size,
               likes: likes.map.size, openReports: [...reports.map.values()].filter(r => r.status === 'open').length });
  });

  /** GET /admin/social/posts — las 300 más recientes (también las retiradas) */
  router.get('/admin/social/posts', adminAuth, (_req, res) => {
    const list = [...posts.map.values()].sort(recent).slice(0, 300).map(p => ({
      ...postFor(p, null), hiddenByAdmin: !!p.hiddenByAdmin, author: userLabel(p.userId) }));
    res.json({ posts: list });
  });

  /** PUT /admin/social/posts/:id — { hidden } retirar / volver a mostrar */
  router.put('/admin/social/posts/:id', adminAuth, (req, res) => {
    const p = posts.map.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Publicación no encontrada' });
    p.hiddenByAdmin = !!req.body?.hidden;
    posts.save();
    res.json({ success: true, hiddenByAdmin: p.hiddenByAdmin });
  });

  /** DELETE /admin/social/posts/:id — borrar para siempre (con sus archivos) */
  router.delete('/admin/social/posts/:id', adminAuth, (req, res) => {
    const p = posts.map.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Publicación no encontrada' });
    deletePost(p);
    res.json({ success: true });
  });

  /** DELETE /admin/social/comments/:id — borrar un comentario */
  router.delete('/admin/social/comments/:id', adminAuth, (req, res) => {
    const c = comments.map.get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Comentario no encontrado' });
    deleteComment(c);
    res.json({ success: true });
  });

  /** GET /admin/social/channels — todos los canales con sus números */
  router.get('/admin/social/channels', adminAuth, (_req, res) => {
    const list = [...profiles.map.entries()].map(([uid, p]) => ({
      ...userLabel(uid), verified: !!p.verified, banned: !!p.banned, createdAt: p.createdAt,
      followers: followersOf.get(uid)?.size || 0, posts: [...posts.map.values()].filter(x => x.userId === uid).length,
    })).sort((a, b) => b.followers - a.followers);
    res.json({ channels: list });
  });

  /** PUT /admin/social/channels/:userId — { verified?, banned? } insignia de verificado / suspender */
  router.put('/admin/social/channels/:userId', adminAuth, (req, res) => {
    const p = profiles.map.get(req.params.userId);
    if (!p) return res.status(404).json({ error: 'Canal no encontrado' });
    const { verified, banned } = req.body || {};
    if ((verified !== undefined && typeof verified !== 'boolean') || (banned !== undefined && typeof banned !== 'boolean')
        || (verified === undefined && banned === undefined))
      return res.status(400).json({ error: 'Datos no válidos' });
    if (verified !== undefined) p.verified = verified;
    if (banned !== undefined) p.banned = banned;
    p.updatedAt = Date.now();
    profiles.save();
    res.json({ success: true, verified: !!p.verified, banned: !!p.banned });
  });

  /** GET /admin/social/reports — denuncias (las abiertas primero) con lo denunciado */
  router.get('/admin/social/reports', adminAuth, (_req, res) => {
    const open = (r) => (r.status === 'open' ? 0 : 1);
    const list = [...reports.map.values()].sort((a, b) => open(a) - open(b) || b.createdAt - a.createdAt)
      .slice(0, 300).map(r => {
        const target = r.kind === 'post' ? posts.map.get(r.targetId) : r.kind === 'comment' ? comments.map.get(r.targetId) : null;
        const ownerId = r.kind === 'channel' ? r.targetId : target?.userId;
        return { ...r, reporter: userLabel(r.reporterId), owner: ownerId ? userLabel(ownerId) : null,
                 exists: r.kind === 'channel' ? profiles.map.has(r.targetId) : !!target,
                 preview: r.kind === 'post' && target
                   ? { text: target.text.slice(0, 200), hiddenByAdmin: !!target.hiddenByAdmin,
                       media: target.media.map(m => ({ type: m.type, url: fileUrl(m.file), thumb: fileUrl(m.thumb) })) }
                   : r.kind === 'comment' && target ? { text: target.text } : null };
      });
    res.json({ reports: list });
  });

  /** PUT /admin/social/reports/:id — { status: open|done|dismissed } */
  router.put('/admin/social/reports/:id', adminAuth, (req, res) => {
    const r = reports.map.get(req.params.id);
    if (!r) return res.status(404).json({ error: 'Denuncia no encontrada' });
    if (!['open', 'done', 'dismissed'].includes(req.body?.status)) return res.status(400).json({ error: 'Estado no válido' });
    r.status = req.body.status; r.resolvedAt = Date.now();
    reports.save();
    res.json({ success: true });
  });

  // ═══ Para server.js ═══
  /** Un directo público ha empezado: aviso en Social a todos sus seguidores; con campana, también notificación */
  function notifyLive(d, alreadyPushed = new Set()) {
    const hostName = profiles.map.get(d.creatorId)?.name || findUserById(d.creatorId)?.name || 'OldFace';
    for (const fid of followersOf.get(d.creatorId) || []) {
      notify(fid, 'live', d.creatorId, { directoId: d.id });
      if (follows.map.get(`${fid}|${d.creatorId}`)?.bell && !alreadyPushed.has(fid))
        pushToUser(fid, T(fid).live(hostName), d.title || T(fid).tap, { type: 'live', directoId: d.id });
    }
  }

  /** Eliminar cuenta: su canal, publicaciones (con archivos), comentarios, me gusta, seguidores, bloqueos y avisos */
  function forgetUser(uid) {
    for (const p of [...posts.map.values()]) if (p.userId === uid) deletePost(p);
    for (const c of [...comments.map.values()]) if (c.userId === uid) deleteComment(c);
    for (const k of [...likes.map.keys()]) {
      const [pid, who] = k.split('|');
      if (who !== uid) continue;
      likes.map.delete(k);
      const p = posts.map.get(pid);
      if (p) p.likes = Math.max(0, (p.likes || 0) - 1);
    }
    for (const k of [...saves.map.keys()]) if (k.startsWith(`${uid}|`)) saves.map.delete(k);
    for (const [k, f] of [...follows.map]) {
      if (f.followerId !== uid && f.targetId !== uid) continue;
      follows.map.delete(k); delFrom(followersOf, f.targetId, f.followerId); delFrom(followingOf, f.followerId, f.targetId);
    }
    followersOf.delete(uid); followingOf.delete(uid);
    for (const k of [...blocks.map.keys()]) if (k.split('|').includes(uid)) blocks.map.delete(k);
    for (const [k, r] of [...reports.map]) if (r.reporterId === uid || r.targetId === uid) reports.map.delete(k);
    notes.map.delete(uid);
    for (const [k, list] of notes.map) {
      const kept = list.filter(n => n.fromId !== uid);
      if (kept.length !== list.length) notes.map.set(k, kept);
    }
    const prof = profiles.map.get(uid);
    if (prof) { dropUpload(prof.avatar); dropUpload(prof.cover); profiles.map.delete(uid); }
    posts.save(); likes.save(); saves.save(); follows.save(); blocks.save(); reports.save(); notes.save(); profiles.save();
  }

  console.log(`[social] ${profiles.map.size} canales · ${posts.map.size} publicaciones · ${follows.map.size} seguimientos`);
  return { notifyLive, forgetUser, blockedEither, CATEGORIES };
};
