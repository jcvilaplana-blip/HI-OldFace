/**
 * OldFace AI — Willy. Se monta desde server.js con lo mínimo:
 *   const ai = require('./ai')({ router, authUser, dataDir, deps: { chatStore, groupStore, messageStore, findUserById,
 *                                                                    contactsOf, isChatMember, callLogStore } });
 * Rutas (siempre con la sesión del usuario; nada de lo que diga el modelo cambia quién es):
 *   GET  /ai/status → { available, name, dailyLimit, remaining, voice }
 *   POST /ai/chat   { messages: [{ role: 'user'|'assistant', content }], location?: { lat, lng } } → { reply, actions, remaining }
 *                   location = posición del móvil que la app manda SOLO si el usuario habla del taxi; se redondea a
 *                   ~100 m, se usa en esa petición y no se guarda ni se anota en ningún registro.
 *   POST /ai/speak  { text } → audio/wav con la voz de Willy (servicio local voice-server/; el texto no se guarda)
 * La conversación con Willy la guarda la app (no el servidor). Aquí solo se cuentan peticiones y tokens por día
 * (data/ai_usage.json) y se anota qué herramientas se usaron (data/ai_audit.log, sin contenido y con el usuario
 * seudonimizado). Configuración en .env: ver providers/index.js y AI_DAILY_LIMIT (peticiones por usuario y día).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createProvider, ProviderError } = require('./providers');
const { createVoice } = require('./providers/tts');
const { createAccess } = require('./access');
const { createSemantic } = require('./semantic');
const { createTaxi } = require('./taxi');
const { runAgent, SYSTEM_PROMPT } = require('./agent');
const { toolSpecs } = require('./tools');
const { validate } = require('./validate');

const MAX_TURNS = 40, MAX_CHARS_PER_TURN = 4000, MAX_TOTAL_CHARS = 40_000;
const INDEX_EVERY_MS = 60_000;   // el índice por significado (en memoria) se pone al día cada minuto

/** Posición que manda la app (opcional): números válidos, redondeados a 3 decimales (~100 m); si no, null */
function roughLocation(loc) {
  if (!loc || typeof loc !== 'object' || Array.isArray(loc)) return null;
  const lat = Number(loc.lat), lng = Number(loc.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000 };
}

/** Lo que acepta /ai/speak: una frase (la app trocea las respuestas largas) */
const SPEAK_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['text'],
  properties: { text: { type: 'string', minLength: 1, maxLength: 800 }, userId: { type: 'string', maxLength: 200 } },
};
const MAX_VOICE_IN_FLIGHT = 2;   // la app pide la frase siguiente mientras suena la actual

