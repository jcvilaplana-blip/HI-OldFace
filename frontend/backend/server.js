/**
 * OldFace Backend — Tokens ZEGOCLOUD + Autenticación OTP por SMS
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

// Convertir a Map (operaciones en memoria, persistimos después de cada escritura)
const userStore    = new Map(Object.entries(_users));
const chatStore2   = new Map(Object.entries(_chats));
const messageStore = new Map(Object.entries(_messages));
const directoStore = new Map(Object.entries(_directos));
const fcmStore     = new Map(Object.entries(_fcm));     // userId → fcmToken
const callLogStore = new Map(Object.entries(_callLog)); // userId → [calls]
let   storiesList  = Array.isArray(_stories) ? _stories : []; // array plano de stories
const groupStore   = new Map(Object.entries(_groups));  // groupId → group
const subStore     = new Map(Object.entries(_subs));    // userId → { plan, since }
const pollStore        = new Map(Object.entries(_polls));        // pollId → poll
const pollVoteStore    = new Map(Object.entries(_pollVotes));    // pollId → { userId: optionId }
const pollCatStore     = new Map(Object.entries(_pollCats));     // categoryId → category
const pollProfileStore = new Map(Object.entries(_pollProfiles)); // userId → { age, sex, postalCode, nationality }

const saveUsers    = () => saveJSON('users.json',    Object.fromEntries(userStore));
const saveChats    = () => saveJSON('chats.json',    Object.fromEntries(chatStore2));
const saveMessages = () => saveJSON('messages.json', Object.fromEntries(messageStore));
const saveDirectos = () => saveJSON('directos.json', Object.fromEntries(directoStore));
const saveFcm      = () => saveJSON('fcm_tokens.json', Object.fromEntries(fcmStore));
const saveCallLog  = () => saveJSON('call_log.json',  Object.fromEntries(callLogStore));
const saveStories  = () => saveJSON('stories.json',   storiesList);
const saveGroups   = () => saveJSON('groups.json',    Object.fromEntries(groupStore));
const saveSubs     = () => saveJSON('subscriptions.json', Object.fromEntries(subStore));
const savePolls        = () => saveJSON('poll_polls.json',      Object.fromEntries(pollStore));
const savePollVotes    = () => saveJSON('poll_votes.json',      Object.fromEntries(pollVoteStore));
const savePollCats     = () => saveJSON('poll_categories.json', Object.fromEntries(pollCatStore));
const savePollProfiles = () => saveJSON('poll_profiles.json',   Object.fromEntries(pollProfileStore));

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
const rateMap = new Map();
function rateLimit(ip, max = 60, windowMs = 60_000) {
  const now = Date.now();
  const entry = rateMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
  entry.count++;
  rateMap.set(ip, entry);
  return entry.count > max;
}
app.use((req, res, next) => {
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
//  ZEGOCLOUD Token04 — Formato exacto del SDK oficial (generateKitTokenForTest)
// ════════════════════════════════════════════════════════════════
function generateToken04(appId, userId, serverSecret, effectiveSeconds = 86400) {
  const now      = Math.floor(Date.now() / 1000);
  const expireAt = now + effectiveSeconds;
  const nonce    = Math.floor(Math.random() * 2_147_483_647);

  const tokenData = {
    app_id: appId, user_id: userId, nonce, ctime: now, expire: expireAt,
  };

  // IV: 16 dígitos de Math.random() (igual que generateKitTokenForTest)
  let iv = Math.random().toString().substring(2, 18);
  if (iv.length < 16) iv += iv.substring(0, 16 - iv.length);
  const ivBuf = Buffer.from(iv, 'utf8'); // 16 bytes ASCII

  // AES-256-CBC con serverSecret COMPLETO (32 bytes = 256-bit)
  const key    = Buffer.from(serverSecret, 'utf8'); // 32 bytes
  const cipher = crypto.createCipheriv('aes-256-cbc', key, ivBuf);
  cipher.setAutoPadding(true);
  const cipherText = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(tokenData), 'utf8')),
    cipher.final(),
  ]);

  // Buffer con length-prefixes (formato oficial):
  // [0:4] zeros | [4:8] expire int32BE | [8:10] IV_len | [10:26] IV | [26:28] cipher_len | [28:...] cipher
  const buf = Buffer.alloc(28 + cipherText.length);
  buf.writeInt32BE(expireAt, 4);
  buf[8] = ivBuf.length >> 8;
  buf[9] = ivBuf.length & 0xFF;
  ivBuf.copy(buf, 10);
  buf[26] = cipherText.length >> 8;
  buf[27] = cipherText.length & 0xFF;
  cipherText.copy(buf, 28);

  return '04' + buf.toString('base64');
}

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
async function sendFCMPush(fcmToken, title, body, data = {}, channelId = 'oldface_messages') {
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
          sound:     'message_sound',
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
      for (const [uid, tok] of fcmStore.entries()) {
        if (tok === fcmToken) { fcmStore.delete(uid); saveFcm(); break; }
      }
    } else {
      console.warn('[FCM] sendFCMPush error:', e.message);
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
  const { phone, code, name } = req.body || {};
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

  console.log(`✅ Usuario verificado: ${userData.name} (${normalizedPhone})`);
  return res.json({ success: true, verified: true, userId, user: userData, rtcToken: signRtcToken(userId) });
});

/**
 * GET /config?userId= — configuración en tiempo de ejecución para la app.
 * rtcSignaling: 'oldface' (servidor RTC propio, por defecto) | 'zim' (ZEGOCLOUD, solo si RTC_SIGNALING=zim).
 * OldFace ya no depende de ZEGOCLOUD: el servidor propio es el sistema por defecto.
 */
