/**
 * db — base de datos del taxi (SQLite integrado en Node: node:sqlite, sin dependencias).
 *   · Aplica schema.sql al arrancar (CREATE IF NOT EXISTS) y carga los datos iniciales (seed) una sola vez.
 *   · Helpers: all/get/run, tx (transacción), settings get/set, now().
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DB_FILE = process.env.TAXI_DB || path.join(__dirname, 'data', 'taxi.db');
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

const now = () => Date.now();
const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);

/** Ejecuta fn dentro de una transacción (todo o nada) */
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}

// ── Ajustes ──────────────────────────────────────────────────────────────────
function getSetting(key, fallback = null) {
  const row = get('SELECT value FROM settings WHERE key = ?', key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
}
function setSetting(key, value) {
  run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      key, JSON.stringify(value), now());
}

// ── Contraseñas (scrypt) ─────────────────────────────────────────────────────
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(String(pw), salt, 64).toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [, salt, hash] = String(stored || '').split('$');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex'), b = crypto.scryptSync(String(pw), salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Módulos con permisos CRUD (los del PDF + los necesarios para el panel completo) ──
const MODULES = [
  'dashboard', 'booking', 'city', 'zone', 'country', 'ride_type', 'cancellation_policy', 'drivers', 'customers',
  'vehicles', 'document', 'driver_incentive', 'driver_payout', 'cash_point', 'live_map', 'commission', 'invoice',
  'transaction', 'wallet', 'refund', 'promo_code', 'referral_bonus', 'referral', 'tax', 'banner', 'faq_category',
  'support_ticket', 'support_chat', 'notification', 'language', 'system_configuration', 'admin_users', 'roles',
  'permissions',
];
const ACTIONS = ['view', 'create', 'edit', 'delete'];

// ── Ajustes por defecto (todas las pantallas de configuración del PDF) ─────────
const DEFAULT_SETTINGS = {
  app: { appName: 'OldFace Taxi', supportEmail: 'contacto@oldface.app', supportPhone: '', maintenanceMode: false,
         adminLogo: '', androidVersion: '1.0.0', androidForceUpdate: false, iosVersion: '1.0.0', iosForceUpdate: false,
         appleShareLink: '', androidShareLink: 'https://oldface.app', adminPrimaryColor: '#000080', appPrimaryColor: '#000080' },
  payments: {
    cash:     { enabled: true },
    wallet:   { enabled: true },
    stripe:   { enabled: false, mode: 'sandbox', currency: 'EUR', publishableKey: '', secretKey: '', webhookSecret: '' },
    razorpay: { enabled: false, keyId: '', secretKey: '', currency: 'INR', webhookSecret: '' },
  },
  referral: { driverReferrer: 10, driverReferred: 5, userReferrer: 5, userReferred: 5, userFriendDiscount: 10 },
  currency: { code: 'EUR', symbol: '€', name: 'Euro' },
  otp: { provider: 'email', fcmEnabled: true,
         msg91: { authKey: '', templateId: '', senderId: '' },
         whatsapp: { apiUrl: '', securityKey: '', template: '' } },
  integrations: { pusher: { appId: '', key: '', secret: '', cluster: '' },
                  maps: { provider: 'oldface', googleEnabled: false, googleKey: '' },
                  mail: { mailer: 'smtp', host: '', port: 587, username: '', password: '', encryption: 'tls', fromAddress: '', fromName: 'OldFace Taxi' } },
  refund: { requiredHours: 48 },
  driverSearch: { round1Km: 3, round2Km: 6, round3Km: 10, offerSeconds: 20, active: true },
  booking: { otpRequired: true, scheduleMaxDays: 7, searchTimeoutSec: 120 },
};

const COUNTRIES = [
  // nombre, código, moneda, símbolo, prefijo, idioma, lat, lng, zoom, por defecto
  ['España', 'ES', 'EUR', '€', '+34', 'es', 40.4168, -3.7038, 6, 1],
  ['Portugal', 'PT', 'EUR', '€', '+351', 'es', 39.4, -8.2, 6],
  ['Francia', 'FR', 'EUR', '€', '+33', 'es', 46.6, 2.4, 5],
  ['Italia', 'IT', 'EUR', '€', '+39', 'es', 42.8, 12.5, 5],
  ['Alemania', 'DE', 'EUR', '€', '+49', 'es', 51.2, 10.4, 5],
  ['Reino Unido', 'GB', 'GBP', '£', '+44', 'en', 54.0, -2.5, 5],
  ['Estados Unidos', 'US', 'USD', '$', '+1', 'en', 39.8, -98.6, 4],
  ['México', 'MX', 'MXN', '$', '+52', 'es', 23.6, -102.5, 5],
  ['Argentina', 'AR', 'ARS', '$', '+54', 'es', -38.4, -63.6, 4],
  ['Colombia', 'CO', 'COP', '$', '+57', 'es', 4.6, -74.1, 5],
  ['Chile', 'CL', 'CLP', '$', '+56', 'es', -35.7, -71.5, 4],
  ['Perú', 'PE', 'PEN', 'S/', '+51', 'es', -9.2, -75.0, 5],
  ['Venezuela', 'VE', 'VES', 'Bs', '+58', 'es', 6.4, -66.6, 5],
  ['Ecuador', 'EC', 'USD', '$', '+593', 'es', -1.8, -78.2, 6],
  ['Uruguay', 'UY', 'UYU', '$', '+598', 'es', -32.5, -55.8, 6],
  ['Paraguay', 'PY', 'PYG', '₲', '+595', 'es', -23.4, -58.4, 6],
  ['Bolivia', 'BO', 'BOB', 'Bs', '+591', 'es', -16.3, -63.6, 5],
  ['Brasil', 'BR', 'BRL', 'R$', '+55', 'es', -14.2, -51.9, 4],
];

