// Supabase (db/): paso archivo ⇄ filas sin pérdidas y, si hay base de pruebas, la API real contra el esquema
// oldface_test (nunca el de producción): migración, guardado fila a fila, recuperar data/ desde Supabase, Supabase
// caído (la API sigue y lo sube después) y que nadie más que la API puede entrar en las tablas.
// Uso: npm test · con base de pruebas: DB_TEST_ENV=<archivo con DB_HOST, DB_USER, DB_PASSWORD…> node test/db.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const core = require('../db/core.js');
const { TABLES, APPEND_TABLES, TABLE_NAMES, FILES, tablesOf } = require('../db/tables.js');

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => { cond ? ok++ : fail++; console.log(`${cond ? 'OK ' : 'FALLO'}  ${name}${cond ? '' : '  ' + extra}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── 1) Archivo → filas → archivo, sin base de datos ─────────────────────────
const A = 'user_34600000001', B = 'user_34600000002';
const CHAT = `chat_${[A, B].sort().join('_')}`;
const SAMPLE = {
  'users.json': { '+34600000001': { userId: A, name: 'Ana', phone: '+34600000001', avatar: null }, '+34600000002': { userId: B, name: 'Bea', phone: '+34600000002' } },
  'messages.json': {
    [CHAT]: [
      { id: 'm1', chatId: CHAT, senderId: A, text: 'hola', type: 'text', createdAt: 1, readBy: [A] },
      { id: 'm1', chatId: CHAT, senderId: B, text: 'id repetido', type: 'text', createdAt: 2 },
      { id: 'm2', chatId: CHAT, senderId: B, text: 'ñandú 😀', type: 'text', createdAt: 3, replyTo: { id: 'm1', text: 'hola' } },
    ],
    vacio: [],
  },
  'stories.json': [{ id: 's1', userId: A, expiresAt: 9 }, { id: 's2', userId: B, expiresAt: 8 }],
  'devices.json': { byUser: { [A]: [{ deviceId: 'd1', name: 'Móvil' }] }, revoked: { d0: { userId: A, at: 1 } } },
  'live_settings.json': { mode: 'admin', broadcasters: ['a@x.com'] },
  'ai_usage.json': { day: '2026-10-19', users: { [A]: { requests: 2, input: 10, output: 5, voice: 0 } } },
  'call_log.json': { [A]: [{ id: 'c1', userId: A, contactId: B, type: 'voice', direction: 'out', timestamp: 5 }] },
  'poll_votes.json': { p1: { [A]: 'o1', [B]: 'o2' } },
};
for (const [file, data] of Object.entries(SAMPLE)) {
  const byTable = {};
  for (const t of tablesOf(file)) byTable[t.table] = [...(byTable[t.table] || []), ...core.rowsOf(t, data).values()];
  check(`ida y vuelta sin pérdidas: ${file}`, core.canon(core.fileFromTables(file, byTable)) === core.canon(data));
}
check('canon no depende del orden de las claves', core.canon({ a: 1, b: { c: 2, d: 3 } }) === core.canon({ b: { d: 3, c: 2 }, a: 1 }));
check('ids repetidos no se pisan', core.rowsOf(TABLES.find(t => t.table === 'messages'), SAMPLE['messages.json']).size === 4);
check('cada archivo de data/ que usa server.js tiene tabla', ['users.json', 'chats.json', 'messages.json', 'directos.json', 'fcm_tokens.json',
  'call_log.json', 'stories.json', 'groups.json', 'subscriptions.json', 'poll_polls.json', 'poll_votes.json', 'poll_categories.json',
  'poll_profiles.json', 'karaoke_songs.json', 'karaoke_recordings.json', 'karaoke_genres.json', 'karaoke_bans.json', 'stickers.json',
  'user_prefs.json', 'devices.json', 'story_privacy.json', 'user_privacy.json', 'user_contacts.json', 'live_settings.json',
  'live_recordings.json', 'muted_chats.json', 'reminders.json', 'ai_media.json', 'ai_usage.json'].every(f => FILES.includes(f)));
check('sin DB_HOST la base de datos está apagada', core.configFrom({}).enabled === false);
check('DB_SOURCE=off la apaga aunque haya datos', core.configFrom({ DB_HOST: 'h', DB_PASSWORD: 'p', DB_SOURCE: 'off' }).enabled === false);
let threw = false; try { core.configFrom({ DB_HOST: 'h', DB_PASSWORD: 'p', DB_SCHEMA: 'x; drop' }); } catch { threw = true; }
check('esquema con caracteres raros → error', threw);

// ── 2) API real contra Supabase (esquema oldface_test) ──────────────────────
const envFile = process.env.DB_TEST_ENV;
if (!envFile) {
  console.log('\n(sin DB_TEST_ENV: se omite la prueba contra Supabase)');
} else {
  const dbEnv = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const DBV = { DB_HOST: dbEnv.DB_HOST, DB_PORT: dbEnv.DB_PORT_SESSION || dbEnv.DB_PORT || '5432', DB_USER: dbEnv.DB_USER,
    DB_PASSWORD: dbEnv.DB_PASSWORD, DB_NAME: dbEnv.DB_NAME || 'postgres', DB_SCHEMA: 'oldface_test' };
  const cfg = core.configFrom({ ...DBV, DB_SOURCE: 'json' });
  const S = 'oldface_test';
  const pg = core.newClient(cfg);
  await pg.connect();
  const sql = async (text, params) => (await pg.query(text, params)).rows;
  const dropAll = async () => { for (const t of [...TABLE_NAMES, ...APPEND_TABLES]) await sql(`drop table if exists ${S}.${core.q(t)}`); };
  await dropAll();

  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'oldface-db-'));
  fs.mkdirSync(path.join(DIR, 'data')); fs.mkdirSync(path.join(DIR, 'uploads'));
  for (const f of ['server.js', 'admin.html']) fs.copyFileSync(path.join(SRC, f), path.join(DIR, f));
  for (const d of ['ai', 'db']) fs.cpSync(path.join(SRC, d), path.join(DIR, d), { recursive: true });
  const dataFile = (f) => path.join(DIR, 'data', f);
  const write = (f, v) => fs.writeFileSync(dataFile(f), JSON.stringify(v));
  write('users.json', SAMPLE['users.json']);
  write('chats.json', { [CHAT]: { id: CHAT, participants: [A, B], name: 'Chat', createdAt: 1, lastMessage: 'hola', lastTime: 1 } });
  write('messages.json', { [CHAT]: SAMPLE['messages.json'][CHAT].filter((m, i) => i !== 1).map(m => ({ ...m, createdAt: Date.now() })) });
  write('devices.json', { byUser: { [A]: [{ deviceId: 'devA', name: 'Móvil', platform: 'android', linkedAt: 1, lastSeen: 1 }] }, revoked: {} });
  write('live_settings.json', SAMPLE['live_settings.json']);

  const SECRET = 'test-secret';
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const tokenA = `${A}.${exp}.${crypto.createHmac('sha256', SECRET).update(`${A}.${exp}`).digest('base64url')}`;
  const PORT = 3994, BASE = `http://127.0.0.1:${PORT}`;
  let srv = null, log = '';
  const start = async (extra) => {
    log = '';
    const env = { ...process.env, PORT, RTC_SECRET: SECRET, NODE_PATH: path.join(SRC, 'node_modules'), RTC_INTERNAL_URL: '',
      ANTHROPIC_API_KEY: '', AI_PROVIDER: 'off', DB_FLUSH_MS: '50', ...DBV, ...extra };
    srv = spawn(process.execPath, ['server.js'], { cwd: DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    for (let i = 0; i < 150; i++) { try { if ((await fetch(`${BASE}/health`)).ok) return true; } catch { /* arrancando */ } await sleep(200); }
    return false;
  };
  const stop = async () => { if (!srv) return; srv.kill(); await new Promise(r => srv.once('exit', r)); srv = null; };
  const call = async (method, p, body) => {
    const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(150); } return false; };
  const msgRows = () => sql(`select k2, data, sender_id from ${S}.messages where k = $1 order by pos`, [CHAT]);

  try {
    // Primera migración: Supabase vacío → se suben los datos de data/
    check('arranca con Supabase', await start({ DB_SOURCE: 'json' }), log.slice(-400));
    check('log: primera migración', /primera migración/.test(log), log.slice(-300));
    check('log sin contenido de mensajes', !/hola|ñandú/.test(log));
    const tablesNow = (await sql(`select tablename from pg_tables where schemaname = $1`, [S])).map(r => r.tablename);
    check('creadas todas las tablas', [...TABLE_NAMES, ...APPEND_TABLES].every(t => tablesNow.includes(t)));
    check('mensajes subidos (2)', (await msgRows()).length === 2);
    check('usuarios subidos (2) con columnas legibles', (await sql(`select name from ${S}.users order by name`)).map(r => r.name).join() === 'Ana,Bea');
    check('documento live_settings subido', (await sql(`select data from ${S}.app_docs where k = 'live_settings.json'`))[0]?.data?.mode === 'admin');
    check('dispositivos en su tabla (parte byUser)', (await sql(`select k from ${S}.devices`)).length === 1);

    // Cambios en marcha: se guardan solos, fila a fila
    const sent = await call('POST', '/messages', { chatId: CHAT, senderId: A, text: 'nuevo desde la API' });
    check('enviar mensaje → 200', sent.status === 200, JSON.stringify(sent.body));
    check('el mensaje nuevo llega a Supabase', await waitFor(async () => (await msgRows()).some(r => r.data.text === 'nuevo desde la API')));
    const before = (await sql(`select updated_at from ${S}.messages where k = $1 and k2 = 'm2'`, [CHAT]))[0]?.updated_at;
    const ed = await call('POST', `/messages/${CHAT}/m1/edit`, { userId: A, text: 'editado' });
    check('editar mensaje → 200', ed.status === 200, JSON.stringify(ed.body));
    check('la edición llega a Supabase', await waitFor(async () => (await msgRows()).find(r => r.k2 === 'm1')?.data.text === 'editado'));
    const after = (await sql(`select updated_at from ${S}.messages where k = $1 and k2 = 'm2'`, [CHAT]))[0]?.updated_at;
    check('solo se reescribe la fila que cambia (m2 intacto)', String(before) === String(after));
    check('el chat (último mensaje) también', await waitFor(async () => (await sql(`select data from ${S}.chats where k = $1`, [CHAT]))[0]?.data.lastMessage !== 'hola'));
    check('sin cambios pendientes al terminar', await waitFor(async () => !fs.existsSync(dataFile('.db-pending'))));
    await stop();

    // Supabase manda: data/ perdido o viejo → se recupera al arrancar (con copia del archivo viejo)
    fs.rmSync(dataFile('messages.json'));
    write('users.json', { '+34600000001': { userId: A, name: 'Viejo', phone: '+34600000001' } });
    check('arranca con DB_SOURCE=supabase', await start({ DB_SOURCE: 'supabase' }), log.slice(-400));
    const got = await call('GET', `/messages/${CHAT}?userId=${A}`);
    check('mensajes recuperados desde Supabase (3)', got.body.messages?.length === 3, JSON.stringify(got.body).slice(0, 200));
    check('incluye la edición', got.body.messages?.some(m => m.text === 'editado'));
    check('users.json recuperado', JSON.parse(fs.readFileSync(dataFile('users.json'), 'utf8'))['+34600000001']?.name === 'Ana');
    check('copia del archivo viejo en .db-backup', fs.readdirSync(path.join(DIR, 'data', '.db-backup')).length === 1);
    await stop();

    // Supabase caído: la API arranca igual, guarda en data/ y lo sube cuando vuelve
    check('arranca aunque Supabase falle', await start({ DB_SOURCE: 'json', DB_PASSWORD: 'mala', DB_BOOT_TIMEOUT_MS: '30000' }), log.slice(-400));
    check('avisa en el log sin mostrar la contraseña', /No se pudo sincronizar/.test(log) && !log.includes(DBV.DB_PASSWORD));
    const off = await call('POST', '/messages', { chatId: CHAT, senderId: A, text: 'escrito sin Supabase' });
    check('se puede escribir con Supabase caído → 200', off.status === 200);
    check('queda marcado como pendiente', fs.existsSync(dataFile('.db-pending')));
    await stop();
    check('al volver Supabase arranca y lo sube', await start({ DB_SOURCE: 'supabase' }), log.slice(-400));
    check('el mensaje escrito sin Supabase está en Supabase', (await msgRows()).some(r => r.data.text === 'escrito sin Supabase'));
    check('y sigue en la app', (await call('GET', `/messages/${CHAT}?userId=${A}`)).body.messages?.some(m => m.text === 'escrito sin Supabase'));
    check('ya no queda nada pendiente', !fs.existsSync(dataFile('.db-pending')));
    await stop();

    // Nadie más que la API: los roles públicos de Supabase no pueden entrar y RLS está activado en todo
    for (const role of ['anon', 'authenticated']) {
      for (const schema of ['oldface', S]) {
        const r = await sql(`select has_schema_privilege($1, $2, 'USAGE') as u`, [role, schema]);
        check(`${role} no puede entrar en el esquema ${schema}`, r[0].u === false);
      }
    }
    const noRls = await sql(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and c.relkind = 'r' and not c.relrowsecurity`, [S]);
    check('RLS activado en todas las tablas', noRls.length === 0, noRls.map(r => r.relname).join());
  } finally {
    await stop();
    await dropAll();
    await pg.end();
    fs.rmSync(DIR, { recursive: true, force: true });
  }
}

console.log(`\n${ok} OK · ${fail} fallos`);
process.exit(fail ? 1 : 0);
