// Pruebas de la API del panel del taxi (base de datos temporal). Uso: npm test
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'taxi-test-'));
const PORT = 4199, B = `http://127.0.0.1:${PORT}/taxi`;
const env = { ...process.env, TAXI_DB: join(dir, 'taxi.db'), TAXI_PORT: String(PORT), ENV_FILE: join(dir, 'none.env'),
              ADMIN_EMAIL: 'admin@test.es', ADMIN_PASSWORD: 'Clave-segura-1', RTC_SECRET: 'test-secret' };
const srv = spawn(process.execPath, ['server.js'], { cwd: join(dirname(fileURLToPath(import.meta.url)), '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
let errOut = ''; srv.stderr.on('data', d => { errOut += d; });

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond ? '' : ' → ' + JSON.stringify(extra)?.slice(0, 300)}`); };
const req = async (method, path, body, token) => {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, d: await r.json().catch(() => null) };
};

try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(B + '/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  ok('servicio arranca', (await req('GET', '/health')).d?.ok);

  // ── Sesión ──
  ok('login con contraseña incorrecta → 401', (await req('POST', '/api/admin/login', { email: 'admin@test.es', password: 'mala' })).s === 401);
  const L = await req('POST', '/api/admin/login', { email: 'ADMIN@test.es', password: 'Clave-segura-1' });
  ok('login del superadministrador', L.s === 200 && L.d.admin.role === 'Superadministrador', L);
  const T = L.d.token;
  ok('sin token → 401', (await req('GET', '/api/admin/meta')).s === 401);
  ok('token manipulado → 401', (await req('GET', '/api/admin/meta', null, T.slice(0, -2) + 'xx')).s === 401);

  const meta = (await req('GET', '/api/admin/meta', null, T)).d;
  ok(`el superadmin ve todas las secciones (${meta.resources.length})`, meta.resources.length >= 30 && meta.resources.every(r => r.ops.includes('view')), meta.resources.length);

  // ── CRUD genérico (ciudades) ──
  const spain = (await req('GET', '/api/admin/r/countries?search=Espa', null, T)).d.rows[0];
  ok('país España sembrado y por defecto', spain?.code === 'ES' && spain.is_default === 1, spain);
  const c1 = await req('POST', '/api/admin/r/cities', { name: 'Madrid', state: 'Madrid', country_id: spain.id, lat: 40.4168, lng: -3.7038 }, T);
  ok('crear ciudad', c1.s === 201 && c1.d.row.name === 'Madrid' && c1.d.row.country_id__label === 'España' && c1.d.row.radius_km === 30, c1);
  ok('campo obligatorio vacío → 400', (await req('POST', '/api/admin/r/cities', { name: 'Sin país', lat: 1, lng: 1 }, T)).s === 400);
  ok('número no válido → 400', (await req('POST', '/api/admin/r/cities', { name: 'X', country_id: spain.id, lat: 'abc', lng: 1 }, T)).s === 400);
  const list = await req('GET', '/api/admin/r/cities?search=madr', null, T);
  ok('buscar ciudades', list.d.total === 1 && list.d.rows[0].name === 'Madrid', list.d);
  const ed = await req('PUT', `/api/admin/r/cities/${c1.d.row.id}`, { radius_km: 45, active: false }, T);
  ok('editar ciudad (parcial)', ed.d.row.radius_km === 45 && ed.d.row.active === 0 && ed.d.row.name === 'Madrid', ed.d);
  const z = await req('POST', '/api/admin/r/zones', { city_id: c1.d.row.id, name: 'Centro', polygon: [[-3.71, 40.41], [-3.69, 40.41], [-3.69, 40.43]], surge: 1.2 }, T);
  ok('crear zona con polígono', z.s === 201 && JSON.parse(z.d.row.polygon).length === 3, z);
  ok('JSON no válido → 400', (await req('PUT', `/api/admin/r/zones/${z.d.row.id}`, { weekly_slots: '{mal' }, T)).s === 400);
  ok('filtro por ciudad', (await req('GET', `/api/admin/r/zones?f_city_id=${c1.d.row.id}`, null, T)).d.total === 1);
  ok('opciones para selectores', (await req('GET', '/api/admin/options/cities', null, T)).d.options.some(o => o.label === 'Madrid'));
  ok('borrar ciudad con zonas (cascada)', (await req('DELETE', `/api/admin/r/cities/${c1.d.row.id}`, null, T)).d?.success);
  ok('…y su zona también desaparece', (await req('GET', `/api/admin/r/zones/${z.d.row.id}`, null, T)).s === 404);

  // ── Tipos de viaje y promos ──
  const rt = (await req('GET', '/api/admin/r/ride_types', null, T)).d;
  ok(`tipos de viaje sembrados (${rt.total})`, rt.total === 4 && rt.rows.some(r => r.code === 'economy'), rt.total);
  const p1 = await req('POST', '/api/admin/r/promo_codes', { code: 'bienvenida', type: 'percent', value: 20, max_discount: 5 }, T);
  ok('crear promo (código en mayúsculas)', p1.s === 201 && p1.d.row.code === 'BIENVENIDA', p1);
  ok('promo duplicada → 409', (await req('POST', '/api/admin/r/promo_codes', { code: 'BIENVENIDA', value: 5 }, T)).s === 409);
  ok('tipo de select no válido → 400', (await req('POST', '/api/admin/r/promo_codes', { code: 'X1', type: 'regalo', value: 5 }, T)).s === 400);
  ok('las comisiones son solo lectura (crear → 403)', (await req('POST', '/api/admin/r/commissions', { fare: 1 }, T)).s === 403);

  // ── Roles y permisos ──
  const op = (await req('GET', '/api/admin/r/roles?search=Operador', null, T)).d.rows[0];
  ok('rol Operador con permisos limitados', op && op.permissions__count > 0 && op.permissions__count < 136, op);
  const u2 = await req('POST', '/api/admin/r/admin_users', { name: 'Ana Operadora', email: 'ana@test.es', password: 'Otra-clave-2', role_id: op.id }, T);
  ok('crear administrador (sin devolver la contraseña)', u2.s === 201 && !('password_hash' in u2.d.row), u2);
  ok('administrador sin contraseña → 400', (await req('POST', '/api/admin/r/admin_users', { name: 'X', email: 'x@test.es', role_id: op.id }, T)).s === 400);
  const T2 = (await req('POST', '/api/admin/login', { email: 'ana@test.es', password: 'Otra-clave-2' })).d.token;
  const meta2 = (await req('GET', '/api/admin/meta', null, T2)).d;
  ok('el operador solo ve sus secciones', meta2.resources.some(r => r.key === 'bookings') && !meta2.resources.some(r => r.key === 'admin_users'), meta2.resources.map(r => r.key));
  ok('el operador no puede ver administradores (403)', (await req('GET', '/api/admin/r/admin_users', null, T2)).s === 403);
  ok('el operador no puede borrar conductores (403)', (await req('DELETE', '/api/admin/r/drivers/1', null, T2)).s === 403);
  ok('el operador no puede ver ajustes (403)', (await req('GET', '/api/admin/settings/payments', null, T2)).s === 403);
  const permIds = (await req('GET', '/api/admin/r/permissions?search=promo_code&limit=50', null, T)).d.rows.filter(p => p.module === 'promo_code').map(p => p.id);
  const upd = await req('PUT', `/api/admin/r/roles/${op.id}`, { permissions: permIds }, T);
  ok('cambiar los permisos de un rol', upd.d.row.permissions.length === 4, upd.d);
  ok('…y el operador ya gestiona promos', (await req('GET', '/api/admin/r/promo_codes', null, T2)).s === 200);
  ok('…y ya no ve reservas', (await req('GET', '/api/admin/r/bookings', null, T2)).s === 403);
  const superRole = (await req('GET', '/api/admin/r/roles?search=Super', null, T)).d.rows[0];
  ok('no se puede borrar el rol Superadministrador', (await req('DELETE', `/api/admin/r/roles/${superRole.id}`, null, T)).s === 400);
  const me = (await req('GET', '/api/admin/me', null, T)).d.admin;
  ok('no puedes borrarte a ti mismo', (await req('DELETE', `/api/admin/r/admin_users/${me.id}`, null, T)).s === 400);
  ok('borrar otro administrador', (await req('DELETE', `/api/admin/r/admin_users/${u2.d.row.id}`, null, T)).d?.success);
  ok('…y su sesión deja de valer', (await req('GET', '/api/admin/meta', null, T2)).s === 401);

  // ── Ajustes ──
  const pay = (await req('PUT', '/api/admin/settings/payments', { value: { cash: { enabled: true }, wallet: { enabled: true }, stripe: { enabled: true, mode: 'sandbox', currency: 'EUR', publishableKey: 'pk_test_1', secretKey: 'sk_test_SECRETO', webhookSecret: '' }, razorpay: { enabled: false } } }, T)).d;
  ok('las claves secretas no se devuelven', pay.value.stripe.secretKey === '••••••••' && pay.value.stripe.publishableKey === 'pk_test_1', pay);
  const again = (await req('GET', '/api/admin/settings/payments', null, T)).d.value;
  await req('PUT', '/api/admin/settings/payments', { value: { ...again, stripe: { ...again.stripe, mode: 'live' } } }, T);
  ok('guardar sin tocar la clave la conserva', (await req('GET', '/api/admin/settings/payments', null, T)).d.value.stripe.secretKey === '••••••••');
  ok('ajuste desconocido → 404', (await req('GET', '/api/admin/settings/inventado', null, T)).s === 404);

  // ── Idiomas ──
  const langs = (await req('GET', '/api/admin/r/languages', null, T)).d.rows;
  const es = langs.find(l => l.code === 'es');
  ok('idiomas sembrados (español por defecto)', langs.length === 2 && es.is_default === 1, langs);
  ok('guardar traducciones de la app', (await req('PUT', `/api/admin/languages/${es.id}/json?kind=app`, { json: { home: 'Inicio', wallet: 'Monedero' } }, T)).d?.success);
  ok('leer traducciones', (await req('GET', `/api/admin/languages/${es.id}/json?kind=app`, null, T)).d.json.wallet === 'Monedero');
  ok('no se puede borrar el idioma por defecto', (await req('DELETE', `/api/admin/r/languages/${es.id}`, null, T)).s === 400);

  // ── Dashboard ──
  const dash = await req('GET', '/api/admin/dashboard', null, T);
  ok('dashboard con todas las cifras', dash.s === 200 && 'commission' in dash.d && 'support' in dash.d && dash.d.currency.code === 'EUR' && dash.d.promo.active === 1, dash.d);
} catch (e) {
  fail++; console.log('FAIL excepción', e.message);
} finally {
  srv.kill();
  if (errOut.trim()) console.log('stderr del servidor:\n' + errOut.split('\n').filter(l => !/ExperimentalWarning|trace-warnings/.test(l)).join('\n'));
  setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} console.log(`\n${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0); }, 300);
}
