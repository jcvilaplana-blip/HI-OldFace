/**
 * OldFace RTC — servidor propio de tiempo real (sustituye a ZEGOCLOUD)
 *
 *  • Socket.IO  → autenticación, presencia, señalización de llamadas (antes ZIM)
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

// ── HTTP + Socket.IO ─────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/rtc/health', (_req, res) => {
  res.json({
    ok: true, workers: workers.length, rooms: rooms.size,
    peers: [...rooms.values()].reduce((n, r) => n + r.peers.size, 0),
    online: onlineUsers.size, uptime: Math.round(process.uptime()),
  });
});

app.use('/rtc/test', express.static(path.join(__dirname, 'public')));

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

  // ── Presencia y señalización (sustituye a ZIM) ──────────────────────────
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
    const room = await getOrCreateRoom(roomId);
    if (!room.peers.has(socket.id)) {
      room.peers.set(socket.id, {
        socketId: socket.id, userId, name: socket.data.name,
        role: role === 'viewer' ? 'viewer' : 'speaker',
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
    producer.observer.on('close', () => {
      peer.producers.delete(producer.id);
      io.to(`room:${room.id}`).emit('rtc:producerClosed', { roomId: room.id, producerId: producer.id, userId });
    });
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

  socket.on('disconnect', () => {
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
  server.listen(CFG.port, CFG.host, () => {
    console.log(`[RTC] OldFace RTC escuchando en ${CFG.host}:${CFG.port} (IP pública ${CFG.publicIp}, ${workers.length} workers)`);
  });
})().catch((err) => { console.error('[RTC] Error al arrancar:', err); process.exit(1); });

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`[RTC] ${sig} — cerrando`);
    io.close();
    for (const { worker } of workers) worker.close();
    process.exit(0);
  });
}
