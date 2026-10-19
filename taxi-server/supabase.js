/**
 * supabase — copia en Supabase (Postgres, esquema `taxi`) de la base de datos del taxi.
 *
 * El taxi sigue trabajando con SQLite (rápido y síncrono). Supabase tiene las MISMAS tablas (columnas, claves
 * primarias, relaciones e índices, generadas desde SQLite) y se mantiene al día:
 *   · Unos triggers de SQLite apuntan en _sync_log qué filas cambian; cada segundo se suben (una transacción).
 *   · Al arrancar (db.js → bootSync, proceso aparte, ANTES de abrir la base):
 *       TAXI_SUPABASE_SOURCE=sqlite (transición): SQLite manda → se sube lo que difiera.
 *       TAXI_SUPABASE_SOURCE=supabase: Supabase manda → se trae a SQLite lo que difiera (con copia de taxi.db antes).
 *       Si taxi.db está vacía y Supabase no, se restaura desde Supabase (servidor nuevo o base perdida).
 *   · Cada hora se compara todo por si algo se escapó.
 * Secretos (ajustes de pagos, correo, OTP…; datos bancarios de retiradas) se guardan CIFRADOS (AES-256-GCM) con
 * TAXI_SUPABASE_KEY, que solo está en el .env del servidor. La posición de los conductores no provoca copias (cambia
 * cada pocos segundos y no hace falta conservarla). Nunca se registra el contenido de los datos, solo recuentos.
 *
 *   node supabase.js check   — compara SQLite con Supabase sin cambiar nada
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const LOG = '_sync_log';
const EPHEMERAL = { drivers: ['lat', 'lng', 'heading', 'location_at'] };   // no provocan copia (sí viajan con la fila)
const SECRET_SETTINGS = ['payments', 'otp', 'integrations'];
const SECRET_RX = /secret|password|authkey|securitykey|apikey|token/i;
/** Columnas que se guardan cifradas en Supabase */
const ENCRYPTED = {
  settings: { column: 'value', when: (r) => SECRET_SETTINGS.includes(r.key) || SECRET_RX.test(String(r.value || '')) },
  withdrawal_requests: { column: 'account_details', when: (r) => r.account_details != null },
};

function configFrom(env = process.env) {
  const source = String(env.TAXI_SUPABASE_SOURCE || 'sqlite').toLowerCase();
  const schema = String(env.TAXI_SUPABASE_SCHEMA || 'taxi');
  const enabled = !!(env.TAXI_SUPABASE_HOST && env.TAXI_SUPABASE_PASSWORD) && source !== 'off';
  if (!enabled) return { enabled: false };
  if (!/^[a-z_][a-z0-9_]{0,40}$/.test(schema)) throw new Error('TAXI_SUPABASE_SCHEMA no válido');
  if (!['sqlite', 'supabase'].includes(source)) throw new Error('TAXI_SUPABASE_SOURCE debe ser sqlite, supabase u off');
  const key = Buffer.from(String(env.TAXI_SUPABASE_KEY || ''), 'base64');
  if (key.length !== 32) throw new Error('Falta TAXI_SUPABASE_KEY (32 bytes en base64) para cifrar los secretos');
  const caFile = env.TAXI_SUPABASE_SSL_CA || path.join(__dirname, 'supabase-ca-2021.crt');
  return {
    enabled: true, source, schema, key,
    flushMs: Number(env.TAXI_SUPABASE_FLUSH_MS) || 1000,
    reconcileMs: (Number(env.TAXI_SUPABASE_RECONCILE_MIN) || 60) * 60_000,
    pg: {
      host: env.TAXI_SUPABASE_HOST, port: Number(env.TAXI_SUPABASE_PORT) || 5432, user: env.TAXI_SUPABASE_USER,
      password: env.TAXI_SUPABASE_PASSWORD, database: env.TAXI_SUPABASE_NAME || 'postgres',
      ssl: env.TAXI_SUPABASE_SSL === 'off' ? false : { rejectUnauthorized: true, ca: fs.readFileSync(caFile, 'utf8') },
      connectionTimeoutMillis: 15000, statement_timeout: 30000, application_name: 'oldface-taxi',
    },
  };
}

