/**
 * OldFace AI — Willy. Se monta desde server.js con lo mínimo:
 *   const ai = require('./ai')({ router, authUser, dataDir, deps: { chatStore, groupStore, messageStore, findUserById,
 *                                                                    contactsOf, isChatMember } });
 * Rutas (siempre con la sesión del usuario; nada de lo que diga el modelo cambia quién es):
 *   GET  /ai/status → { available, name, dailyLimit, remaining }
 *   POST /ai/chat   { messages: [{ role: 'user'|'assistant', content }] } → { reply, actions, remaining }
 * La conversación con Willy la guarda la app (no el servidor). Aquí solo se cuentan peticiones y tokens por día
 * (data/ai_usage.json) y se anota qué herramientas se usaron (data/ai_audit.log, sin contenido y con el usuario
 * seudonimizado). Configuración en .env: ver providers/index.js y AI_DAILY_LIMIT (peticiones por usuario y día).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createProvider, ProviderError } = require('./providers');
const { createAccess } = require('./access');
const { runAgent } = require('./agent');

const MAX_TURNS = 40, MAX_CHARS_PER_TURN = 4000, MAX_TOTAL_CHARS = 40_000;

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
  const access = createAccess({ ...deps, refSecret: env.RTC_SECRET });
  const dailyLimit = Math.max(parseInt(env.AI_DAILY_LIMIT || '40', 10) || 40, 1);
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
    return usage.users[uid] || (usage.users[uid] = { requests: 0, input: 0, output: 0 });
  };

  /** Registro sin contenido: quién (seudónimo), qué herramientas, cuántos tokens y si fue bien */
  const audit = (uid, entry) => {
    const user = crypto.createHmac('sha256', auditKey).update(uid).digest('hex').slice(0, 16);
    fs.promises.appendFile(auditFile, `${JSON.stringify({ at: new Date().toISOString(), user, ...entry })}\n`).catch(() => {});
  };

  console.log(`🤖 Willy (IA): ${provider ? `${provider.name} · ${provider.model}` : 'desactivado (sin ANTHROPIC_API_KEY)'}`);

  /** GET /ai/status — ¿está Willy disponible y cuántas peticiones me quedan hoy? */
  router.get('/ai/status', (req, res) => {
    const uid = authUser(req, res, req.query.userId);
    if (!uid) return;
    res.json({ available: !!provider, name: 'Willy', dailyLimit, remaining: Math.max(dailyLimit - usageOf(uid).requests, 0) });
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
      const out = await runAgent({ provider, history: req.body.messages, my: access.forUser(uid) });
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
    forgetUser(uid) { if (usage.users[uid]) { delete usage.users[uid]; saveUsage(); } },
  };
};
