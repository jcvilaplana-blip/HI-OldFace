// Copia del taxi en Supabase (supabase.js): cifrado y, si hay base de pruebas, el taxi real contra el esquema taxi_test
// (nunca el de producción): primera migración, cambios fila a fila, posición de conductores sin copias, secretos
// cifrados, restaurar taxi.db desde Supabase, Supabase caído y que nadie más puede entrar.
// Uso: npm test · con base de pruebas: DB_TEST_ENV=<archivo con DB_HOST, TAXI_DB_USER, TAXI_DB_PASSWORD, TAXI_ENC_KEY>
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const sb = require('../supabase.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond ? '' : ' → ' + String(extra ?? '').slice(0, 300)}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── 1) Sin base de datos ─────────────────────────────────────────────────────
const key = crypto.randomBytes(32);
const secret = JSON.stringify({ stripe: { secretKey: 'sk_test_123' } });
const enc = sb.encrypt(key, secret);
ok('cifrado: no se ve el secreto', enc.startsWith('enc:v1:') && !enc.includes('sk_test'));
ok('cifrado: se recupera igual', sb.decrypt(key, enc) === secret);
let threw = false; try { sb.decrypt(crypto.randomBytes(32), enc); } catch { threw = true; }
ok('cifrado: otra clave no lo abre', threw);
ok('texto sin cifrar pasa igual', sb.decrypt(key, 'hola') === 'hola');
ok('sin TAXI_SUPABASE_HOST está apagado', sb.configFrom({}).enabled === false);
threw = false; try { sb.configFrom({ TAXI_SUPABASE_HOST: 'h', TAXI_SUPABASE_PASSWORD: 'p' }); } catch { threw = true; }
ok('sin clave de cifrado no arranca la copia', threw);
{
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8'));
  const meta = sb.describe(db);
  ok('todas las tablas del taxi tienen clave primaria', meta.length === db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n, meta.length);
  ok('importes como número decimal', meta.find(t => t.name === 'bookings').cols.find(c => c.name === 'total_amount').kind === 'double precision');
  ok('claves como entero', meta.find(t => t.name === 'bookings').cols.find(c => c.name === 'customer_id').kind === 'bigint');
  db.close();
}

// ── 2) Taxi real contra Supabase (esquema taxi_test) ─────────────────────────
const envFile = process.env.DB_TEST_ENV;
if (!envFile) {
  console.log('\n(sin DB_TEST_ENV: se omite la prueba contra Supabase)');
} else {
  const v = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const S = 'taxi_test';
  const SB = { TAXI_SUPABASE_HOST: v.DB_HOST, TAXI_SUPABASE_PORT: v.DB_PORT_SESSION || '5432', TAXI_SUPABASE_USER: v.TAXI_DB_USER,
    TAXI_SUPABASE_PASSWORD: v.TAXI_DB_PASSWORD, TAXI_SUPABASE_SCHEMA: S, TAXI_SUPABASE_KEY: v.TAXI_ENC_KEY, TAXI_SUPABASE_FLUSH_MS: '200' };
  const { Client } = require('pg');
  const pg = new Client({ host: v.DB_HOST, port: Number(SB.TAXI_SUPABASE_PORT), user: v.TAXI_DB_USER, password: v.TAXI_DB_PASSWORD, database: 'postgres',
    ssl: { rejectUnauthorized: true, ca: fs.readFileSync(path.join(ROOT, 'supabase-ca-2021.crt'), 'utf8') } });
  await pg.connect();
  const sql = async (q, p) => (await pg.query(q, p)).rows;
  const dropAll = async () => { for (const { tablename } of await sql('select tablename from pg_tables where schemaname = $1', [S])) await sql(`drop table if exists ${S}."${tablename}" cascade`); };
  await dropAll();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taxi-sb-'));
  const DBF = path.join(dir, 'taxi.db');
  const PORT = 4197, B = `http://127.0.0.1:${PORT}/taxi`;
  let srv = null, log = '';
  const startSrv = async (extra = {}) => {
    log = '';
    const env = { ...process.env, TAXI_DB: DBF, TAXI_PORT: String(PORT), ENV_FILE: path.join(dir, 'none.env'), ADMIN_EMAIL: 'admin@test.es',
      ADMIN_PASSWORD: 'Clave-segura-1', RTC_SECRET: 'test-secret', ...SB, ...extra };
    srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
    for (let i = 0; i < 200; i++) { try { if ((await fetch(B + '/health')).ok) return true; } catch { /* arrancando */ } await sleep(150); }
    return false;
  };
  const stopSrv = async () => { if (!srv) return; srv.kill(); await new Promise(r => srv.once('exit', r)); srv = null; };
  const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(150); } return false; };
  const local = () => { const d = new DatabaseSync(DBF); d.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;'); return d; };
  const checkCmd = (extra = {}) => spawnSync(process.execPath, ['supabase.js', 'check', DBF], { cwd: ROOT, env: { ...process.env, ENV_FILE: path.join(dir, 'none.env'), ...SB, ...extra }, encoding: 'utf8' });

  try {
    ok('el taxi arranca con Supabase', await startSrv(), log.slice(-400));
    ok('log: sincronizado al arrancar', /\[taxi·supabase\] sqlite: subidos/.test(log), log.slice(-300));   // base nueva: los datos iniciales suben al crearse
    const pgTables = (await sql('select count(*)::int n from pg_tables where schemaname = $1', [S]))[0].n;
    const d0 = local();
    const liteTables = d0.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_sync_log'").get().n;
    ok(`las mismas tablas en Supabase (${liteTables})`, pgTables === liteTables, `${pgTables} vs ${liteTables}`);
    ok('relaciones entre tablas creadas', (await sql(`select count(*)::int n from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = $1 and contype = 'f'`, [S]))[0].n >= 20);
    ok('datos iniciales subidos (permisos, roles, países)', await waitFor(async () => (await sql(`select count(*)::int n from ${S}.permissions`))[0].n === d0.prepare('SELECT count(*) n FROM permissions').get().n));
    ok('panel: administrador y roles en Supabase', (await sql(`select count(*)::int n from ${S}.admin_users`))[0].n === 1 && (await sql(`select count(*)::int n from ${S}.roles`))[0].n === 2);
    const pay = (await sql(`select value from ${S}.settings where key = 'payments'`))[0]?.value || '';
    ok('ajustes de pagos CIFRADOS en Supabase', pay.startsWith('enc:v1:') && !/secretKey|stripe/.test(pay), pay.slice(0, 40));
    ok('ajustes sin secretos se ven normales', JSON.parse((await sql(`select value from ${S}.settings where key = 'currency'`))[0].value).code === 'EUR');
    ok('check: todo coincide', checkCmd().status === 0);

    // Cambios en marcha (otro proceso escribe en taxi.db: los triggers lo apuntan y el taxi lo sube)
    const t = Date.now();
    const city = d0.prepare("INSERT INTO cities (country_id, name, lat, lng, created_at) VALUES (1, 'Ciudad Prueba', 40.1, -3.2, ?)").run(t).lastInsertRowid;
    d0.prepare("INSERT INTO zones (city_id, name, surge, created_at) VALUES (?, 'Centro', 1.25, ?)").run(city, t);
    ok('ciudad y zona nuevas llegan a Supabase', await waitFor(async () => (await sql(`select z.surge from ${S}.zones z join ${S}.cities c on c.id = z.city_id where c.name = 'Ciudad Prueba'`))[0]?.surge === 1.25));
    d0.prepare("UPDATE cities SET name = 'Ciudad Renombrada' WHERE id = ?").run(city);
    ok('el cambio de nombre llega', await waitFor(async () => (await sql(`select name from ${S}.cities where id = $1`, [city]))[0]?.name === 'Ciudad Renombrada'));
    d0.prepare('DELETE FROM zones WHERE city_id = ?').run(city);
    ok('borrar una zona la borra en Supabase', await waitFor(async () => (await sql(`select count(*)::int n from ${S}.zones where city_id = $1`, [city]))[0].n === 0));

    d0.prepare("INSERT INTO taxi_accounts (user_id, role, created_at) VALUES ('user_test_d', 'driver', ?)").run(t);
    const drv = d0.prepare("INSERT INTO drivers (user_id, name, status, lat, lng, created_at) VALUES ('user_test_d', 'Conductor', 'active', 40, -3, ?)").run(t).lastInsertRowid;
    ok('conductor nuevo llega', await waitFor(async () => (await sql(`select lat from ${S}.drivers where id = $1`, [drv]))[0]?.lat === 40));
    await waitFor(async () => d0.prepare('SELECT count(*) n FROM _sync_log').get().n === 0, 3000);
    d0.prepare('UPDATE drivers SET lat = 41, lng = -4, location_at = ? WHERE id = ?').run(Date.now(), drv);
    ok('mover al conductor no apunta nada que subir', d0.prepare('SELECT count(*) n FROM _sync_log').get().n === 0);
    d0.prepare("UPDATE drivers SET status = 'blocked' WHERE id = ?").run(drv);
    ok('otro cambio del conductor sube la fila entera (posición al día)', await waitFor(async () => { const r = (await sql(`select status, lat from ${S}.drivers where id = $1`, [drv]))[0]; return r?.status === 'blocked' && r?.lat === 41; }));

    d0.prepare("INSERT INTO withdrawal_requests (driver_id, amount, account_details, created_at) VALUES (?, 50, 'ES76 0000 1111 2222 3333 4444', ?)").run(drv, t);
    ok('datos bancarios CIFRADOS en Supabase', await waitFor(async () => { const r = (await sql(`select account_details a from ${S}.withdrawal_requests where driver_id = $1`, [drv]))[0]; return r && r.a.startsWith('enc:v1:') && !r.a.includes('ES76'); }));
    ok('… y sin cifrar en taxi.db (el taxi los usa)', d0.prepare('SELECT account_details a FROM withdrawal_requests WHERE driver_id = ?').get(drv).a.startsWith('ES76'));
    const before = { perms: d0.prepare('SELECT count(*) n FROM permissions').get().n, pay: d0.prepare("SELECT value FROM settings WHERE key = 'payments'").get().value };
    d0.close();
    await waitFor(async () => checkCmd().status === 0);
    await stopSrv();

    // taxi.db perdida → se restaura sola desde Supabase al arrancar
    for (const f of ['', '-wal', '-shm']) fs.rmSync(DBF + f, { force: true });
    ok('arranca sin taxi.db', await startSrv(), log.slice(-400));
    ok('log: restaurada desde Supabase', /restaurada desde Supabase/.test(log), log.slice(-300));
    const d1 = local();
    ok('permisos restaurados (sin volver a sembrar)', d1.prepare('SELECT count(*) n FROM permissions').get().n === before.perms);
    ok('secretos de pagos restaurados descifrados', d1.prepare("SELECT value FROM settings WHERE key = 'payments'").get().value === before.pay);
    ok('datos bancarios restaurados descifrados', d1.prepare('SELECT account_details a FROM withdrawal_requests WHERE driver_id = ?').get(drv)?.a.startsWith('ES76'));
    ok('conductor restaurado', d1.prepare('SELECT status FROM drivers WHERE id = ?').get(drv)?.status === 'blocked');
    const L = await fetch(B + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@test.es', password: 'Clave-segura-1' }) });
    ok('el administrador entra en el panel tras restaurar', L.status === 200);
    d1.close();
    await stopSrv();

    // Supabase caído: el taxi arranca igual y lo sube cuando vuelve
    ok('arranca aunque Supabase falle', await startSrv({ TAXI_SUPABASE_PASSWORD: 'mala' }), log.slice(-400));
    ok('avisa sin mostrar la contraseña', /No se pudo sincronizar/.test(log) && !log.includes(v.TAXI_DB_PASSWORD));
    const d2 = local();
    d2.prepare("INSERT INTO cities (country_id, name, created_at) VALUES (1, 'Sin Supabase', ?)").run(Date.now());
    await sleep(600);
    ok('el cambio queda apuntado', d2.prepare('SELECT count(*) n FROM _sync_log').get().n > 0);
    d2.close();
    await stopSrv();
    ok('al volver Supabase arranca', await startSrv({ TAXI_SUPABASE_SOURCE: 'supabase' }), log.slice(-400));
    ok('lo pendiente se sube (SQLite manda aunque SOURCE=supabase)', (await sql(`select count(*)::int n from ${S}.cities where name = 'Sin Supabase'`))[0].n === 1);
    ok('check: todo coincide', checkCmd().status === 0);
    await stopSrv();

    // Nadie más: roles públicos y el usuario de OldFace no entran; RLS en todas las tablas
    for (const role of ['anon', 'authenticated', 'service_role', 'oldface_app']) {
      for (const schema of ['taxi', S]) ok(`${role} no puede entrar en ${schema}`, (await sql("select has_schema_privilege($1, $2, 'USAGE') u", [role, schema]))[0].u === false);
    }
    ok('taxi_app no puede entrar en oldface', (await sql("select has_schema_privilege('taxi_app', 'oldface', 'USAGE') u"))[0].u === false);
    const noRls = await sql(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relkind = 'r' and not c.relrowsecurity`, [S]);
    ok('RLS activado en todas las tablas', noRls.length === 0, noRls.map(r => r.relname).join());
  } finally {
    await stopSrv();
    await dropAll();
    await pg.end();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${pass} OK, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