// ── Cifrado ──────────────────────────────────────────────────────────────────
function encrypt(key, text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `enc:v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}
function decrypt(key, v) {
  if (typeof v !== 'string' || !v.startsWith('enc:v1:')) return v;
  const [, , iv, tag, ct] = v.split(':');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

// ── Estructura de SQLite ─────────────────────────────────────────────────────
const qi = (id) => `"${String(id).replace(/"/g, '""')}"`;

/** Tablas, columnas, clave primaria, relaciones e índices de la base SQLite */
function describe(db) {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> ? ORDER BY name`).all(LOG)
    .map(({ name }) => {
      const cols = db.prepare(`PRAGMA table_info(${qi(name)})`).all();
      const pk = cols.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk).map(c => c.name);
      const fks = db.prepare(`PRAGMA foreign_key_list(${qi(name)})`).all();
      const indexes = db.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL`).all(name);
      const keyish = new Set([...pk, ...fks.map(f => f.from)]);
      return {
        name, pk, fks, indexes,
        cols: cols.map(c => ({ name: c.name, kind: /INT/i.test(c.type) ? (keyish.has(c.name) ? 'bigint' : 'numeric') : /REAL|FLOA|DOUB/i.test(c.type) ? 'double precision' : 'text' })),
      };
    });
  return tables.filter(t => t.pk.length);   // todas las del taxi tienen clave primaria
}

function installTriggers(db, meta) {
  db.exec(`CREATE TABLE IF NOT EXISTS ${LOG} (seq INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, pk TEXT NOT NULL)`);
  for (const t of meta) {
    const key = (row) => `json_array(${t.pk.map(c => `${row}.${qi(c)}`).join(', ')})`;
    const watched = t.cols.map(c => c.name).filter(c => !(EPHEMERAL[t.name] || []).includes(c));
    const T = qi(t.name), N = (op) => qi(`_sync_${op}_${t.name}`);
    db.exec(`DROP TRIGGER IF EXISTS ${N('upd')}`);   // se rehace: la lista de columnas puede cambiar
    db.exec(`CREATE TRIGGER IF NOT EXISTS ${N('ins')} AFTER INSERT ON ${T} BEGIN INSERT INTO ${LOG} (tbl, pk) VALUES ('${t.name}', ${key('NEW')}); END`);
    db.exec(`CREATE TRIGGER ${N('upd')} AFTER UPDATE OF ${watched.map(qi).join(', ')} ON ${T} BEGIN
      INSERT INTO ${LOG} (tbl, pk) VALUES ('${t.name}', ${key('NEW')});
      INSERT INTO ${LOG} (tbl, pk) SELECT '${t.name}', ${key('OLD')} WHERE ${key('OLD')} <> ${key('NEW')}; END`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS ${N('del')} AFTER DELETE ON ${T} BEGIN INSERT INTO ${LOG} (tbl, pk) VALUES ('${t.name}', ${key('OLD')}); END`);
  }
}

function dropTriggers(db) {
  for (const { name } of db.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE '\\_sync\\_%' ESCAPE '\\'`).all()) {
    db.exec(`DROP TRIGGER IF EXISTS ${qi(name)}`);
  }
  db.exec(`DROP TABLE IF EXISTS ${LOG}`);
}

// ── Postgres ─────────────────────────────────────────────────────────────────
function newClient(cfg) {
  const { Client, types } = require('pg');
  const num = (v) => (v === null ? null : Number(v));
  return new Client({ ...cfg.pg, types: { getTypeParser: (oid, fmt) => (oid === 20 || oid === 1700 ? num : types.getTypeParser(oid, fmt)) } });
}
/** Conecta y pide los decimales completos (el pooler de Supabase redondea a 15 cifras: coordenadas distintas) */
async function connectPg(client) {
  await client.connect();
  await client.query('set extra_float_digits = 3');
  return client;
}

