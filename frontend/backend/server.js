/**
 * OldFace Backend — Autenticación OTP, chats, estados, directos, encuestas y karaoke
 * (llamadas y tiempo real: servidor RTC propio en rtc-server/, sin servicios de terceros)
 * Persistencia en disco: users, chats, mensajes y directos sobreviven reinicios
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors    = require('cors');
const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3001;

// ════════════════════════════════════════════════════════════════
//  Persistencia en disco — JSON files en /data/
// ════════════════════════════════════════════════════════════════
const DATA_DIR    = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(DATA_DIR))    fs.mkdirSync(DATA_DIR,    { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function loadJSON(file, defaultValue = {}) {
  const filePath = path.join(DATA_DIR, file);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.warn(`[DB] Error cargando ${file}:`, e.message);
  }
  return defaultValue;
}

function saveJSON(file, data) {
  try {
    fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error(`[DB] Error guardando ${file}:`, e.message);
  }
}

// Cargar datos persistentes al arrancar
const _users    = loadJSON('users.json',    {});
const _chats    = loadJSON('chats.json',    {});
const _messages = loadJSON('messages.json', {});
const _directos = loadJSON('directos.json', {});
const _fcm      = loadJSON('fcm_tokens.json', {});
const _callLog  = loadJSON('call_log.json', {});
const _stories  = loadJSON('stories.json', []);
const _groups   = loadJSON('groups.json', {});
const _subs     = loadJSON('subscriptions.json', {});
const _polls         = loadJSON('poll_polls.json', {});
const _pollVotes     = loadJSON('poll_votes.json', {});
const _pollCats      = loadJSON('poll_categories.json', {});
const _pollProfiles  = loadJSON('poll_profiles.json', {});
const _karaokeSongs  = loadJSON('karaoke_songs.json', {});
const _karaokeRecs   = loadJSON('karaoke_recordings.json', {});
const _karaokeGenres = loadJSON('karaoke_genres.json', {});
const _karaokeBans   = loadJSON('karaoke_bans.json', {});
const _stickers      = loadJSON('stickers.json', {});

// Convertir a Map (operaciones en memoria, persistimos después de cada escritura)
const userStore    = new Map(Object.entries(_users));
const chatStore2   = new Map(Object.entries(_chats));
const messageStore = new Map(Object.entries(_messages));
const directoStore = new Map(Object.entries(_directos));
// userId → [{ token, deviceId, at }] (un usuario puede tener varios dispositivos vinculados).
// Formato antiguo: userId → "token" — se convierte al cargar.
const fcmStore     = new Map(Object.entries(_fcm).map(([uid, v]) => [uid,
  Array.isArray(v) ? v : (typeof v === 'string' && v ? [{ token: v, deviceId: null, at: Date.now() }] : [])]));
const MAX_DEVICE_TOKENS = 6;
const callLogStore = new Map(Object.entries(_callLog)); // userId → [calls]
let   storiesList  = Array.isArray(_stories) ? _stories : []; // array plano de stories
const groupStore   = new Map(Object.entries(_groups));  // groupId → group
const subStore     = new Map(Object.entries(_subs));    // userId → { plan, since }
const pollStore        = new Map(Object.entries(_polls));        // pollId → poll
const pollVoteStore    = new Map(Object.entries(_pollVotes));    // pollId → { userId: optionId }
const pollCatStore     = new Map(Object.entries(_pollCats));     // categoryId → category
const pollProfileStore = new Map(Object.entries(_pollProfiles)); // userId → { age, sex, postalCode, nationality }
const karaokeSongStore = new Map(Object.entries(_karaokeSongs)); // songId → { title, artist, audioUrl, coverUrl, lyrics, duration }
const karaokeRecStore  = new Map(Object.entries(_karaokeRecs));  // recId → { userId, songId, audioUrl, duration, createdAt }
const karaokeGenreStore = new Map(Object.entries(_karaokeGenres)); // genreId → { name, icon, createdAt }
const karaokeBanStore   = new Map(Object.entries(_karaokeBans));   // userId → { reason, at }
const stickerStore      = new Map(Object.entries(_stickers));      // userId → [url] (stickers creados por el usuario)
const saveStickers      = () => saveJSON('stickers.json', Object.fromEntries(stickerStore));

const saveUsers    = () => saveJSON('users.json',    Object.fromEntries(userStore));
const saveChats    = () => saveJSON('chats.json',    Object.fromEntries(chatStore2));
const saveMessages = () => saveJSON('messages.json', Object.fromEntries(messageStore));
const saveDirectos = () => saveJSON('directos.json', Object.fromEntries(directoStore));
const saveFcm      = () => saveJSON('fcm_tokens.json', Object.fromEntries(fcmStore));

/** Tokens de aviso de todos los dispositivos de un usuario */
const fcmTokensOf = (userId) => (fcmStore.get(String(userId || '')) || []).map(e => e.token).filter(Boolean);

/** Guardar el token de un dispositivo (sustituye el anterior del mismo dispositivo; quita el token de otras cuentas) */
function addFcmToken(userId, token, deviceId = null) {
  for (const [uid, list] of fcmStore) {
    const kept = list.filter(e => e.token !== token && !(deviceId && uid !== userId && e.deviceId === deviceId));
    if (kept.length !== list.length) fcmStore.set(uid, kept);
  }
  let list = (fcmStore.get(userId) || []).filter(e => e.token !== token && !(deviceId && e.deviceId === deviceId));
  list.push({ token, deviceId, at: Date.now() });
  if (list.length > MAX_DEVICE_TOKENS) list = list.slice(-MAX_DEVICE_TOKENS);
  fcmStore.set(userId, list);
  saveFcm();
}

function removeFcmToken(token) {
  for (const [uid, list] of fcmStore) {
    const kept = list.filter(e => e.token !== token);
    if (kept.length !== list.length) fcmStore.set(uid, kept);
  }
  saveFcm();
}

function removeDeviceTokens(userId, deviceId) {
  const list = fcmStore.get(userId);
  if (!list || !deviceId) return;
  fcmStore.set(userId, list.filter(e => e.deviceId !== deviceId));
  saveFcm();
}

// ── Preferencias de aviso por usuario (tono de mensaje) ──────────
const prefsStore = new Map(Object.entries(loadJSON('user_prefs.json', {})));   // userId → { messageTone }
const savePrefs  = () => saveJSON('user_prefs.json', Object.fromEntries(prefsStore));
const MESSAGE_TONES = ['clasico', 'campana', 'burbuja', 'cristal', 'suave', 'ninguno'];
/** Canal de Android y sonido del aviso de un mensaje según el tono que eligió el destinatario */
function messageChannelOf(userId) {
  const tone = prefsStore.get(userId)?.messageTone || 'clasico';
  if (tone === 'clasico') return { channelId: 'oldface_messages', sound: 'message_sound' };
  if (tone === 'ninguno') return { channelId: 'oldface_msg_ninguno', sound: null };
  return { channelId: `oldface_msg_${tone}`, sound: `msg_${tone}` };
}

/** Idioma de los avisos de un usuario (el de su dispositivo; español si no se sabe) */
const userLang = (userId) => (prefsStore.get(String(userId || ''))?.lang === 'en' ? 'en' : 'es');
const PUSH_TEXT = {
  es: {
    audio: '🎤 Te ha enviado una nota de voz', location: '📍 Te ha enviado su ubicación',
    live_location: '📍 Está compartiendo su ubicación en tiempo real', onceVideo: '① Te ha enviado un vídeo para ver una vez',
    oncePhoto: '① Te ha enviado una foto para ver una vez', image: '📷 Te ha enviado una foto', video: '🎥 Te ha enviado un vídeo',
    sticker: '🌟 Te ha enviado un sticker',
    gAudio: '🎤 Nota de voz', gLocation: '📍 Ubicación', gImage: '📷 Foto', gVideo: '🎥 Vídeo', gSticker: '🌟 Sticker',
    someone: 'Alguien', group: 'Grupo', isLive: (n) => `🔴 ${n} está en directo`, tapToWatch: 'Toca para verlo',
  },
  en: {
    audio: '🎤 Sent you a voice message', location: '📍 Sent you their location',
    live_location: '📍 Is sharing their live location', onceVideo: '① Sent you a video to view once',
    oncePhoto: '① Sent you a photo to view once', image: '📷 Sent you a photo', video: '🎥 Sent you a video',
    sticker: '🌟 Sent you a sticker',
    gAudio: '🎤 Voice message', gLocation: '📍 Location', gImage: '📷 Photo', gVideo: '🎥 Video', gSticker: '🌟 Sticker',
    someone: 'Someone', group: 'Group', isLive: (n) => `🔴 ${n} is live`, tapToWatch: 'Tap to watch',
  },
};
const pushText = (userId) => PUSH_TEXT[userLang(userId)];

/** Aviso con notificación a todos los dispositivos de un usuario. `message: true` → con su tono de mensaje */
function pushToUser(userId, title, body, data = {}, { message = false } = {}) {
  const tokens = fcmTokensOf(userId);
  const ch = message ? messageChannelOf(userId) : { channelId: 'oldface_messages', sound: 'message_sound' };
  return Promise.all(tokens.map(t => sendFCMPush(t, title, body, data, ch.channelId, ch.sound).catch(() => {})))
    .then(() => tokens.length);
}

/** Aviso solo de datos (llamadas, taxi) a todos los dispositivos de un usuario */
function dataToUser(userId, data = {}, ttlMs = 60000) {
  const tokens = fcmTokensOf(userId);
  return Promise.all(tokens.map(t => sendFCMData(t, data, ttlMs).catch(() => {}))).then(() => tokens.length);
}
const saveCallLog  = () => saveJSON('call_log.json',  Object.fromEntries(callLogStore));
const saveStories  = () => saveJSON('stories.json',   storiesList);
const saveGroups   = () => saveJSON('groups.json',    Object.fromEntries(groupStore));
const saveSubs     = () => saveJSON('subscriptions.json', Object.fromEntries(subStore));
const savePolls        = () => saveJSON('poll_polls.json',      Object.fromEntries(pollStore));
const savePollVotes    = () => saveJSON('poll_votes.json',      Object.fromEntries(pollVoteStore));
const savePollCats     = () => saveJSON('poll_categories.json', Object.fromEntries(pollCatStore));
const savePollProfiles = () => saveJSON('poll_profiles.json',   Object.fromEntries(pollProfileStore));
const saveKaraokeSongs = () => saveJSON('karaoke_songs.json',   Object.fromEntries(karaokeSongStore));
const saveKaraokeRecs  = () => saveJSON('karaoke_recordings.json', Object.fromEntries(karaokeRecStore));
const saveKaraokeGenres = () => saveJSON('karaoke_genres.json', Object.fromEntries(karaokeGenreStore));
const saveKaraokeBans   = () => saveJSON('karaoke_bans.json',   Object.fromEntries(karaokeBanStore));

console.log(`[DB] Usuarios: ${userStore.size} | Chats: ${chatStore2.size} | Directos: ${directoStore.size} | CallLog: ${callLogStore.size}`);

// ── CORS ──────────────────────────────────────────────────────────
app.use(cors({
  origin: (_origin, cb) => cb(null, true),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.options('*', cors());
app.use(express.json({ limit: '20mb' }));

// ── Rate limiting básico por IP ───────────────────────────────────
// Detrás de nginx/Apache/Passenger: la IP real viene en X-Forwarded-For (sin esto todos compartían el mismo cupo)
app.set('trust proxy', true);
const rateMap = new Map();
// Peticiones ligeras y frecuentes de la propia app que no cuentan para el límite (si fallan, se pierden avisos)
const RATE_FREE = /^\/(api\/)?(health|presence|register-fcm-token|messages\/[^/]+\/mark-read)\b/;
function rateLimit(ip, max = 300, windowMs = 60_000) {
  const now = Date.now();
  const entry = rateMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
  entry.count++;
  rateMap.set(ip, entry);
  return entry.count > max;
}
app.use((req, res, next) => {
  if (req.method === 'OPTIONS' || RATE_FREE.test(req.path)) return next();
  const ip = req.ip || req.socket?.remoteAddress;
  if (rateLimit(ip)) return res.status(429).json({ error: 'Demasiadas solicitudes' });
  next();
});

// ── Logging ───────────────────────────────────────────────────────
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ════════════════════════════════════════════════════════════════
//  OTP Store — solo en memoria (los OTPs no necesitan persistir)
// ════════════════════════════════════════════════════════════════
const otpStore = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [phone, data] of otpStore.entries()) {
    if (data.expiry < now) otpStore.delete(phone);
  }
}, 60_000);

// ════════════════════════════════════════════════════════════════
//  FCM Push Notifications — Firebase Admin SDK (API v1)
// ════════════════════════════════════════════════════════════════

let _firebaseAdmin = null;

function getFirebaseAdmin() {
  if (_firebaseAdmin) return _firebaseAdmin;
  try {
    const admin = require('firebase-admin');
    if (admin.apps.length) { _firebaseAdmin = admin; return admin; }

    // Cargar service account desde archivo (recomendado) o desde variable de entorno
    const saPath = path.join(__dirname, 'firebase-service-account.json');
    if (fs.existsSync(saPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf8'));
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      _firebaseAdmin = admin;
      console.log('[FCM] Firebase Admin inicializado con service account');
    } else {
      console.warn('[FCM] firebase-service-account.json no encontrado — push desactivado');
    }
  } catch (e) {
    console.warn('[FCM] Error inicializando Firebase Admin:', e.message);
  }
  return _firebaseAdmin;
}

/**
 * Envía push notification usando FCM API v1 (Firebase Admin SDK).
 * Requiere firebase-service-account.json en el directorio backend/.
 * Para obtenerlo: Firebase Console → Configuración → Cuentas de servicio
 *                 → Generar nueva clave privada → guardar como firebase-service-account.json
 */
async function sendFCMPush(fcmToken, title, body, data = {}, channelId = 'oldface_messages', sound = 'message_sound') {
  if (!fcmToken) return;
  const admin = getFirebaseAdmin();
  if (!admin) return;

  try {
    // Convertir todos los valores de data a string (requerido por FCM)
    const dataStr = {};
    for (const [k, v] of Object.entries(data)) dataStr[k] = String(v);

    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      android: {
        priority: 'high',
        notification: {
          ...(sound ? { sound } : {}),
          channelId: channelId,
          priority:  'max',
        },
      },
      data: dataStr,
    });
  } catch (e) {
    // Token expirado/inválido → eliminarlo
    if (e.code === 'messaging/registration-token-not-registered' ||
        e.code === 'messaging/invalid-registration-token') {
      removeFcmToken(fcmToken);
    } else {
      console.warn('[FCM] sendFCMPush error:', e.message);
    }
  }
}

/**
 * Aviso push SOLO de datos (sin bloque notification) y prioridad alta: lo recibe la app aunque esté cerrada
 * o el móvil en reposo, y es la app (OldFaceMessagingService) la que suena y abre la pantalla de llamada.
 */
async function sendFCMData(fcmToken, data = {}, ttlMs = 60000) {
  if (!fcmToken) return;
  const admin = getFirebaseAdmin();
  if (!admin) return;
  const dataStr = {};
  for (const [k, v] of Object.entries(data)) dataStr[k] = String(v ?? '');
  try {
    await admin.messaging().send({ token: fcmToken, android: { priority: 'high', ttl: ttlMs }, data: dataStr });
  } catch (e) {
    if (e.code === 'messaging/registration-token-not-registered' ||
        e.code === 'messaging/invalid-registration-token') {
      removeFcmToken(fcmToken);
    } else {
      console.warn('[FCM] sendFCMData error:', e.message);
    }
  }
}

// ── Token para el servidor RTC propio (rtc-server) ───────────────
// Formato: <userId>.<expSeg>.<hmac-sha256 base64url>, firmado con RTC_SECRET (compartido con rtc-server)
function signRtcToken(userId, ttlSec = 30 * 24 * 3600) {
  const secret = process.env.RTC_SECRET;
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = crypto.createHmac('sha256', secret).update(`${userId}.${exp}`).digest('base64url');
  return `${userId}.${exp}.${sig}`;
}

// ── Helper ────────────────────────────────────────────────────────
function normalizePhone(phone) {
  const p = phone.trim().replace(/\s+/g, '');
  // Normalizar: 641872224 → +34641872224, 0034... → +34...
  if (p.startsWith('+')) return p;
  if (p.startsWith('0034')) return '+34' + p.slice(4);
  if (p.startsWith('34') && p.length === 11) return '+' + p;
  if (p.length === 9) return '+34' + p;
  return p;
}