function seed() {
  if (getSetting('seeded')) return;
  tx(() => {
    const t = now();
    for (const m of MODULES) for (const a of ACTIONS) {
      run('INSERT OR IGNORE INTO permissions (name, module, action) VALUES (?, ?, ?)', `${m}.${a}`, m, a);
    }
    run("INSERT OR IGNORE INTO roles (name, description, is_system, created_at) VALUES ('Superadministrador', 'Acceso total a todas las secciones', 1, ?)", t);
    run("INSERT OR IGNORE INTO roles (name, description, is_system, created_at) VALUES ('Operador', 'Gestión diaria: reservas, conductores, clientes y soporte', 0, ?)", t);
    const superRole = get("SELECT id FROM roles WHERE name = 'Superadministrador'").id;
    run('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions', superRole);
    const opRole = get("SELECT id FROM roles WHERE name = 'Operador'").id;
    run(`INSERT OR IGNORE INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions
         WHERE module IN ('dashboard','booking','drivers','customers','vehicles','document','support_ticket','support_chat','live_map','refund')
           AND action IN ('view','edit')`, opRole);

    // Primer administrador: el mismo del panel de OldFace (.env)
    const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    if (email && process.env.ADMIN_PASSWORD) {
      run('INSERT OR IGNORE INTO admin_users (name, email, password_hash, role_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          'Administrador', email, hashPassword(process.env.ADMIN_PASSWORD), superRole, 'active', t);
    }

    run("INSERT OR IGNORE INTO languages (name, name_en, code, country_code, is_default, active, app_json, panel_json) VALUES ('Español', 'Spanish', 'es', 'ES', 1, 1, '{}', '{}')");
    run("INSERT OR IGNORE INTO languages (name, name_en, code, country_code, is_default, active, app_json, panel_json) VALUES ('English', 'English', 'en', 'GB', 0, 1, '{}', '{}')");

    COUNTRIES.forEach((c, i) => run(
      'INSERT OR IGNORE INTO countries (name, code, currency_code, currency_symbol, phone_code, default_language, lat, lng, zoom, is_default, active, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,1,?)',
      c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9] ? 1 : 0, i));

    [['Permiso de conducir', 'driver'], ['DNI / NIE / Pasaporte', 'driver'], ['Licencia de taxi o VTC', 'driver'],
     ['Seguro del vehículo', 'vehicle'], ['ITV', 'vehicle'], ['Permiso de circulación', 'vehicle']]
      .forEach(([n, ty], i) => run('INSERT INTO document_types (name, type, required, has_expiry, active, sort_order) VALUES (?, ?, 1, 1, 1, ?)', n, ty, i));

    [['Moto', 'moto', 'Rápido y económico, 1 pasajero', 1, 1.5, 0.45, 0.10, 3],
     ['Económico', 'economy', 'Viajes diarios a buen precio', 4, 2.5, 0.85, 0.20, 5],
     ['Confort', 'comfort', 'Coches más amplios y nuevos', 4, 3.5, 1.10, 0.25, 7],
     ['XL', 'xl', 'Hasta 6 pasajeros', 6, 4.5, 1.40, 0.30, 9]]
      .forEach(([n, c, d, s, b, km, min, mf], i) => run(
        'INSERT INTO ride_types (name, code, description, seats, base_price, price_per_km, price_per_min, min_fare, commission_rate, sort_order, active, created_at) VALUES (?,?,?,?,?,?,?,?,15,?,1,?)',
        n, c, d, s, b, km, min, mf, i, t));

    run("INSERT INTO cancellation_policies (name, applies_to, free_window_min, fixed_fee, fee_percent, active) VALUES ('Cancelación del cliente', 'customer', 2, 3, 0, 1)");
    run("INSERT INTO city_taxes (name, rate, active) VALUES ('IVA', 10, 1)");

    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) setSetting(k, v);
    setSetting('seeded', true);
  });
}
seed();

module.exports = { db, all, get, run, tx, now, getSetting, setSetting, hashPassword, checkPassword, MODULES, ACTIONS, DB_FILE };
