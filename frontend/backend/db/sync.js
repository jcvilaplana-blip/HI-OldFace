/**
 * Sincronización al arrancar la API (la lanza db/index.js antes de cargar los datos) y migración manual.
 *
 *   node db/sync.js boot <dataDir>      — crea tablas que falten y deja data/ y Supabase iguales:
 *       · DB_SOURCE=json (transición): data/ manda → se suben a Supabase las diferencias.
 *       · DB_SOURCE=supabase: Supabase manda → se reescriben los archivos de data/ que cambien (con copia antes).
 *       · Si quedaron cambios sin subir (data/.db-pending) se suben primero, sea cual sea el modo.
 *       · Si Supabase está vacío y data/ no, se suben los datos (primera migración).
 *   node db/sync.js check <dataDir>     — compara sin cambiar nada y dice qué tablas no coinciden
 *
 * Seguridad: un archivo que no existe en data/ nunca borra filas de Supabase. Solo se escriben recuentos en el log.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const core = require('./core');
const { TABLES, FILES, TABLE_NAMES, EMPTY, tablesOf } = require('./tables');

const PENDING = '.db-pending';

function readLocal(dataDir, file) {
  const p = path.join(dataDir, file);
  if (!fs.existsSync(p)) return { exists: false, data: undefined };
  return { exists: true, data: JSON.parse(fs.readFileSync(p, 'utf8')) };   // un JSON roto detiene la sincronización
}

async function readAll(client, schema) {
  const byTable = {};
  for (const t of TABLE_NAMES) byTable[t] = await core.readTable(client, schema, t);
  return byTable;
}

/** Diferencias entre data/ y Supabase: [{ table, upserts, deletes }] (solo de archivos que existen en data/) */
function diffPush(dataDir, dbRows) {
  const out = [];
  for (const t of TABLES) {
    const local = readLocal(dataDir, t.file);
    if (!local.exists) continue;
    const want = core.rowsOf(t, local.data);
    const have = new Map((dbRows[t.table] || [])
      .filter(r => t.kind !== 'doc' || r.k === t.file)
      .map(r => [core.rowKey(r.k, r.k2), `${r.pos}|${core.canon(r.data)}`]));
    const upserts = [...want.entries()].filter(([key, r]) => have.get(key) !== r.sig).map(([, r]) => r);
    const deletes = t.kind === 'doc' ? [] : [...have.keys()].filter(key => !want.has(key)).map(key => {
      const [k, k2] = key.split('\u0001'); return { k, k2 };
    });
    if (upserts.length || deletes.length) out.push({ table: t.table, upserts, deletes });
  }
  return out;
}

async function push(client, schema, changes) {
  await client.query('begin');
  try {
    for (const c of changes) await core.writeRows(client, schema, c.table, c.upserts, c.deletes);
    await client.query('commit');
  } catch (e) { await client.query('rollback').catch(() => {}); throw e; }
}

/** Reescribe en data/ los archivos que difieren de Supabase; guarda antes una copia en data/.db-backup/<fecha>/ */
function pull(dataDir, dbRows) {
  const changed = [];
  const backupDir = path.join(dataDir, '.db-backup', new Date().toISOString().replace(/[:.]/g, '-'));
  for (const file of FILES) {
    const ts = tablesOf(file);
    const hasRows = ts.some(t => (dbRows[t.table] || []).some(r => t.kind !== 'doc' || r.k === file));
    const local = readLocal(dataDir, file);
    if (!hasRows && (!local.exists || ts[0].kind === 'doc')) continue;   // nada que traer: se queda lo de data/ o el valor por defecto
    const remote = hasRows ? core.fileFromTables(file, dbRows) : (EMPTY[file] !== undefined ? EMPTY[file] : {});
    if (remote === undefined) continue;
    if (local.exists && core.canon(local.data) === core.canon(remote)) continue;
    if (local.exists) {
      fs.mkdirSync(backupDir, { recursive: true });
      fs.copyFileSync(path.join(dataDir, file), path.join(backupDir, file));
    }
    const tmp = path.join(dataDir, `${file}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(remote, null, 2), 'utf8');
    fs.renameSync(tmp, path.join(dataDir, file));
    changed.push(file);
  }
  return changed;
}

async function boot(dataDir, cfg) {
  const client = core.newClient(cfg);
  await client.connect();
  try {
    await core.ensureSchema(client, cfg.schema);
    let dbRows = await readAll(client, cfg.schema);
    const dbEmpty = TABLE_NAMES.every(t => !dbRows[t].length);
    const localFiles = FILES.filter(f => fs.existsSync(path.join(dataDir, f)));
    const pending = fs.existsSync(path.join(dataDir, PENDING));
    const report = [];

    if (cfg.source === 'json' || pending || (dbEmpty && localFiles.length)) {
      const changes = diffPush(dataDir, dbRows);
      if (changes.length) {
        await push(client, cfg.schema, changes);
        dbRows = await readAll(client, cfg.schema);
      }
      const n = changes.reduce((a, c) => a + c.upserts.length + c.deletes.length, 0);
      report.push(`subidos ${n} cambios en ${changes.length} tablas` + (pending ? ' (había cambios pendientes)' : '') + (dbEmpty ? ' (primera migración)' : ''));
    }
    if (cfg.source === 'supabase') {
      const changed = pull(dataDir, dbRows);
      report.push(changed.length ? `actualizados desde Supabase: ${changed.length} archivos` : 'data/ ya coincide con Supabase');
    }
    fs.rmSync(path.join(dataDir, PENDING), { force: true });
    const rows = TABLE_NAMES.reduce((a, t) => a + dbRows[t].length, 0);
    console.log(`[DB] Supabase (${cfg.source}): ${report.join(' · ')} · ${rows} filas en ${TABLE_NAMES.length} tablas`);
  } finally {
    await client.end().catch(() => {});
  }
}

async function check(dataDir, cfg) {
  const client = core.newClient(cfg);
  await client.connect();
  try {
    const dbRows = await readAll(client, cfg.schema);
    const changes = diffPush(dataDir, dbRows);
    for (const t of TABLE_NAMES) {
      const c = changes.find(x => x.table === t);
      console.log(`${t.padEnd(20)} ${String(dbRows[t].length).padStart(5)} filas  ${c ? `DIFERENTE (${c.upserts.length} por subir, ${c.deletes.length} de más)` : 'igual'}`);
    }
    console.log(changes.length ? `\n${changes.length} tablas no coinciden con data/` : '\nTodo coincide con data/');
    process.exitCode = changes.length ? 1 : 0;
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  const [cmd, dataDir = path.join(__dirname, '..', 'data')] = process.argv.slice(2);
  const cfg = core.configFrom();
  if (!cfg.enabled) { console.log('[DB] Supabase desactivado (faltan DB_HOST/DB_PASSWORD o DB_SOURCE=off)'); process.exit(0); }
  const run = cmd === 'boot' ? boot : cmd === 'check' ? check : null;
  if (!run) { console.log('Uso: node db/sync.js boot|check [dataDir]'); process.exit(64); }
  run(dataDir, cfg).catch((e) => {
    console.error(`[DB] Error con Supabase: ${e.code || ''} ${String(e.message).split('\n')[0]}`);
    process.exit(2);
  });
}

module.exports = { boot, check, diffPush, pull, PENDING };