// ── Router ────────────────────────────────────────────────────────
const router = express.Router();

/** GET /health */
router.get('/health', (_req, res) => {
  res.json({
    status: 'ok', service: 'OldFace API',
    ts: new Date().toISOString(),
    users: userStore.size, chats: chatStore2.size, directos: directoStore.size,
  });
});

// ════════════════════════════════════════════════════════════════
//  AUTH — OTP + registro
// ════════════════════════════════════════════════════════════════

// ── Nodemailer transporter ────────────────────────────────────────
function createMailTransporter() {
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendOtpEmail(toEmail, code) {
  const transporter = createMailTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await transporter.sendMail({
    from: `OldFace <${from}>`,
    to: toEmail,
    subject: `Tu código de verificación OldFace: ${code}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:400px;margin:0 auto;padding:30px;background:#f8f9ff;border-radius:16px;">
        <div style="text-align:center;margin-bottom:24px;">
          <h1 style="color:#6366f1;font-size:28px;margin:0;">OldFace</h1>
          <p style="color:#888;margin:4px 0 0;">Conecta con quien más quieres</p>
        </div>
        <div style="background:white;border-radius:12px;padding:24px;text-align:center;">
          <p style="color:#444;margin:0 0 16px;">Tu código de verificación es:</p>
          <div style="font-size:40px;font-weight:bold;letter-spacing:8px;color:#6366f1;margin:16px 0;">${code}</div>
          <p style="color:#888;font-size:13px;margin:16px 0 0;">Válido durante 10 minutos. No compartas este código.</p>
        </div>
      </div>`,
    text: `Tu código de verificación OldFace es: ${code}. Válido 10 minutos.`,
  });
}

/** POST /send-otp */
router.post('/send-otp', async (req, res) => {
  const { phone, email } = req.body || {};
  if (!phone || typeof phone !== 'string' || phone.trim().length < 8)
    return res.status(400).json({ error: 'Número de teléfono inválido' });

  const normalizedPhone = normalizePhone(phone);

  const existing = otpStore.get(normalizedPhone);
  if (existing && existing.sendCount >= 5 && Date.now() - existing.firstSent < 3_600_000)
    return res.status(429).json({ error: 'Demasiados intentos. Espera una hora.' });

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiry = Date.now() + 10 * 60_000;

  // Enviar por email si está configurado y el usuario lo proporcionó
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const toEmail  = email && email.includes('@') ? email.trim().toLowerCase() : null;

  if (!toEmail)
    return res.status(400).json({ error: 'Introduce un email válido para recibir el código' });

  if (!smtpUser || !smtpPass) {
    console.error('❌ SMTP no configurado (SMTP_USER/SMTP_PASS)');
    return res.status(503).json({ error: 'Servicio de correo no disponible. Inténtalo más tarde.' });
  }

  try {
    await sendOtpEmail(toEmail, code);
    console.log(`✅ OTP enviado por email a ${toEmail}`);
    otpStore.set(normalizedPhone, {
      code, expiry, attempts: 0,
      sendCount: (existing?.sendCount || 0) + 1,
      firstSent: existing?.firstSent || Date.now(),
    });
    return res.json({ success: true, message: `Código enviado a ${toEmail}`, channel: 'email' });
  } catch (err) {
    console.error('❌ Email send error:', err.message);
    return res.status(500).json({ error: 'No se pudo enviar el email. Revisa la dirección o inténtalo más tarde.' });
  }
});

/** POST /verify-otp */
router.post('/verify-otp', async (req, res) => {
  const { phone, code, name, deviceId, deviceName, platform } = req.body || {};
  if (!phone || !code) return res.status(400).json({ error: 'Teléfono y código son requeridos' });

  const normalizedPhone = normalizePhone(phone);
  const entry = otpStore.get(normalizedPhone);

  if (!entry) return res.status(400).json({ error: 'No hay código activo. Solicita uno nuevo.' });
  if (Date.now() > entry.expiry) { otpStore.delete(normalizedPhone); return res.status(400).json({ error: 'Código expirado.' }); }

  // Validación local del código
  if (entry.attempts >= 3) { otpStore.delete(normalizedPhone); return res.status(400).json({ error: 'Demasiados intentos incorrectos.' }); }
  if (entry.code !== String(code).trim()) {
    entry.attempts++;
    otpStore.set(normalizedPhone, entry);
    const r = 3 - entry.attempts;
    return res.status(400).json({ error: `Código incorrecto. ${r} intento${r !== 1 ? 's' : ''} restante${r !== 1 ? 's' : ''}.` });
  }

  otpStore.delete(normalizedPhone);

  const userId = `user_${normalizedPhone.replace(/\D/g, '')}`;
  const existingUser = userStore.get(normalizedPhone);
  const userData = {
    userId,
    name:         name?.trim() || existingUser?.name || 'Usuario',
    phone:        normalizedPhone,
    avatar:       existingUser?.avatar || null,   // preservar avatar existente
    status:       existingUser?.status || null,   // preservar estado existente
    registeredAt: existingUser?.registeredAt || Date.now(),
    lastLogin:    Date.now(),
  };

  userStore.set(normalizedPhone, userData);
  saveUsers(); // ← persistir en disco

  // Este dispositivo aparece en "Dispositivos vinculados" (y deja de estar revocado si lo estaba)
  if (deviceId) touchDevice(userId, { deviceId: String(deviceId).slice(0, 64), name: deviceName, platform, via: 'login' });

  console.log(`✅ Usuario verificado: ${userData.name} (${normalizedPhone})`);
  return res.json({ success: true, verified: true, userId, user: userData, rtcToken: signRtcToken(userId) });
});

/** Avisa a usuarios conectados al servidor RTC (no bloquea; si falla, la app recurre al polling) */
function rtcEmit(to, event, data) {
  const url = process.env.RTC_INTERNAL_URL, secret = process.env.RTC_SECRET;
  if (!url || !secret) return;
  fetch(`${url}/rtc/internal/emit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
    body: JSON.stringify({ to, event, data }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});
}

/** Participantes de un chat (1 a 1 o grupo) */
function chatMembers(chatId) {
  return chatStore2.get(chatId)?.participants || chatId.replace(/^chat_/, '').split(/_(?=user_)/);
}

/**
 * Avisar al instante a los demás del chat de que algo cambió (leído, editado, eliminado, fijado, ubicación en
 * tiempo real…): la app vuelve a cargar los mensajes de ese chat en vez de esperar a su refresco de 5 s.
 */
function notifyChatUpdate(chatId, exceptUserId, reason) {
  for (const to of chatMembers(chatId)) if (to && to !== exceptUserId) rtcEmit(to, 'chat:update', { chatId, reason });
}

/** POST /rtc-token — token para el servidor RTC (sesiones iniciadas antes de existir rtcToken) */
router.post('/rtc-token', (req, res) => {
  const { userId, deviceId } = req.body || {};
  if (!userId || ![...userStore.values()].some(u => u.userId === userId))
    return res.status(404).json({ error: 'Usuario no encontrado' });
  // Con dispositivos registrados, solo uno de ellos puede renovar el token (si no, cualquiera que supiera el
  // userId podría sacar un token y vincular su ordenador a esa cuenta). Cuentas sin dispositivos: como antes.
  const devs = deviceStore.get(userId) || [];
  if (devs.length && (!deviceId || !devs.some(d => d.deviceId === deviceId) || revokedStore.has(deviceId)))
    return res.status(401).json({ error: 'Sesión no válida en este dispositivo. Vuelve a entrar.' });
  const token = signRtcToken(userId);
  if (!token) return res.status(503).json({ error: 'RTC no configurado' });
  return res.json({ token });
});

/** POST /check-users — qué teléfonos tienen cuenta */
router.post('/check-users', (req, res) => {
  const { phones } = req.body || {};
  if (!Array.isArray(phones)) return res.status(400).json({ error: 'Se requiere array de teléfonos' });

  const registered = phones
    .map(p => normalizePhone(String(p)))
    .filter(p => userStore.has(p));

  return res.json({ registeredPhones: registered });
});

/** GET /find-user?phone= — buscar usuario por teléfono */
router.get('/find-user', (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: 'phone es requerido' });

  const normalized = normalizePhone(phone.trim());
  const found = userStore.get(normalized);

  if (!found) {
    // Intentar búsqueda sin prefijo
    for (const [key, val] of userStore.entries()) {
      const digitsKey = key.replace(/\D/g, '');
      const digitsQ   = normalized.replace(/\D/g, '');
      if (digitsKey.endsWith(digitsQ) || digitsQ.endsWith(digitsKey)) {
        return res.json({ userId: val.userId, name: val.name, phone: key });
      }
    }
    return res.status(404).json({ error: 'Usuario no encontrado en OldFace' });
  }

  return res.json({ userId: found.userId, name: found.name, phone: normalized });
});

/** GET /users — listar todos los usuarios (para admin/debug) */
router.get('/users', (_req, res) => {
  const list = [...userStore.values()].map(u => ({ userId: u.userId, name: u.name, phone: u.phone }));
  return res.json({ users: list, count: list.length });
});

/** GET /find-user-by-id?userId= — buscar usuario por userId */
router.get('/find-user-by-id', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId es requerido' });
  for (const u of userStore.values()) {
    if (u.userId === userId) return res.json({ userId: u.userId, name: u.name, phone: u.phone });
  }
  return res.status(404).json({ error: 'Usuario no encontrado' });
});

// ════════════════════════════════════════════════════════════════
//  FCM Token Registration
// ════════════════════════════════════════════════════════════════

/** POST /register-fcm-token — Guarda el token FCM del dispositivo para un usuario */
router.post('/register-fcm-token', (req, res) => {
  const { userId, token, deviceId } = req.body || {};
  if (!userId || !token) return res.status(400).json({ error: 'userId y token son requeridos' });
  addFcmToken(String(userId), String(token), deviceId ? String(deviceId).slice(0, 64) : null);
  return res.json({ success: true });
});

/** POST /user/prefs — tono de mensaje del usuario (para el sonido de los avisos con la app cerrada) */
router.post('/user/prefs', (req, res) => {
  const { userId, messageTone, lang } = req.body || {};
  if (!userId || (messageTone !== undefined && !MESSAGE_TONES.includes(messageTone)) || (lang !== undefined && !['es', 'en'].includes(lang)))
    return res.status(400).json({ error: 'datos no válidos' });
  const patch = {};
  if (messageTone !== undefined) patch.messageTone = messageTone;
  if (lang !== undefined) patch.lang = lang;   // idioma del dispositivo: los avisos se redactan en él
  prefsStore.set(String(userId), { ...(prefsStore.get(String(userId)) || {}), ...patch });
  savePrefs();
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════
//  DISPOSITIVOS VINCULADOS — ordenador o tablet en la misma cuenta (QR + código, como WhatsApp Web)
//    1. El dispositivo nuevo pide un código: POST /link/start → muestra QR "oldface-link:<código>" y el código.
//    2. En el móvil (sesión iniciada): Ajustes → Dispositivos vinculados → escanear o escribir → POST /link/approve.
//    3. El nuevo pregunta cada 2 s GET /link/status/:linkId → recibe la sesión una sola vez.
//  Cada dispositivo tiene un deviceId propio (lo genera la app); "Cerrar sesión" en otro lo revoca.
// ════════════════════════════════════════════════════════════════
const _devices = loadJSON('devices.json', { byUser: {}, revoked: {} });
const deviceStore  = new Map(Object.entries(_devices.byUser || {}));   // userId → [{ deviceId, name, platform, linkedAt, lastSeen, via }]
const revokedStore = new Map(Object.entries(_devices.revoked || {}));  // deviceId → { userId, at }
const saveDevices  = () => saveJSON('devices.json', { byUser: Object.fromEntries(deviceStore), revoked: Object.fromEntries(revokedStore) });
const linkStore    = new Map();   // linkId → { code, name, platform, expiresAt, status, userId, deviceId }
const LINK_TTL_MS  = 3 * 60_000;
const LINK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // sin 0/O ni 1/I para no confundirse al escribirlo

setInterval(() => {
  const now = Date.now();
  for (const [id, l] of linkStore) if (l.expiresAt + 60_000 < now) linkStore.delete(id);
}, 60_000);

/** Comprueba un token del servidor RTC (`<userId>.<exp>.<firma>`) y que sea de ese usuario */
function verifyRtcToken(token, userId) {
  const secret = process.env.RTC_SECRET;
  if (!secret || typeof token !== 'string') return false;
  const i = token.lastIndexOf('.'), j = token.lastIndexOf('.', i - 1);
  if (i < 0 || j < 0) return false;
  const uid = token.slice(0, j), exp = Number(token.slice(j + 1, i)), sig = token.slice(i + 1);
  if (uid !== userId || !(exp > Date.now() / 1000)) return false;
  const good = crypto.createHmac('sha256', secret).update(`${uid}.${exp}`).digest('base64url');
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}
const bearer = (req) => (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.body?.rtcToken || '';

const cleanName = (s, def) => String(s || def).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60) || def;
const cleanPlatform = (p) => (['android', 'ios', 'web', 'desktop'].includes(p) ? p : 'web');

/** Alta o actualización de un dispositivo de un usuario (también al entrar con el código por email) */
function touchDevice(userId, { deviceId, name, platform, via }) {
  if (!userId || !deviceId) return;
  revokedStore.delete(deviceId);
  const list = deviceStore.get(userId) || [];
  const d = list.find(x => x.deviceId === deviceId);
  if (d) Object.assign(d, { name: cleanName(name, d.name), platform: cleanPlatform(platform || d.platform), lastSeen: Date.now() });
  else list.push({ deviceId, name: cleanName(name, 'Dispositivo'), platform: cleanPlatform(platform), linkedAt: Date.now(), lastSeen: Date.now(), via: via || 'login' });
  deviceStore.set(userId, list);
  saveDevices();
}

/** POST /link/start { deviceName, platform } — el dispositivo nuevo pide un código para vincularse */
router.post('/link/start', (req, res) => {
  const { deviceName, platform } = req.body || {};
  let code;
  do {
    code = Array.from(crypto.randomBytes(8), b => LINK_ALPHABET[b % LINK_ALPHABET.length]).join('');
  } while ([...linkStore.values()].some(l => l.code === code));
  const linkId = crypto.randomBytes(18).toString('base64url');
  const expiresAt = Date.now() + LINK_TTL_MS;
  linkStore.set(linkId, { code, name: cleanName(deviceName, 'Ordenador'), platform: cleanPlatform(platform), expiresAt, status: 'pending' });
  res.json({ linkId, code, expiresAt });
});

/** GET /link/status/:linkId — el dispositivo nuevo pregunta si ya lo han aprobado (la sesión se entrega una vez) */
router.get('/link/status/:linkId', (req, res) => {
  const l = linkStore.get(req.params.linkId);
  if (!l || (l.status === 'pending' && l.expiresAt < Date.now())) return res.json({ status: 'expired' });
  if (l.status !== 'approved') return res.json({ status: 'pending', expiresAt: l.expiresAt });
  linkStore.delete(req.params.linkId);
  const u = findUserById(l.userId);
  res.json({
    status: 'approved', deviceId: l.deviceId, rtcToken: signRtcToken(l.userId),
    user: { userId: l.userId, name: u?.name || 'Usuario', phone: u?.phone || '', avatar: u?.avatar || null, status: u?.status || null },
  });
});

/** POST /link/approve { userId, rtcToken, code } — el móvil con la sesión iniciada aprueba el código */
router.post('/link/approve', (req, res) => {
  const { userId, code } = req.body || {};
  if (!userId || !verifyRtcToken(bearer(req), userId)) return res.status(401).json({ error: 'Sesión no válida. Vuelve a entrar en OldFace.' });
  const wanted = String(code || '').toUpperCase().replace(/^OLDFACE-LINK:/, '').replace(/[^A-Z0-9]/g, '');
  const entry = [...linkStore.entries()].find(([, l]) => l.code === wanted && l.status === 'pending');
  if (!entry || entry[1].expiresAt < Date.now()) return res.status(404).json({ error: 'Código no válido o caducado. Genera uno nuevo en el otro dispositivo.' });
  const [, l] = entry;
  l.status = 'approved';
  l.userId = userId;
  l.deviceId = `dev_${crypto.randomBytes(12).toString('base64url')}`;
  touchDevice(userId, { deviceId: l.deviceId, name: l.name, platform: l.platform, via: 'link' });
  res.json({ success: true, deviceName: l.name });
});

/** GET /devices/:userId — dispositivos con la sesión iniciada (Authorization: Bearer <rtcToken>) */
router.get('/devices/:userId', (req, res) => {
  const { userId } = req.params;
  if (!verifyRtcToken(bearer(req), userId)) return res.status(401).json({ error: 'Sesión no válida' });
  res.json({ devices: (deviceStore.get(userId) || []).slice().sort((a, b) => b.lastSeen - a.lastSeen) });
});

/** DELETE /devices/:userId/:deviceId — cerrar la sesión de otro dispositivo */
router.delete('/devices/:userId/:deviceId', (req, res) => {
  const { userId, deviceId } = req.params;
  if (!verifyRtcToken(bearer(req), userId)) return res.status(401).json({ error: 'Sesión no válida' });
  const list = deviceStore.get(userId) || [];
  if (!list.some(d => d.deviceId === deviceId)) return res.status(404).json({ error: 'Dispositivo no encontrado' });
  deviceStore.set(userId, list.filter(d => d.deviceId !== deviceId));
  revokedStore.set(deviceId, { userId, at: Date.now() });
  saveDevices();
  removeDeviceTokens(userId, deviceId);
  rtcEmit(userId, 'device:revoked', { deviceId });   // si está abierto, se cierra al momento
  res.json({ success: true });
});

/** POST /devices/heartbeat { userId, deviceId, deviceName, platform } — al abrir la app; dice si se cerró su sesión */
router.post('/devices/heartbeat', (req, res) => {
  const { userId, deviceId, deviceName, platform } = req.body || {};
  if (!userId || !deviceId) return res.status(400).json({ error: 'datos no válidos' });
  if (!verifyRtcToken(bearer(req), userId)) return res.status(401).json({ error: 'Sesión no válida' });
  const rev = revokedStore.get(String(deviceId));
  if (rev && rev.userId === userId) return res.json({ revoked: true });
  touchDevice(String(userId), { deviceId: String(deviceId).slice(0, 64), name: deviceName, platform });
  res.json({ revoked: false });
});

/** POST /call-notification — Envía FCM push al destinatario cuando se inicia una llamada */
router.post('/call-notification', async (req, res) => {
  const { calleeId, callerId, callerName, callType, roomId } = req.body || {};
  if (!calleeId || !callerId) return res.status(400).json({ error: 'calleeId y callerId son requeridos' });

  // Si el destinatario tiene la app abierta con el servidor RTC, recibe la invitación al instante
  rtcEmit(calleeId, 'signal', {
    from: callerId, fromName: callerName || callerId, type: 'call_invite', ts: Date.now(),
    payload: { callType: callType || 'voice', callerName: callerName || callerId, roomId: roomId || null },
  });

  if (!fcmTokensOf(calleeId).length) return res.json({ success: false, reason: 'sin token FCM para el destinatario' });

  // Solo datos: la app suena con el tono de llamada y abre la pantalla de llamada (también con la pantalla apagada)
  await dataToUser(calleeId, {
    type:       'call',
    callType:   callType === 'video' ? 'video' : 'voice',
    callerId,
    callerName: callerName || callerId,
    calleeId,
    roomId:     roomId || '',
    ts:         Date.now(), // la app descarta llamadas ya caducadas
  });
  return res.json({ success: true });
});

/** POST /call-cancel — quien llama colgó antes de que contestaran: deja de sonar en el móvil del destinatario */
router.post('/call-cancel', async (req, res) => {
  const { calleeId, callerId } = req.body || {};
  if (!calleeId || !callerId) return res.status(400).json({ error: 'calleeId y callerId son requeridos' });
  await dataToUser(calleeId, { type: 'call_cancel', callerId, ts: Date.now() });
  return res.json({ success: true });
});

/** POST /call-response — rechazo desde la pantalla de llamada nativa (la app puede estar cerrada, sin socket) */
router.post('/call-response', (req, res) => {
  const { callerId, calleeId, action } = req.body || {};
  if (!callerId || !calleeId || action !== 'reject') return res.status(400).json({ error: 'datos no válidos' });
  rtcEmit(callerId, 'signal', { from: calleeId, type: 'call_reject', ts: Date.now(), payload: {} });
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════
//  CHATS + MENSAJES
// ════════════════════════════════════════════════════════════════

/** POST /chats */
router.post('/chats', (req, res) => {
  const { userId1, userId2, name } = req.body || {};
  if (!userId1 || !userId2) return res.status(400).json({ error: 'userId1 y userId2 son requeridos' });

  const chatId = `chat_${[userId1, userId2].sort().join('_')}`;
  if (!chatStore2.has(chatId)) {
    chatStore2.set(chatId, {
      id: chatId, participants: [userId1, userId2],
      name: name || 'Chat', createdAt: Date.now(),
      lastMessage: '', lastTime: Date.now(),
    });
    saveChats();
  }
  const chat = chatStore2.get(chatId);
  // Resolver el nombre del otro participante desde userStore para la respuesta
  const requesterId = userId1;
  const otherId2 = chat.participants.find(p => p !== requesterId);
  const otherUser2 = otherId2 ? [...userStore.values()].find(u => u.userId === otherId2) : null;
  let resolvedName = otherUser2?.name || chat.name || 'Usuario';
  if (resolvedName.startsWith('user_')) {
    resolvedName = otherUser2?.phone
      ? otherUser2.phone
      : '+' + resolvedName.replace(/^user_/, '');
  }
  return res.json({ ...chat, name: resolvedName, avatar: otherUser2?.avatar || null });
});

/** GET /chats?userId= */
router.get('/chats', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId es requerido' });
  const userChats = [...chatStore2.values()]
    .filter(c => c.participants.includes(userId))
    .map(c => {
      if (c.isGroup) {
        // Enriquecer con memberNames actualizados desde groupStore
        const group = c.groupId ? groupStore.get(c.groupId) : null;
        const memberNames = group?.memberNames || {};
        // Si faltan nombres, resolverlos desde userStore ahora
        const enriched = { ...memberNames };
        for (const memberId of (c.participants || [])) {
          if (!enriched[memberId]) {
            const u = [...userStore.values()].find(u => u.userId === memberId);
            if (u) enriched[memberId] = u.name;
          }
        }
        return { ...c, name: group?.name || c.name, avatar: group?.avatar || null, memberNames: enriched };
      }
      // Chat 1-a-1: nombre y avatar del otro participante
      const otherId = c.participants.find(p => p !== userId);
      const otherUser = otherId ? [...userStore.values()].find(u => u.userId === otherId) : null;
      let displayName = otherUser?.name || c.name || 'Usuario';
      // Si el nombre sigue siendo un userId (user_XXXXX), usar el teléfono formateado
      if (displayName.startsWith('user_')) {
        displayName = otherUser?.phone
          ? otherUser.phone
          : '+' + displayName.replace(/^user_/, '');
      }
      return { ...c, name: displayName, avatar: otherUser?.avatar || null };
    })
    .sort((a, b) => b.lastTime - a.lastTime);
  return res.json({ chats: userChats });
});

/** DELETE /chats/:chatId — elimina el chat y todos sus mensajes */
router.delete('/chats/:chatId', (req, res) => {
  const { chatId } = req.params;
  if (!chatId) return res.status(400).json({ error: 'chatId requerido' });
  chatStore2.delete(chatId);
  messageStore.delete(chatId);
  saveChats();
  saveMessages();
  return res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════
//  SUBIDA DE ARCHIVOS — almacenamiento en disco, URL permanente
// ════════════════════════════════════════════════════════════════

/** POST /upload-file — convierte base64 → archivo binario en /uploads, devuelve URL */
router.post('/upload-file', (req, res) => {
  const { data, fileName } = req.body || {};
  if (!data || !fileName) return res.status(400).json({ error: 'data y fileName requeridos' });
  // Límite: 15 MB en base64 ≈ 11 MB real
  if (data.length > 15_000_000) return res.status(413).json({ error: 'Archivo demasiado grande (máx ~10MB)' });
  try {
    const matches = data.match(/^data:([^;]+);base64,(.+)$/s);
    if (!matches) return res.status(400).json({ error: 'Formato de datos inválido (se espera data URL)' });
    const buffer  = Buffer.from(matches[2], 'base64');
    const ext     = path.extname(fileName).replace(/[^a-zA-Z0-9.]/g, '').toLowerCase();
    const safeName = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, safeName), buffer);
    console.log(`[upload-file] Guardado: ${safeName} (${buffer.length} bytes)`);
    return res.json({ url: `/files/${safeName}` });
  } catch (err) {
    console.error('[upload-file] Error:', err.message);
    return res.status(500).json({ error: 'Error al guardar el archivo' });
  }
});

/**
 * POST /chat/upload?userId= — foto, vídeo o audio del chat en binario (cuerpo = archivo, Content-Type = su tipo).
 * Los vídeos de la cámara superan el límite de /upload-file (base64 en JSON, ~10 MB).
 */
const CHAT_UPLOAD_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/3gpp': '.3gp', 'video/quicktime': '.mov',
  'audio/webm': '.webm', 'audio/mp4': '.m4a', 'audio/ogg': '.ogg', 'audio/mpeg': '.mp3',
};
router.post('/chat/upload', express.raw({ type: () => true, limit: '150mb' }), (req, res) => {
  if (!req.query.userId || !findUserById(req.query.userId)) return res.status(401).json({ error: 'Usuario no válido' });
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const ext = CHAT_UPLOAD_EXT[type];
  if (!ext) return res.status(415).json({ error: 'Formato no admitido' });
  if (!Buffer.isBuffer(req.body) || req.body.length < 100) return res.status(400).json({ error: 'Archivo vacío' });
  const safeName = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
  try {
    fs.writeFileSync(path.join(UPLOADS_DIR, safeName), req.body);
    res.json({ url: `/files/${safeName}` });
  } catch (err) {
    console.error('[chat/upload] Error:', err.message);
    res.status(500).json({ error: 'Error al guardar el archivo' });
  }
});

/** GET /files/:filename — sirve archivos subidos por los usuarios */
router.get('/files/:filename', (req, res) => {
  const safeName = path.basename(req.params.filename); // evita path traversal
  const filePath = path.join(UPLOADS_DIR, safeName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado' });
  res.sendFile(filePath);
});

/** Texto de la vista previa del chat (lista de chats) */
function chatPreviewText(type, text) {
  return type === 'audio' ? '🎤 Nota de voz' : type === 'location' ? '📍 Ubicación'
       : type === 'live_location' ? '📍 Ubicación en tiempo real' : type === 'image' ? '📷 Foto'
       : type === 'video' ? '🎥 Vídeo' : type === 'sticker' ? '🌟 Sticker' : text;
}

/** Mensaje tal como se entrega a las apps: las fotos/vídeos "ver una vez" nunca llevan su URL (se pide con /open) */
function publicMsg(m) {
  if (!m.viewOnce) return m;
  const { url, ...rest } = m;
  return rest;
}

/** GET /messages/:chatId (los eliminados para todos antiguos tampoco se devuelven) */
router.get('/messages/:chatId', (req, res) => {
  const uid = req.query.userId;
  const list = (messageStore.get(req.params.chatId) || []).filter(m => !m.deleted);
  return res.json({ messages: (uid ? list.filter(m => !(m.hiddenFor || []).includes(uid)) : list).map(publicMsg) });
});

// ── "Ver una vez" ────────────────────────────────────────────────────────────
const VIEW_ONCE_KEEP_MS = 15 * 60 * 1000;   // tiempo para terminar de verla antes de borrar el archivo
const viewOnceFile = (url) => path.join(UPLOADS_DIR, path.basename(String(url || '').split('?')[0]));
/** ¿La han abierto ya todos los destinatarios? */
const viewOnceDone = (chatId, m) => chatMembers(chatId).filter(u => u && u !== m.senderId).every(u => (m.openedBy || []).includes(u));
/** Borra los archivos "ver una vez" que ya vio todo el mundo (pasado el margen) */
function sweepViewOnce() {
  let changed = false;
  for (const list of messageStore.values()) {
    for (const m of list) {
      if (!m.viewOnce || !m.url || !m.allOpenedAt || Date.now() - m.allOpenedAt < VIEW_ONCE_KEEP_MS) continue;
      try { fs.unlinkSync(viewOnceFile(m.url)); } catch { /* ya no estaba */ }
      m.url = null; changed = true;
    }
  }
  if (changed) saveMessages();
}
setInterval(sweepViewOnce, 5 * 60 * 1000).unref?.();
setTimeout(sweepViewOnce, 30 * 1000).unref?.();

/** POST /messages/:chatId/:messageId/open — { userId } → { url } una sola vez por destinatario */
router.post('/messages/:chatId/:messageId/open', (req, res) => {
  const { chatId, messageId } = req.params;
  const { userId } = req.body || {};
  const m = (messageStore.get(chatId) || []).find(x => x.id === messageId);
  if (!m || !m.viewOnce) return res.status(404).json({ error: 'Mensaje no encontrado' });
  if (!userId || !chatMembers(chatId).includes(userId)) return res.status(403).json({ error: 'No perteneces a este chat' });
  if (m.senderId === userId) return res.status(403).json({ error: 'Las fotos y vídeos de ver una vez solo los puede abrir quien los recibe' });
  if ((m.openedBy || []).includes(userId) || !m.url) return res.status(410).json({ error: 'Ya la abriste: solo se puede ver una vez' });
  m.openedBy = [...(m.openedBy || []), userId];
  if (viewOnceDone(chatId, m)) m.allOpenedAt = Date.now();
  saveMessages();
  notifyChatUpdate(chatId, userId, 'opened');
  res.json({ url: m.url, type: m.type });
});

/** DELETE /messages/:chatId/:messageId — elimina un mensaje concreto */
router.delete('/messages/:chatId/:messageId', (req, res) => {
  const { chatId, messageId } = req.params;
  const { userId, scope } = req.query;
  if (!chatId || !messageId) return res.status(400).json({ error: 'chatId y messageId requeridos' });
  const msgs = messageStore.get(chatId) || [];
  const idx  = msgs.findIndex(m => m.id === messageId);
  if (idx === -1) return res.status(404).json({ error: 'Mensaje no encontrado' });
  if (scope === 'me') {
    if (!userId) return res.status(400).json({ error: 'userId requerido' });
    const m = msgs[idx];
    m.hiddenFor = [...new Set([...(m.hiddenFor || []), userId])];
    saveMessages();
    return res.json({ ok: true });
  }
  if (scope === 'all') {
    // Para todos: se borra sin dejar rastro ("Se eliminó este mensaje" ya no se muestra)
    const m = msgs[idx];
    if (!userId || m.senderId !== userId) return res.status(403).json({ error: 'Solo quien lo envió puede eliminarlo para todos' });
    msgs.splice(idx, 1);
    for (const x of msgs) if (x.replyTo?.id === messageId) x.replyTo = null;   // tampoco queda citado en las respuestas
    messageStore.set(chatId, msgs);
    saveMessages();
    if (idx === msgs.length && chatStore2.has(chatId)) {   // era el último → vista previa del anterior
      const c = chatStore2.get(chatId);
      const prev = [...msgs].reverse().find(x => !x.deleted);
      c.lastMessage = prev ? chatPreviewText(prev.type, prev.text) : '';
      chatStore2.set(chatId, c);
      saveChats();
    }
    notifyChatUpdate(chatId, userId, 'deleted');
    return res.json({ ok: true });
  }
  msgs.splice(idx, 1);
  messageStore.set(chatId, msgs);
  saveMessages();
  return res.json({ ok: true });
});

/** POST /messages */
router.post('/messages', async (req, res) => {
  const { chatId, senderId, text, type = 'text', url, replyTo, fileName, duration, live, viewOnce } = req.body || {};
  if (!chatId || !senderId || !text) return res.status(400).json({ error: 'chatId, senderId y text son requeridos' });
  // "Ver una vez": solo fotos y vídeos subidos al servidor (para poder borrarlos cuando se hayan visto)
  const once = !!viewOnce && (type === 'image' || type === 'video') && /\/files\/[\w.-]+$/.test(String(url || ''));

  const msg = {
    id:        `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    chatId, senderId, text, type, url: url || null,
    replyTo:   replyTo || null,
    fileName:  fileName || null,
    ...(once ? { viewOnce: true, openedBy: [] } : {}),
    ...(Number(duration) > 0 ? { duration: Math.round(Number(duration)) } : {}),
    // Ubicación en tiempo real: hasta cuándo se comparte; la posición la va actualizando quien la envía
    ...(type === 'live_location' && live ? { live: {
      lat: Number(live.lat), lng: Number(live.lng), updatedAt: Date.now(),
      until: Math.min(Number(live.until) || 0, Date.now() + 8 * 3600 * 1000), stopped: false,
    } } : {}),
    // el VPS está en UTC: la hora se da en la de España (la app la recalcula con createdAt en la zona del móvil)
    time:      new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }),
    createdAt: Date.now(),
  };

  const list = messageStore.get(chatId) || [];
  list.push(msg);
  messageStore.set(chatId, list);
  saveMessages();

  if (chatStore2.has(chatId)) {
    const c = chatStore2.get(chatId);
    c.lastMessage = chatPreviewText(type, text);
    c.lastTime = Date.now();
    chatStore2.set(chatId, c);
    saveChats();
  }

  // ── Entrega en tiempo real por el servidor RTC propio ──────────────────
  const senderUser = [...userStore.values()].find(u => u.userId === senderId);
  const rtcRecipients = chatStore2.get(chatId)?.participants
    || chatId.replace(/^chat_/, '').split(/_(?=user_)/);
  for (const to of rtcRecipients) {
    if (to && to !== senderId) rtcEmit(to, 'chat:message', { ...publicMsg(msg), senderName: senderUser?.name || null });
  }

  // ── Enviar push FCM al destinatario ─────────────────────────────────────
  // chatId tiene formato: chat_userA_userB — extraer el ID que no es el remitente
  // Grupo: aviso a cada miembro con el nombre del grupo y de quien escribe
  const groupChat = chatStore2.get(chatId);
  if (groupChat?.isGroup) {
    for (const to of groupChat.participants || []) {
      if (to === senderId) continue;
      const T = pushText(to);   // en el idioma de cada destinatario
      const gName = groupStore.get(groupChat.groupId)?.name || groupChat.name || T.group;
      const who = senderUser?.name || T.someone;
      const what = type === 'audio' ? T.gAudio : type === 'location' || type === 'live_location' ? T.gLocation
                 : type === 'image' ? T.gImage : type === 'video' ? T.gVideo : type === 'sticker' ? T.gSticker
                 : text.length > 80 ? text.slice(0, 80) + '…' : text;
      pushToUser(to, gName, `${who}: ${what}`, { chatId, senderId }, { message: true });
    }
    return res.json(publicMsg(msg));
  }

  try {
    const withoutPrefix = chatId.replace(/^chat_/, '');
    const parts = withoutPrefix.split(/_(?=user_)/);
    const recipientId = parts.find(p => p !== senderId);
    if (recipientId) {
      if (fcmTokensOf(recipientId).length) {
        // Buscar el nombre del remitente
        let senderName = 'OldFace';
        for (const u of userStore.values()) {
          if (u.userId === senderId) { senderName = u.name; break; }
        }
        const T = pushText(recipientId);   // en el idioma del destinatario
        const notifBody = type === 'audio' ? T.audio
                        : type === 'location' ? T.location
                        : type === 'live_location' ? T.live_location
                        : once ? (type === 'video' ? T.onceVideo : T.oncePhoto)
                        : type === 'image' ? T.image
                        : type === 'video' ? T.video
                        : type === 'sticker' ? T.sticker
                        : text.length > 80 ? text.slice(0, 80) + '…' : text;
        // No await — responder al cliente sin esperar el push
        pushToUser(recipientId, senderName, notifBody, { chatId, senderId }, { message: true });
      }
    }
  } catch { /* no bloquear la respuesta si falla el push */ }

  return res.json(publicMsg(msg));
});