router.get('/config', (_req, res) => {
  const rtcEnabled = !!process.env.RTC_SECRET;
  const signaling = rtcEnabled && process.env.RTC_SIGNALING !== 'zim' ? 'oldface' : 'zim';
  res.json({ rtcSignaling: signaling });
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

/** POST /rtc-token — token para el servidor RTC (sesiones iniciadas antes de existir rtcToken) */
router.post('/rtc-token', (req, res) => {
  const { userId } = req.body || {};
  if (!userId || ![...userStore.values()].some(u => u.userId === userId))
    return res.status(404).json({ error: 'Usuario no encontrado' });
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
//  ZEGOCLOUD Tokens
// ════════════════════════════════════════════════════════════════

/** POST /generate-token */
router.post('/generate-token', (req, res) => {
  const { userId, roomId = '' } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId es requerido' });

  const appId        = parseInt(process.env.ZEGOCLOUD_APP_ID);
  const serverSecret = process.env.ZEGOCLOUD_SERVER_SECRET;
  if (!appId || !serverSecret) return res.status(500).json({ error: 'Credenciales ZEGOCLOUD no configuradas' });

  try {
    const token    = generateToken04(appId, userId.trim(), serverSecret, 86400);
    const expireAt = Math.floor(Date.now() / 1000) + 86400;
    return res.json({ token, userId, appId, expireTime: expireAt });
  } catch (err) {
    return res.status(500).json({ error: 'Error generando token' });
  }
});

/** POST /generate-room-token */
router.post('/generate-room-token', (req, res) => {
  const { userId, roomId } = req.body || {};
  if (!userId || !roomId) return res.status(400).json({ error: 'userId y roomId son requeridos' });

  const appId        = parseInt(process.env.ZEGOCLOUD_APP_ID);
  const serverSecret = process.env.ZEGOCLOUD_SERVER_SECRET;
  try {
    const token    = generateToken04(appId, userId, serverSecret, 86400);
    const expireAt = Math.floor(Date.now() / 1000) + 86400;
    return res.json({ token, userId, roomId, appId, expireTime: expireAt });
  } catch (err) {
    return res.status(500).json({ error: 'Error generando token' });
  }
});

// ════════════════════════════════════════════════════════════════
//  FCM Token Registration
// ════════════════════════════════════════════════════════════════

/** POST /register-fcm-token — Guarda el token FCM del dispositivo para un usuario */
router.post('/register-fcm-token', (req, res) => {
  const { userId, token } = req.body || {};
  if (!userId || !token) return res.status(400).json({ error: 'userId y token son requeridos' });
  fcmStore.set(userId, token);
  saveFcm();
  return res.json({ success: true });
});

/** POST /call-notification — Envía FCM push al destinatario cuando se inicia una llamada */
router.post('/call-notification', async (req, res) => {
  const { calleeId, callerId, callerName, callType, roomId } = req.body || {};
  if (!calleeId || !callerId) return res.status(400).json({ error: 'calleeId y callerId son requeridos' });
  const media = req.body?.media === 'zego' ? 'zego' : 'oldface'; // motor de audio/vídeo (por defecto el propio)

  // Si el destinatario tiene la app abierta con el servidor RTC, recibe la invitación al instante
  rtcEmit(calleeId, 'signal', {
    from: callerId, fromName: callerName || callerId, type: 'call_invite', ts: Date.now(),
    payload: { callType: callType || 'voice', callerName: callerName || callerId, roomId: roomId || null, media },
  });

  const fcmToken = fcmStore.get(calleeId);
  if (!fcmToken) return res.json({ success: false, reason: 'sin token FCM para el destinatario' });

  const isVideo   = callType === 'video';
  const title     = isVideo ? `📹 Videollamada de ${callerName || callerId}` : `📞 Llamada de ${callerName || callerId}`;
  const body      = isVideo ? 'Videollamada entrante — toca para responder' : 'Llamada entrante — toca para responder';

  try {
    await sendFCMPush(fcmToken, title, body, {
      type:       'call',
      callType:   callType || 'voice',
      callerId,
      callerName: callerName || callerId,
      roomId:     roomId    || '',
      ts:         Date.now(), // la app descarta notificaciones de llamadas ya caducadas
      media,
    }, 'oldface_calls');
    return res.json({ success: true });
  } catch (e) {
    return res.json({ success: false, reason: e.message });
  }
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
        return { ...c, memberNames: enriched };
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

/** GET /files/:filename — sirve archivos subidos por los usuarios */
router.get('/files/:filename', (req, res) => {
  const safeName = path.basename(req.params.filename); // evita path traversal
  const filePath = path.join(UPLOADS_DIR, safeName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado' });
  res.sendFile(filePath);
});

/** GET /messages/:chatId */
router.get('/messages/:chatId', (req, res) => {
  return res.json({ messages: messageStore.get(req.params.chatId) || [] });
});

/** DELETE /messages/:chatId/:messageId — elimina un mensaje concreto */
router.delete('/messages/:chatId/:messageId', (req, res) => {
  const { chatId, messageId } = req.params;
  if (!chatId || !messageId) return res.status(400).json({ error: 'chatId y messageId requeridos' });
  const msgs = messageStore.get(chatId) || [];
  const idx  = msgs.findIndex(m => m.id === messageId);
  if (idx === -1) return res.status(404).json({ error: 'Mensaje no encontrado' });
  msgs.splice(idx, 1);
  messageStore.set(chatId, msgs);
  saveMessages();
  return res.json({ ok: true });
});

/** POST /messages */
router.post('/messages', async (req, res) => {
  const { chatId, senderId, text, type = 'text', url, replyTo, fileName } = req.body || {};
  if (!chatId || !senderId || !text) return res.status(400).json({ error: 'chatId, senderId y text son requeridos' });

  const msg = {
    id:        `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    chatId, senderId, text, type, url: url || null,
    replyTo:   replyTo || null,
    fileName:  fileName || null,
    time:      new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }),
    createdAt: Date.now(),
  };

  const list = messageStore.get(chatId) || [];
  list.push(msg);
  messageStore.set(chatId, list);
  saveMessages();

  if (chatStore2.has(chatId)) {
    const c = chatStore2.get(chatId);
    c.lastMessage = type === 'audio' ? '🎤 Nota de voz' : type === 'location' ? '📍 Ubicación' : text;
    c.lastTime = Date.now();
    chatStore2.set(chatId, c);
    saveChats();
  }

  // ── Entrega en tiempo real por el servidor RTC propio (sustituye a ZIM) ──
  const senderUser = [...userStore.values()].find(u => u.userId === senderId);
  const rtcRecipients = chatStore2.get(chatId)?.participants
    || chatId.replace(/^chat_/, '').split(/_(?=user_)/);
  for (const to of rtcRecipients) {
    if (to && to !== senderId) rtcEmit(to, 'chat:message', { ...msg, senderName: senderUser?.name || null });
  }

  // ── Enviar push FCM al destinatario ─────────────────────────────────────
  // chatId tiene formato: chat_userA_userB — extraer el ID que no es el remitente
  try {
    const withoutPrefix = chatId.replace(/^chat_/, '');
    const parts = withoutPrefix.split(/_(?=user_)/);
    const recipientId = parts.find(p => p !== senderId);
    if (recipientId) {
      const fcmToken = fcmStore.get(recipientId);
      if (fcmToken) {
        // Buscar el nombre del remitente
        let senderName = 'OldFace';
        for (const u of userStore.values()) {
          if (u.userId === senderId) { senderName = u.name; break; }
        }
        const notifBody = type === 'audio' ? '🎤 Te ha enviado una nota de voz'
                        : type === 'location' ? '📍 Te ha enviado su ubicación'
                        : text.length > 80 ? text.slice(0, 80) + '…' : text;
        // No await — responder al cliente sin esperar el push
        sendFCMPush(fcmToken, senderName, notifBody, { chatId, senderId }).catch(() => {});
      }
    }
  } catch { /* no bloquear la respuesta si falla el push */ }

  return res.json(msg);
});

// ════════════════════════════════════════════════════════════════
//  PRESENCIA (online / última vez)
// ════════════════════════════════════════════════════════════════

/** POST /presence — actualiza el lastSeen del usuario (heartbeat cada 30s) */
router.post('/presence', (req, res) => {
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId requerido' });
  for (const [phone, u] of userStore.entries()) {
    if (u.userId === userId) { u.lastSeen = Date.now(); userStore.set(phone, u); break; }
  }
  return res.json({ success: true });
});

/** GET /presence/:userId — devuelve online + lastSeen del usuario */
router.get('/presence/:userId', (req, res) => {
  const { userId } = req.params;
  for (const u of userStore.values()) {
    if (u.userId === userId) {
      const lastSeen = u.lastSeen || u.lastLogin || 0;
      const online   = Date.now() - lastSeen < 2 * 60 * 1000; // 2 min
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
  if (changed) { messageStore.set(chatId, msgs); saveMessages(); }
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════
//  ESTADOS (STORIES) — 24 horas
// ════════════════════════════════════════════════════════════════

/** GET /stories — devuelve los estados activos (no expirados) */
router.get('/stories', (_req, res) => {
  const now     = Date.now();
  const active  = storiesList.filter(s => s.expiresAt > now);
  // Limpiar expirados en memoria
  if (active.length !== storiesList.length) { storiesList = active; saveStories(); }
  return res.json({ stories: active });
});

/** POST /stories — crea un nuevo estado */
router.post('/stories', (req, res) => {
  const { userId, userName, mediaType, content, bgColor } = req.body || {};
  if (!userId || !content) return res.status(400).json({ error: 'userId y content requeridos' });
  const story = {
    id:        `story_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    userId, userName: userName || userId,
    mediaType: mediaType || 'text',
    content,
    bgColor:   bgColor || '#000080',
    createdAt: Date.now(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    viewers:   [],
  };
  storiesList.unshift(story);
  saveStories();
  return res.status(201).json(story);
});

/** POST /stories/:storyId/view — registra que un usuario vio un estado */
router.post('/stories/:storyId/view', (req, res) => {
  const { viewerId } = req.body || {};
  const story = storiesList.find(s => s.id === req.params.storyId);
  if (story && viewerId && !story.viewers.includes(viewerId)) {
    story.viewers.push(viewerId);
    saveStories();
  }
  return res.json({ success: true });
});

/** DELETE /stories/:storyId — elimina un estado (solo el creador) */
router.delete('/stories/:storyId', (req, res) => {
  const { userId } = req.body || {};
  const idx = storiesList.findIndex(s => s.id === req.params.storyId && s.userId === userId);
  if (idx === -1) return res.status(404).json({ error: 'Estado no encontrado o sin permisos' });
  storiesList.splice(idx, 1);
  saveStories();
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════
//  GRUPOS
// ════════════════════════════════════════════════════════════════

/** GET /groups?userId= — grupos en los que participa el usuario */
router.get('/groups', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId requerido' });
  const userGroups = [...groupStore.values()]
    .filter(g => g.members.includes(userId))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return res.json({ groups: userGroups });
});

/** POST /groups — crea un grupo nuevo */
router.post('/groups', (req, res) => {
  const { adminId, name, members } = req.body || {};
  if (!adminId || !name || !Array.isArray(members) || members.length < 1)
    return res.status(400).json({ error: 'adminId, name y members[] son requeridos' });

  const allMembers = [...new Set([adminId, ...members])];
  // Buscar nombres de los miembros
  const memberNames = {};
  for (const u of userStore.values()) {
    if (allMembers.includes(u.userId)) memberNames[u.userId] = u.name;
  }

  const group = {
    id:          `group_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    adminId,
    members:     allMembers,
    memberNames,
    avatar:      null,
    createdAt:   Date.now(),
    updatedAt:   Date.now(),
    lastMessage: '',
    lastTime:    Date.now(),
  };
  groupStore.set(group.id, group);
  saveGroups();

  // Crear el chat del grupo en chatStore2 para unificar la lectura de mensajes
  const chatId = `group_${group.id}`;
  if (!chatStore2.has(chatId)) {
    chatStore2.set(chatId, {
      id: chatId, participants: allMembers, name,
      isGroup: true, groupId: group.id,
      createdAt: Date.now(), lastMessage: '', lastTime: Date.now(),
    });
    saveChats();
  }

  return res.status(201).json(group);
});

/** PUT /groups/:groupId — actualiza nombre/avatar del grupo */
router.put('/groups/:groupId', (req, res) => {
  const g = groupStore.get(req.params.groupId);
  if (!g) return res.status(404).json({ error: 'Grupo no encontrado' });
  const { name, avatar } = req.body || {};
  if (name)   g.name   = name;
  if (avatar) g.avatar = avatar;
  g.updatedAt = Date.now();
  groupStore.set(g.id, g);
  saveGroups();
  return res.json(g);
});

/** POST /groups/:groupId/members — añade miembro al grupo */
router.post('/groups/:groupId/members', (req, res) => {
  const g = groupStore.get(req.params.groupId);
  if (!g) return res.status(404).json({ error: 'Grupo no encontrado' });
  const { userId, adminId } = req.body || {};
  if (g.adminId !== adminId) return res.status(403).json({ error: 'Solo el admin puede añadir miembros' });
  if (!g.members.includes(userId)) {
    g.members.push(userId);
    const u = [...userStore.values()].find(u => u.userId === userId);
    if (u) g.memberNames[userId] = u.name;
    g.updatedAt = Date.now();
    groupStore.set(g.id, g);
    saveGroups();
    // Actualizar chat participantes
    const chatId = `group_${g.id}`;
    const chat = chatStore2.get(chatId);
    if (chat) { chat.participants = g.members; chatStore2.set(chatId, chat); saveChats(); }
  }
  return res.json(g);
});

/** DELETE /groups/:groupId/members/:userId — sale o expulsa a un miembro */
router.delete('/groups/:groupId/members/:userId', (req, res) => {
  const g = groupStore.get(req.params.groupId);
  if (!g) return res.status(404).json({ error: 'Grupo no encontrado' });
  const { requesterId } = req.body || {};
  const targetId = req.params.userId;
  if (targetId !== requesterId && g.adminId !== requesterId)
    return res.status(403).json({ error: 'Sin permisos' });
  g.members = g.members.filter(m => m !== targetId);
  delete g.memberNames[targetId];
  g.updatedAt = Date.now();
  groupStore.set(g.id, g);
  saveGroups();
  return res.json({ success: true });
});

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
    const token = fcmStore.get(u.userId);
    if (token) {
      sendFCMPush(token, `🔴 ${hostName} está en directo`, d.title || 'Toca para verlo',
        { type: 'live', directoId: d.id }).catch(() => {});
    }
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
const ADMIN_EMAIL    = 'williamduarte0412@gmail.com';
const ADMIN_PASSWORD = 'DeqntvOF2001*';
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
  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD)
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
//  POLL — encuestas integradas (antes poll.fullstark.es)
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
  console.log(`🔑 ZEGOCLOUD APP_ID: ${process.env.ZEGOCLOUD_APP_ID || '⚠️  NO configurado'}`);
  console.log(`📱 Twilio: ${process.env.TWILIO_ACCOUNT_SID ? '✅' : '⚠️  modo desarrollo (OTP en logs)'}`);
  console.log(`💾 Datos en: ${DATA_DIR}`);
  console.log(`📡 Health: http://localhost:${PORT}/health\n`);
});

module.exports = app;
