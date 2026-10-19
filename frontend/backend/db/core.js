/**
 * Núcleo de la base de datos (Supabase / Postgres): conexión, tablas, y paso de archivo ⇄ filas.
 * Lo usan db/index.js (la API, en marcha) y db/sync.js (al arrancar). Nunca registra el contenido de los datos.
 */
const fs = require('fs');
const path = require('path');
const { TABLES, APPEND_TABLES, EMPTY, TABLE_NAMES, tablesOf } = require('./tables');

/** Configuración desde .env. Sin DB_HOST o DB_PASSWORD (o con DB_SOURCE=off) la base de datos está apagada. */
function configFrom(env = process.env) {
  const source = String(env.DB_SOURCE || 'json').toLowerCase();
  const schema = String(env.DB_SCHEMA || 'oldface');
  const enabled = !!(env.DB_HOST && env.DB_PASSWORD) && source !== 'off';
  if (enabled && !/^[a-z_][a-z0-9_]{0,40}$/.test(schema)) throw new Error('DB_SCHEMA no válido');
  if (enabled && !['json', 'supabase'].includes(source)) throw new Error('DB_SOURCE debe ser json, supabase u off');
  const caFile = env.DB_SSL_CA || path.join(__dirname, 'supabase-ca-2021.crt');
  return {
    enabled, source, schema,
    pg: enabled ? {
      host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, user: env.DB_USER, password: env.DB_PASSWORD,
      database: env.DB_NAME || 'postgres',
      // Conexión cifrada y verificada con el certificado raíz de Supabase (DB_SSL=off solo para pruebas locales)
      ssl: env.DB_SSL === 'off' ? false : { rejectUnauthorized: true, ca: fs.readFileSync(caFile, 'utf8') },
      connectionTimeoutMillis: 15000, statement_timeout: 30000, application_name: 'oldface-api',
    } : null,
  };
}

/** JSON con las claves ordenadas: Postgres (jsonb) cambia el orden, así se comparan igual los dos lados */
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(x => (x === undefined ? 'null' : canon(x))).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}

const rowKey = (k, k2) => `${k}\u0001${k2}`;

/** Filas de una tabla a partir del contenido del archivo: Map(rowKey → { k, k2, pos, data, sig }) */
function rowsOf(t, fileData) {
  const out = new Map();
  const add = (k, k2, pos, data) => {
    let key2 = k2, n = 1;
    while (out.has(rowKey(k, key2))) key2 = `${k2}#${++n}`;   // ids repetidos: se guardan todos igualmente
    out.set(rowKey(k, key2), { k, k2: key2, pos, data, sig: `${pos}|${canon(data)}` });
  };
  const src = t.part ? (fileData || {})[t.part] : fileData;
  if (t.kind === 'doc') {
    if (fileData != null) add(t.file, '', 0, fileData);
  } else if (t.kind === 'list') {
    (Array.isArray(src) ? src : []).forEach((x, i) => add(String(x?.id ?? `#${i}`), '', i, x));
  } else if (t.kind === 'rows') {
    for (const [k, arr] of Object.entries(src || {})) {
      if (!Array.isArray(arr) || !arr.length) { add(k, '', -1, arr); continue; }   // lista vacía o valor raro: fila «marcador»
      arr.forEach((x, i) => add(k, String(x?.id ?? `#${i}`) || `#${i}`, i, x));
    }
  } else {   // map
    Object.entries(src || {}).forEach(([k, v], i) => add(k, '', i, v));
  }
  return out;
}

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Contenido de la tabla dentro del archivo a partir de sus filas (inverso de rowsOf) */
function fromRows(t, rows) {
  if (t.kind === 'doc') return rows.find(r => r.k === t.file)?.data;
  if (t.kind === 'rows') {
    const out = {};
    for (const r of [...rows].sort((a, b) => byText(a.k, b.k) || a.pos - b.pos)) {
      if (r.pos === -1) { out[r.k] = r.data; continue; }   // marcador de una lista vacía
      (Array.isArray(out[r.k]) ? out[r.k] : (out[r.k] = [])).push(r.data);
    }
    return out;
  }
  const sorted = [...rows].sort((a, b) => a.pos - b.pos || byText(a.k, b.k));
  if (t.kind === 'list') return sorted.map(r => r.data);
  return Object.fromEntries(sorted.map(r => [r.k, r.data]));
}