const EDIT_WINDOW_MS = 15 * 60 * 1000;   // como WhatsApp: se puede editar durante 15 minutos

/** POST /messages/:chatId/:messageId/edit — { userId, text } — editar un mensaje de texto propio */
router.post('/messages/:chatId/:messageId/edit', (req, res) => {
  const { userId, text } = req.body || {};
  const msg = (messageStore.get(req.params.chatId) || []).find(m => m.id === req.params.messageId);
  if (!msg) return res.status(404).json({ error: 'Mensaje no encontrado' });
  if (msg.senderId !== userId) return res.status(403).json({ error: 'Solo puedes editar tus mensajes' });
  if ((msg.type || 'text') !== 'text') return res.status(400).json({ error: 'Solo se pueden editar mensajes de texto' });
  if (Date.now() - (msg.createdAt || 0) > EDIT_WINDOW_MS) return res.status(410).json({ error: 'Ya no se puede editar (pasaron más de 15 minutos)' });
  const clean = String(text || '').trim().slice(0, 5000);
  if (!clean) return res.status(400).json({ error: 'El mensaje no puede quedar vacío' });
  msg.text = clean;
  msg.editedAt = Date.now();
  saveMessages();
  notifyChatUpdate(req.params.chatId, userId, 'edited');
  res.json({ message: msg });
});