async function ensurePgSchema(client, schema, meta) {
  const S = qi(schema);
  for (const t of meta) {
    const T = `${S}.${qi(t.name)}`;
    await client.query(`create table if not exists ${T} (${t.cols.map(c => `${qi(c.name)} ${c.kind}`).join(', ')}, primary key (${t.pk.map(qi).join(', ')}))`);
    for (const c of t.cols) await client.query(`alter table ${T} add column if not exists ${qi(c.name)} ${c.kind}`);
    await client.query(`alter table ${T} enable row level security`);
    for (const ix of t.indexes) {
      const m = /ON\s+"?\w+"?\s*\(([^)]+)\)/i.exec(ix.sql);
      if (m) await client.query(`create index if not exists ${qi(ix.name)} on ${T} (${m[1].split(',').map(s => qi(s.trim().split(/\s+/)[0].replace(/"/g, ''))).join(', ')})`);
    }
  }
  // Relaciones entre tablas: se comprueban al final de cada transacción (las copias llegan en cualquier orden)
  const have = new Set((await client.query(`select conname from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = $1 and contype = 'f'`, [schema])).rows.map(r => r.conname));
  for (const t of meta) {
    const groups = new Map();
    for (const f of t.fks) (groups.get(f.id) || groups.set(f.id, []).get(f.id)).push(f);
    for (const [, fs_] of groups) {
      const parent = meta.find(m => m.name === fs_[0].table);
      if (!parent) continue;
      const to = fs_.map((f, i) => f.to || parent.pk[i]);
      if (to.join() !== parent.pk.join()) continue;   // solo relaciones con la clave primaria (en Postgres deben ser únicas)
      const name = `fk_${t.name}_${fs_.map(f => f.from).join('_')}`.slice(0, 63);
      if (have.has(name)) continue;
      await client.query(`alter table ${S}.${qi(t.name)} add constraint ${qi(name)} foreign key (${fs_.map(f => qi(f.from)).join(', ')})
        references ${S}.${qi(parent.name)} (${to.map(qi).join(', ')}) deferrable initially deferred`);
    }
  }
}

// ── Filas: SQLite ⇄ Postgres ─────────────────────────────────────────────────
const pkOf = (t, row) => JSON.stringify(t.pk.map(c => row[c]));

/** Normaliza una fila para comparar o escribir (números como número; texto como texto) */
function norm(t, row) {
  const out = {};
  for (const c of t.cols) {
    let v = row[c.name];
    if (v === undefined) v = null;
    if (typeof v === 'bigint') v = Number(v);
    if (v instanceof Uint8Array) v = Buffer.from(v).toString('base64');
    if (c.kind !== 'text' && typeof v === 'string') v = Number.isFinite(Number(v)) && v.trim() !== '' ? Number(v) : null;
    if (c.kind === 'bigint' && typeof v === 'number' && !Number.isInteger(v)) v = Math.round(v);
    if (c.kind === 'text' && v !== null && typeof v !== 'string') v = String(v);
    out[c.name] = v;
  }
  return out;
}
const sig = (t, row) => JSON.stringify(t.cols.map(c => row[c.name]));

function toPg(cfg, t, row) {
  const enc = ENCRYPTED[t.name];
  if (!enc || !enc.when(row) || row[enc.column] == null) return row;
  return { ...row, [enc.column]: encrypt(cfg.key, row[enc.column]) };
}
function fromPg(cfg, t, row) {
  const enc = ENCRYPTED[t.name];
  if (!enc || row[enc.column] == null) return row;
  return { ...row, [enc.column]: decrypt(cfg.key, row[enc.column]) };
}

async function pgUpsert(client, schema, t, rows) {
  const T = `${qi(schema)}.${qi(t.name)}`;
  const cols = t.cols.map(c => qi(c.name)).join(', ');
  const nonPk = t.cols.filter(c => !t.pk.includes(c.name));
  const set = nonPk.length ? `do update set ${nonPk.map(c => `${qi(c.name)} = excluded.${qi(c.name)}`).join(', ')}` : 'do nothing';
  for (let i = 0; i < rows.length; i += 300) {
    await client.query(`insert into ${T} (${cols}) select ${cols} from jsonb_to_recordset($1::jsonb) as x(${t.cols.map(c => `${qi(c.name)} ${c.kind}`).join(', ')})
      on conflict (${t.pk.map(qi).join(', ')}) ${set}`,
    [JSON.stringify(rows.slice(i, i + 300), (_k, v) => (typeof v === 'string' ? v.replace(/\u0000/g, '') : v))]);
  }
}
async function pgDelete(client, schema, t, pks) {
  const T = `${qi(schema)}.${qi(t.name)}`;
  const pkCols = t.pk.map(p => t.cols.find(c => c.name === p));
  for (let i = 0; i < pks.length; i += 500) {
    const objs = pks.slice(i, i + 500).map(p => Object.fromEntries(JSON.parse(p).map((v, j) => [t.pk[j], v])));
    await client.query(`delete from ${T} t using jsonb_to_recordset($1::jsonb) as x(${pkCols.map(c => `${qi(c.name)} ${c.kind}`).join(', ')})
      where ${t.pk.map(c => `t.${qi(c)} = x.${qi(c)}`).join(' and ')}`, [JSON.stringify(objs)]);
  }
}

