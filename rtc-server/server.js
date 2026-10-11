/**
 * OldFace RTC — servidor propio de tiempo real (llamadas, directos, karaoke y mensajes)
 *
 *  • Socket.IO  → autenticación, presencia, señalización de llamadas
 *  • mediasoup  → SFU para llamadas 1:1, de grupo y directos (antes UIKit)
 *  • TURN       → credenciales temporales para coturn (TURN REST API)
 *  • /internal  → el backend Express avisa de eventos (p. ej. mensajes nuevos)
 *
 * Escucha en 127.0.0.1:RTC_PORT; nginx expone wss://oldface.app/rtc/…
 * Ver docs/webrtc/PLAN.md
 */
const path = require('path');
require('dotenv').config({ path: process.env.ENV_FILE || path.join(__dirname, '.env') });

const crypto   = require('crypto');
const http     = require('http');
const os       = require('os');
const express  = require('express');
const mediasoup = require('mediasoup');
const { Server } = require('socket.io');

// ── Configuración ────────────────────────────────────────────────────────────
const CFG = {
  port:         parseInt(process.env.RTC_PORT || '4000', 10),
  host:         process.env.RTC_HOST || '127.0.0.1',
  secret:       process.env.RTC_SECRET,                 // firma de tokens + /internal
  turnSecret:   process.env.TURN_SECRET,                // static-auth-secret de coturn
  turnHost:     process.env.TURN_HOST || 'oldface.app',
  publicIp:     process.env.RTC_PUBLIC_IP,              // IP anunciada en los candidatos ICE
  basePort:     parseInt(process.env.RTC_BASE_PORT || '40000', 10), // un puerto UDP+TCP por worker
  numWorkers:   Math.min(parseInt(process.env.RTC_WORKERS || '4', 10), os.cpus().length),
  allowGuests:  process.env.RTC_ALLOW_GUESTS === '1',   // página de prueba: ids guest_* en salas test_*
  backendUrl:   process.env.RTC_BACKEND_URL || 'https://oldface.app/api', // para validar quién es el anfitrión de un directo
};
for (const k of ['secret', 'turnSecret', 'publicIp']) {
  if (!CFG[k]) { console.error(`[RTC] Falta configuración: ${k}`); process.exit(1); }
}

const MEDIA_CODECS = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  { kind: 'video', mimeType: 'video/VP8',  clockRate: 90000, parameters: { 'x-google-start-bitrate': 800 } },
  { kind: 'video', mimeType: 'video/H264', clockRate: 90000,
    parameters: { 'packetization-mode': 1, 'profile-level-id': '42e01f', 'level-asymmetry-allowed': 1 } },
];

// ── Tokens ───────────────────────────────────────────────────────────────────
// Formato: <userId>.<expSeg>.<hmac base64url>  — lo emite el backend al hacer login
function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts;
  const expected = crypto.createHmac('sha256', CFG.secret).update(`${userId}.${exp}`).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(exp) * 1000 < Date.now()) return null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId)) return null;
  return userId;
}

function iceServers(userId) {
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const username = `${exp}:${userId}`;
  const credential = crypto.createHmac('sha1', CFG.turnSecret).update(username).digest('base64');
  return [
    { urls: [`stun:${CFG.turnHost}:3478`] },
    { urls: [`turn:${CFG.turnHost}:3478?transport=udp`, `turn:${CFG.turnHost}:3478?transport=tcp`,
             `turns:${CFG.turnHost}:5349?transport=tcp`], username, credential },
  ];
}

// ── mediasoup: workers + WebRtcServer (un puerto por worker) ────────────────
const workers = [];   // { worker, webRtcServer }
let nextWorker = 0;

async function startWorkers() {
  for (let i = 0; i < CFG.numWorkers; i++) {
    const worker = await mediasoup.createWorker({ logLevel: 'warn' });
    worker.on('died', () => {
      console.error(`[RTC] Worker ${worker.pid} murió — reiniciando proceso`);
      setTimeout(() => process.exit(1), 1000); // systemd lo vuelve a levantar
    });
    const port = CFG.basePort + i;
    const webRtcServer = await worker.createWebRtcServer({
      listenInfos: [
        { protocol: 'udp', ip: '0.0.0.0', announcedAddress: CFG.publicIp, port },
        { protocol: 'tcp', ip: '0.0.0.0', announcedAddress: CFG.publicIp, port },
      ],
    });
    workers.push({ worker, webRtcServer });
    console.log(`[RTC] Worker ${i} pid=${worker.pid} puerto ${port} udp/tcp`);
  }
}

function pickWorker() {
  const w = workers[nextWorker];
  nextWorker = (nextWorker + 1) % workers.length;
  return w;
}

// ── Salas ────────────────────────────────────────────────────────────────────
/** roomId → { id, router, webRtcServer, peers: Map<socketId, Peer>, createdAt } */
const rooms = new Map();
/** Peer = { socketId, userId, name, role, transports:Map, producers:Map, consumers:Map } */

async function getOrCreateRoom(roomId) {
  let room = rooms.get(roomId);
  if (room) return room;
  const { worker, webRtcServer } = pickWorker();
  const router = await worker.createRouter({ mediaCodecs: MEDIA_CODECS });
  // Otra petición pudo crearla mientras esperábamos
  if (rooms.has(roomId)) { router.close(); return rooms.get(roomId); }
  room = { id: roomId, router, webRtcServer, peers: new Map(), createdAt: Date.now() };
  rooms.set(roomId, room);
  console.log(`[RTC] Sala creada ${roomId}`);
  return room;
}

function closePeer(room, socketId) {
  const peer = room.peers.get(socketId);
  if (!peer) return;
  for (const t of peer.transports.values()) t.close(); // cierra producers/consumers asociados
  room.peers.delete(socketId);
  io.to(`room:${room.id}`).emit('rtc:peerLeft', { roomId: room.id, userId: peer.userId });
  if (room.peers.size === 0) {
    room.router.close();
    rooms.delete(room.id);
    console.log(`[RTC] Sala cerrada ${room.id}`);
  }
}

function peerSummary(peer) {
  return {
    userId: peer.userId, name: peer.name, role: peer.role,
    producers: [...peer.producers.values()].map(p => ({ id: p.id, kind: p.kind, paused: p.paused, appData: p.appData })),
  };
}

// ── Directos (estilo Instagram / TikTok) ─────────────────────────────────────
// La sala de medios de un directo es `live_<directoId>`. El anfitrión y los invitados aceptados
// emiten; el resto solo ve. Chat, likes, espectadores e invitados viven aquí (en memoria).
/** liveId → { id, roomId, hostId, hostName, title, startedAt, chat[], likes, guests:Map, requests:Map, invited:Set, hostTimer } */
const lives = new Map();
const liveRoomId = (liveId) => `live_${liveId}`;