/**
 * POST /messages/:chatId/:messageId/flags — { userId, pinned?, starred? }
 *   pinned: fijar arriba del chat para todos (máx. 3; al fijar un 4.º se quita el más antiguo)
 *   starred: destacar solo para este usuario
 */
router.post('/messages/:chatId/:messageId/flags', (req, res) => {
  const { userId, pinned, starred } = req.body || {};
  const list = messageStore.get(req.params.chatId) || [];
  const msg = list.find(m => m.id === req.params.messageId);
  if (!msg) return res.status(404).json({ error: 'Mensaje no encontrado' });
  if (!userId || !chatMembers(req.params.chatId).includes(userId)) return res.status(403).json({ error: 'No perteneces a este chat' });
  if (typeof pinned === 'boolean') {
    msg.pinned = pinned;
    msg.pinnedAt = pinned ? Date.now() : null;
    if (pinned) {
      const pins = list.filter(m => m.pinned).sort((a, b) => (b.pinnedAt || 0) - (a.pinnedAt || 0));
      for (const old of pins.slice(3)) { old.pinned = false; old.pinnedAt = null; }
    }
    notifyChatUpdate(req.params.chatId, userId, 'pinned');
  }
  if (typeof starred === 'boolean') {
    const set = new Set(msg.starredBy || []);
    if (starred) set.add(userId); else set.delete(userId);
    msg.starredBy = [...set];
  }
  saveMessages();
  res.json({ message: msg });
});

/**
 * POST /messages/:chatId/:messageId/live — { senderId, lat, lng, stop } — nueva posición de una ubicación en
 * tiempo real (solo quien la comparte) o dejar de compartirla. Los demás la ven al refrescar los mensajes.
 */
let liveSaveTimer = null;
router.post('/messages/:chatId/:messageId/live', (req, res) => {
  const { senderId, lat, lng, stop } = req.body || {};
  const msg = (messageStore.get(req.params.chatId) || []).find(m => m.id === req.params.messageId);
  if (!msg || msg.type !== 'live_location' || !msg.live) return res.status(404).json({ error: 'Mensaje no encontrado' });
  if (msg.senderId !== senderId) return res.status(403).json({ error: 'Solo quien comparte la ubicación puede actualizarla' });
  if (stop) {
    msg.live.stopped = true;
  } else {
    if (msg.live.stopped || Date.now() > msg.live.until) return res.status(410).json({ error: 'Ya no se comparte' });
    const la = Number(lat), ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return res.status(400).json({ error: 'Posición no válida' });
    msg.live.lat = la; msg.live.lng = ln;
  }
  msg.live.updatedAt = Date.now();
  notifyChatUpdate(req.params.chatId, senderId, 'live');
  // Guardar en disco como mucho cada 30 s (llegan posiciones a menudo)
  if (stop) { clearTimeout(liveSaveTimer); liveSaveTimer = null; saveMessages(); }
  else if (!liveSaveTimer) liveSaveTimer = setTimeout(() => { liveSaveTimer = null; saveMessages(); }, 30000);
  res.json({ live: msg.live });
});

// ════════════════════════════════════════════════════════════════
//  PRESENCIA (online / última vez)
// ════════════════════════════════════════════════════════════════

/** POST /presence — actualiza el lastSeen del usuario (heartbeat cada 30s) */
// La app manda un latido cada 25 s mientras está a la vista, y { away: true } al pasar a segundo plano o cerrarse
const ONLINE_WINDOW_MS = 75 * 1000;
router.post('/presence', (req, res) => {
  const { userId, away } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId requerido' });
  for (const [phone, u] of userStore.entries()) {
    if (u.userId === userId) { u.lastSeen = Date.now(); u.away = !!away; userStore.set(phone, u); break; }
  }
  return res.json({ success: true });
});

/** GET /stickers/:userId — stickers creados por el usuario */
router.get('/stickers/:userId', (req, res) => res.json({ stickers: stickerStore.get(req.params.userId) || [] }));

/** POST /stickers — { userId, url } (la imagen se sube antes con /chat/upload) */
router.post('/stickers', (req, res) => {
  const { userId, url } = req.body || {};
  if (!userId || !findUserById(userId)) return res.status(401).json({ error: 'Usuario no válido' });
  if (!/^https?:\/\/.+\/files\/[\w.-]+$/.test(String(url || ''))) return res.status(400).json({ error: 'Sticker no válido' });
  const list = [url, ...(stickerStore.get(userId) || []).filter(u => u !== url)].slice(0, 200);
  stickerStore.set(userId, list);
  saveStickers();
  res.json({ stickers: list });
});

/** DELETE /stickers/:userId?url= — quitar un sticker de la colección */
router.delete('/stickers/:userId', (req, res) => {
  const list = (stickerStore.get(req.params.userId) || []).filter(u => u !== req.query.url);
  stickerStore.set(req.params.userId, list);
  saveStickers();
  res.json({ stickers: list });
});

/** GET /presence/:userId — devuelve online + lastSeen del usuario */
router.get('/presence/:userId', (req, res) => {
  const { userId } = req.params;
  for (const u of userStore.values()) {
    if (u.userId === userId) {
      const lastSeen = u.lastSeen || u.lastLogin || 0;
      const online   = !u.away && Date.now() - lastSeen < ONLINE_WINDOW_MS;
      return res.json({ online, lastSeen });
    }
  }
  return res.json({ online: false, lastSeen: null });
});

// ════════════════════════════════════════════════════════════════
//  AVATAR DE USUARIO
// ════════════════════════════════════════════════════════════════

/** POST /user/avatar — guarda el avatar comprimido (base64) del usuario */
router.post('/user/avatar', (req, res) => {
  const { userId, avatar } = req.body || {};
  if (!userId || !avatar) return res.status(400).json({ error: 'userId y avatar requeridos' });
  // Limite de seguridad: avatares comprimidos no deberían superar 50KB en base64
  if (avatar.length > 80_000) return res.status(400).json({ error: 'Avatar demasiado grande (máx 50KB)' });
  for (const [phone, u] of userStore.entries()) {
    if (u.userId === userId) { u.avatar = avatar; userStore.set(phone, u); saveUsers(); break; }
  }
  return res.json({ success: true });
});

/** GET /user/avatar/:userId — devuelve el avatar de un usuario */
router.get('/user/avatar/:userId', (req, res) => {
  const { userId } = req.params;
  for (const u of userStore.values()) {
    if (u.userId === userId) return res.json({ avatar: u.avatar || null });
  }
  return res.json({ avatar: null });
});

// ════════════════════════════════════════════════════════════════
//  CONFIRMACIONES DE LECTURA (✓✓ azul)
// ════════════════════════════════════════════════════════════════

/** POST /messages/:chatId/mark-read — marca todos los mensajes del chat como leídos por userId */
router.post('/messages/:chatId/mark-read', (req, res) => {
  const { chatId } = req.params;
  const { userId }  = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId requerido' });
  const msgs = messageStore.get(chatId) || [];
  let changed = false;
  msgs.forEach(m => {
    if (m.senderId !== userId) {
      if (!Array.isArray(m.readBy)) m.readBy = [];
      if (!m.readBy.includes(userId)) { m.readBy.push(userId); changed = true; }
    }
  });
  if (changed) { messageStore.set(chatId, msgs); saveMessages(); notifyChatUpdate(chatId, userId, 'read'); }
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════
//  ESTADOS (STORIES) — 24 horas
// ════════════════════════════════════════════════════════════════
// Cada estado guarda a quién se le muestra (`allowed`, calculado al publicar):
//   contacts → mis contactos · except → mis contactos menos `userIds` · only → solo `userIds`.
// "Mis contactos" = los contactos de la agenda que usan OldFace (los manda la app) + con quien tengo chat o grupo.
// Fotos y vídeos se suben antes con /chat/upload; aquí solo se guarda su URL.

const STORY_TTL_MS = 24 * 60 * 60 * 1000;
const STORY_LIMITS = { total: 20, video: 5, image: 15 };
const STORY_MODES = ['contacts', 'except', 'only'];
const storyPrivacyStore = new Map(Object.entries(loadJSON('story_privacy.json', {})));   // userId → { mode, userIds }
const saveStoryPrivacy = () => saveJSON('story_privacy.json', Object.fromEntries(storyPrivacyStore));

/** Personas con las que el usuario tiene chat o comparte grupo */
function storyContactsOf(userId) {
  const set = new Set();
  for (const c of chatStore2.values()) {
    if (!c.participants?.includes(userId)) continue;
    for (const p of c.participants) if (p !== userId) set.add(p);
  }
  return set;
}

function cleanStoryPrivacy(p) {
  const mode = STORY_MODES.includes(p?.mode) ? p.mode : 'contacts';
  const userIds = mode === 'contacts' ? []
    : [...new Set((Array.isArray(p?.userIds) ? p.userIds : []).filter(id => typeof id === 'string' && findUserById(id)))].slice(0, 500);
  return { mode, userIds };
}

function storyAudience(userId, privacy, contactIds = []) {
  if (privacy.mode === 'only') return privacy.userIds.filter(id => id !== userId);
  const base = storyContactsOf(userId);
  for (const id of (Array.isArray(contactIds) ? contactIds.slice(0, 3000) : [])) {
    if (typeof id === 'string' && id !== userId && findUserById(id)) base.add(id);
  }
  if (privacy.mode === 'except') for (const id of privacy.userIds) base.delete(id);
  return [...base];
}

/** Estados antiguos (sin `allowed`) los veían todos: se respeta hasta que caduquen */
const canSeeStory = (s, viewerId) => s.userId === viewerId || !s.allowed || (!!viewerId && s.allowed.includes(viewerId));

const STORY_FILE_RE = /\/files\/([\w.-]+)$/;
/** Archivos de estados borrados/caducados: se eliminan más tarde si ningún mensaje los usa (respuestas a estados) */
const storyFileTrash = new Map();   // nombre de archivo → cuándo se dejó de usar
function trashStoryFile(story) {
  const m = String(story?.content || '').match(STORY_FILE_RE);
  if (m) storyFileTrash.set(m[1], Date.now());
}
function sweepStoryFiles() {
  if (!storyFileTrash.size) return;
  const live = new Set(storiesList.map(s => String(s.content || '').match(STORY_FILE_RE)?.[1]).filter(Boolean));
  const referenced = (name) => {
    const tail = `/files/${name}`;
    for (const list of messageStore.values()) {
      for (const m of list) if (String(m.url || '').endsWith(tail) || String(m.replyTo?.url || '').endsWith(tail)) return true;
    }
    return false;
  };
  for (const [name, at] of storyFileTrash) {
    if (Date.now() - at < 60 * 60 * 1000) continue;            // margen de una hora
    storyFileTrash.delete(name);
    if (live.has(name) || referenced(name)) continue;
    try { fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(name))); } catch { /* ya no estaba */ }
  }
}

function pruneStories() {
  const now = Date.now();
  const expired = storiesList.filter(s => s.expiresAt <= now);
  if (!expired.length) return;
  expired.forEach(trashStoryFile);
  storiesList = storiesList.filter(s => s.expiresAt > now);
  saveStories();
}
setInterval(() => { pruneStories(); sweepStoryFiles(); }, 10 * 60 * 1000).unref?.();

/** Lo que ve cada uno: el autor, todo (quién lo vio y con quién lo compartió); los demás, solo si ya lo vieron */
function storyFor(s, viewerId) {
  const { allowed, viewers = [], privacy, ...rest } = s;
  if (s.userId === viewerId) return { ...rest, viewers, privacy: privacy || null, audienceCount: allowed ? allowed.length : null };
  return { ...rest, seen: viewers.includes(viewerId) };
}

