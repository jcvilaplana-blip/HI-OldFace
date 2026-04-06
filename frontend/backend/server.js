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
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

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

// Convertir a Map (operaciones en memoria, persistimos después de cada escritura)
const userStore    = new Map(Object.entries(_users));
const chatStore2   = new Map(Object.entries(_chats));
const messageStore = new Map(Object.entries(_messages));
const directoStore = new Map(Object.entries(_directos));
const fcmStore     = new Map(Object.entries(_fcm)); // userId → fcmToken

const saveUsers    = () => saveJSON('users.json',    Object.fromEntries(userStore));
const saveChats    = () => saveJSON('chats.json',    Object.fromEntries(chatStore2));
const saveMessages = () => saveJSON('messages.json', Object.fromEntries(messageStore));
const saveDirectos = () => saveJSON('directos.json', Object.fromEntries(directoStore));
const saveFcm      = () => saveJSON('fcm_tokens.json', Object.fromEntries(fcmStore));

console.log(`[DB] Usuarios: ${userStore.size} | Chats: ${chatStore2.size} | Directos: ${directoStore.size}`);

// ── CORS ──────────────────────────────────────────────────────────
app.use(cors({
  origin: (_origin, cb) => cb(null, true),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.options('*', cors());
app.use(express.json({ limit: '1mb' }));

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
async function sendFCMPush(fcmToken, title, body, data = {}) {
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
          sound:     'default',
          channelId: 'oldface_messages',
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

  if (smtpUser && smtpPass && toEmail) {
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
      return res.status(500).json({ error: 'Error enviando email. Comprueba la dirección.' });
    }
  }

  // Fallback: modo desarrollo — OTP en logs
  otpStore.set(normalizedPhone, {
    code, expiry, attempts: 0,
    sendCount: (existing?.sendCount || 0) + 1,
    firstSent: existing?.firstSent || Date.now(),
  });
  console.log(`\n🔑 OTP para ${normalizedPhone}: ${code} (modo desarrollo)\n`);
  return res.json({ success: true, message: 'Código enviado', channel: 'dev' });
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
    name: name?.trim() || existingUser?.name || 'Usuario',
    phone: normalizedPhone,
    registeredAt: existingUser?.registeredAt || Date.now(),
    lastLogin: Date.now(),
  };

  userStore.set(normalizedPhone, userData);
  saveUsers(); // ← persistir en disco

  console.log(`✅ Usuario verificado: ${userData.name} (${normalizedPhone})`);
  return res.json({ success: true, verified: true, userId, user: userData });
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
  return res.json(chatStore2.get(chatId));
});

/** GET /chats?userId= */
router.get('/chats', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId es requerido' });
  const userChats = [...chatStore2.values()]
    .filter(c => c.participants.includes(userId))
    .sort((a, b) => b.lastTime - a.lastTime);
  return res.json({ chats: userChats });
});

/** GET /messages/:chatId */
router.get('/messages/:chatId', (req, res) => {
  return res.json({ messages: messageStore.get(req.params.chatId) || [] });
});

/** POST /messages */
router.post('/messages', async (req, res) => {
  const { chatId, senderId, text, type = 'text', url } = req.body || {};
  if (!chatId || !senderId || !text) return res.status(400).json({ error: 'chatId, senderId y text son requeridos' });

  const msg = {
    id:        `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    chatId, senderId, text, type, url: url || null,
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

router.put('/directos/:id', (req, res) => {
  const d = directoStore.get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Directo no encontrado' });
  const { title, description, scheduledAt, contacts, price, status } = req.body || {};
  if (title       !== undefined) d.title       = title;
  if (description !== undefined) d.description = description;
  if (scheduledAt !== undefined) d.scheduledAt = scheduledAt;
  if (contacts    !== undefined) d.contacts    = contacts;
  if (price       !== undefined) d.price       = price;
  if (status      !== undefined) d.status      = status;
  directoStore.set(d.id, d);
  saveDirectos();
  return res.json(d);
});

router.delete('/directos/:id', (req, res) => {
  if (!directoStore.has(req.params.id)) return res.status(404).json({ error: 'Directo no encontrado' });
  directoStore.delete(req.params.id);
  saveDirectos();
  return res.json({ success: true });
});

// ── Montar router ─────────────────────────────────────────────────
app.use('/api', router);
app.use('/', router);

// ── Estático + fallback ───────────────────────────────────────────
const distPath = path.join(__dirname, '../dist');
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