/** Diferencias tabla a tabla. SQLite se lee ENTERA de golpe (foto coherente) antes de preguntar a Postgres. */
async function diff(db, client, cfg, meta) {
  const local = meta.map(t => db.prepare(`SELECT * FROM ${qi(t.name)}`).all().map(r => norm(t, r)));
  const out = [];
  for (const [i, t] of meta.entries()) {
    const remote = (await client.query(`select * from ${qi(cfg.schema)}.${qi(t.name)}`)).rows.map(r => norm(t, fromPg(cfg, t, r)));
    const want = new Map(local[i].map(r => [pkOf(t, r), r]));
    const have = new Map(remote.map(r => [pkOf(t, r), r]));
    out.push({
      t, counts: [want.size, have.size],
      upserts: [...want].filter(([k, r]) => !have.has(k) || sig(t, have.get(k)) !== sig(t, r)).map(([, r]) => r),
      deletes: [...have.keys()].filter(k => !want.has(k)),
      // para traer a SQLite (Supabase manda)
      pgRows: [...have].filter(([k, r]) => !want.has(k) || sig(t, want.get(k)) !== sig(t, r)).map(([, r]) => r),
      sqliteOnly: [...want.keys()].filter(k => !have.has(k)),
    });
  }
  return out;
}

async function pushDiff(client, cfg, changes) {
  await client.query('begin');
  try {
    await client.query('set constraints all deferred');
    for (const c of changes) if (c.deletes.length) await pgDelete(client, cfg.schema, c.t, c.deletes);
    for (const c of changes) if (c.upserts.length) await pgUpsert(client, cfg.schema, c.t, c.upserts.map(r => toPg(cfg, c.t, r)));
    await client.query('commit');
  } catch (e) { await client.query('rollback').catch(() => {}); throw e; }
}

/** Trae a SQLite lo que difiere de Supabase (Supabase manda) */
function pullDiff(db, changes) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const { t, sqliteOnly, pgRows } of changes) {
      const del = db.prepare(`DELETE FROM ${qi(t.name)} WHERE ${t.pk.map(p => `${qi(p)} = ?`).join(' AND ')}`);
      for (const k of sqliteOnly) del.run(...JSON.parse(k));
      const cols = t.cols.map(x => x.name);
      const nonPk = cols.filter(x => !t.pk.includes(x));
      const ins = db.prepare(`INSERT INTO ${qi(t.name)} (${cols.map(qi).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
        ON CONFLICT (${t.pk.map(qi).join(', ')}) ${nonPk.length ? `DO UPDATE SET ${nonPk.map(x => `${qi(x)} = excluded.${qi(x)}`).join(', ')}` : 'DO NOTHING'}`);
      for (const r of pgRows) ins.run(...cols.map(x => r[x]));
    }
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch { /* nada */ } throw e; } finally { db.exec('PRAGMA foreign_keys = ON'); }
}

const markerOf = (dbFile) => `${dbFile}.supabase-off`;
const changed = (c) => c.upserts.length || c.deletes.length;

