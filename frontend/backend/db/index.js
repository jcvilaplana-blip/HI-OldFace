/**
 * Base de datos Supabase (Postgres) para la API — la memoria (los Map de server.js) sigue siendo la caché y data/
 * la copia local; Supabase guarda todo fila a fila.
 *
 *   const db = require('./db')({ dataDir });   // ANTES de cargar los datos: sincroniza data/ con Supabase
 *   db.save('users.json', datos)               // tras cada saveJSON: sube solo las filas que cambiaron (en segundo plano)
 *   db.append('ai_audit', entrada)             // registros que solo se añaden
 *
 * Sin DB_HOST/DB_PASSWORD (o DB_SOURCE=off) no hace nada: la API funciona como siempre, solo con data/.
 * Si Supabase no responde, la API sigue con data/; los cambios se reintentan y data/.db-pending hace que el siguiente
 * arranque los suba. Nunca registra el contenido de los datos, solo recuentos y códigos de error.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const core = require('./core');
const { TABLES, tablesOf } = require('./tables');
const { PENDING } = require('./sync');

const OFF = { enabled: false, save() {}, append() {}, flush: async () => {}, status: () => ({ enabled: false }) };

module.exports = function createDb({ dataDir, env = process.env, log = console } = {}) {
  const cfg = core.configFrom(env);
  if (!cfg.enabled) return OFF;

  const state = { ready: false, lastFlushAt: null, lastError: null, failures: 0 };
  const pendingFile = path.join(dataDir, PENDING);

  // 1) Al arrancar: dejar data/ y Supabase iguales (proceso aparte, para que server.js cargue los datos como siempre)
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'sync.js'), 'boot', dataDir], {
      env, stdio: ['ignore', 'inherit', 'inherit'], timeout: Number(env.DB_BOOT_TIMEOUT_MS) || 90_000,
    });
    state.ready = true;
  } catch {
    state.lastError = 'arranque';
    log.error('[DB] ⚠️  No se pudo sincronizar con Supabase al arrancar: la API usa data/ y lo reintentará');
    try { fs.writeFileSync(pendingFile, ''); } catch { /* sin disco no hay nada que hacer */ }
  }

  // 2) Lo que hay ahora en Supabase (= data/ tras la sincronización), para enviar solo las diferencias
  const snapId = (t) => `${t.table}|${t.file}|${t.part || ''}`;
  const snap = new Map();
  for (const t of TABLES) {
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(dataDir, t.file), 'utf8')); } catch { data = undefined; }
    snap.set(snapId(t), new Map([...core.rowsOf(t, data)].map(([key, r]) => [key, r.sig])));
  }

  const queue = new Map();   // `${tabla}\u0002${rowKey}` → { table, del, row }  (el último cambio de cada fila gana)
  const appendQueue = [];    // { table, entry }
  let client = null, timer = null, flushing = false;

  function schedule(ms = Number(env.DB_FLUSH_MS) || 250) {
    if (timer) return;
    timer = setTimeout(() => { timer = null; flush().catch(() => {}); }, ms);
    timer.unref?.();
  }

  function markPending() {
    try { if (!fs.existsSync(pendingFile)) fs.writeFileSync(pendingFile, ''); } catch { /* ignorar */ }
  }

  /** Tras cada saveJSON(file, data): encola las filas que cambiaron */
  function save(file, data) {
    try {
      let changed = false;
      for (const t of tablesOf(file)) {
        const old = snap.get(snapId(t));
        const rows = core.rowsOf(t, data);
        for (const [key, r] of rows) {
          if (old.get(key) === r.sig) continue;
          old.set(key, r.sig);
          queue.set(`${t.table}\u0002${key}`, { table: t.table, del: false, row: r });
          changed = true;
        }
        if (t.kind === 'doc') continue;
        for (const key of [...old.keys()]) {
          if (rows.has(key)) continue;
          old.delete(key);
          const [k, k2] = key.split('\u0001');
          queue.set(`${t.table}\u0002${key}`, { table: t.table, del: true, row: { k, k2 } });
          changed = true;
        }
      }
      if (changed) { markPending(); schedule(); }
    } catch (e) {
      log.error(`[DB] Error preparando ${file}: ${e.message}`);
    }
  }

  function append(table, entry) {
    appendQueue.push({ table, entry });
    if (appendQueue.length > 5000) appendQueue.splice(0, appendQueue.length - 5000);   // Supabase caído mucho tiempo
    schedule();
  }

  async function connect() {
    if (client) return client;
    const c = core.newClient(cfg);
    c.on('error', () => { if (client === c) client = null; });
    await c.connect();
    client = c;
    return c;
  }

  async function flush() {
    if (flushing) { schedule(); return; }
    if (!queue.size && !appendQueue.length && state.ready) return;
    flushing = true;
    const batch = [...queue.entries()];
    const appends = appendQueue.splice(0);
    queue.clear();
    try {
      const c = await connect();
      if (!state.ready) {   // el arranque falló: subir ahora todo lo que difiera (data/ está al día)
        const { boot } = require('./sync');
        await boot(dataDir, { ...cfg, source: 'json' });
        state.ready = true;
      }
      await c.query('begin');
      try {
        const byTable = new Map();
        for (const [, op] of batch) {
          const g = byTable.get(op.table) || byTable.set(op.table, { up: [], del: [] }).get(op.table);
          (op.del ? g.del : g.up).push(op.row);
        }
        for (const [table, g] of byTable) await core.writeRows(c, cfg.schema, table, g.up, g.del);
        const byAppend = new Map();
        for (const a of appends) (byAppend.get(a.table) || byAppend.set(a.table, []).get(a.table)).push(a.entry);
        for (const [table, entries] of byAppend) {
          await c.query(`insert into ${core.q(cfg.schema)}.${core.q(table)} (entry) select value from jsonb_array_elements($1::jsonb)`,
            [JSON.stringify(entries)]);
        }
        await c.query('commit');
      } catch (e) { await c.query('rollback').catch(() => {}); throw e; }
      state.lastFlushAt = Date.now();
      if (state.failures) log.log(`[DB] ✅ Supabase vuelve a responder (${batch.length} cambios guardados)`);
      state.failures = 0; state.lastError = null;
      if (!queue.size) { try { fs.rmSync(pendingFile, { force: true }); } catch { /* ignorar */ } }
    } catch (e) {
      // devolver a la cola lo que no se guardó (salvo filas que ya tienen un cambio más nuevo)
      for (const [key, op] of batch) if (!queue.has(key)) queue.set(key, op);
      appendQueue.unshift(...appends);
      state.failures++; state.lastError = e.code || 'error';
      if (client) { client.end().catch(() => {}); client = null; }
      const wait = Math.min(60_000, 1000 * 2 ** Math.min(state.failures, 6));
      if (state.failures === 1 || state.failures % 20 === 0) {
        log.error(`[DB] ⚠️  Error guardando en Supabase (${e.code || ''} ${String(e.message).split('\n')[0]}); reintento en ${wait / 1000} s`);
      }
      flushing = false;
      schedule(wait);
      return;
    }
    flushing = false;
    if (queue.size || appendQueue.length) schedule();
  }

  // si el arranque falló, intentar reconectar pronto aunque nadie guarde nada
  if (!state.ready) schedule(5000);

  const status = () => ({ enabled: true, source: cfg.source, ready: state.ready, pending: queue.size + appendQueue.length,
    lastFlushAt: state.lastFlushAt, lastError: state.lastError });

  return { enabled: true, save, append, flush, status };
};