/** El directo tal como lo ve `userId` (el backend solo se lo da a quien puede verlo; null si no existe para él) */
async function fetchDirecto(liveId, userId) {
  const res = await fetch(`${CFG.backendUrl}/directos/${encodeURIComponent(liveId)}?userId=${encodeURIComponent(userId)}`,
    { signal: AbortSignal.timeout(5000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('No se pudo consultar el directo');
  return res.json();
}

function liveState(live) {
  return {
    liveId: live.id, hostId: live.hostId, hostName: live.hostName, title: live.title,
    startedAt: live.startedAt, likes: live.likes,
    viewers: liveViewers(live),
    guests: [...live.guests.entries()].map(([userId, name]) => ({ userId, name })),
    chat: live.chat.slice(-50),
  };
}

function liveViewers(live) {
  return io.sockets.adapter.rooms.get(`live:${live.id}`)?.size || 0;
}

function broadcastViewers(live) {
  io.to(`live:${live.id}`).emit('live:viewers', { liveId: live.id, viewers: liveViewers(live) });
}

function endLive(live, reason = 'ended') {
  clearTimeout(live.hostTimer);
  io.to(`live:${live.id}`).emit('live:ended', { liveId: live.id, reason });
  lives.delete(live.id);
  console.log(`[RTC] Directo finalizado ${live.id} (${reason})`);
  recFinish(live).catch(err => console.error(`[REC] ${live.id}: no se pudo cerrar la grabación:`, err.message));
}

// ── Grabación de directos ────────────────────────────────────────────────────
// Lo que emite el anfitrión se graba aquí: mediasoup reenvía su audio y vídeo por RTP (PlainTransport) a ffmpeg,
// que lo guarda sin recodificar (VP8/Opus → WebM; H264 → MP4). Si el anfitrión cambia de cámara o se va y vuelve,
// empieza otro tramo; al terminar el directo se unen los tramos en un archivo y se avisa al backend
// (POST /internal/live-recordings), que lo publica en el canal del anfitrión y lo registra en el Administrador.
const fs = require('fs');
const { spawn } = require('child_process');
const FFMPEG = (() => { try { return require('ffmpeg-static'); } catch { return null; } })();
// Los archivos van a la carpeta de subidas del backend, que es quien los sirve (/api/files/…)
const REC_DIR = process.env.RTC_RECORDINGS_DIR
  || [path.join(__dirname, '../httpdocs/backend/uploads'), path.join(__dirname, '../frontend/backend/uploads')].find(d => fs.existsSync(d))
  || path.join(__dirname, 'recordings');
const REC_PORT_MIN = parseInt(process.env.RTC_REC_PORT_MIN || '21000', 10);
let recPortCursor = 0;
/** Puertos locales donde escucha ffmpeg: RTP en uno par y RTCP en el siguiente */
const nextRecPort = () => REC_PORT_MIN + (recPortCursor++ % 2000) * 2;

const newRecording = () => ({ segments: [], seg: null, chain: Promise.resolve(), timer: null, finishing: false });

/** SDP que le dice a ffmpeg qué le llega por cada puerto */
function recSdp(parts) {
  const lines = ['v=0', 'o=- 0 0 IN IP4 127.0.0.1', 's=OldFace', 'c=IN IP4 127.0.0.1', 't=0 0'];
  for (const p of parts) {
    const c = p.consumer.rtpParameters.codecs[0];
    const name = c.mimeType.split('/')[1];
    lines.push(`m=${p.kind} ${p.port} RTP/AVP ${c.payloadType}`, `a=rtcp:${p.port + 1}`,
      `a=rtpmap:${c.payloadType} ${name}/${c.clockRate}${c.channels > 1 ? `/${c.channels}` : ''}`);
    const fmtp = Object.entries(c.parameters || {}).map(([k, v]) => `${k}=${v}`).join(';');
    if (fmtp && name === 'H264') lines.push(`a=fmtp:${c.payloadType} ${fmtp}`);
    lines.push('a=recvonly');
  }
  return lines.join('\r\n') + '\r\n';
}

/** Graba los productores actuales del anfitrión; si son los mismos que ya se graban, no hace nada */
async function recSync(live) {
  const rec = live.rec;
  if (!rec || !FFMPEG) return;
  const room = rooms.get(live.roomId);
  const producers = [];
  for (const peer of room ? room.peers.values() : []) {
    if (peer.userId !== live.hostId) continue;
    for (const p of peer.producers.values()) if (!p.closed && !producers.some(x => x.kind === p.kind)) producers.push(p);
  }
  const key = producers.map(p => p.id).sort().join(',');
  if (rec.seg?.key === key) return;
  await recStopSegment(rec);
  if (!producers.length || rec.finishing) return;

  const parts = [];
  try {
    for (const producer of producers) {
      const port = nextRecPort();
      const transport = await room.router.createPlainTransport({ listenInfo: { protocol: 'udp', ip: '127.0.0.1' }, rtcpMux: false, comedia: false });
      parts.push({ kind: producer.kind, port, transport });
      await transport.connect({ ip: '127.0.0.1', port, rtcpPort: port + 1 });
      const codecs = room.router.rtpCapabilities.codecs.filter(c => c.kind === producer.kind && !/\/rtx$/i.test(c.mimeType));
      parts[parts.length - 1].consumer = await transport.consume({ producerId: producer.id, rtpCapabilities: { codecs, headerExtensions: [] }, paused: true });
    }
  } catch (err) {
    console.error(`[REC] ${live.id}: no se pudo preparar la grabación:`, err.message);
    for (const p of parts) p.transport.close();
    return;
  }

  const video = parts.find(p => p.kind === 'video');
  const mp4 = /h264/i.test(video?.consumer.rtpParameters.codecs[0].mimeType || '');
  const tag = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const file = path.join(REC_DIR, `.liveseg_${live.id}_${tag}.${mp4 ? 'mp4' : 'webm'}`);
  const sdpFile = path.join(os.tmpdir(), `oldface_rec_${tag}.sdp`);
  fs.mkdirSync(REC_DIR, { recursive: true });
  fs.writeFileSync(sdpFile, recSdp(parts));
  const proc = spawn(FFMPEG, ['-hide_banner', '-loglevel', process.env.RTC_REC_LOGLEVEL || 'error', '-protocol_whitelist', 'file,udp,rtp',
    // Hora de llegada como marca de tiempo: audio y vídeo quedan alineados desde el principio y ffmpeg escribe al
    // disco sobre la marcha (si no, los retiene hasta sincronizarlos y un cierre brusco deja el archivo vacío)
    '-use_wallclock_as_timestamps', '1', '-fflags', '+genpts', '-analyzeduration', '2000000', '-probesize', '1000000',
    '-f', 'sdp', '-i', sdpFile,
    // Bloques de 2 s escritos al momento: si ffmpeg muere de golpe se pierde como mucho eso
    '-map', '0', '-c', 'copy', '-flush_packets', '1',
    ...(mp4 ? ['-f', 'mp4', '-movflags', '+frag_keyframe+empty_moov'] : ['-f', 'webm', '-cluster_time_limit', '2000']), '-y', file],
    { stdio: ['pipe', 'ignore', 'pipe'] });
  proc.stderr.on('data', d => console.warn(`[REC] ${live.id} ffmpeg: ${String(d).trim().slice(0, 300)}`));
  proc.stdin.on('error', () => {});   // escribir 'q' cuando ya terminó no debe tumbar el servidor
  proc.on('error', err => console.error(`[REC] ${live.id}: ffmpeg no arrancó:`, err.message));
  const seg = { key, parts, proc, file, sdpFile, startedAt: Date.now(), exited: new Promise(r => proc.on('close', r)) };
  rec.seg = seg;
  // Si mediasoup cierra el transporte (se cerró la sala), el tramo termina
  for (const p of parts) p.transport.observer.on('close', () => { if (rec.seg === seg) recSchedule(live, 0); });
  // ffmpeg tarda un momento en abrir los puertos: después llega el flujo y se pide una imagen completa
  setTimeout(async () => {
    if (rec.seg !== seg) return;
    for (const p of parts) await p.consumer.resume().catch(() => {});
    if (video) for (const ms of [0, 1500, 4000]) setTimeout(() => { if (rec.seg === seg) video.consumer.requestKeyFrame().catch(() => {}); }, ms);
  }, 1000);
  console.log(`[REC] ${live.id}: grabando tramo ${path.basename(file)} (${parts.map(p => p.kind).join('+')})`);
}

/** Cierra el tramo actual: ffmpeg termina el archivo ('q') y se guarda si tiene contenido */
async function recStopSegment(rec) {
  const seg = rec.seg;
  if (!seg) return;
  rec.seg = null;
  const ms = Date.now() - seg.startedAt;   // lo que duró el tramo (sin contar lo que tarda ffmpeg en cerrar)
  try { seg.proc.stdin.write('q'); seg.proc.stdin.end(); } catch { /* ya había terminado */ }
  // Si ya no llegan datos (el anfitrión se fue) ffmpeg no lee la 'q'; SIGINT lo cierra bien igualmente (Linux)
  if (process.platform !== 'win32') { try { seg.proc.kill('SIGINT'); } catch { /* ya había terminado */ } }
  const killer = setTimeout(() => { try { seg.proc.kill('SIGKILL'); } catch { /* ya había terminado */ } }, 6000);
  await seg.exited;
  clearTimeout(killer);
  for (const p of seg.parts) p.transport.close();
  fs.rm(seg.sdpFile, { force: true }, () => {});
  let size = 0;
  try { size = fs.statSync(seg.file).size; } catch { /* no llegó a crearse */ }
  if (size > 20_000) rec.segments.push({ file: seg.file, ms });
  else fs.rm(seg.file, { force: true }, () => {});
}

/** Vuelve a mirar qué emite el anfitrión dentro de un momento (cámara nueva, se fue, volvió…) */
function recSchedule(live, delay = 1500) {
  const rec = live.rec;
  if (!rec || rec.finishing) return;
  clearTimeout(rec.timer);
  rec.timer = setTimeout(() => {
    rec.chain = rec.chain.then(() => recSync(live)).catch(err => console.error(`[REC] ${live.id}:`, err.message));
  }, delay);
}

function runFfmpeg(args) {
  return new Promise((resolve) => {
    const p = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => resolve(e.message));
    p.on('close', code => resolve(code === 0 ? null : err.trim().slice(0, 500) || `código ${code}`));
  });
}

/** Al terminar el directo: une los tramos en un solo archivo y se lo da al backend (una sola vez; todos esperan a lo mismo) */
function recFinish(live) {
  const rec = live.rec;
  if (!rec) return Promise.resolve();
  if (!rec.done) { rec.finishing = true; rec.done = recFinalize(live); }
  return rec.done;
}

async function recFinalize(live) {
  const rec = live.rec;
  clearTimeout(rec.timer);
  await rec.chain.catch(() => {});
  await recStopSegment(rec);
  const segs = rec.segments.filter(s => fs.existsSync(s.file));
  if (!segs.length) { console.log(`[REC] ${live.id}: no hay nada grabado`); return; }

  const ext = path.extname(segs[0].file);
  const same = segs.filter(s => path.extname(s.file) === ext);   // un cambio de formato a mitad (raro) no se puede unir
  const name = `live_${live.id}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
  const finalPath = path.join(REC_DIR, name);
  if (same.length === 1) {
    fs.renameSync(same[0].file, finalPath);
  } else {
    const list = path.join(os.tmpdir(), `oldface_rec_${crypto.randomBytes(4).toString('hex')}.txt`);
    fs.writeFileSync(list, same.map(s => `file '${s.file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
    const err = await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
      '-c', 'copy', ...(ext === '.mp4' ? ['-movflags', '+faststart'] : []), '-y', finalPath]);
    fs.rm(list, { force: true }, () => {});
    if (err || !fs.existsSync(finalPath)) {
      // Si no se pueden unir, al menos se guarda el tramo más largo
      console.error(`[REC] ${live.id}: no se pudieron unir los tramos:`, err);
      const longest = same.reduce((a, b) => (b.ms > a.ms ? b : a));
      fs.renameSync(longest.file, finalPath);
      same.splice(0, same.length, longest);
    }
  }
  for (const s of segs) if (s.file !== finalPath) fs.rm(s.file, { force: true }, () => {});

  const info = { liveId: live.id, hostId: live.hostId, file: name, size: fs.statSync(finalPath).size,
                 duration: Math.round(same.reduce((n, s) => n + s.ms, 0) / 1000), startedAt: live.startedAt, endedAt: Date.now() };
  console.log(`[REC] ${live.id}: grabación lista ${name} (${Math.round(info.size / 1048576)} MB, ${info.duration} s)`);
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(`${CFG.backendUrl}/internal/live-recordings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': CFG.secret },
        body: JSON.stringify(info), signal: AbortSignal.timeout(10000),
      });
      if (r.ok) return;
      console.error(`[REC] ${live.id}: el backend respondió ${r.status}`);
    } catch (err) { console.error(`[REC] ${live.id}: no se pudo avisar al backend:`, err.message); }
    await new Promise(r => setTimeout(r, 5000 * (i + 1)));
  }
  console.error(`[REC] ${live.id}: grabación guardada en ${finalPath} pero sin registrar en el backend`);
}
if (!FFMPEG) console.warn('[REC] ffmpeg-static no está instalado: los directos no se grabarán');

/** Cambia el rol de todos los sockets de un usuario en la sala de medios del directo */
function setLivePeerRole(live, userId, role) {
  const room = rooms.get(live.roomId);
  if (!room) return;
  for (const peer of room.peers.values()) {
    if (peer.userId !== userId) continue;
    peer.role = role;
    if (role === 'viewer') for (const p of [...peer.producers.values()]) p.close();
  }
}

// ── Karaoke ──────────────────────────────────────────────────────────────────
// Salas de karaoke: cola de canciones, un cantante cada vez (emite voz + música mezcladas),
// letra sincronizada con la posición que envía el cantante, chat y likes. Medios: sala `karaoke_<id>`.
/** roomId → { id, title, hostId, hostName, createdAt, queue[], current, chat[], likes, hostTimer } */
const karaokes = new Map();

function karaokeListeners(k) {
  return io.sockets.adapter.rooms.get(`karaoke:${k.id}`)?.size || 0;
}

function karaokeState(k) {
  return {
    roomId: k.id, title: k.title, hostId: k.hostId, hostName: k.hostName,
    queue: k.queue, current: k.current, likes: k.likes,
    listeners: karaokeListeners(k), chat: k.chat.slice(-50),
  };
}

function setKaraokeSinger(k, userId) {
  const room = rooms.get(`karaoke_${k.id}`);
  if (!room) return;
  for (const peer of room.peers.values()) {
    const sing = peer.userId === userId;
    peer.role = sing ? 'speaker' : 'viewer';
    if (!sing) for (const p of [...peer.producers.values()]) p.close();
  }
}

/** Termina la canción actual y avisa al siguiente de la cola */
function karaokeNext(k, reason = 'finished') {
  if (k.current) {
    k.queue = k.queue.filter(e => e.id !== k.current.id);
    io.to(`karaoke:${k.id}`).emit('karaoke:songEnded', { roomId: k.id, entryId: k.current.id, reason });
  }
  k.current = null;
  setKaraokeSinger(k, null);
  io.to(`karaoke:${k.id}`).emit('karaoke:state', { roomId: k.id, queue: k.queue, current: null });
  const next = k.queue[0];
  if (next) io.to(`user:${next.userId}`).emit('karaoke:yourTurn', { roomId: k.id, entryId: next.id });
}

function closeKaraoke(k, reason = 'closed') {
  clearTimeout(k.hostTimer);
  io.to(`karaoke:${k.id}`).emit('karaoke:closed', { roomId: k.id, reason });
  karaokes.delete(k.id);
  console.log(`[RTC] Sala de karaoke cerrada ${k.id} (${reason})`);
}

// ── HTTP + Socket.IO ─────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/rtc/health', (_req, res) => {
  res.json({
    ok: true, workers: workers.length, rooms: rooms.size,
    peers: [...rooms.values()].reduce((n, r) => n + r.peers.size, 0),
    online: onlineUsers.size, lives: lives.size, karaokes: karaokes.size, uptime: Math.round(process.uptime()),
  });
});

app.use('/rtc/test', express.static(path.join(__dirname, 'public')));

/** Salas de karaoke abiertas (lista pública para la app) */
app.get('/rtc/karaoke/rooms', (_req, res) => {
  res.json({
    rooms: [...karaokes.values()].map(k => ({
      roomId: k.id, title: k.title, hostId: k.hostId, hostName: k.hostName, createdAt: k.createdAt,
      listeners: karaokeListeners(k), queue: k.queue.length,
      current: k.current ? { title: k.current.song.title, artist: k.current.song.artist, singer: k.current.name } : null,
    })).sort((a, b) => b.listeners - a.listeners || b.createdAt - a.createdAt),
  });
});

/** Solo el backend (mismo servidor) con el secreto compartido. nginx bloquea /rtc/internal/ desde fuera. */
function internalAuth(req, res, next) {
  const hdr = req.get('x-internal-secret') || '';
  const ok = hdr.length === CFG.secret.length && crypto.timingSafeEqual(Buffer.from(hdr), Buffer.from(CFG.secret));
  if (!ok) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// ── Karaoke: control del superadministrador (vía backend /api/admin/karaoke/rooms…) ──
let karaokeBanned = new Set();
async function loadKaraokeBans() {
  try {
    const r = await fetch(`${CFG.backendUrl}/internal/karaoke/bans`, { headers: { 'x-internal-secret': CFG.secret }, signal: AbortSignal.timeout(5000) });
    if (r.ok) karaokeBanned = new Set((await r.json()).userIds || []);
  } catch { /* se reintenta al recibir cambios */ }
}

app.post('/rtc/internal/karaoke/bans', internalAuth, (req, res) => {
  karaokeBanned = new Set(Array.isArray(req.body?.userIds) ? req.body.userIds : []);
  // Un bloqueado que esté cantando deja de cantar
  for (const k of karaokes.values()) if (k.current && karaokeBanned.has(k.current.userId)) karaokeNext(k, 'removed');
  res.json({ ok: true, bans: karaokeBanned.size });
});

app.get('/rtc/internal/karaoke/rooms', internalAuth, (_req, res) => {
  res.json({ rooms: [...karaokes.values()].map(k => ({ ...karaokeState(k), chat: undefined, createdAt: k.createdAt, hostAway: !!k.hostTimer }))
    .sort((a, b) => b.createdAt - a.createdAt) });
});

app.post('/rtc/internal/karaoke/:id/close', internalAuth, (req, res) => {
  const k = karaokes.get(req.params.id);
  if (!k) return res.status(404).json({ error: 'La sala ya no existe' });
  closeKaraoke(k, 'admin');
  res.json({ ok: true });
});

app.post('/rtc/internal/karaoke/:id/skip', internalAuth, (req, res) => {
  const k = karaokes.get(req.params.id);
  if (!k) return res.status(404).json({ error: 'La sala ya no existe' });
  if (!k.current) return res.status(400).json({ error: 'Nadie está cantando' });
  karaokeNext(k, 'skipped');
  res.json({ ok: true });
});

app.post('/rtc/internal/karaoke/:id/unqueue', internalAuth, (req, res) => {
  const k = karaokes.get(req.params.id);
  if (!k) return res.status(404).json({ error: 'La sala ya no existe' });
  const entryId = req.body?.entryId;
  if (k.current?.id === entryId) { karaokeNext(k, 'removed'); return res.json({ ok: true }); }
  const wasFirst = k.queue[0]?.id === entryId;
  k.queue = k.queue.filter(e => e.id !== entryId);
  io.to(`karaoke:${k.id}`).emit('karaoke:state', { roomId: k.id, queue: k.queue, current: k.current });
  if (wasFirst && !k.current && k.queue[0]) io.to(`user:${k.queue[0].userId}`).emit('karaoke:yourTurn', { roomId: k.id, entryId: k.queue[0].id });
  res.json({ ok: true });
});

/** Backend → RTC: quién está en una sala (llamadas de grupo: saber si siguen en curso) */
app.get('/rtc/internal/rooms/:roomId', internalAuth, (req, res) => {
  const room = rooms.get(req.params.roomId);
  res.json({ exists: !!room, peers: room ? [...room.peers.values()].map(p => ({ userId: p.userId, name: p.name })) : [] });
});

/** Backend → RTC: emitir un evento a un usuario. Header x-internal-secret. */
app.post('/rtc/internal/emit', (req, res) => {
  const hdr = req.get('x-internal-secret') || '';
  const ok = hdr.length === CFG.secret.length && crypto.timingSafeEqual(Buffer.from(hdr), Buffer.from(CFG.secret));
  if (!ok) return res.status(401).json({ error: 'unauthorized' });
  const { to, event, data } = req.body || {};
  if (!to || !event) return res.status(400).json({ error: 'to y event requeridos' });
  io.to(`user:${to}`).emit(event, data ?? {});
  res.json({ delivered: onlineUsers.has(to) });
});

const server = http.createServer(app);
const io = new Server(server, {
  path: '/rtc/socket.io',
  cors: { origin: true, credentials: true },
  pingInterval: 20000, pingTimeout: 20000,
});

/** userId → Set<socketId> */
const onlineUsers = new Map();

io.use((socket, next) => {
  const { token, guestId, name } = socket.handshake.auth || {};
  let userId = verifyToken(token);
  if (!userId && CFG.allowGuests && typeof guestId === 'string' && /^guest_[A-Za-z0-9]{3,24}$/.test(guestId)) {
    userId = guestId;
    socket.data.guest = true;
  }
  if (!userId) return next(new Error('unauthorized'));
  socket.data.userId = userId;
  socket.data.name = typeof name === 'string' ? name.slice(0, 60) : userId;
  next();
});

// Envuelve un handler con ack: (data, ack) → ack({ ok, ...result } | { ok:false, error })
function handle(socket, event, fn) {
  socket.on(event, async (data, ack) => {
    try {
      const result = await fn(data || {});
      if (typeof ack === 'function') ack({ ok: true, ...(result || {}) });
    } catch (err) {
      console.warn(`[RTC] ${event} (${socket.data.userId}):`, err.message);
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });
}

io.on('connection', (socket) => {
  const { userId } = socket.data;
  socket.join(`user:${userId}`);
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId).add(socket.id);
  /** salas en las que está este socket */
  const myRooms = new Set();

  const requireRoom = (roomId) => {
    const room = rooms.get(roomId);
    if (!room || !room.peers.has(socket.id)) throw new Error('No estás en esa sala');
    return { room, peer: room.peers.get(socket.id) };
  };
  const checkRoomId = (roomId) => {
    if (typeof roomId !== 'string' || !/^[A-Za-z0-9_-]{3,100}$/.test(roomId)) throw new Error('roomId inválido');
    if (socket.data.guest && !roomId.startsWith('test_')) throw new Error('Los invitados solo pueden usar salas test_');
  };

  // ── Presencia y señalización de llamadas ────────────────────────────────
  handle(socket, 'presence:query', ({ userIds }) => {
    const online = {};
    for (const id of (Array.isArray(userIds) ? userIds.slice(0, 500) : [])) online[id] = onlineUsers.has(id);
    return { online };
  });

  /** Mensaje de señalización a otro usuario: call_invite, call_accept, call_reject, call_cancel, call_end… */
  handle(socket, 'signal:send', ({ to, type, payload }) => {
    if (typeof to !== 'string' || typeof type !== 'string') throw new Error('to y type requeridos');
    if (socket.data.guest && !to.startsWith('guest_')) throw new Error('Los invitados solo pueden señalizar a invitados');
    io.to(`user:${to}`).emit('signal', {
      from: userId, fromName: socket.data.name, type: type.slice(0, 40),
      payload: payload ?? {}, ts: Date.now(),
    });
    return { delivered: onlineUsers.has(to) };
  });

  handle(socket, 'rtc:iceServers', () => ({ iceServers: iceServers(userId) }));

  // ── Salas mediasoup ─────────────────────────────────────────────────────
  handle(socket, 'rtc:join', async ({ roomId, role }) => {
    checkRoomId(roomId);
    // Salas de directo: solo emiten el anfitrión y los invitados aceptados (lo decide el servidor)
    let effectiveRole = role === 'viewer' ? 'viewer' : 'speaker';
    if (roomId.startsWith('live_')) {
      const live = lives.get(roomId.slice(5));
      if (!live) throw new Error('El directo no está en emisión');
      const canSpeak = live.hostId === userId || live.guests.has(userId);
      effectiveRole = canSpeak && role !== 'viewer' ? 'speaker' : 'viewer';
    }
    // Karaoke: solo emite quien está cantando
    if (roomId.startsWith('karaoke_')) {
      const k = karaokes.get(roomId.slice(8));
      if (!k) throw new Error('La sala de karaoke no existe');
      effectiveRole = k.current?.userId === userId && role !== 'viewer' ? 'speaker' : 'viewer';
    }
    const room = await getOrCreateRoom(roomId);
    if (!room.peers.has(socket.id)) {
      room.peers.set(socket.id, {
        socketId: socket.id, userId, name: socket.data.name,
        role: effectiveRole,
        transports: new Map(), producers: new Map(), consumers: new Map(),
      });
      socket.join(`room:${roomId}`);
      myRooms.add(roomId);
      socket.to(`room:${roomId}`).emit('rtc:peerJoined', { roomId, peer: peerSummary(room.peers.get(socket.id)) });
    }
    const others = [...room.peers.values()].filter(p => p.socketId !== socket.id).map(peerSummary);
    return {
      routerRtpCapabilities: room.router.rtpCapabilities,
      peers: others,
      iceServers: iceServers(userId),
    };
  });

  handle(socket, 'rtc:createTransport', async ({ roomId, direction }) => {
    const { room, peer } = requireRoom(roomId);
    if (direction === 'send' && peer.role === 'viewer') throw new Error('Los espectadores no pueden emitir');
    const transport = await room.router.createWebRtcTransport({
      webRtcServer: room.webRtcServer,
      enableUdp: true, enableTcp: true, preferUdp: true,
      initialAvailableOutgoingBitrate: 1_000_000,
      appData: { direction },
    });
    peer.transports.set(transport.id, transport);
    transport.on('dtlsstatechange', (s) => { if (s === 'closed' || s === 'failed') transport.close(); });
    transport.observer.on('close', () => peer.transports.delete(transport.id));
    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  });

  handle(socket, 'rtc:connectTransport', async ({ roomId, transportId, dtlsParameters }) => {
    const { peer } = requireRoom(roomId);
    const transport = peer.transports.get(transportId);
    if (!transport) throw new Error('Transport no encontrado');
    await transport.connect({ dtlsParameters });
  });

  handle(socket, 'rtc:produce', async ({ roomId, transportId, kind, rtpParameters, appData }) => {
    const { room, peer } = requireRoom(roomId);
    if (peer.role === 'viewer') throw new Error('Los espectadores no pueden emitir');
    const transport = peer.transports.get(transportId);
    if (!transport) throw new Error('Transport no encontrado');
    const producer = await transport.produce({ kind, rtpParameters, appData: { ...(appData || {}), userId } });
    peer.producers.set(producer.id, producer);
    // Directo: lo que emite el anfitrión se graba (cada cambio de cámara/micrófono abre otro tramo)
    const hostLive = room.id.startsWith('live_') ? lives.get(room.id.slice(5)) : null;
    const recLive = hostLive?.hostId === userId ? hostLive : null;
    producer.observer.on('close', () => {
      peer.producers.delete(producer.id);
      io.to(`room:${room.id}`).emit('rtc:producerClosed', { roomId: room.id, producerId: producer.id, userId });
      if (recLive) recSchedule(recLive);
    });
    if (recLive) recSchedule(recLive);
    socket.to(`room:${room.id}`).emit('rtc:newProducer', {
      roomId: room.id, userId, name: peer.name, producerId: producer.id, kind, appData: producer.appData,
    });
    return { id: producer.id };
  });

  handle(socket, 'rtc:consume', async ({ roomId, transportId, producerId, rtpCapabilities }) => {
    const { room, peer } = requireRoom(roomId);
    const transport = peer.transports.get(transportId);
    if (!transport) throw new Error('Transport no encontrado');
    if (!room.router.canConsume({ producerId, rtpCapabilities })) throw new Error('No se puede consumir ese producer');
    const consumer = await transport.consume({ producerId, rtpCapabilities, paused: true });
    peer.consumers.set(consumer.id, consumer);
    consumer.observer.on('close', () => peer.consumers.delete(consumer.id));
    consumer.on('producerclose', () => {
      socket.emit('rtc:consumerClosed', { roomId, consumerId: consumer.id, producerId });
    });
    consumer.on('producerpause',  () => socket.emit('rtc:consumerPaused',  { roomId, consumerId: consumer.id, producerId }));
    consumer.on('producerresume', () => socket.emit('rtc:consumerResumed', { roomId, consumerId: consumer.id, producerId }));
    return {
      id: consumer.id, producerId, kind: consumer.kind,
      rtpParameters: consumer.rtpParameters, producerPaused: consumer.producerPaused,
    };
  });

  handle(socket, 'rtc:resumeConsumer', async ({ roomId, consumerId }) => {
    const { peer } = requireRoom(roomId);
    const c = peer.consumers.get(consumerId);
    if (!c) throw new Error('Consumer no encontrado');
    await c.resume();
  });

  /** Mute/unmute: pausa o reanuda un producer propio */
  handle(socket, 'rtc:setProducerPaused', async ({ roomId, producerId, paused }) => {
    const { peer } = requireRoom(roomId);
    const p = peer.producers.get(producerId);
    if (!p) throw new Error('Producer no encontrado');
    if (paused) await p.pause(); else await p.resume();
    socket.to(`room:${roomId}`).emit('rtc:producerPaused', { roomId, producerId, userId, paused: !!paused });
  });

  handle(socket, 'rtc:closeProducer', ({ roomId, producerId }) => {
    const { peer } = requireRoom(roomId);
    const p = peer.producers.get(producerId);
    if (p) p.close();
  });

  handle(socket, 'rtc:leave', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room) closePeer(room, socket.id);
    socket.leave(`room:${roomId}`);
    myRooms.delete(roomId);
  });

  // ── Directos ────────────────────────────────────────────────────────────
  const myLives = new Set();
  const getLive = (liveId) => {
    const live = lives.get(liveId);
    if (!live) throw new Error('El directo no está en emisión');
    return live;
  };
  const requireHost = (live) => { if (live.hostId !== userId) throw new Error('Solo el anfitrión puede hacer esto'); };
  const enterLiveRoom = (live) => {
    socket.join(`live:${live.id}`);
    myLives.add(live.id);
    broadcastViewers(live);
  };
  let likeWindow = { start: 0, count: 0 };

  /** El anfitrión inicia (o retoma) la emisión */
  handle(socket, 'live:start', async ({ liveId }) => {
    if (typeof liveId !== 'string' || !/^[A-Za-z0-9_-]{3,80}$/.test(liveId)) throw new Error('Directo no válido');
    let live = lives.get(liveId);
    if (!live) {
      const d = await fetchDirecto(liveId, userId);
      if (!d) throw new Error('Directo no encontrado');
      if (d.creatorId !== userId) throw new Error('Solo el creador puede emitir este directo');
      if (d.hostCanBroadcast === false) throw new Error('Tu cuenta no tiene permiso para emitir directos');
      live = {
        id: liveId, roomId: liveRoomId(liveId), hostId: userId, hostName: socket.data.name,
        title: d.title, startedAt: Date.now(), chat: [], likes: 0,
        guests: new Map(), requests: new Map(), invited: new Map(), hostTimer: null,
        rec: newRecording(),
      };
      lives.set(liveId, live);
      console.log(`[RTC] Directo iniciado ${liveId} por ${userId}`);
    }
    requireHost(live);
    clearTimeout(live.hostTimer);
    enterLiveRoom(live);
    io.to(`live:${liveId}`).emit('live:hostBack', { liveId });
    return { live: liveState(live) };
  });

  /** Un espectador entra al directo */
  handle(socket, 'live:join', ({ liveId }) => {
    const live = getLive(liveId);
    enterLiveRoom(live);
    return { live: liveState(live) };
  });

  handle(socket, 'live:leave', ({ liveId }) => {
    socket.leave(`live:${liveId}`);
    myLives.delete(liveId);
    const live = lives.get(liveId);
    if (live) broadcastViewers(live);
  });

  handle(socket, 'live:chat', ({ liveId, text }) => {
    const live = getLive(liveId);
    const clean = String(text || '').trim().slice(0, 200);
    if (!clean) throw new Error('Mensaje vacío');
    const msg = { id: `lc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, userId, name: socket.data.name, text: clean, ts: Date.now() };
    live.chat.push(msg);
    if (live.chat.length > 200) live.chat.splice(0, live.chat.length - 200);
    io.to(`live:${liveId}`).emit('live:chat', { liveId, msg });
  });

  /** Likes: hasta 15 por segundo por persona (toques rápidos de corazón) */
  handle(socket, 'live:like', ({ liveId, count = 1 }) => {
    const live = getLive(liveId);
    const now = Date.now();
    if (now - likeWindow.start > 1000) likeWindow = { start: now, count: 0 };
    const n = Math.max(1, Math.min(5, parseInt(count, 10) || 1));
    if (likeWindow.count + n > 15) return { likes: live.likes };
    likeWindow.count += n;
    live.likes += n;
    io.to(`live:${liveId}`).emit('live:like', { liveId, likes: live.likes, n, from: userId });
    return { likes: live.likes };
  });

  /** Espectador pide subir al directo */
  handle(socket, 'live:requestJoin', ({ liveId }) => {
    const live = getLive(liveId);
    if (live.hostId === userId) throw new Error('Ya eres el anfitrión');
    live.requests.set(userId, socket.data.name);
    io.to(`user:${live.hostId}`).emit('live:joinRequest', { liveId, userId, name: socket.data.name });
  });

  /** El anfitrión acepta una solicitud o invita directamente a un espectador */
  handle(socket, 'live:approveGuest', ({ liveId, guestId }) => {
    const live = getLive(liveId);
    requireHost(live);
    if (live.guests.size >= 3) throw new Error('Máximo 3 invitados a la vez');
    const name = live.requests.get(guestId) || guestId;
    live.requests.delete(guestId);
    live.invited.set(guestId, name); // aparece en el escenario cuando pulse "Subir al directo"
    io.to(`user:${guestId}`).emit('live:approved', { liveId });
  });

  handle(socket, 'live:rejectGuest', ({ liveId, guestId }) => {
    const live = getLive(liveId);
    requireHost(live);
    live.requests.delete(guestId);
    io.to(`user:${guestId}`).emit('live:rejected', { liveId });
  });

  /** El invitado aceptado pasa a emitir: su peer de la sala de medios pasa a 'speaker' */
  handle(socket, 'live:goOnStage', ({ liveId }) => {
    const live = getLive(liveId);
    if (!live.invited.has(userId) && !live.guests.has(userId)) throw new Error('El anfitrión no te ha invitado');
    if (!live.guests.has(userId) && live.guests.size >= 3) throw new Error('El escenario está lleno');
    live.guests.set(userId, live.invited.get(userId) || socket.data.name);
    live.invited.delete(userId);
    setLivePeerRole(live, userId, 'speaker');
    io.to(`live:${liveId}`).emit('live:guests', { liveId, guests: liveState(live).guests });
  });

  /** Quitar a un invitado (anfitrión) o bajarse uno mismo */
  handle(socket, 'live:removeGuest', ({ liveId, guestId }) => {
    const live = getLive(liveId);
    const target = guestId || userId;
    if (target !== userId) requireHost(live);
    live.guests.delete(target);
    live.invited.delete(target);
    setLivePeerRole(live, target, 'viewer');
    io.to(`user:${target}`).emit('live:removed', { liveId });
    io.to(`live:${liveId}`).emit('live:guests', { liveId, guests: liveState(live).guests });
  });

  handle(socket, 'live:end', ({ liveId }) => {
    const live = getLive(liveId);
    requireHost(live);
    endLive(live, 'ended');
  });

  // ── Karaoke ─────────────────────────────────────────────────────────────
  const myKaraokes = new Set();
  const getK = (roomId) => {
    const k = karaokes.get(roomId);
    if (!k) throw new Error('La sala de karaoke ya no existe');
    return k;
  };
  const enterK = (k) => {
    socket.join(`karaoke:${k.id}`);
    myKaraokes.add(k.id);
    io.to(`karaoke:${k.id}`).emit('karaoke:listeners', { roomId: k.id, listeners: karaokeListeners(k) });
  };
  let kLikeWindow = { start: 0, count: 0 };

  handle(socket, 'karaoke:create', ({ title }) => {
    if (karaokeBanned.has(userId)) throw new Error('Tu cuenta no puede usar el karaoke');
    const mine = [...karaokes.values()].find(k => k.hostId === userId);
    if (mine) { enterK(mine); clearTimeout(mine.hostTimer); return { room: karaokeState(mine) }; }
    const k = {
      id: `k${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`,
      title: String(title || '').trim().slice(0, 60) || `Karaoke de ${socket.data.name}`,
      hostId: userId, hostName: socket.data.name, createdAt: Date.now(),
      queue: [], current: null, chat: [], likes: 0, hostTimer: null,
    };
    karaokes.set(k.id, k);
    enterK(k);
    console.log(`[RTC] Sala de karaoke creada ${k.id} por ${userId}`);
    return { room: karaokeState(k) };
  });

  handle(socket, 'karaoke:join', ({ roomId }) => {
    const k = getK(roomId);
    if (k.hostId === userId) { clearTimeout(k.hostTimer); io.to(`karaoke:${k.id}`).emit('karaoke:hostBack', { roomId }); }
    enterK(k);
    return { room: karaokeState(k) };
  });

  handle(socket, 'karaoke:leave', ({ roomId }) => {
    socket.leave(`karaoke:${roomId}`);
    myKaraokes.delete(roomId);
    const k = karaokes.get(roomId);
    if (!k) return;
    if (k.current?.userId === userId) karaokeNext(k, 'singer_left');
    io.to(`karaoke:${roomId}`).emit('karaoke:listeners', { roomId, listeners: karaokeListeners(k) });
  });

  /** Apuntarse a la cola con una canción del catálogo (máx. 2 canciones por persona) */
  handle(socket, 'karaoke:queue', ({ roomId, song }) => {
    const k = getK(roomId);
    if (karaokeBanned.has(userId)) throw new Error('Tu cuenta no puede usar el karaoke');
    if (!song?.id || !song?.audioUrl) throw new Error('Canción no válida');
    if (k.queue.filter(e => e.userId === userId).length >= 2) throw new Error('Ya tienes 2 canciones en la cola');
    if (k.queue.length >= 30) throw new Error('La cola está llena');
    const entry = {
      id: `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, userId, name: socket.data.name,
      song: { id: song.id, title: String(song.title || '').slice(0, 80), artist: String(song.artist || '').slice(0, 60),
              audioUrl: String(song.audioUrl).slice(0, 300), lyricsUrl: song.lyricsUrl ? String(song.lyricsUrl).slice(0, 300) : null,
              duration: Number(song.duration) || 0 },
    };
    k.queue.push(entry);
    io.to(`karaoke:${roomId}`).emit('karaoke:state', { roomId, queue: k.queue, current: k.current });
    if (!k.current && k.queue[0] === entry) io.to(`user:${userId}`).emit('karaoke:yourTurn', { roomId, entryId: entry.id });
    return { entry };
  });

  /** Quitar de la cola (uno mismo o el anfitrión) */
  handle(socket, 'karaoke:unqueue', ({ roomId, entryId }) => {
    const k = getK(roomId);
    const entry = k.queue.find(e => e.id === entryId);
    if (!entry) return;
    if (entry.userId !== userId && k.hostId !== userId) throw new Error('No puedes quitar esta canción');
    if (k.current?.id === entryId) return karaokeNext(k, 'removed');
    const wasFirst = k.queue[0]?.id === entryId;
    k.queue = k.queue.filter(e => e.id !== entryId);
    io.to(`karaoke:${roomId}`).emit('karaoke:state', { roomId, queue: k.queue, current: k.current });
    if (wasFirst && !k.current && k.queue[0]) io.to(`user:${k.queue[0].userId}`).emit('karaoke:yourTurn', { roomId, entryId: k.queue[0].id });
  });

  /** Empezar a cantar: solo el primero de la cola y si nadie está cantando */
  handle(socket, 'karaoke:start', ({ roomId, entryId }) => {
    const k = getK(roomId);
    if (k.current) throw new Error('Alguien está cantando');
    const entry = k.queue[0];
    if (!entry || entry.id !== entryId || entry.userId !== userId) throw new Error('Todavía no es tu turno');
    k.current = { ...entry, startedAt: Date.now(), position: 0, positionAt: Date.now() };
    setKaraokeSinger(k, userId);
    io.to(`karaoke:${roomId}`).emit('karaoke:state', { roomId, queue: k.queue, current: k.current });
    return { current: k.current };
  });

  /** El cantante informa de la posición de la canción (para sincronizar la letra del público) */
  socket.on('karaoke:progress', ({ roomId, position } = {}) => {
    const k = karaokes.get(roomId);
    if (!k?.current || k.current.userId !== userId) return;
    k.current.position = Math.max(0, Number(position) || 0);
    k.current.positionAt = Date.now();
    socket.to(`karaoke:${roomId}`).volatile.emit('karaoke:progress', { roomId, entryId: k.current.id, position: k.current.position, at: k.current.positionAt });
  });

  /** Fin de canción: el propio cantante (terminó / se rindió) o el anfitrión (saltar) */
  handle(socket, 'karaoke:finish', ({ roomId }) => {
    const k = getK(roomId);
    if (!k.current) return;
    if (k.current.userId !== userId && k.hostId !== userId) throw new Error('Solo el cantante o el anfitrión pueden terminar la canción');
    karaokeNext(k, k.current.userId === userId ? 'finished' : 'skipped');
  });

  handle(socket, 'karaoke:chat', ({ roomId, text }) => {
    const k = getK(roomId);
    const clean = String(text || '').trim().slice(0, 200);
    if (!clean) throw new Error('Mensaje vacío');
    const msg = { id: `kc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, userId, name: socket.data.name, text: clean, ts: Date.now() };
    k.chat.push(msg);
    if (k.chat.length > 200) k.chat.splice(0, k.chat.length - 200);
    io.to(`karaoke:${roomId}`).emit('karaoke:chat', { roomId, msg });
  });

  handle(socket, 'karaoke:like', ({ roomId }) => {
    const k = getK(roomId);
    const now = Date.now();
    if (now - kLikeWindow.start > 1000) kLikeWindow = { start: now, count: 0 };
    if (++kLikeWindow.count > 15) return { likes: k.likes };
    k.likes += 1;
    io.to(`karaoke:${roomId}`).emit('karaoke:like', { roomId, likes: k.likes, from: userId });
    return { likes: k.likes };
  });

  handle(socket, 'karaoke:close', ({ roomId }) => {
    const k = getK(roomId);
    if (k.hostId !== userId) throw new Error('Solo el anfitrión puede cerrar la sala');
    closeKaraoke(k, 'closed');
  });

  socket.on('disconnect', () => {
    for (const roomId of myKaraokes) {
      const k = karaokes.get(roomId);
      if (!k) continue;
      if (k.current?.userId === userId) karaokeNext(k, 'singer_left');
      if (k.hostId === userId) {
        io.to(`karaoke:${roomId}`).emit('karaoke:hostAway', { roomId });
        clearTimeout(k.hostTimer);
        k.hostTimer = setTimeout(() => { if (karaokes.get(roomId) === k) closeKaraoke(k, 'host_left'); }, 120000);
      }
      setTimeout(() => io.to(`karaoke:${roomId}`).emit('karaoke:listeners', { roomId, listeners: karaokeListeners(k) }), 0);
    }
    for (const liveId of myLives) {
      const live = lives.get(liveId);
      if (!live) continue;
      if (live.hostId === userId) {
        // El anfitrión puede volver (cambio de red, app en segundo plano): 60 s de gracia
        io.to(`live:${liveId}`).emit('live:hostAway', { liveId });
        clearTimeout(live.hostTimer);
        live.hostTimer = setTimeout(() => { if (lives.get(liveId) === live) endLive(live, 'host_left'); }, 60000);
      }
      setTimeout(() => broadcastViewers(live), 0);
    }
    for (const roomId of myRooms) {
      const room = rooms.get(roomId);
      if (room) closePeer(room, socket.id);
    }
    const set = onlineUsers.get(userId);
    if (set) { set.delete(socket.id); if (!set.size) onlineUsers.delete(userId); }
  });
});

// ── Arranque ─────────────────────────────────────────────────────────────────
(async () => {
  await startWorkers();
  loadKaraokeBans();
  server.listen(CFG.port, CFG.host, () => {
    console.log(`[RTC] OldFace RTC escuchando en ${CFG.host}:${CFG.port} (IP pública ${CFG.publicIp}, ${workers.length} workers)`);
  });
})().catch((err) => { console.error('[RTC] Error al arrancar:', err); process.exit(1); });

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log(`[RTC] ${sig} — cerrando`);
    // Los directos en curso terminan y su grabación se guarda (máximo 20 s)
    const pending = [...lives.values()].map(live => { endLive(live, 'server_restart'); return recFinish(live).catch(() => {}); });
    await Promise.race([Promise.all(pending), new Promise(r => setTimeout(r, 20000))]);
    io.close();
    for (const { worker } of workers) worker.close();
    process.exit(0);
  });
}