// ── Arranque (proceso aparte, antes de que db.js abra la base) ───────────────
async function boot(dbFile, cfg) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  const meta = describe(db);
  installTriggers(db, meta);
  const client = newClient(cfg);
  await connectPg(client);
  try {
    await ensurePgSchema(client, cfg.schema, meta);
    const all = await diff(db, client, cfg, meta);
    const todo = all.filter(changed);
    const sqliteEmpty = all.every(c => c.counts[0] === 0);
    const pgEmpty = all.every(c => c.counts[1] === 0);
    const pending = db.prepare(`SELECT count(*) AS n FROM ${LOG}`).get().n > 0 || fs.existsSync(markerOf(dbFile));
    let what;
    if (sqliteEmpty && !pgEmpty) {
      pullDiff(db, todo); what = `taxi.db vacía → restaurada desde Supabase (${todo.length} tablas)`;
    } else if (cfg.source === 'sqlite' || pending || pgEmpty) {
      await pushDiff(client, cfg, todo);
      const n = todo.reduce((a, c) => a + c.upserts.length + c.deletes.length, 0);
      what = `subidos ${n} cambios en ${todo.length} tablas` + (pgEmpty && !sqliteEmpty ? ' (primera migración)' : '') + (pending ? ' (había pendientes)' : '');
    } else if (todo.length) {
      db.exec(`VACUUM INTO '${`${dbFile}.bak-supabase-${new Date().toISOString().replace(/[:.]/g, '-')}`.replace(/'/g, "''")}'`);
      pullDiff(db, todo);
      what = `traídos desde Supabase cambios en ${todo.length} tablas (copia de taxi.db guardada)`;
    } else {
      what = 'taxi.db ya coincide con Supabase';
    }
    db.exec(`DELETE FROM ${LOG}`);
    fs.rmSync(markerOf(dbFile), { force: true });
    console.log(`[taxi·supabase] ${cfg.source}: ${what} · ${meta.length} tablas`);
  } finally {
    await client.end().catch(() => {});
    db.close();
  }
}

/** Lanza boot() en un proceso aparte y espera (db.js es síncrono). Si falla, el taxi sigue con SQLite. */
function bootSync(dbFile, env = process.env) {
  let cfg;
  try { cfg = configFrom(env); } catch (e) { console.error(`[taxi·supabase] ⚠️  ${e.message}: copia desactivada`); return false; }
  if (!cfg.enabled) return false;
  try {
    execFileSync(process.execPath, [__filename, 'boot', dbFile], { env, stdio: ['ignore', 'inherit', 'inherit'], timeout: Number(env.TAXI_SUPABASE_BOOT_TIMEOUT_MS) || 90_000 });
    return true;
  } catch {
    console.error('[taxi·supabase] ⚠️  No se pudo sincronizar con Supabase al arrancar: el taxi sigue con SQLite y lo reintentará');
    return false;
  }
}