/** Comprueba la conversación que manda la app: devuelve el texto del error o null */
function badHistory(messages) {
  if (!Array.isArray(messages) || !messages.length) return 'Falta el mensaje';
  if (messages.length > MAX_TURNS) return 'Conversación demasiado larga: empieza una nueva';
  let total = 0;
  for (const m of messages) {
    if (!m || typeof m !== 'object' || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string') return 'Mensajes no válidos';
    const len = m.content.trim().length;
    if (!len || m.content.length > MAX_CHARS_PER_TURN) return 'Cada mensaje debe tener entre 1 y 4000 caracteres';
    total += m.content.length;
  }
  if (total > MAX_TOTAL_CHARS) return 'Conversación demasiado larga: empieza una nueva';
  if (messages[0].role !== 'user' || messages[messages.length - 1].role !== 'user') return 'El último mensaje debe ser tuyo';
  return null;
}

module.exports = function mountAi({ router, authUser, dataDir, deps, env = process.env }) {
  const provider = createProvider(env);
  const voice = createVoice(env);
  const semantic = createSemantic(env);
  const taxi = createTaxi(env);
  const access = createAccess({ ...deps, semantic, refSecret: env.RTC_SECRET });
  const placesOf = new Map();   // uid → destinos de taxi encontrados por Willy (caducan a los 30 min)
  const dailyLimit = Math.max(parseInt(env.AI_DAILY_LIMIT || '40', 10) || 40, 1);
  const voiceLimit = Math.max(parseInt(env.AI_VOICE_DAILY_LIMIT || '400', 10) || 400, 1);   // frases leídas por usuario y día
  const voiceInFlight = new Map();   // uid → frases generándose ahora
  const usageFile = path.join(dataDir, 'ai_usage.json');
  const auditFile = path.join(dataDir, 'ai_audit.log');
  const auditKey = env.RTC_SECRET || 'oldface-ai';
  const inFlight = new Set();   // una petición a la vez por usuario

  const today = () => new Date().toISOString().slice(0, 10);
  let usage = { day: today(), users: {} };
  try { usage = JSON.parse(fs.readFileSync(usageFile, 'utf8')); } catch { /* primera vez */ }
  let saveTimer = null;
  const saveUsage = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      fs.promises.writeFile(usageFile, JSON.stringify(usage)).catch(e => console.warn('[ai] uso:', e.message));
    }, 2000);
    saveTimer.unref?.();
  };
  const usageOf = (uid) => {
    if (usage.day !== today()) usage = { day: today(), users: {} };
    return usage.users[uid] || (usage.users[uid] = { requests: 0, input: 0, output: 0, voice: 0 });
  };

  /** Registro sin contenido: quién (seudónimo), qué herramientas, cuántos tokens y si fue bien */
  const audit = (uid, entry) => {
    const user = crypto.createHmac('sha256', auditKey).update(uid).digest('hex').slice(0, 16);
    fs.promises.appendFile(auditFile, `${JSON.stringify({ at: new Date().toISOString(), user, ...entry })}\n`).catch(() => {});
  };

  console.log(`🤖 Willy (IA): ${provider ? `${provider.name} · ${provider.model}` : 'desactivado (sin ANTHROPIC_API_KEY)'}`
    + ` · voz: ${voice ? voice.name : 'la del móvil'} · búsqueda: ${semantic ? 'palabras y significado' : 'palabras'}`
    + ` · taxi: ${taxi ? 'sí' : 'no'}`);
  // Índice por significado SOLO en memoria: mensajes nuevos o editados se calculan en segundo plano y los
  // borrados se olvidan (prune). Al reiniciar se vuelve a calcular todo.
  if (semantic && provider) {
    const refresh = () => {
      const items = access.searchableItems();
      semantic.prune(new Set(items.map(i => i.key)));
      semantic.backfill(items);
    };
    setTimeout(refresh, 10_000).unref?.();
    setInterval(refresh, INDEX_EVERY_MS).unref?.();
  }
  // Modelo local: que procese ya las instrucciones fijas para que la primera pregunta no espere ~30 s
  if (provider?.warmUp) {
    setTimeout(() => provider.warmUp({ system: SYSTEM_PROMPT, tools: toolSpecs() })
      .then(() => console.log('🤖 Willy: modelo local preparado'))
      .catch(() => console.warn('[ai] modelo local: no responde todavía')), 3000).unref?.();
  }

  /** GET /ai/status — ¿está Willy disponible y cuántas peticiones me quedan hoy? */
  router.get('/ai/status', (req, res) => {
    const uid = authUser(req, res, req.query.userId);
    if (!uid) return;
    res.json({ available: !!provider, name: 'Willy', dailyLimit, remaining: Math.max(dailyLimit - usageOf(uid).requests, 0), voice: !!voice });
  });

  /** POST /ai/speak — { text } una frase de Willy → audio/wav con la voz del servidor (sin guardar el texto) */
  router.post('/ai/speak', async (req, res) => {
    const uid = authUser(req, res, req.body?.userId);
    if (!uid) return;
    if (!voice) return res.status(503).json({ error: 'La voz de Willy no está disponible ahora' });
    const v = validate(SPEAK_SCHEMA, req.body);
    if (!v.ok || !req.body.text.trim()) return res.status(400).json({ error: 'El texto debe tener entre 1 y 800 caracteres' });
    const mine = usageOf(uid);
    if ((mine.voice || 0) >= voiceLimit) return res.status(429).json({ error: 'Willy ya ha hablado mucho hoy. Vuelve mañana.' });
    const busy = voiceInFlight.get(uid) || 0;
    if (busy >= MAX_VOICE_IN_FLIGHT) return res.status(429).json({ error: 'Espera a que Willy termine de hablar' });

    voiceInFlight.set(uid, busy + 1);
    mine.voice = (mine.voice || 0) + 1;
    saveUsage();
    try {
      const { audio, mime } = await voice.speak(req.body.text.trim());
      res.set({ 'Content-Type': mime, 'Cache-Control': 'no-store' }).send(audio);
    } catch (e) {
      if (e instanceof ProviderError) return res.status(e.status).json({ error: e.message });
      console.error('[ai] voz:', e.message);
      res.status(500).json({ error: 'La voz de Willy ha tenido un problema' });
    } finally {
      const n = (voiceInFlight.get(uid) || 1) - 1;
      if (n > 0) voiceInFlight.set(uid, n); else voiceInFlight.delete(uid);
    }
  });

  /** POST /ai/chat — { messages } la conversación con Willy (la guarda la app); responde el siguiente turno */
  router.post('/ai/chat', async (req, res) => {
    const uid = authUser(req, res, req.body?.userId);
    if (!uid) return;
    if (!provider) return res.status(503).json({ error: 'Willy no está disponible todavía' });
    const err = badHistory(req.body?.messages);
    if (err) return res.status(400).json({ error: err });
    const mine = usageOf(uid);
    if (mine.requests >= dailyLimit) return res.status(429).json({ error: `Has usado las ${dailyLimit} consultas de hoy a Willy. Vuelve mañana.` });
    if (inFlight.has(uid)) return res.status(429).json({ error: 'Willy aún está respondiendo a tu mensaje anterior' });

    inFlight.add(uid);
    mine.requests++;
    saveUsage();
    try {
      if (!placesOf.has(uid)) placesOf.set(uid, new Map());
      const ctx = { taxi, location: roughLocation(req.body.location), places: placesOf.get(uid) };
      const out = await runAgent({ provider, history: req.body.messages, my: access.forUser(uid), ctx });
      mine.input += out.usage.input;
      mine.output += out.usage.output;
      saveUsage();
      audit(uid, { tools: out.tools, rounds: out.rounds, input: out.usage.input, output: out.usage.output, ok: true });
      res.json({ reply: out.reply, actions: out.actions, remaining: Math.max(dailyLimit - mine.requests, 0) });
    } catch (e) {
      audit(uid, { ok: false, error: e instanceof ProviderError ? e.message : 'interno' });
      if (e instanceof ProviderError) return res.status(e.status).json({ error: e.message });
      console.error('[ai] error:', e.message);
      res.status(500).json({ error: 'Willy ha tenido un problema. Inténtalo de nuevo.' });
    } finally {
      inFlight.delete(uid);
    }
  });

  return {
    /** Al eliminar la cuenta: borrar su contador de uso (el registro ya no lleva su userId) */
    forgetUser(uid) { placesOf.delete(uid); if (usage.users[uid]) { delete usage.users[uid]; saveUsage(); } },
  };
};