/** Archivo completo a partir de las filas de sus tablas: { table → [filas] } */
function fileFromTables(file, rowsByTable) {
  const ts = tablesOf(file);
  if (ts[0].kind === 'doc') return fromRows(ts[0], (rowsByTable[ts[0].table] || []).filter(r => r.k === file));
  if (ts.some(t => t.part)) {
    const out = structuredClone(EMPTY[file] || {});
    for (const t of ts) out[t.part] = fromRows(t, rowsByTable[t.table] || []);
    return out;
  }
  return fromRows(ts[0], rowsByTable[ts[0].table] || []);
}

const q = (id) => `"${String(id).replace(/"/g, '""')}"`;

/** Crea las tablas que falten (se puede repetir sin peligro). RLS activado y sin permisos para nadie más. */
async function ensureSchema(client, schema) {
  const S = q(schema);
  for (const name of TABLE_NAMES) {
    const T = `${S}.${q(name)}`;
    await client.query(`create table if not exists ${T} (
      k text not null, k2 text not null default '', pos integer not null default 0, data jsonb,
      updated_at timestamptz not null default now(), primary key (k, k2))`);
    const cols = Object.assign({}, ...TABLES.filter(t => t.table === name).map(t => t.cols || {}));
    for (const [col, field] of Object.entries(cols)) {
      await client.query(`alter table ${T} add column if not exists ${q(col)} text
        generated always as (case when jsonb_typeof(data) = 'object' then data->>'${field.replace(/'/g, "''")}' end) stored`);
    }
    await client.query(`alter table ${T} enable row level security`);
  }
  for (const name of APPEND_TABLES) {
    const T = `${S}.${q(name)}`;
    await client.query(`create table if not exists ${T} (id bigserial primary key, at timestamptz not null default now(), entry jsonb not null)`);
    await client.query(`alter table ${T} enable row level security`);
  }
}

/** Escribe cambios de una tabla: upserts [{k,k2,pos,data}] y borrados [{k,k2}] */
async function writeRows(client, schema, table, upserts, deletes) {
  const T = `${q(schema)}.${q(table)}`;
  for (let i = 0; i < deletes.length; i += 500) {
    await client.query(`delete from ${T} t using jsonb_to_recordset($1::jsonb) as x(k text, k2 text)
      where t.k = x.k and t.k2 = x.k2`, [JSON.stringify(deletes.slice(i, i + 500).map(({ k, k2 }) => ({ k, k2 })))]);
  }
  for (let i = 0; i < upserts.length; i += 200) {
    const batch = upserts.slice(i, i + 200).map(({ k, k2, pos, data }) => ({ k, k2, pos, data: data === undefined ? null : data }));
    await client.query(`insert into ${T} (k, k2, pos, data)
      select k, k2, pos, data from jsonb_to_recordset($1::jsonb) as x(k text, k2 text, pos integer, data jsonb)
      on conflict (k, k2) do update set pos = excluded.pos, data = excluded.data, updated_at = now()`,
    [JSON.stringify(batch, (_k, v) => (typeof v === 'string' ? v.replace(/\u0000/g, '') : v))]);   // Postgres no admite \u0000 en jsonb
  }
}

async function readTable(client, schema, table) {
  const r = await client.query(`select k, k2, pos, data from ${q(schema)}.${q(table)}`);
  return r.rows;
}

function newClient(cfg) {
  const { Client } = require('pg');
  return new Client(cfg.pg);
}

module.exports = { configFrom, canon, rowKey, rowsOf, fromRows, fileFromTables, ensureSchema, writeRows, readTable, newClient, q };
