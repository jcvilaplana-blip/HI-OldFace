/**
 * Acciones pendientes de Willy (Fase 4) — Willy solo PROPONE; nada se hace hasta que el usuario pulsa Confirmar.
 *
 *   const actions = createActions();
 *   actions.propose(uid, payload)   → { id, expiresAt }   (la herramienta la crea; la app enseña la tarjeta)
 *   actions.confirm(uid, id)        → { ok, payload } | { ok: false, status, error }
 *   actions.cancel(uid, id)         → { ok } | { ok: false, status, error }
 *
 * Reglas: cada acción es de UN usuario (otro no puede confirmarla), de UN SOLO USO y caduca a los 5 minutos.
 * Viven solo en memoria (si el servidor se reinicia, caducan). Al confirmar, el servidor devuelve lo que hay que hacer
 * y la app lo hace con la sesión del usuario y las rutas normales (POST /messages, PUT /mutes, POST /reminders),
 * que vuelven a comprobar los permisos.
 */
const crypto = require('crypto');

const TTL_MS = 5 * 60 * 1000;
const MAX_PER_USER = 20;
const ID = /^a_[0-9a-f]{24}$/;

function createActions({ ttlMs = TTL_MS } = {}) {
  const pending = new Map();   // id → { uid, payload, exp, state: 'pending' | 'done' | 'cancelled' }

  const prune = () => {
    const now = Date.now();
    for (const [id, a] of pending) if (a.exp + ttlMs < now) pending.delete(id);   // se recuerdan un rato para avisar "caducada"
  };
  setInterval(prune, 60_000).unref?.();

  /** La acción de este usuario, o un error (la de otro usuario se trata como inexistente) */
  function own(uid, id) {
    const a = typeof id === 'string' && ID.test(id) ? pending.get(id) : null;
    if (!a || a.uid !== uid) return { error: { ok: false, status: 404, error: 'Esa acción no existe' } };
    if (a.state === 'done') return { error: { ok: false, status: 409, error: 'Esa acción ya se hizo' } };
    if (a.state === 'cancelled') return { error: { ok: false, status: 409, error: 'Esa acción se canceló' } };
    if (a.exp < Date.now()) return { error: { ok: false, status: 410, error: 'Esa propuesta ha caducado: pídesela otra vez a Willy' } };
    return { a };
  }

  return {
    ttlMs,
    propose(uid, payload) {
      prune();
      const mine = [...pending.values()].filter(a => a.uid === uid && a.state === 'pending');
      if (mine.length >= MAX_PER_USER) mine.sort((x, y) => x.exp - y.exp)[0].state = 'cancelled';
      const id = `a_${crypto.randomBytes(12).toString('hex')}`;
      const exp = Date.now() + ttlMs;
      pending.set(id, { uid, payload, exp, state: 'pending' });
      return { id, expiresAt: exp };
    },
    confirm(uid, id) {
      const { a, error } = own(uid, id);
      if (error) return error;
      a.state = 'done';
      return { ok: true, payload: a.payload };
    },
    cancel(uid, id) {
      const { a, error } = own(uid, id);
      if (error) return error;
      a.state = 'cancelled';
      return { ok: true };
    },
    forgetUser(uid) { for (const [id, a] of pending) if (a.uid === uid) pending.delete(id); },
  };
}

module.exports = { createActions };