// ── En marcha: subir lo que apuntan los triggers ─────────────────────────────
function start(db, dbFile, env = process.env, log = console) {
  let cfg;
  try { cfg = configFrom(env); } catch { cfg = { enabled: false }; }
  if (!cfg.enabled) {
    // Sin Supabase no se apunta nada; la marca hace que, al volver a activarlo, se suba todo lo de SQLite
    if (db.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get(LOG)) { dropTriggers(db); fs.writeFileSync(markerOf(dbFile), ''); }
    return { enabled: false, flush: async () => {}, status: () => ({ enabled: false }) };
  }
  const meta = describe(db);
  installTriggers(db, meta);   // por si el arranque falló antes de crearlos
  const byName = new Map(meta.map(t => [t.name, t]));
  const state = { failures: 0, lastFlushAt: null, lastError: null, needFull: false, lastFull: Date.now() };
  let client = null, flushing = false;

  async function connect() {
    if (client) return client;
    const c = newClient(cfg);
    c.on('error', () => { if (client === c) client = null; });
    await connectPg(c);
    client = c;
    return c;
  }

  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      const full = state.needFull || Date.now() - state.lastFull > cfg.reconcileMs;
      const logRows = db.prepare(`SELECT seq, tbl, pk FROM ${LOG} ORDER BY seq`).all();
      if (!logRows.length && !full) return;
      const maxSeq = logRows.length ? logRows[logRows.length - 1].seq : 0;
      const c = await connect();
      if (full) {
        if (state.needFull) await ensurePgSchema(c, cfg.schema, meta);
        await pushDiff(c, cfg, (await diff(db, c, cfg, meta)).filter(changed));
        state.needFull = false; state.lastFull = Date.now();
      } else {
        // la foto de las filas se toma ahora (síncrono): lo que cambie después queda para la siguiente vuelta
        const groups = new Map();
        for (const r of logRows) (groups.get(r.tbl) || groups.set(r.tbl, new Set()).get(r.tbl)).add(r.pk);
        const changes = [];
        for (const [name, pks] of groups) {
          const t = byName.get(name);
          if (!t) continue;
          const sel = db.prepare(`SELECT * FROM ${qi(t.name)} WHERE ${t.pk.map(p => `${qi(p)} = ?`).join(' AND ')}`);
          const upserts = [], deletes = [];
          for (const pk of pks) {
            const row = sel.get(...JSON.parse(pk));
            if (row) upserts.push(norm(t, row)); else deletes.push(pk);
          }
          changes.push({ t, upserts, deletes });
        }
        await pushDiff(c, cfg, changes);
      }
      if (maxSeq) db.prepare(`DELETE FROM ${LOG} WHERE seq <= ?`).run(maxSeq);
      if (state.failures) log.log('[taxi·supabase] ✅ Supabase vuelve a responder');
      state.failures = 0; state.lastError = null; state.lastFlushAt = Date.now();
    } catch (e) {
      state.failures++; state.lastError = e.code || 'error';
      if (e.code === '23503' || e.code === '42P01' || e.code === '42703') state.needFull = true;   // relación o tabla rota: se rehace y se compara todo
      if (client) { client.end().catch(() => {}); client = null; }
      if (state.failures === 1 || state.failures % 30 === 0) log.error(`[taxi·supabase] ⚠️  Error guardando en Supabase (${e.code || ''} ${String(e.message).split('\n')[0]})`);
    } finally {
      flushing = false;
    }
  }

  const tick = () => {
    const wait = state.failures ? Math.min(60_000, cfg.flushMs * 2 ** Math.min(state.failures, 6)) : cfg.flushMs;
    setTimeout(() => flush().finally(tick), wait).unref?.();
  };
  tick();
  return { enabled: true, flush, status: () => ({ enabled: true, source: cfg.source, pending: db.prepare(`SELECT count(*) AS n FROM ${LOG}`).get().n, ...state }) };
}

// ── Comprobación manual ──────────────────────────────────────────────────────
async function check(dbFile, cfg) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbFile, { readOnly: true });
  const meta = describe(db);
  const client = newClient(cfg);
  await connectPg(client);
  try {
    const all = await diff(db, client, cfg, meta);
    let bad = 0;
    for (const c of all) {
      if (changed(c)) bad++;
      console.log(`${c.t.name.padEnd(24)} ${String(c.counts[0]).padStart(6)} filas  ${changed(c) ? `DIFERENTE (${c.upserts.length} por subir, ${c.deletes.length} de más)` : 'igual'}`);
    }
    console.log(bad ? `\n${bad} tablas no coinciden` : '\nTodo coincide con taxi.db');
    process.exitCode = bad ? 1 : 0;
  } finally { await client.end().catch(() => {}); db.close(); }
}

if (require.main === module) {
  require('dotenv').config({ path: process.env.ENV_FILE || path.join(__dirname, '..', 'frontend', 'backend', '.env') });
  const [cmd, file] = process.argv.slice(2);
  const dbFile = file || process.env.TAXI_DB || path.join(__dirname, 'data', 'taxi.db');
  const cfg = configFrom();
  if (!cfg.enabled) { console.log('[taxi·supabase] desactivado (faltan TAXI_SUPABASE_HOST/PASSWORD o SOURCE=off)'); process.exit(0); }
  const run = cmd === 'boot' ? boot : cmd === 'check' ? check : null;
  if (!run) { console.log('Uso: node supabase.js boot|check [taxi.db]'); process.exit(64); }
  run(dbFile, cfg).catch((e) => { console.error(`[taxi·supabase] Error: ${e.code || ''} ${String(e.message).split('\n')[0]}`); process.exit(2); });
}

module.exports = { bootSync, start, configFrom, encrypt, decrypt, describe, ENCRYPTED, EPHEMERAL };