/** GET /stories?userId= — estados activos que puede ver el usuario + nombre y foto de sus autores */
router.get('/stories', (req, res) => {
  pruneStories();
  const viewerId = req.query.userId || null;
  const visible = storiesList.filter(s => canSeeStory(s, viewerId));
  const authors = {};
  for (const s of visible) {
    if (authors[s.userId]) continue;
    const u = findUserById(s.userId);
    authors[s.userId] = { name: u?.name || s.userName, avatar: u?.avatar || null };
  }
  return res.json({ stories: visible.map(s => storyFor(s, viewerId)), authors, limits: STORY_LIMITS });
});

/** GET /stories/privacy?userId= — privacidad habitual del usuario para sus estados */
router.get('/stories/privacy', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId requerido' });
  return res.json(cleanStoryPrivacy(storyPrivacyStore.get(userId)));
});

/** PUT /stories/privacy — { userId, mode, userIds } guardar la privacidad habitual */
router.put('/stories/privacy', (req, res) => {
  const { userId } = req.body || {};
  if (!userId || !findUserById(userId)) return res.status(401).json({ error: 'Usuario no válido' });
  const p = cleanStoryPrivacy(req.body);
  storyPrivacyStore.set(userId, p);
  saveStoryPrivacy();
  return res.json(p);
});

/**
 * POST /stories — { userId, userName, mediaType: text|image|video, content, bgColor, privacy?, contactIds? }
 * Máximo 20 estados activos: hasta 15 fotos y 5 vídeos. Sin `privacy` se usa la habitual del usuario.
 */
router.post('/stories', (req, res) => {
  const { userId, userName, content, bgColor, contactIds } = req.body || {};
  const mediaType = ['image', 'video'].includes(req.body?.mediaType) ? req.body.mediaType : 'text';
  if (!userId || !content) return res.status(400).json({ error: 'userId y content requeridos' });
  const author = findUserById(userId);
  if (!author) return res.status(401).json({ error: 'Usuario no válido' });
  if (mediaType === 'text' && String(content).length > 700) return res.status(400).json({ error: 'Texto demasiado largo' });
  if (mediaType !== 'text' && !STORY_FILE_RE.test(String(content)) && !String(content).startsWith(`data:${mediaType}/`))
    return res.status(400).json({ error: 'Archivo no válido' });

  pruneStories();
  const mine = storiesList.filter(s => s.userId === userId);
  if (mine.length >= STORY_LIMITS.total)
    return res.status(409).json({ error: `Ya tienes ${STORY_LIMITS.total} estados publicados (el máximo)` });
  if (mediaType === 'video' && mine.filter(s => s.mediaType === 'video').length >= STORY_LIMITS.video)
    return res.status(409).json({ error: `Máximo ${STORY_LIMITS.video} vídeos en tus estados` });
  if (mediaType === 'image' && mine.filter(s => s.mediaType === 'image').length >= STORY_LIMITS.image)
    return res.status(409).json({ error: `Máximo ${STORY_LIMITS.image} fotos en tus estados` });

  const privacy = cleanStoryPrivacy(req.body?.privacy || storyPrivacyStore.get(userId));
  if (privacy.mode === 'only' && privacy.userIds.length === 0)
    return res.status(400).json({ error: 'Elige al menos una persona para compartir' });
  const story = {
    id:        `story_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    userId, userName: author.name || userName || userId,
    mediaType,
    content,
    bgColor:   typeof bgColor === 'string' ? bgColor.slice(0, 20) : '#3D5A80',
    createdAt: Date.now(),
    expiresAt: Date.now() + STORY_TTL_MS,
    viewers:   [],
    privacy,
    allowed:   storyAudience(userId, privacy, contactIds),
  };
  storiesList.unshift(story);
  saveStories();
  return res.status(201).json(storyFor(story, userId));
});

/** POST /stories/:storyId/view — registra que un usuario vio un estado */
router.post('/stories/:storyId/view', (req, res) => {
  const { viewerId } = req.body || {};
  const story = storiesList.find(s => s.id === req.params.storyId);
  if (story && viewerId && viewerId !== story.userId && canSeeStory(story, viewerId) && !story.viewers.includes(viewerId)) {
    story.viewers.push(viewerId);
    saveStories();
  }
  return res.json({ success: true });
});

/** GET /stories/:storyId/viewers?userId= — quién vio mi estado (solo el autor) */
router.get('/stories/:storyId/viewers', (req, res) => {
  const story = storiesList.find(s => s.id === req.params.storyId);
  if (!story || story.userId !== req.query.userId) return res.status(404).json({ error: 'Estado no encontrado' });
  return res.json({ viewers: story.viewers.map(id => ({ userId: id, name: findUserById(id)?.name || id })) });
});

/** DELETE /stories/:storyId — elimina un estado (solo el creador) */
router.delete('/stories/:storyId', (req, res) => {
  const { userId } = req.body || {};
  const idx = storiesList.findIndex(s => s.id === req.params.storyId && s.userId === userId);
  if (idx === -1) return res.status(404).json({ error: 'Estado no encontrado o sin permisos' });
  trashStoryFile(storiesList[idx]);
  storiesList.splice(idx, 1);
  saveStories();
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════
//  GRUPOS
// ════════════════════════════════════════════════════════════════
// El chat de un grupo es `group_<groupId>` (y groupId ya empieza por "group_").
// Cualquier miembro puede añadir a otros; solo el administrador puede expulsar.

const groupChatId = (g) => `group_${g.id}`;
const isGroupMember = (g, userId) => !!g && !!userId && g.members.includes(userId);

/** Foto del grupo: imagen comprimida en base64 (como los avatares) o URL de un archivo subido */
function validGroupAvatar(a) {
  if (typeof a !== 'string') return false;
  if (a.startsWith('data:image/')) return a.length <= 200_000;
  return /^https?:\/\/\S+$/.test(a) && a.length < 500;
}

/** Copia los miembros/nombre/foto del grupo a su chat */
function syncGroupChat(g) {
  const chatId = groupChatId(g);
  const chat = chatStore2.get(chatId) || {
    id: chatId, isGroup: true, groupId: g.id, createdAt: g.createdAt, lastMessage: '', lastTime: Date.now(),
  };
  chat.participants = [...g.members];
  chat.name = g.name;
  chat.avatar = g.avatar || null;
  chatStore2.set(chatId, chat);
  saveChats();
}

function refreshMemberNames(g) {
  const names = {};
  for (const id of g.members) names[id] = findUserById(id)?.name || g.memberNames?.[id] || id;
  g.memberNames = names;
}

/** Datos del grupo que ve la app (con la llamada en curso, si la hay) */
function groupPublic(g) {
  const call = groupCalls.get(g.id);
  return {
    ...g,
    chatId: groupChatId(g),
    activeCall: call ? { roomId: call.roomId, callType: call.callType, startedBy: call.startedBy, startedAt: call.startedAt } : null,
  };
}

/** GET /groups?userId= — grupos en los que participa el usuario */
router.get('/groups', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId requerido' });
  const userGroups = [...groupStore.values()]
    .filter(g => g.members.includes(userId))
    .sort((a, b) => (chatStore2.get(groupChatId(b))?.lastTime || b.updatedAt) - (chatStore2.get(groupChatId(a))?.lastTime || a.updatedAt))
    .map(groupPublic);
  return res.json({ groups: userGroups });
});

/** GET /groups/:groupId?userId= — un grupo (solo para sus miembros) */
router.get('/groups/:groupId', (req, res) => {
  const g = groupStore.get(req.params.groupId);
  if (!g) return res.status(404).json({ error: 'Grupo no encontrado' });
  if (!isGroupMember(g, req.query.userId)) return res.status(403).json({ error: 'No perteneces a este grupo' });
  refreshMemberNames(g);
  return res.json(groupPublic(g));
});

/** POST /groups — crea un grupo nuevo { adminId, name, members[], avatar? } */
router.post('/groups', (req, res) => {
  const { adminId, name, members, avatar } = req.body || {};
  const cleanName = String(name || '').trim().slice(0, 50);
  if (!adminId || !cleanName || !Array.isArray(members) || members.length < 1)
    return res.status(400).json({ error: 'adminId, name y members[] son requeridos' });
  if (!findUserById(adminId)) return res.status(401).json({ error: 'Usuario no válido' });

  const allMembers = [...new Set([adminId, ...members.filter(m => typeof m === 'string' && findUserById(m))])];
  if (allMembers.length < 2) return res.status(400).json({ error: 'Ninguno de los participantes está en OldFace' });

  const group = {
    id:          `group_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name:        cleanName,
    adminId,
    members:     allMembers,
    memberNames: {},
    avatar:      validGroupAvatar(avatar) ? avatar : null,
    createdAt:   Date.now(),
    updatedAt:   Date.now(),
  };
  refreshMemberNames(group);
  groupStore.set(group.id, group);
  saveGroups();
  syncGroupChat(group);   // el chat del grupo vive en chatStore2 para unificar la lectura de mensajes
  for (const m of allMembers) if (m !== adminId) rtcEmit(m, 'chat:update', { chatId: groupChatId(group), reason: 'group' });

  return res.status(201).json(groupPublic(group));
});

/** PUT /groups/:groupId — { userId, name?, avatar? } cambia nombre y/o foto (cualquier miembro) */
router.put('/groups/:groupId', (req, res) => {
  const g = groupStore.get(req.params.groupId);
  if (!g) return res.status(404).json({ error: 'Grupo no encontrado' });
  const { userId, name, avatar } = req.body || {};
  if (!isGroupMember(g, userId)) return res.status(403).json({ error: 'No perteneces a este grupo' });
  const cleanName = typeof name === 'string' ? name.trim().slice(0, 50) : '';
  if (cleanName) g.name = cleanName;
  if (avatar === null) g.avatar = null;
  else if (avatar !== undefined) {
    if (!validGroupAvatar(avatar)) return res.status(400).json({ error: 'Imagen no válida o demasiado grande' });
    g.avatar = avatar;
  }
  g.updatedAt = Date.now();
  groupStore.set(g.id, g);
  saveGroups();
  syncGroupChat(g);
  return res.json(groupPublic(g));
});

/** POST /groups/:groupId/members — { requesterId, userIds[] } añade miembros (cualquier miembro puede) */
router.post('/groups/:groupId/members', (req, res) => {
  const g = groupStore.get(req.params.groupId);
  if (!g) return res.status(404).json({ error: 'Grupo no encontrado' });
  const body = req.body || {};
  const requesterId = body.requesterId || body.adminId;
  if (!isGroupMember(g, requesterId)) return res.status(403).json({ error: 'No perteneces a este grupo' });
  const ids = [...new Set((Array.isArray(body.userIds) ? body.userIds : [body.userId])
    .filter(id => typeof id === 'string' && findUserById(id) && !g.members.includes(id)))];
  if (ids.length) {
    g.members.push(...ids);
    refreshMemberNames(g);
    g.updatedAt = Date.now();
    groupStore.set(g.id, g);
    saveGroups();
    syncGroupChat(g);
    for (const m of ids) rtcEmit(m, 'chat:update', { chatId: groupChatId(g), reason: 'group' });
  }
  return res.json({ ...groupPublic(g), added: ids.length });
});

/** DELETE /groups/:groupId/members/:userId — { requesterId } salir del grupo o expulsar (solo el administrador) */
router.delete('/groups/:groupId/members/:userId', (req, res) => {
  const g = groupStore.get(req.params.groupId);
  if (!g) return res.status(404).json({ error: 'Grupo no encontrado' });
  const requesterId = req.body?.requesterId || req.query.requesterId;
  const targetId = req.params.userId;
  if (!isGroupMember(g, requesterId) || (targetId !== requesterId && g.adminId !== requesterId))
    return res.status(403).json({ error: 'Solo el administrador puede quitar miembros' });
  g.members = g.members.filter(m => m !== targetId);
  if (g.members.length === 0) {
    // Se fue el último: el grupo desaparece
    groupStore.delete(g.id);
    groupCalls.delete(g.id);
    chatStore2.delete(groupChatId(g));
    messageStore.delete(groupChatId(g));
    saveGroups(); saveChats(); saveMessages();
    return res.json({ success: true, deleted: true });
  }
  if (g.adminId === targetId) g.adminId = g.members[0];   // el administrador se fue → pasa al siguiente
  refreshMemberNames(g);
  g.updatedAt = Date.now();
  groupStore.set(g.id, g);
  saveGroups();
  syncGroupChat(g);
  return res.json({ success: true, group: groupPublic(g) });
});

// ── Llamadas de grupo ────────────────────────────────────────────────
// La sala de medios es `gcall__<groupId>__<inicio>`: así la app reconoce una llamada de grupo solo por el roomId
// (también cuando llega por la pantalla de llamada nativa de Android, que solo conserva el roomId).
// Cada uno entra y sale cuando quiere; la llamada sigue mientras quede alguien en la sala.
/** groupId → { roomId, callType, startedBy, startedAt, invited:Set } */
const groupCalls = new Map();
const GROUP_CALL_RING_MS = 60_000;   // lo que suena en los móviles; antes de eso no se da la llamada por vacía

/** Quién está en una sala del servidor RTC (null si no se puede saber) */
async function rtcRoomPeers(roomId) {
  const url = process.env.RTC_INTERNAL_URL, secret = process.env.RTC_SECRET;
  if (!url || !secret) return null;
  try {
    const r = await fetch(`${url}/rtc/internal/rooms/${encodeURIComponent(roomId)}`, {
      headers: { 'x-internal-secret': secret }, signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return null;
    return (await r.json()).peers || [];
  } catch { return null; }
}

/** Llamada en curso del grupo, comprobando que de verdad queda alguien en la sala */
async function activeGroupCall(groupId) {
  const call = groupCalls.get(groupId);
  if (!call) return null;
  const peers = await rtcRoomPeers(call.roomId);
  const age = Date.now() - call.startedAt;
  const empty = peers ? peers.length === 0 : age > 3 * 3600_000;
  if (empty && age > GROUP_CALL_RING_MS) {
    if (groupCalls.get(groupId) === call) groupCalls.delete(groupId);
    return null;
  }
  return { ...call, peers: peers || [] };
}

/** Hacer sonar la llamada en los móviles de `userIds` (señal en vivo + aviso push, como una llamada normal) */
function ringGroupCall(g, call, fromId, userIds) {
  const fromName = findUserById(fromId)?.name || fromId;
  for (const to of userIds) {
    if (!to || to === fromId) continue;
    call.invited.add(to);
    rtcEmit(to, 'signal', {
      from: fromId, fromName, type: 'call_invite', ts: Date.now(),
      payload: { callType: call.callType, callerName: fromName, roomId: call.roomId, groupId: g.id, groupName: g.name },
    });
    dataToUser(to, {
      type: 'call', callType: call.callType, callerId: fromId,
      // La pantalla nativa solo muestra este nombre: grupo + quién llama
      callerName: `${g.name} · ${fromName}`, calleeId: to,
      roomId: call.roomId, groupId: g.id, groupName: g.name, ts: Date.now(),
    });
  }
}

/** Dejar de hacer sonar (la llamada terminó sin que contestaran) */
function stopRingingGroupCall(call, fromId) {
  for (const to of call.invited) {
    if (to === fromId) continue;
    rtcEmit(to, 'signal', { from: fromId, type: 'call_cancel', ts: Date.now(), payload: { roomId: call.roomId } });
    dataToUser(to, { type: 'call_cancel', callerId: fromId, ts: Date.now() });
  }
}

/** GET /groups/:groupId/call?userId= — llamada en curso (o null) con quién está dentro */
router.get('/groups/:groupId/call', async (req, res) => {
  const g = groupStore.get(req.params.groupId);
  if (!g) return res.status(404).json({ error: 'Grupo no encontrado' });
  if (!isGroupMember(g, req.query.userId)) return res.status(403).json({ error: 'No perteneces a este grupo' });
  const call = await activeGroupCall(g.id);
  if (!call) return res.json({ call: null });
  return res.json({ call: { roomId: call.roomId, callType: call.callType, startedBy: call.startedBy, startedAt: call.startedAt,
                            peers: call.peers.map(p => ({ userId: p.userId, name: g.memberNames?.[p.userId] || p.name })) } });
});

/**
 * POST /groups/:groupId/call — { userId, callType: 'voice'|'video' }
 * Si ya hay una llamada en curso se devuelve esa (para unirse); si no, se crea y suena en los móviles del resto.
 */
router.post('/groups/:groupId/call', async (req, res) => {
  const g = groupStore.get(req.params.groupId);
  if (!g) return res.status(404).json({ error: 'Grupo no encontrado' });
  const { userId, callType } = req.body || {};
  if (!isGroupMember(g, userId)) return res.status(403).json({ error: 'No perteneces a este grupo' });
  const existing = await activeGroupCall(g.id);
  if (existing) return res.json({ roomId: existing.roomId, callType: existing.callType, groupName: g.name, joined: true });
  const call = {
    roomId: `gcall__${g.id}__${Date.now()}`,
    callType: callType === 'video' ? 'video' : 'voice',
    startedBy: userId, startedAt: Date.now(), invited: new Set(),
  };
  groupCalls.set(g.id, call);
  ringGroupCall(g, call, userId, g.members);
  return res.json({ roomId: call.roomId, callType: call.callType, groupName: g.name, joined: false });
});

/** POST /groups/:groupId/call/invite — { userId, inviteeIds[] } avisar a más gente durante la llamada */
router.post('/groups/:groupId/call/invite', (req, res) => {
  const g = groupStore.get(req.params.groupId);
  if (!g) return res.status(404).json({ error: 'Grupo no encontrado' });
  const { userId, inviteeIds } = req.body || {};
  if (!isGroupMember(g, userId)) return res.status(403).json({ error: 'No perteneces a este grupo' });
  const call = groupCalls.get(g.id);
  if (!call) return res.status(404).json({ error: 'La llamada ya terminó' });
  const ids = (Array.isArray(inviteeIds) ? inviteeIds : []).filter(id => typeof id === 'string' && findUserById(id)).slice(0, 50);
  ringGroupCall(g, call, userId, ids);
  return res.json({ success: true, invited: ids.length });
});

/** POST /groups/:groupId/call/leave — { userId } salgo yo; si no queda nadie, la llamada termina y deja de sonar */
router.post('/groups/:groupId/call/leave', async (req, res) => {
  const g = groupStore.get(req.params.groupId);
  const { userId } = req.body || {};
  const call = g ? groupCalls.get(g.id) : null;
  if (!call || !isGroupMember(g, userId)) return res.json({ ended: false });
  const peers = await rtcRoomPeers(call.roomId);
  const others = (peers || []).filter(p => p.userId !== userId);
  if (peers && others.length === 0) {
    if (groupCalls.get(g.id) === call) groupCalls.delete(g.id);
    stopRingingGroupCall(call, userId);
    return res.json({ ended: true });
  }
  return res.json({ ended: false, remaining: others.length });
});

// Limpieza: llamadas que se quedaron vacías (p. ej. la app se cerró sin avisar)
setInterval(() => { for (const id of [...groupCalls.keys()]) activeGroupCall(id).catch(() => {}); }, 30_000).unref?.();

// ════════════════════════════════════════════════════════════════
//  REGISTRO DE LLAMADAS
// ════════════════════════════════════════════════════════════════

/** POST /call-log — Registra una llamada realizada o recibida */
router.post('/call-log', (req, res) => {
  const { userId, contactId, contactName, type, duration, direction, timestamp } = req.body || {};
  if (!userId || !contactId) return res.status(400).json({ error: 'userId y contactId son requeridos' });

  const entry = {
    id:          `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    userId, contactId,
    contactName: contactName || contactId,
    type:        type || 'voice',
    duration:    duration || 0,
    direction:   direction || 'outgoing',
    timestamp:   timestamp || Date.now(),
  };

  // Guardar en el log del llamante
  const myLog = callLogStore.get(userId) || [];
  myLog.unshift(entry);
  if (myLog.length > 100) myLog.length = 100;
  callLogStore.set(userId, myLog);

  // Si es saliente, guardar también en el log del destinatario como "incoming"
  if (direction === 'outgoing') {
    // Buscar el nombre del llamante para mostrárselo al destinatario
    const callerUser = [...userStore.values()].find(u => u.userId === userId);
    const contactEntry = {
      ...entry,
      userId:      contactId,
      contactId:   userId,
      contactName: callerUser?.name || userId,
      direction:   'incoming',
    };
    const contactLog = callLogStore.get(contactId) || [];
    contactLog.unshift(contactEntry);
    if (contactLog.length > 100) contactLog.length = 100;
    callLogStore.set(contactId, contactLog);
  }

  saveCallLog();
  return res.json({ success: true, id: entry.id });
});

/** GET /call-log?userId= — Obtiene el historial de llamadas de un usuario */
router.get('/call-log', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId es requerido' });
  const log = callLogStore.get(userId) || [];
  return res.json({ calls: log });
});

/** DELETE /call-log?userId= — Borra todo el historial de llamadas del usuario */
router.delete('/call-log', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId es requerido' });
  callLogStore.set(userId, []);
  saveCallLog();
  return res.json({ success: true });
});

/** DELETE /call-log/:callId?userId= — Borra una llamada específica */
router.delete('/call-log/:callId', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId es requerido' });
  const log = callLogStore.get(userId) || [];
  const idx = log.findIndex(c => c.id === req.params.callId);
  if (idx === -1) return res.status(404).json({ error: 'Llamada no encontrada' });
  log.splice(idx, 1);
  callLogStore.set(userId, log);
  saveCallLog();
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════
//  DIRECTOS
// ════════════════════════════════════════════════════════════════

router.get('/directos', (_req, res) => {
  const list = [...directoStore.values()].sort((a, b) => b.createdAt - a.createdAt);
  return res.json({ directos: list });
});

router.post('/directos', (req, res) => {
  const { creatorId, title, description, scheduledAt, contacts, price } = req.body || {};
  if (!creatorId || !title) return res.status(400).json({ error: 'creatorId y title son requeridos' });

  const directo = {
    id:          `directo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    creatorId, title, description: description || '',
    scheduledAt: scheduledAt || null, contacts: contacts || [],
    price: price || 0, status: 'scheduled',
    createdAt: Date.now(), viewerCount: 0,
  };
  directoStore.set(directo.id, directo);
  saveDirectos();
  return res.status(201).json(directo);
});

router.get('/directos/:id', (req, res) => {
  const d = directoStore.get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Directo no encontrado' });
  const creator = [...userStore.values()].find(u => u.userId === d.creatorId);
  return res.json({ ...d, creatorName: creator?.name || null, creatorAvatar: creator?.avatar || null });
});

/** Avisa a todos los usuarios (menos el anfitrión) de que un directo ha empezado */
function notifyLiveStarted(d) {
  const creator = [...userStore.values()].find(u => u.userId === d.creatorId);
  const hostName = creator?.name || 'Alguien';
  for (const u of userStore.values()) {
    if (u.userId === d.creatorId) continue;
    rtcEmit(u.userId, 'live:started', { directoId: d.id, title: d.title, hostName });
    const T = pushText(u.userId);
    pushToUser(u.userId, T.isLive(hostName), d.title || T.tapToWatch, { type: 'live', directoId: d.id });
  }
}

router.put('/directos/:id', (req, res) => {
  const d = directoStore.get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Directo no encontrado' });
  const { title, description, scheduledAt, contacts, price, status } = req.body || {};
  const goingLive = status === 'live' && d.status !== 'live';
  if (goingLive) d.startedAt = Date.now();
  if (status === 'ended' && d.status !== 'ended') d.endedAt = Date.now();
  if (title       !== undefined) d.title       = title;
  if (description !== undefined) d.description = description;
  if (scheduledAt !== undefined) d.scheduledAt = scheduledAt;
  if (contacts    !== undefined) d.contacts    = contacts;
  if (price       !== undefined) d.price       = price;
  if (status      !== undefined) d.status      = status;
  directoStore.set(d.id, d);
  saveDirectos();
  if (goingLive) notifyLiveStarted(d);
  return res.json(d);
});

router.delete('/directos/:id', (req, res) => {
  if (!directoStore.has(req.params.id)) return res.status(404).json({ error: 'Directo no encontrado' });
  directoStore.delete(req.params.id);
  saveDirectos();
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════
//  ADMIN PANEL
// ════════════════════════════════════════════════════════════════
// Credenciales en .env (ADMIN_EMAIL / ADMIN_PASSWORD); sin ellas el login queda desactivado
const ADMIN_EMAIL    = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const sameSecret = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};
const adminSessions  = new Map(); // token → expiry (24h)

setInterval(() => {
  const now = Date.now();
  for (const [t, exp] of adminSessions.entries()) if (now > exp) adminSessions.delete(t);
}, 3_600_000);

function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  const exp = adminSessions.get(token);
  if (!exp || Date.now() > exp) { adminSessions.delete(token); return res.status(401).json({ error: 'Sesión expirada' }); }
  next();
}

// Sirve el HTML del dashboard (GET directo, sin /api/)
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// Todos los endpoints admin bajo /api/admin/ para que Plesk/Nginx los proxee correctamente
router.post('/admin/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD)
    return res.status(503).json({ error: 'Acceso de administrador no configurado' });
  const okEmail = sameSecret(String(email || '').trim().toLowerCase(), ADMIN_EMAIL);
  const okPass  = sameSecret(password || '', ADMIN_PASSWORD);
  if (!okEmail || !okPass)
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.set(token, Date.now() + 24 * 60 * 60 * 1000);
  res.json({ token });
});

router.get('/admin/stats', adminAuth, (_req, res) => {
  const today = new Date().toDateString();
  let totalMessages = 0;
  for (const msgs of messageStore.values()) if (Array.isArray(msgs)) totalMessages += msgs.length;
  let activeToday = 0;
  for (const u of userStore.values()) if (u.lastSeen && new Date(u.lastSeen).toDateString() === today) activeToday++;
  let calls = 0;
  for (const c of callLogStore.values()) if (Array.isArray(c)) calls += c.length;
  let revenue = 0;
  const subList = [...subStore.values()];
  for (const s of subList) { if (s.plan === 'member') revenue += 1; else if (s.plan === 'premium') revenue += 50; }
  const memberCount  = subList.filter(s => s.plan === 'member').length;
  const premiumCount = subList.filter(s => s.plan === 'premium').length;
  const freeCount    = userStore.size - memberCount - premiumCount;
  res.json({
    users: userStore.size, activeToday, chats: chatStore2.size,
    totalMessages, calls, groups: groupStore.size, revenue,
    planCounts: { free: Math.max(0, freeCount), member: memberCount, premium: premiumCount }
  });
});

router.get('/admin/users', adminAuth, (_req, res) => {
  const list = [];
  for (const [userId, u] of userStore.entries()) {
    const sub = subStore.get(userId) || { plan: 'free', since: null };
    let msgCount = 0;
    for (const msgs of messageStore.values()) if (Array.isArray(msgs)) msgCount += msgs.filter(m => m.sender === userId).length;
    list.push({ id: userId, name: u.name || '—', phone: u.phone || '—', avatar: u.avatar || null,
                registeredAt: u.registeredAt || null, lastSeen: u.lastSeen || null,
                plan: sub.plan, planSince: sub.since || null, msgCount });
  }
  list.sort((a, b) => (b.registeredAt || 0) - (a.registeredAt || 0));
  res.json({ users: list });
});

router.post('/admin/users/:userId/plan', adminAuth, (req, res) => {
  const { userId } = req.params;
  const { plan } = req.body || {};
  if (!['free','member','premium'].includes(plan)) return res.status(400).json({ error: 'Plan inválido' });
  if (!userStore.has(userId)) return res.status(404).json({ error: 'Usuario no encontrado' });
  subStore.set(userId, { plan, since: Date.now() });
  saveSubs();
  res.json({ success: true });
});

router.delete('/admin/users/:userId', adminAuth, (req, res) => {
  const { userId } = req.params;
  userStore.delete(userId); subStore.delete(userId);
  saveUsers(); saveSubs();
  res.json({ success: true });
});

router.get('/admin/chats', adminAuth, (_req, res) => {
  const list = [];
  for (const [id, c] of chatStore2.entries()) {
    const msgs = messageStore.get(id) || [];
    const lastMsg = msgs.length ? (msgs[msgs.length - 1]?.timestamp || null) : null;
    list.push({ id, participants: c.participants || [], msgCount: msgs.length, lastMsg });
  }
  list.sort((a, b) => (b.lastMsg || 0) - (a.lastMsg || 0));
  res.json({ chats: list });
});

router.get('/admin/calls', adminAuth, (_req, res) => {
  const all = [];
  for (const calls of callLogStore.values()) if (Array.isArray(calls)) all.push(...calls);
  all.sort((a, b) => (b.ts || b.timestamp || 0) - (a.ts || a.timestamp || 0));
  res.json({ calls: all.slice(0, 200) });
});

// ════════════════════════════════════════════════════════════════
//  POLL — encuestas integradas (https://oldface.app/poll)
// ════════════════════════════════════════════════════════════════
const POLL_COUNTRIES = [
  'España', 'México', 'Argentina', 'Colombia', 'Chile', 'Perú', 'Venezuela', 'Ecuador',
  'Guatemala', 'Cuba', 'Bolivia', 'República Dominicana', 'Honduras', 'Paraguay', 'El Salvador',
  'Nicaragua', 'Costa Rica', 'Panamá', 'Uruguay', 'Puerto Rico', 'Estados Unidos', 'Otro',
];
const POLL_SEX = ['male', 'female', 'other', 'prefer_not_say'];

const findUserById = (userId) => [...userStore.values()].find(u => u.userId === userId) || null;

function slugify(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** draft | scheduled | active | closed */
function pollStatus(p, now = Date.now()) {
  if (!p.isPublished) return 'draft';
  if (!p.isActive || (p.endsAt && p.endsAt <= now)) return 'closed';
  if (p.startsAt > now) return 'scheduled';
  return 'active';
}

function pollResults(p) {
  const votes  = pollVoteStore.get(p.id) || {};
  const counts = {};
  for (const optId of Object.values(votes)) counts[optId] = (counts[optId] || 0) + 1;
  const total = Object.keys(votes).length;
  return {
    totalVotes: total,
    options: p.options.map(o => ({
      id: o.id, text: o.text,
      count: counts[o.id] || 0,
      percentage: total ? Math.round(((counts[o.id] || 0) / total) * 100) : 0,
    })),
  };
}

function pollDemographics(p) {
  const voterIds = Object.keys(pollVoteStore.get(p.id) || {});
  const sex = {}, age = {}, nationality = {}, postalCode = {};
  let withProfile = 0;
  for (const uid of voterIds) {
    const pr = pollProfileStore.get(uid);
    if (!pr) continue;
    withProfile++;
    sex[pr.sex] = (sex[pr.sex] || 0) + 1;
    const a = pr.age;
    const range = a < 18 ? '< 18' : a < 25 ? '18-24' : a < 35 ? '25-34' : a < 45 ? '35-44' : a < 55 ? '45-54' : '55+';
    age[range] = (age[range] || 0) + 1;
    nationality[pr.nationality] = (nationality[pr.nationality] || 0) + 1;
    postalCode[pr.postalCode] = (postalCode[pr.postalCode] || 0) + 1;
  }
  return { totalVoters: withProfile, sex, age, nationality, postalCode };
}

function serializePoll(p, userId, { withDemographics = false } = {}) {
  const cat = p.categoryId ? pollCatStore.get(p.categoryId) : null;
  const votes = pollVoteStore.get(p.id) || {};
  return {
    id: p.id, title: p.title, description: p.description, type: p.type,
    category: cat ? { id: cat.id, name: cat.name, icon: cat.icon } : null,
    country: p.country || null, videoUrl: p.videoUrl || null,
    startsAt: p.startsAt, endsAt: p.endsAt, createdAt: p.createdAt,
    isPublished: p.isPublished, isActive: p.isActive,
    status: pollStatus(p),
    ...pollResults(p),
    myVote: userId ? (votes[userId] || null) : null,
    ...(withDemographics ? { demographics: pollDemographics(p) } : {}),
  };
}

/** Valida y normaliza el cuerpo de creación/edición de encuesta (admin) */
function parsePollInput(body, existing = null) {
  const { title, description, type, options, categoryId, country, videoUrl, startsAt, endsAt, isPublished } = body || {};
  if (!title || !String(title).trim()) return { error: 'El título es obligatorio' };
  const pollType = type === 'YES_NO' ? 'YES_NO' : 'MULTIPLE';
  const texts = pollType === 'YES_NO'
    ? ['Sí', 'No']
    : (Array.isArray(options) ? options : []).map(o => String(typeof o === 'object' ? o.text : o || '').trim()).filter(Boolean);
  if (texts.length < 2)  return { error: 'Debe haber al menos 2 opciones' };
  if (texts.length > 10) return { error: 'Máximo 10 opciones' };
  if (new Set(texts.map(t => t.toLowerCase())).size !== texts.length) return { error: 'Hay opciones repetidas' };
  const start = startsAt ? new Date(startsAt).getTime() : (existing?.startsAt ?? Date.now());
  const end   = endsAt   ? new Date(endsAt).getTime()   : null;
  if (Number.isNaN(start) || (end !== null && Number.isNaN(end))) return { error: 'Fechas inválidas' };
  if (end !== null && end <= start) return { error: 'La fecha de fin debe ser posterior a la de inicio' };
  if (categoryId && !pollCatStore.has(categoryId)) return { error: 'Categoría no válida' };

  // Conservar IDs de opciones existentes cuando el texto no cambia (no romper votos)
  const prevOpts = existing?.options || [];
  const opts = texts.map((text, i) => {
    const same = prevOpts.find(o => o.text === text);
    return same ? { id: same.id, text } : { id: `opt_${Date.now()}_${i}_${crypto.randomBytes(2).toString('hex')}`, text };
  });

  return {
    data: {
      title: String(title).trim(),
      description: description ? String(description).trim() : '',
      type: pollType, options: opts,
      categoryId: categoryId || null,
      country: country || null,
      videoUrl: videoUrl ? String(videoUrl).trim() : null,
      startsAt: start, endsAt: end,
      isPublished: isPublished !== false,
    },
  };
}

// ── POLL: endpoints de usuario ────────────────────────────────────

/** GET /poll/meta — categorías y listas para formularios */
router.get('/poll/meta', (_req, res) => {
  const categories = [...pollCatStore.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  res.json({ categories, countries: POLL_COUNTRIES });
});

/** GET /poll/polls?userId= — encuestas visibles (activas + cerradas) */
router.get('/poll/polls', (req, res) => {
  const { userId } = req.query;
  const visible = [...pollStore.values()]
    .map(p => serializePoll(p, userId))
    .filter(p => p.status === 'active' || p.status === 'closed');
  const active   = visible.filter(p => p.status === 'active').sort((a, b) => b.startsAt - a.startsAt);
  const finished = visible.filter(p => p.status === 'closed')
    .sort((a, b) => (b.endsAt || b.startsAt) - (a.endsAt || a.startsAt)).slice(0, 50);
  res.json({ current: active[0] || null, active: active.slice(1), finished });
});

/** GET /poll/polls/:id?userId= — detalle con resultados y demografía */
router.get('/poll/polls/:id', (req, res) => {
  const p = pollStore.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Encuesta no encontrada' });
  const status = pollStatus(p);
  if (status === 'draft' || status === 'scheduled') return res.status(404).json({ error: 'Encuesta no disponible' });
  res.json({ poll: serializePoll(p, req.query.userId, { withDemographics: true }) });
});

/** POST /poll/polls/:id/vote — { userId, optionId } */
router.post('/poll/polls/:id/vote', (req, res) => {
  const { userId, optionId } = req.body || {};
  const p = pollStore.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Encuesta no encontrada' });
  if (!userId || !findUserById(userId)) return res.status(401).json({ error: 'Usuario no válido' });
  if (pollStatus(p) !== 'active') return res.status(400).json({ error: 'Esta encuesta no acepta votos' });
  if (!pollProfileStore.has(userId)) return res.status(409).json({ error: 'Completa tu perfil para votar', needsProfile: true });
  if (!p.options.some(o => o.id === optionId)) return res.status(400).json({ error: 'Opción no válida' });

  const votes = pollVoteStore.get(p.id) || {};
  if (votes[userId]) return res.status(409).json({ error: 'Ya has votado en esta encuesta' });
  votes[userId] = optionId;
  pollVoteStore.set(p.id, votes);
  savePollVotes();
  res.json({ success: true, poll: serializePoll(p, userId, { withDemographics: true }) });
});

/** GET /poll/profile/:userId */
router.get('/poll/profile/:userId', (req, res) => {
  res.json({ profile: pollProfileStore.get(req.params.userId) || null });
});

/** POST /poll/profile — { userId, age, sex, postalCode, nationality } */
router.post('/poll/profile', (req, res) => {
  const { userId, age, sex, postalCode, nationality } = req.body || {};
  if (!userId || !findUserById(userId)) return res.status(401).json({ error: 'Usuario no válido' });
  const ageNum = parseInt(age, 10);
  if (Number.isNaN(ageNum) || ageNum < 16 || ageNum > 120) return res.status(400).json({ error: 'La edad debe estar entre 16 y 120' });
  if (!POLL_SEX.includes(sex)) return res.status(400).json({ error: 'Sexo no válido' });
  if (!postalCode || !/^[A-Za-z0-9 -]{3,10}$/.test(String(postalCode).trim())) return res.status(400).json({ error: 'Código postal no válido' });
  if (!POLL_COUNTRIES.includes(nationality)) return res.status(400).json({ error: 'Nacionalidad no válida' });
  const profile = { age: ageNum, sex, postalCode: String(postalCode).trim().toUpperCase(), nationality, updatedAt: Date.now() };
  pollProfileStore.set(userId, profile);
  savePollProfiles();
  res.json({ success: true, profile });
});

/** GET /poll/history?userId= — encuestas en las que ha votado el usuario */
router.get('/poll/history', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId requerido' });
  const list = [...pollStore.values()]
    .filter(p => (pollVoteStore.get(p.id) || {})[userId])
    .map(p => serializePoll(p, userId))
    .sort((a, b) => b.startsAt - a.startsAt);
  res.json({ polls: list });
});

// ── POLL: endpoints de administración ─────────────────────────────

router.get('/admin/poll/stats', adminAuth, (_req, res) => {
  const all = [...pollStore.values()];
  const byStatus = { draft: 0, scheduled: 0, active: 0, closed: 0 };
  for (const p of all) byStatus[pollStatus(p)]++;
  let totalVotes = 0;
  for (const v of pollVoteStore.values()) totalVotes += Object.keys(v).length;
  res.json({ polls: all.length, ...byStatus, totalVotes, profiles: pollProfileStore.size, categories: pollCatStore.size });
});

router.get('/admin/poll/polls', adminAuth, (_req, res) => {
  const list = [...pollStore.values()].map(p => serializePoll(p, null)).sort((a, b) => b.createdAt - a.createdAt);
  res.json({ polls: list });
});

router.get('/admin/poll/polls/:id', adminAuth, (req, res) => {
  const p = pollStore.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Encuesta no encontrada' });
  res.json({ poll: { ...serializePoll(p, null, { withDemographics: true }), categoryId: p.categoryId } });
});

router.post('/admin/poll/polls', adminAuth, (req, res) => {
  const { data, error } = parsePollInput(req.body);
  if (error) return res.status(400).json({ error });
  const poll = {
    id: `poll_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    ...data, isActive: true, createdAt: Date.now(), updatedAt: Date.now(),
  };
  pollStore.set(poll.id, poll);
  savePolls();
  res.status(201).json({ poll: serializePoll(poll, null) });
});

router.put('/admin/poll/polls/:id', adminAuth, (req, res) => {
  const p = pollStore.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Encuesta no encontrada' });
  const { data, error } = parsePollInput(req.body, p);
  if (error) return res.status(400).json({ error });
  // Si ya hay votos, no permitir cambiar las opciones (falsearía resultados)
  const votes = pollVoteStore.get(p.id) || {};
  const sameOptions = data.options.length === p.options.length && data.options.every((o, i) => o.id === p.options[i].id);
  if (Object.keys(votes).length && !sameOptions)
    return res.status(409).json({ error: 'La encuesta ya tiene votos: no se pueden cambiar las opciones' });
  Object.assign(p, data, { updatedAt: Date.now() });
  pollStore.set(p.id, p);
  savePolls();
  res.json({ poll: serializePoll(p, null) });
});

/** POST /admin/poll/polls/:id/toggle — abrir/cerrar manualmente */
router.post('/admin/poll/polls/:id/toggle', adminAuth, (req, res) => {
  const p = pollStore.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Encuesta no encontrada' });
  if (pollStatus(p) === 'closed') {
    p.isActive = true;
    if (p.endsAt && p.endsAt <= Date.now()) p.endsAt = null; // reabrir quita la fecha de fin vencida
  } else {
    p.isActive = false;
  }
  p.updatedAt = Date.now();
  savePolls();
  res.json({ poll: serializePoll(p, null) });
});

router.delete('/admin/poll/polls/:id', adminAuth, (req, res) => {
  if (!pollStore.delete(req.params.id)) return res.status(404).json({ error: 'Encuesta no encontrada' });
  pollVoteStore.delete(req.params.id);
  savePolls(); savePollVotes();
  res.json({ success: true });
});

router.get('/admin/poll/categories', adminAuth, (_req, res) => {
  const count = {};
  for (const p of pollStore.values()) if (p.categoryId) count[p.categoryId] = (count[p.categoryId] || 0) + 1;
  const list = [...pollCatStore.values()].map(c => ({ ...c, polls: count[c.id] || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  res.json({ categories: list });
});

router.post('/admin/poll/categories', adminAuth, (req, res) => {
  const { name, icon } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const cat = { id: `cat_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
    name: String(name).trim(), slug: slugify(name), icon: icon ? String(icon).trim() : null, createdAt: Date.now() };
  pollCatStore.set(cat.id, cat);
  savePollCats();
  res.status(201).json({ category: cat });
});

router.put('/admin/poll/categories/:id', adminAuth, (req, res) => {
  const c = pollCatStore.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Categoría no encontrada' });
  const { name, icon } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  Object.assign(c, { name: String(name).trim(), slug: slugify(name), icon: icon ? String(icon).trim() : null });
  savePollCats();
  res.json({ category: c });
});

router.delete('/admin/poll/categories/:id', adminAuth, (req, res) => {
  if (!pollCatStore.delete(req.params.id)) return res.status(404).json({ error: 'Categoría no encontrada' });
  let changed = false;
  for (const p of pollStore.values()) if (p.categoryId === req.params.id) { p.categoryId = null; changed = true; }
  savePollCats();
  if (changed) savePolls();
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════
//  KARAOKE — catálogo de canciones (pista instrumental + letra LRC)
// ════════════════════════════════════════════════════════════════
const songRecCount = (songId) => [...karaokeRecStore.values()].filter(r => r.songId === songId).length;
const songSummary = (s) => {
  const g = s.genreId ? karaokeGenreStore.get(s.genreId) : null;
  return {
    id: s.id, title: s.title, artist: s.artist, audioUrl: s.audioUrl, coverUrl: s.coverUrl || null,
    duration: s.duration || 0, lyricsUrl: `/karaoke/songs/${s.id}/lyrics`, createdAt: s.createdAt, updatedAt: s.updatedAt || s.createdAt,
    genre: g ? { id: g.id, name: g.name, icon: g.icon || null } : null,
    published: s.published !== false, featured: !!s.featured,
    recordings: songRecCount(s.id),
  };
};
const isKaraokeBanned = (userId) => karaokeBanStore.has(userId);

const recSummary = (r) => {
  const song = karaokeSongStore.get(r.songId);
  const u = [...userStore.values()].find(x => x.userId === r.userId);
  // Dúos: la parte A abre el dúo; quien se une (parte B) apunta a ella con duetOf
  const first = r.duetOf ? karaokeRecStore.get(r.duetOf) : null;
  const partner = first ? [...userStore.values()].find(x => x.userId === first.userId) : null;
  return {
    id: r.id, userId: r.userId, userName: u?.name || 'Usuario', userAvatar: u?.avatar || null,
    songId: r.songId, songTitle: song?.title || 'Canción', songArtist: song?.artist || '',
    coverUrl: song?.coverUrl || null, audioUrl: r.audioUrl, video: !!r.video, duration: r.duration || 0, createdAt: r.createdAt,
    score: Number.isFinite(r.score) ? r.score : null,
    duetPart: r.duetPart || null, duetOf: r.duetOf || null,
    partnerName: first ? (partner?.name || 'Usuario') : null,
    duetJoins: r.duetPart && !r.duetOf ? [...karaokeRecStore.values()].filter(x => x.duetOf === r.id).length : 0,
  };
};

/**
 * POST /karaoke/upload?userId= — sube la grabación en binario (cuerpo = archivo, Content-Type = su tipo).
 * Las grabaciones con vídeo superan el límite de /upload-file (base64 en JSON, ~10 MB).
 */
const KARAOKE_UPLOAD_EXT = {
  'video/webm': '.webm', 'video/mp4': '.mp4', 'audio/webm': '.webm', 'audio/mp4': '.m4a', 'audio/ogg': '.ogg',
};
router.post('/karaoke/upload', express.raw({ type: () => true, limit: '120mb' }), (req, res) => {
  const userId = req.query.userId;
  if (!userId || !findUserById(userId)) return res.status(401).json({ error: 'Usuario no válido' });
  if (isKaraokeBanned(userId)) return res.status(403).json({ error: 'Tu cuenta no puede usar el karaoke' });
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const ext = KARAOKE_UPLOAD_EXT[type];
  if (!ext) return res.status(415).json({ error: 'Formato de grabación no admitido' });
  if (!Buffer.isBuffer(req.body) || req.body.length < 1000) return res.status(400).json({ error: 'Grabación vacía' });
  const safeName = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
  try {
    fs.writeFileSync(path.join(UPLOADS_DIR, safeName), req.body);
    console.log(`[karaoke/upload] ${safeName} (${req.body.length} bytes)`);
    res.json({ url: `/files/${safeName}`, video: type.startsWith('video/') });
  } catch (err) {
    console.error('[karaoke/upload] Error:', err.message);
    res.status(500).json({ error: 'Error al guardar la grabación' });
  }
});

/**
 * POST /karaoke/recordings — { userId, songId, audioUrl (de /karaoke/upload), video, duration, score,
 *                              duetPart ('A' abre un dúo), duetOf (id del dúo al que se une → parte B) }
 */
router.post('/karaoke/recordings', (req, res) => {
  const { userId, songId, audioUrl, duration, video, score, duetPart, duetOf } = req.body || {};
  if (!userId || !findUserById(userId)) return res.status(401).json({ error: 'Usuario no válido' });
  if (isKaraokeBanned(userId)) return res.status(403).json({ error: 'Tu cuenta no puede usar el karaoke' });
  if (!karaokeSongStore.has(songId)) return res.status(404).json({ error: 'Canción no encontrada' });
  if (!audioUrl || !/^\/files\/[\w.-]+$/.test(audioUrl)) return res.status(400).json({ error: 'Grabación no válida' });
  let duet = {};
  if (duetOf) {
    const first = karaokeRecStore.get(duetOf);
    if (!first || !first.duetPart || first.duetOf) return res.status(404).json({ error: 'Ese dúo ya no existe' });
    if (first.songId !== songId) return res.status(400).json({ error: 'El dúo es de otra canción' });
    duet = { duetOf, duetPart: first.duetPart === 'A' ? 'B' : 'A' };
  } else if (duetPart) {
    if (!['A', 'B'].includes(duetPart)) return res.status(400).json({ error: 'Parte del dúo no válida' });
    duet = { duetPart };
  }
  const n = Number(score);
  const rec = { id: `rec_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`, userId, songId, audioUrl, video: !!video,
                duration: Math.max(0, Number(duration) || 0), createdAt: Date.now(),
                ...(Number.isFinite(n) ? { score: Math.max(0, Math.min(100, Math.round(n))) } : {}), ...duet };
  karaokeRecStore.set(rec.id, rec);
  saveKaraokeRecs();
  res.status(201).json({ recording: recSummary(rec) });
});

/** GET /karaoke/recordings?userId= — grabaciones de un usuario (o las últimas públicas sin userId) */
router.get('/karaoke/recordings', (req, res) => {
  const { userId } = req.query;
  const list = [...karaokeRecStore.values()]
    .filter(r => !userId || r.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 100).map(recSummary);
  res.json({ recordings: list });
});

/** GET /karaoke/duets — dúos abiertos (parte A grabada) a los que cualquiera puede unirse */
router.get('/karaoke/duets', (req, res) => {
  const list = [...karaokeRecStore.values()]
    .filter(r => r.duetPart && !r.duetOf && karaokeSongStore.get(r.songId)?.published !== false)
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 100).map(recSummary);
  res.json({ duets: list });
});

/** GET /karaoke/recordings/:id — una grabación (enlace para compartir) */
router.get('/karaoke/recordings/:id', (req, res) => {
  const r = karaokeRecStore.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Grabación no encontrada' });
  res.json({ recording: recSummary(r) });
});

router.delete('/karaoke/recordings/:id', (req, res) => {
  const r = karaokeRecStore.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Grabación no encontrada' });
  if (r.userId !== req.query.userId) return res.status(403).json({ error: 'Solo puedes borrar tus grabaciones' });
  karaokeRecStore.delete(r.id);
  saveKaraokeRecs();
  try { fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(r.audioUrl))); } catch { /* ya no estaba */ }
  res.json({ success: true });
});

/** GET /karaoke/songs — catálogo para la app */
router.get('/karaoke/songs', (_req, res) => {
  const list = [...karaokeSongStore.values()].filter(s => s.published !== false).map(songSummary)
    .sort((a, b) => a.title.localeCompare(b.title, 'es'));
  res.json({ songs: list });
});

/** GET /karaoke/genres — géneros para filtrar el catálogo en la app */
router.get('/karaoke/genres', (_req, res) => {
  res.json({ genres: [...karaokeGenreStore.values()].sort((a, b) => a.name.localeCompare(b.name, 'es')) });
});

/** GET /karaoke/songs/:id/lyrics — letra sincronizada (formato LRC) */
router.get('/karaoke/songs/:id/lyrics', (req, res) => {
  const s = karaokeSongStore.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Canción no encontrada' });
  res.type('text/plain; charset=utf-8').send(s.lyrics || '');
});

router.get('/admin/karaoke/songs', adminAuth, (_req, res) => {
  res.json({ songs: [...karaokeSongStore.values()].map(s => ({ ...songSummary(s), lines: (s.lyrics || '').split('\n').filter(l => /^\[\d/.test(l)).length })) });
});

/** POST /admin/karaoke/songs — { title, artist, audioUrl (de /upload-file), lyrics (LRC), duration } */
router.post('/admin/karaoke/songs', adminAuth, (req, res) => {
  const { title, artist, audioUrl, coverUrl, lyrics, duration, genreId, published, featured } = req.body || {};
  if (genreId && !karaokeGenreStore.has(genreId)) return res.status(400).json({ error: 'Género no válido' });
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'El título es obligatorio' });
  if (!audioUrl || !/^\/files\/[\w.-]+$/.test(audioUrl)) return res.status(400).json({ error: 'Sube la pista de audio' });
  if (coverUrl && !/^\/files\/[\w.-]+$/.test(coverUrl)) return res.status(400).json({ error: 'Portada no válida' });
  const lrc = String(lyrics || '').replace(/\r/g, '');
  if (!/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/.test(lrc)) return res.status(400).json({ error: 'La letra debe estar en formato LRC: [mm:ss.xx] texto' });
  const song = {
    id: `song_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
    title: String(title).trim().slice(0, 80), artist: String(artist || '').trim().slice(0, 60),
    audioUrl, coverUrl: coverUrl || null, lyrics: lrc.slice(0, 50000), duration: Math.max(0, Number(duration) || 0), createdAt: Date.now(),
    genreId: genreId || null, published: published !== false, featured: !!featured,
  };
  karaokeSongStore.set(song.id, song);
  saveKaraokeSongs();
  res.status(201).json({ song: songSummary(song) });
});

router.delete('/admin/karaoke/songs/:id', adminAuth, (req, res) => {
  const s = karaokeSongStore.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Canción no encontrada' });
  karaokeSongStore.delete(s.id);
  saveKaraokeSongs();
  // Borrar el archivo de audio si ninguna otra canción lo usa
  if (![...karaokeSongStore.values()].some(o => o.audioUrl === s.audioUrl)) {
    try { fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(s.audioUrl))); } catch { /* ya no estaba */ }
  }
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════
//  KARAOKE — SUPERADMINISTRADOR (CRUD completo, requiere adminAuth)
// ════════════════════════════════════════════════════════════════
const FILE_URL_RE = /^\/files\/[\w.-]+$/;

/** Borra un archivo subido si ya no lo usa ninguna canción ni grabación */
function removeUploadIfUnused(url) {
  if (!url || !FILE_URL_RE.test(url)) return;
  const used = [...karaokeSongStore.values()].some(s => s.audioUrl === url || s.coverUrl === url)
            || [...karaokeRecStore.values()].some(r => r.audioUrl === url);
  if (!used) { try { fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(url))); } catch { /* no estaba */ } }
}

/** Llamada al servidor RTC (salas en vivo) con el secreto interno */
async function rtcAdmin(method, p, body) {
  const url = process.env.RTC_INTERNAL_URL, secret = process.env.RTC_SECRET;
  if (!url || !secret) throw new Error('Servidor RTC no configurado');
  const r = await fetch(`${url}/rtc/internal/karaoke${p}`, {
    method, headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Error del servidor RTC');
  return d;
}

const userLabel = (userId) => {
  const u = findUserById(userId);
  return { userId, name: u?.name || userId, phone: u?.phone || null };
};

router.get('/admin/karaoke/stats', adminAuth, async (_req, res) => {
  const songs = [...karaokeSongStore.values()];
  const recs = [...karaokeRecStore.values()];
  let rooms = [];
  try { rooms = (await rtcAdmin('GET', '/rooms')).rooms || []; } catch { /* RTC caído: sin salas */ }
  const top = songs.map(s => ({ id: s.id, title: s.title, artist: s.artist, recordings: songRecCount(s.id) }))
    .sort((a, b) => b.recordings - a.recordings).slice(0, 5);
  const weekAgo = Date.now() - 7 * 86400000;
  res.json({
    songs: songs.length, published: songs.filter(s => s.published !== false).length,
    featured: songs.filter(s => s.featured).length, genres: karaokeGenreStore.size,
    recordings: recs.length, recordingsWeek: recs.filter(r => r.createdAt > weekAgo).length,
    singers: new Set(recs.map(r => r.userId)).size,
    rooms: rooms.length, listeners: rooms.reduce((n, r) => n + (r.listeners || 0), 0),
    bans: karaokeBanStore.size, top,
  });
});

/** GET /admin/karaoke/songs/:id — canción completa (con letra) para editar */
router.get('/admin/karaoke/songs/:id', adminAuth, (req, res) => {
  const s = karaokeSongStore.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Canción no encontrada' });
  res.json({ song: { ...songSummary(s), genreId: s.genreId || null, lyrics: s.lyrics || '' } });
});

/** PUT /admin/karaoke/songs/:id — edición parcial de cualquier campo (incluye reemplazar pista/portada) */
router.put('/admin/karaoke/songs/:id', adminAuth, (req, res) => {
  const s = karaokeSongStore.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Canción no encontrada' });
  const b = req.body || {};
  if (b.title !== undefined) {
    if (!String(b.title).trim()) return res.status(400).json({ error: 'El título es obligatorio' });
    s.title = String(b.title).trim().slice(0, 80);
  }
  if (b.artist !== undefined) s.artist = String(b.artist || '').trim().slice(0, 60);
  if (b.genreId !== undefined) {
    if (b.genreId && !karaokeGenreStore.has(b.genreId)) return res.status(400).json({ error: 'Género no válido' });
    s.genreId = b.genreId || null;
  }
  if (b.published !== undefined) s.published = !!b.published;
  if (b.featured !== undefined) s.featured = !!b.featured;
  if (b.duration !== undefined) s.duration = Math.max(0, Number(b.duration) || 0);
  if (b.lyrics !== undefined) {
    const lrc = String(b.lyrics || '').replace(/\r/g, '');
    if (!/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/.test(lrc)) return res.status(400).json({ error: 'La letra debe estar en formato LRC: [mm:ss.xx] texto' });
    s.lyrics = lrc.slice(0, 50000);
  }
  const oldFiles = [];
  if (b.audioUrl !== undefined && b.audioUrl !== s.audioUrl) {
    if (!FILE_URL_RE.test(b.audioUrl || '')) return res.status(400).json({ error: 'Pista de audio no válida' });
    oldFiles.push(s.audioUrl); s.audioUrl = b.audioUrl;
  }
  if (b.coverUrl !== undefined && b.coverUrl !== s.coverUrl) {
    if (b.coverUrl && !FILE_URL_RE.test(b.coverUrl)) return res.status(400).json({ error: 'Portada no válida' });
    oldFiles.push(s.coverUrl); s.coverUrl = b.coverUrl || null;
  }
  s.updatedAt = Date.now();
  saveKaraokeSongs();
  oldFiles.forEach(removeUploadIfUnused);
  res.json({ song: songSummary(s) });
});

// ── Géneros ──
router.get('/admin/karaoke/genres', adminAuth, (_req, res) => {
  const count = {};
  for (const s of karaokeSongStore.values()) if (s.genreId) count[s.genreId] = (count[s.genreId] || 0) + 1;
  res.json({ genres: [...karaokeGenreStore.values()].map(g => ({ ...g, songs: count[g.id] || 0 })).sort((a, b) => a.name.localeCompare(b.name, 'es')) });
});
router.post('/admin/karaoke/genres', adminAuth, (req, res) => {
  const { name, icon } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const g = { id: `gen_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`, name: String(name).trim().slice(0, 40), icon: icon ? String(icon).trim().slice(0, 8) : null, createdAt: Date.now() };
  karaokeGenreStore.set(g.id, g); saveKaraokeGenres();
  res.status(201).json({ genre: g });
});
router.put('/admin/karaoke/genres/:id', adminAuth, (req, res) => {
  const g = karaokeGenreStore.get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Género no encontrado' });
  const { name, icon } = req.body || {};
  if (name !== undefined) { if (!String(name).trim()) return res.status(400).json({ error: 'El nombre es obligatorio' }); g.name = String(name).trim().slice(0, 40); }
  if (icon !== undefined) g.icon = icon ? String(icon).trim().slice(0, 8) : null;
  saveKaraokeGenres();
  res.json({ genre: g });
});
router.delete('/admin/karaoke/genres/:id', adminAuth, (req, res) => {
  if (!karaokeGenreStore.delete(req.params.id)) return res.status(404).json({ error: 'Género no encontrado' });
  let changed = false;
  for (const s of karaokeSongStore.values()) if (s.genreId === req.params.id) { s.genreId = null; changed = true; }
  saveKaraokeGenres(); if (changed) saveKaraokeSongs();
  res.json({ success: true });
});

// ── Grabaciones (todas) ──
router.get('/admin/karaoke/recordings', adminAuth, (req, res) => {
  const { userId, songId } = req.query;
  const list = [...karaokeRecStore.values()]
    .filter(r => (!userId || r.userId === userId) && (!songId || r.songId === songId))
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 500)
    .map(r => ({ ...recSummary(r), userPhone: findUserById(r.userId)?.phone || null }));
  res.json({ recordings: list });
});
router.delete('/admin/karaoke/recordings/:id', adminAuth, (req, res) => {
  const r = karaokeRecStore.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Grabación no encontrada' });
  karaokeRecStore.delete(r.id); saveKaraokeRecs();
  removeUploadIfUnused(r.audioUrl);
  res.json({ success: true });
});

// ── Salas en vivo (control remoto del servidor RTC) ──
router.get('/admin/karaoke/rooms', adminAuth, async (_req, res) => {
  try { res.json(await rtcAdmin('GET', '/rooms')); } catch (e) { res.status(502).json({ error: e.message }); }
});
router.post('/admin/karaoke/rooms/:id/close', adminAuth, async (req, res) => {
  try { res.json(await rtcAdmin('POST', `/${encodeURIComponent(req.params.id)}/close`)); } catch (e) { res.status(502).json({ error: e.message }); }
});
router.post('/admin/karaoke/rooms/:id/skip', adminAuth, async (req, res) => {
  try { res.json(await rtcAdmin('POST', `/${encodeURIComponent(req.params.id)}/skip`)); } catch (e) { res.status(502).json({ error: e.message }); }
});
router.delete('/admin/karaoke/rooms/:id/queue/:entryId', adminAuth, async (req, res) => {
  try { res.json(await rtcAdmin('POST', `/${encodeURIComponent(req.params.id)}/unqueue`, { entryId: req.params.entryId })); } catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Bloqueos ──
router.get('/admin/karaoke/bans', adminAuth, (_req, res) => {
  res.json({ bans: [...karaokeBanStore.entries()].map(([userId, b]) => ({ ...userLabel(userId), ...b })).sort((a, b) => b.at - a.at) });
});
router.post('/admin/karaoke/bans', adminAuth, async (req, res) => {
  const { userId, reason } = req.body || {};
  if (!userId || !findUserById(userId)) return res.status(404).json({ error: 'Usuario no encontrado' });
  karaokeBanStore.set(userId, { reason: String(reason || '').trim().slice(0, 200), at: Date.now() });
  saveKaraokeBans();
  rtcAdmin('POST', '/bans', { userIds: [...karaokeBanStore.keys()] }).catch(() => {});
  res.status(201).json({ ban: { ...userLabel(userId), ...karaokeBanStore.get(userId) } });
});
router.delete('/admin/karaoke/bans/:userId', adminAuth, (req, res) => {
  if (!karaokeBanStore.delete(req.params.userId)) return res.status(404).json({ error: 'Ese usuario no está bloqueado' });
  saveKaraokeBans();
  rtcAdmin('POST', '/bans', { userIds: [...karaokeBanStore.keys()] }).catch(() => {});
  res.json({ success: true });
});

/** Servidor RTC → backend: lista de bloqueados al arrancar (secreto interno) */
router.get('/internal/karaoke/bans', (req, res) => {
  const hdr = req.get('x-internal-secret') || '';
  const secret = process.env.RTC_SECRET || '';
  if (!secret || hdr.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(hdr), Buffer.from(secret)))
    return res.status(401).json({ error: 'unauthorized' });
  res.json({ userIds: [...karaokeBanStore.keys()] });
});

/** Servicios propios (taxi) → backend: enviar un aviso push a un usuario de OldFace (secreto interno) */
router.post('/internal/push', async (req, res) => {
  const hdr = req.get('x-internal-secret') || '';
  const secret = process.env.RTC_SECRET || '';
  if (!secret || hdr.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(hdr), Buffer.from(secret)))
    return res.status(401).json({ error: 'unauthorized' });
  const { userId, title, body, data, dataOnly } = req.body || {};
  const uid = String(userId || '');
  if (!fcmTokensOf(uid).length) return res.json({ success: false, reason: 'sin token FCM' });
  // Solo datos (ofertas de viaje del taxi): la app nativa muestra la pantalla "Nuevo servicio" aunque esté cerrada
  if (dataOnly) {
    await dataToUser(uid, data && typeof data === 'object' ? data : {}, 60000);
    return res.json({ success: true });
  }
  await pushToUser(uid, String(title || 'OldFace').slice(0, 120), String(body || '').slice(0, 300),
                   data && typeof data === 'object' ? data : {});
  res.json({ success: true });
});

// ── Android App Links: los enlaces https://oldface.app/directo/... abren la app instalada ──
// Huellas SHA-256 de los certificados con que se firma el APK. La primera es la clave de
// depuración con la que se compilan ahora los APK de prueba; para la versión de Play Store
// añadir su huella en .env: ANDROID_CERT_SHA256=AA:BB:...,CC:DD:...
// (express.static ignora las carpetas que empiezan por punto, por eso va como ruta explícita)
const ANDROID_CERTS = [
  'F2:86:7F:C0:C7:7E:F1:4D:B7:E1:A5:86:45:10:D6:95:88:0D:40:7F:0D:FE:53:AE:0D:1B:F1:8B:7A:50:18:48',
  ...String(process.env.ANDROID_CERT_SHA256 || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
];
app.get('/.well-known/assetlinks.json', (_req, res) => {
  res.json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: 'com.oldface.app', sha256_cert_fingerprints: [...new Set(ANDROID_CERTS)] },
  }]);
});

// ── Montar router ─────────────────────────────────────────────────
app.use('/api', router);
app.use('/', router);

// ── Estático + fallback ───────────────────────────────────────────
const distPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(distPath));
app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));

app.use((err, _req, res, _next) => {
  console.error('❌', err.message);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 OldFace Backend en http://0.0.0.0:${PORT}`);
  console.log(`📞 Servidor RTC propio: ${process.env.RTC_SECRET ? '✅' : '⚠️  RTC_SECRET no configurado'}`);
  console.log(`📱 Twilio: ${process.env.TWILIO_ACCOUNT_SID ? '✅' : '⚠️  modo desarrollo (OTP en logs)'}`);
  console.log(`💾 Datos en: ${DATA_DIR}`);
  console.log(`📡 Health: http://localhost:${PORT}/health\n`);
});

module.exports = app;
