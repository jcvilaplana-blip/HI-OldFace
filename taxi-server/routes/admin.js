/**
 * API del panel de administración del taxi — /taxi/api/admin/…
 *
 *   POST /login                         → { token, admin }
 *   GET  /me                            → administrador + permisos
 *   GET  /meta                          → secciones (resources.js) que puede ver este administrador
 *   GET  /options/:res                  → [{ id, label }] para los selectores
 *   GET|POST /r/:res   GET|PUT|DELETE /r/:res/:id   → CRUD genérico con permisos <módulo>.<acción>
 *   GET|PUT /settings/:key              → pantallas de configuración (app, pagos, moneda, OTP…)
 *   GET  /dashboard                     → estadísticas del dashboard
 *   GET|PUT /languages/:id/json?kind=app|panel  → traducciones
 *   PUT  /accounts/:userId/role         → cambiar el rol de taxi de una cuenta (solo administradores)
 */
const express = require('express');
const { all, get, run, tx, now, getSetting, setSetting, hashPassword } = require('../db');
const { adminLogin, adminAuth, requirePerm } = require('../auth');
const { RESOURCES, byKey } = require('../resources');
const wallet = require('../wallet');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DB_FILE } = require('../db');

const router = express.Router();

// ── Sesión ───────────────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const r = adminLogin(req.body?.email, req.body?.password);
  if (r.error) return res.status(401).json({ error: r.error });
  res.json(r);
});

router.use(adminAuth);
router.get('/me', (req, res) => res.json({ admin: req.admin }));

// ── Metadatos de las secciones ──────────────────────────────────────────────
router.get('/meta', (req, res) => {
  const visible = RESOURCES.filter(r => req.can(`${r.perm}.view`)).map(r => ({
    ...r,
    ops: (r.ops || ['view', 'create', 'edit', 'delete']).filter(op => req.can(`${r.perm}.${op}`)),
  }));
  const languages = all('SELECT code, name, is_default FROM languages WHERE active = 1 ORDER BY is_default DESC, name');
  const lang = get('SELECT code, panel_json FROM languages WHERE active = 1 AND code = ?', String(req.query.lang || ''))
            || get('SELECT code, panel_json FROM languages WHERE active = 1 AND is_default = 1');
  res.json({
    resources: visible, currency: getSetting('currency'), app: getSetting('app'),
    languages, language: lang ? { code: lang.code, texts: JSON.parse(lang.panel_json || '{}') } : null,
  });
});

// ── Utilidades del CRUD genérico ─────────────────────────────────────────────
const getRes = (key) => { const r = byKey[key]; if (!r) { const e = new Error('Sección no encontrada'); e.status = 404; throw e; } return r; };
const writable = (r) => r.fields.filter(f => !f.readonly && !f.virtual && !['readonly', 'permissions', 'owner'].includes(f.type));

function selectSql(r) {
  const extras = [];
  for (const f of r.fields) {
    if (f.type === 'ref') {
      const ref = byKey[f.ref];
      extras.push(`(SELECT ${ref.labelSql} FROM ${ref.table} x WHERE x.${f.refKey || 'id'} = t.${f.name}) AS "${f.name}__label"`);
    } else if (f.type === 'owner') {
      extras.push(`(CASE t.owner_type WHEN 'customer' THEN (SELECT name FROM customers WHERE id = t.${f.name}) ELSE (SELECT name FROM drivers WHERE id = t.${f.name}) END) AS "${f.name}__label"`);
    } else if (f.type === 'permissions') {
      extras.push(`(SELECT count(*) FROM role_permissions WHERE role_id = t.id) AS "permissions__count"`);
    } else if (f.name === 'roles_count') {
      extras.push(`(SELECT count(*) FROM role_permissions WHERE permission_id = t.id) AS roles_count`);
    }
  }
  return `SELECT t.*${extras.length ? ', ' + extras.join(', ') : ''} FROM ${r.table} t`;
}

/** Valida y convierte los valores del formulario según el tipo de cada campo */
function cleanBody(r, body, { partial }) {
  const data = {};
  for (const f of writable(r)) {
    if (f.type === 'password') continue;
    if (!(f.name in body)) {
      if (!partial && f.required && f.default === undefined) throw Object.assign(new Error(`Falta "${f.label}"`), { status: 400 });
      if (!partial && f.default !== undefined) data[f.name] = f.default;
      continue;
    }
    let v = body[f.name];
    if (v === '' || v === undefined) v = null;
    if (v !== null) {
      if (['number', 'money', 'percent'].includes(f.type)) {
        v = Number(v);
        if (!Number.isFinite(v)) throw Object.assign(new Error(`"${f.label}" debe ser un número`), { status: 400 });
        if (f.type === 'money') v = Math.round(v * 100) / 100;
      } else if (f.type === 'bool') v = v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
      else if (f.type === 'ref' && !f.refKey) v = Number(v);
      else if (['json', 'polygon'].includes(f.type)) {
        if (typeof v !== 'string') v = JSON.stringify(v);
        try { JSON.parse(v); } catch { throw Object.assign(new Error(`"${f.label}" no es un JSON válido`), { status: 400 }); }
      } else if (f.type === 'select' && f.options && !f.options.some(o => o.value === v)) {
        throw Object.assign(new Error(`Valor no válido para "${f.label}"`), { status: 400 });
      } else v = String(v).slice(0, 20000);
    }
    if (v === null && f.required) throw Object.assign(new Error(`"${f.label}" es obligatorio`), { status: 400 });
    data[f.name] = v;
  }
  return data;
}

const tableCols = {};
const colsOf = (table) => (tableCols[table] ||= new Set(all(`PRAGMA table_info(${table})`).map(c => c.name)));

// Reglas especiales por sección (antes / después de guardar)
const HOOKS = {
  admin_users: {
    before(data, body, { id, req }) {
      if (body.password) data.password_hash = hashPassword(body.password);
      else if (!id) throw Object.assign(new Error('La contraseña es obligatoria'), { status: 400 });
      if (data.email) data.email = String(data.email).trim().toLowerCase();
      if (id && Number(id) === req.admin.id && data.status === 'blocked') throw Object.assign(new Error('No puedes bloquearte a ti mismo'), { status: 400 });
    },
    beforeDelete(row, req) { if (row.id === req.admin.id) throw Object.assign(new Error('No puedes borrarte a ti mismo'), { status: 400 }); },
    clean(row) { delete row.password_hash; return row; },
  },
  roles: {
    after(id, body) {
      if (!Array.isArray(body.permissions)) return;
      run('DELETE FROM role_permissions WHERE role_id = ?', id);
      for (const p of body.permissions) {
        const pid = typeof p === 'number' ? p : get('SELECT id FROM permissions WHERE name = ?', String(p))?.id;
        if (pid) run('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)', id, pid);
      }
    },
    beforeDelete(row) {
      if (row.is_system) throw Object.assign(new Error('El rol Superadministrador no se puede borrar'), { status: 400 });
      if (get('SELECT 1 FROM admin_users WHERE role_id = ?', row.id)) throw Object.assign(new Error('Hay administradores con este rol'), { status: 400 });
    },
    detail(row) { row.permissions = all('SELECT permission_id FROM role_permissions WHERE role_id = ?', row.id).map(r => r.permission_id); return row; },
  },
  countries: { after(id, body) { if (Number(body.is_default)) run('UPDATE countries SET is_default = 0 WHERE id != ?', id); } },
  languages: {
    before(data) { if (data.code) data.code = String(data.code).trim().toLowerCase(); },
    after(id, body) { if (Number(body.is_default)) run('UPDATE languages SET is_default = 0 WHERE id != ?', id); },
    beforeDelete(row) { if (row.is_default) throw Object.assign(new Error('No se puede borrar el idioma por defecto'), { status: 400 }); },
  },
  promo_codes: { before(data) { if (data.code) data.code = String(data.code).trim().toUpperCase(); } },

  // Retirada marcada como PAGADA → se descuenta del monedero del conductor (una sola vez)
  withdrawal_requests: {
    before(data, _body, { id }) {
      const cur = get('SELECT * FROM withdrawal_requests WHERE id = ?', id);
      if (!cur || !data.status || data.status === cur.status) return;
      if (cur.status === 'paid') throw Object.assign(new Error('Una retirada pagada no se puede cambiar'), { status: 400 });
      if (data.status === 'paid') {
        wallet.debit('driver', cur.driver_id, cur.amount, `Retirada #${cur.id} pagada`, { refType: 'withdrawal', refId: cur.id });
      }
      data.processed_at = now();
    },
  },
  // Reembolso APROBADO → se abona al monedero del cliente (una sola vez)
  refund_requests: {
    before(data, _body, { id }) {
      const cur = get('SELECT * FROM refund_requests WHERE id = ?', id);
      if (!cur || !data.status || data.status === cur.status) return;
      if (cur.status !== 'pending') throw Object.assign(new Error('Este reembolso ya está resuelto'), { status: 400 });
      if (data.status === 'approved') {
        const amount = wallet.money(data.amount_approved ?? cur.amount_approved ?? cur.amount_requested);
        if (!(amount > 0)) throw Object.assign(new Error('Indica el importe aprobado'), { status: 400 });
        data.amount_approved = amount;
        const b = get('SELECT code, total_amount FROM bookings WHERE id = ?', cur.booking_id);
        wallet.credit('customer', cur.customer_id, amount, `Reembolso del viaje ${b?.code || ''}`.trim(), { refType: 'refund', refId: cur.id });
        if (b && amount >= b.total_amount) run("UPDATE bookings SET payment_status = 'refunded' WHERE id = ?", cur.booking_id);
      }
      data.processed_at = now();
    },
  },
};

// ── CRUD genérico ────────────────────────────────────────────────────────────
router.get('/options/:res', (req, res) => {
  const r = getRes(req.params.res);
  const key = req.query.key || 'id';
  if (!colsOf(r.table).has(key)) return res.status(400).json({ error: 'Clave no válida' });
  const q = String(req.query.q || '').trim();
  const rows = all(`SELECT ${key} AS id, ${r.labelSql} AS label FROM ${r.table} ${q ? `WHERE ${r.labelSql} LIKE ?` : ''} ORDER BY label LIMIT 500`, ...(q ? [`%${q}%`] : []));
  res.json({ options: rows });
});

router.get('/r/:res', (req, res) => {
  const r = getRes(req.params.res);
  if (!req.can(`${r.perm}.view`)) return res.status(403).json({ error: 'No tienes permiso para ver esta sección' });
  const where = [], params = [];
  const q = String(req.query.search || '').trim();
  if (q && r.search?.length) { where.push(`(${r.search.map(c => `t.${c} LIKE ?`).join(' OR ')})`); r.search.forEach(() => params.push(`%${q}%`)); }
  const cols = colsOf(r.table);
  for (const [k, v] of Object.entries(req.query)) {
    if (!k.startsWith('f_')) continue;
    const c = k.slice(2);
    if (!cols.has(c) || v === '') continue;
    where.push(`t.${c} = ?`); params.push(v);
  }
  const sortCol = String(req.query.sort || '');
  const order = cols.has(sortCol) ? `t.${sortCol} ${req.query.dir === 'asc' ? 'ASC' : 'DESC'}` : (r.sort || 'id DESC').split(',').map(s => `t.${s.trim()}`).join(', ');
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 25));
  const page = Math.max(1, Number(req.query.page) || 1);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = get(`SELECT count(*) n FROM ${r.table} t ${w}`, ...params).n;
  let rows = all(`${selectSql(r)} ${w} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, limit, (page - 1) * limit);
  if (HOOKS[r.key]?.clean) rows = rows.map(HOOKS[r.key].clean);
  res.json({ rows, total, page, limit });
});

router.get('/r/:res/:id', (req, res) => {
  const r = getRes(req.params.res);
  if (!req.can(`${r.perm}.view`)) return res.status(403).json({ error: 'No tienes permiso para ver esta sección' });
  let row = get(`${selectSql(r)} WHERE t.id = ?`, req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  if (HOOKS[r.key]?.clean) row = HOOKS[r.key].clean(row);
  if (HOOKS[r.key]?.detail) row = HOOKS[r.key].detail(row);
  res.json({ row });
});

router.post('/r/:res', (req, res) => {
  const r = getRes(req.params.res);
  if (!(r.ops || ['create']).includes('create') || !req.can(`${r.perm}.create`)) return res.status(403).json({ error: 'No tienes permiso para crear aquí' });
  const body = req.body || {};
  const data = cleanBody(r, body, { partial: false });
  const h = HOOKS[r.key];
  const id = tx(() => {
    h?.before?.(data, body, { req });
    if (colsOf(r.table).has('created_at')) data.created_at = now();
    const keys = Object.keys(data).filter(k => colsOf(r.table).has(k));
    const info = run(`INSERT INTO ${r.table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, ...keys.map(k => data[k]));
    const newId = Number(info.lastInsertRowid);
    h?.after?.(newId, body, { req });
    return newId;
  });
  let row = get(`${selectSql(r)} WHERE t.id = ?`, id);
  if (h?.clean) row = h.clean(row);
  res.status(201).json({ row });
});

router.put('/r/:res/:id', (req, res) => {
  const r = getRes(req.params.res);
  if (!req.can(`${r.perm}.edit`)) return res.status(403).json({ error: 'No tienes permiso para editar aquí' });
  const id = Number(req.params.id);
  if (!get(`SELECT id FROM ${r.table} WHERE id = ?`, id)) return res.status(404).json({ error: 'No encontrado' });
  const body = req.body || {};
  const data = cleanBody(r, body, { partial: true });
  const h = HOOKS[r.key];
  tx(() => {
    h?.before?.(data, body, { id, req });
    const keys = Object.keys(data).filter(k => colsOf(r.table).has(k));
    if (keys.length) run(`UPDATE ${r.table} SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map(k => data[k]), id);
    h?.after?.(id, body, { id, req });
  });
  let row = get(`${selectSql(r)} WHERE t.id = ?`, id);
  if (h?.clean) row = h.clean(row);
  if (h?.detail) row = h.detail(row);
  res.json({ row });
});

router.delete('/r/:res/:id', (req, res) => {
  const r = getRes(req.params.res);
  if (!(r.ops || ['delete']).includes('delete') || !req.can(`${r.perm}.delete`)) return res.status(403).json({ error: 'No tienes permiso para borrar aquí' });
  const row = get(`SELECT * FROM ${r.table} WHERE id = ?`, req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  HOOKS[r.key]?.beforeDelete?.(row, req);
  try { run(`DELETE FROM ${r.table} WHERE id = ?`, row.id); }
  catch (e) {
    if (/FOREIGN KEY/i.test(e.message)) return res.status(409).json({ error: 'No se puede borrar: hay otros datos que dependen de este registro' });
    throw e;
  }
  res.json({ success: true });
});

// ── Ajustes (pantallas de configuración) ────────────────────────────────────
const SETTING_KEYS = ['app', 'payments', 'referral', 'currency', 'otp', 'integrations', 'refund', 'driverSearch', 'booking'];
const SECRET_FIELDS = /^(secretKey|webhookSecret|password|securityKey|authKey|secret|googleKey)$/;
const MASK = '••••••••';

function maskSecrets(v) {
  if (Array.isArray(v)) return v.map(maskSecrets);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_FIELDS.test(k) && x ? MASK : maskSecrets(x)]));
  return v;
}
function mergeSecrets(incoming, current) {
  if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
    return Object.fromEntries(Object.entries(incoming).map(([k, x]) => [k, x === MASK ? current?.[k] : mergeSecrets(x, current?.[k])]));
  }
  return incoming;
}

router.get('/settings/:key', requirePerm('system_configuration.view'), (req, res) => {
  if (!SETTING_KEYS.includes(req.params.key)) return res.status(404).json({ error: 'Ajuste no encontrado' });
  res.json({ value: maskSecrets(getSetting(req.params.key, {})) });
});
router.put('/settings/:key', requirePerm('system_configuration.edit'), (req, res) => {
  if (!SETTING_KEYS.includes(req.params.key)) return res.status(404).json({ error: 'Ajuste no encontrado' });
  const value = req.body?.value;
  if (!value || typeof value !== 'object') return res.status(400).json({ error: 'Datos no válidos' });
  setSetting(req.params.key, mergeSecrets(value, getSetting(req.params.key, {})));
  res.json({ value: maskSecrets(getSetting(req.params.key)) });
});

// ── Traducciones de un idioma ───────────────────────────────────────────────
router.get('/languages/:id/json', requirePerm('language.view'), (req, res) => {
  const col = req.query.kind === 'panel' ? 'panel_json' : 'app_json';
  const row = get(`SELECT id, name, code, ${col} AS json FROM languages WHERE id = ?`, req.params.id);
  if (!row) return res.status(404).json({ error: 'Idioma no encontrado' });
  res.json({ language: { id: row.id, name: row.name, code: row.code }, json: JSON.parse(row.json || '{}') });
});
router.put('/languages/:id/json', requirePerm('language.edit'), (req, res) => {
  const col = req.query.kind === 'panel' ? 'panel_json' : 'app_json';
  const json = req.body?.json;
  if (!json || typeof json !== 'object' || Array.isArray(json)) return res.status(400).json({ error: 'Debe ser un objeto JSON { "clave": "texto" }' });
  run(`UPDATE languages SET ${col} = ? WHERE id = ?`, JSON.stringify(json), req.params.id);
  res.json({ success: true });
});

// ── Cambiar el rol de taxi de una cuenta (cliente ↔ conductor) ───────────────
router.put('/accounts/:userId/role', requirePerm('customers.edit'), (req, res) => {
  const role = req.body?.role;
  if (!['customer', 'driver'].includes(role)) return res.status(400).json({ error: 'Rol no válido' });
  if (!req.can('drivers.edit')) return res.status(403).json({ error: 'Necesitas permiso para editar conductores y clientes' });
  const acc = get('SELECT * FROM taxi_accounts WHERE user_id = ?', req.params.userId);
  if (!acc) return res.status(404).json({ error: 'La cuenta no ha entrado nunca al taxi' });
  tx(() => {
    run('UPDATE taxi_accounts SET role = ?, changed_by = ? WHERE user_id = ?', role, req.admin.id, acc.user_id);
    const from = acc.role === 'driver' ? 'drivers' : 'customers', to = role === 'driver' ? 'drivers' : 'customers';
    if (from !== to && !get(`SELECT id FROM ${to} WHERE user_id = ?`, acc.user_id)) {
      const src = get(`SELECT name, phone, email, photo, country_id, language FROM ${from} WHERE user_id = ?`, acc.user_id) || { name: 'Usuario' };
      run(`INSERT INTO ${to} (user_id, name, phone, email, photo, country_id, language, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
          acc.user_id, src.name, src.phone, src.email, src.photo, src.country_id, src.language || 'es', role === 'driver' ? 'pending' : 'active', now());
    }
  });
  res.json({ success: true, role });
});

// ── Monederos: ajuste manual (abono / cargo) ────────────────────────────────
router.post('/wallets/:id/adjust', requirePerm('wallet.edit'), (req, res) => {
  const w = get('SELECT * FROM wallets WHERE id = ?', req.params.id);
  if (!w) return res.status(404).json({ error: 'Monedero no encontrado' });
  const type = req.body?.type, amount = wallet.money(req.body?.amount);
  const description = String(req.body?.description || '').trim().slice(0, 200);
  if (!['credit', 'debit'].includes(type) || !(amount > 0)) return res.status(400).json({ error: 'Indica abono o cargo y un importe mayor que 0' });
  if (!description) return res.status(400).json({ error: 'Indica el motivo del ajuste' });
  tx(() => {
    wallet[type](w.owner_type, w.owner_id, amount, `${description} (ajuste de ${req.admin.name})`, { refType: 'admin', refId: req.admin.id, allowNegative: w.owner_type === 'driver' });
    // Si el conductor salda deuda de efectivo (p. ej. en un punto de cobro), baja también su deuda
    if (w.owner_type === 'driver' && type === 'credit' && req.body?.settlesDebt) {
      run('UPDATE drivers SET debt = max(0, round(debt - ?, 2)) WHERE id = ?', amount, w.owner_id);
    }
  });
  res.json({ wallet: get('SELECT * FROM wallets WHERE id = ?', w.id) });
});

// ── Tickets de soporte: conversación y respuesta ────────────────────────────
router.get('/tickets/:id/messages', requirePerm('support_ticket.view'), (req, res) => {
  const t = get('SELECT * FROM support_tickets WHERE id = ?', req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket no encontrado' });
  const owner = get(`SELECT id, name, phone, email FROM ${t.owner_type === 'driver' ? 'drivers' : 'customers'} WHERE id = ?`, t.owner_id);
  res.json({ ticket: t, owner, messages: all(`SELECT m.*, a.name AS admin_name FROM ticket_messages m LEFT JOIN admin_users a ON m.sender_type = 'admin' AND a.id = m.sender_id
                                           WHERE ticket_id = ? ORDER BY m.id`, t.id) });
});
router.post('/tickets/:id/messages', requirePerm('support_ticket.edit'), (req, res) => {
  const t = get('SELECT * FROM support_tickets WHERE id = ?', req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket no encontrado' });
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Escribe una respuesta' });
  run('INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, message, created_at) VALUES (?,?,?,?,?)', t.id, 'admin', req.admin.id, message.slice(0, 4000), now());
  run('UPDATE support_tickets SET last_reply_at = ?, status = ?, assigned_to = coalesce(assigned_to, ?) WHERE id = ?',
      now(), req.body?.close ? 'closed' : 'pending', req.admin.id, t.id);
  require('../realtime').emit(`${t.owner_type}:${t.owner_id}`, 'ticket:reply', { id: t.id });
  res.status(201).json({ success: true });
});

// ── Mapa en vivo: conductores conectados y viajes activos ───────────────────
router.get('/live', requirePerm('live_map.view'), (_req, res) => {
  res.json({
    drivers: all(`SELECT d.id, d.name, d.photo, d.lat, d.lng, d.heading, d.location_at, d.available, d.rating, v.plate, r.name AS ride_type
                  FROM drivers d LEFT JOIN vehicles v ON v.driver_id = d.id AND v.status = 'active' LEFT JOIN ride_types r ON r.id = v.ride_type_id
                  WHERE d.online = 1 AND d.lat IS NOT NULL GROUP BY d.id`),
    bookings: all(`SELECT b.code, b.status, b.pickup_lat, b.pickup_lng, b.dropoff_lat, b.dropoff_lng, b.pickup_address, b.dropoff_address,
                   b.driver_id, c.name AS customer FROM bookings b JOIN customers c ON c.id = b.customer_id
                   WHERE b.status IN ('searching','accepted','arrived','started')`),
  });
});

// ── Subir imágenes (iconos, banners, banderas, avatares) ────────────────────
const UPLOAD_DIR = path.join(path.dirname(DB_FILE), 'uploads');
const IMG_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'application/pdf': '.pdf' };
router.post('/upload', express.raw({ type: () => true, limit: '8mb' }), (req, res) => {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!IMG_TYPES[type]) return res.status(415).json({ error: 'Formato no admitido (JPG, PNG, WebP, SVG o PDF)' });
  if (!Buffer.isBuffer(req.body) || req.body.length < 50) return res.status(400).json({ error: 'Archivo vacío' });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const name = `${Date.now()}_${crypto.randomBytes(5).toString('hex')}${IMG_TYPES[type]}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), req.body);
  res.json({ url: `/taxi/files/${name}` });
});

// ── Dashboard ───────────────────────────────────────────────────────────────
router.get('/dashboard', requirePerm('dashboard.view'), (req, res) => {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const today = d0.getTime(), week = today - 6 * 86400000, month = today - 29 * 86400000;
  const n = (sql, ...p) => get(sql, ...p) || {};
  const com = n('SELECT count(*) rides, coalesce(sum(commission),0) commission, coalesce(sum(driver_earning),0) earnings FROM commissions WHERE created_at >= ?', today);
  const payouts = n("SELECT count(*) c, coalesce(sum(amount),0) s FROM withdrawal_requests WHERE status = 'pending'");
  const promo = n('SELECT count(*) c, coalesce(sum(discount),0) s FROM promo_uses WHERE created_at >= ?', today);
  const refBonus = n("SELECT count(*) c, coalesce(sum(amount),0) s FROM referral_bonuses WHERE status = 'pending'");
  const chats = n("SELECT count(*) total, sum(status = 'open') open, coalesce(sum(unread_admin),0) unread, sum(priority = 'urgent' AND status = 'open') urgent FROM support_chats");
  const msgs = (since) => n("SELECT count(*) c FROM chat_messages WHERE sender_type != 'admin' AND created_at >= ?", since).c;
  const tickets = n(`SELECT sum(status != 'closed') open, sum(status != 'closed' AND coalesce(last_reply_at, created_at) < ?) attention,
                     sum(status != 'closed' AND assigned_to IS NULL) unassigned FROM support_tickets`, now() - 86400000);
  const wallets = n('SELECT coalesce(sum(balance),0) total FROM wallets');
  const txToday = (type) => n('SELECT count(*) c, coalesce(sum(amount),0) s FROM wallet_transactions WHERE type = ? AND created_at >= ?', type, today);
  const latest = all(`SELECT b.code, b.status, b.total_amount, b.estimated_fare, b.pickup_address, b.dropoff_address, b.created_at,
                      c.name AS customer, d.name AS driver FROM bookings b LEFT JOIN customers c ON c.id = b.customer_id
                      LEFT JOIN drivers d ON d.id = b.driver_id ORDER BY b.created_at DESC LIMIT 10`);
  const trend = all(`SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch', 'localtime') day, count(*) bookings,
                     sum(status = 'completed') completed FROM bookings WHERE created_at >= ? GROUP BY day ORDER BY day`, month);
  res.json({
    commission: { today: com.commission, rides: com.rides }, driverEarnings: { today: com.earnings },
    pendingPayouts: { amount: payouts.s, count: payouts.c }, promo: { usesToday: promo.c, discountToday: promo.s,
      active: n("SELECT count(*) c FROM promo_codes WHERE status = 'active' AND (expires_at IS NULL OR expires_at >= date('now'))").c },
    referralPending: { count: refBonus.c, amount: refBonus.s },
    support: { conversations: chats.total || 0, open: chats.open || 0, unread: chats.unread || 0, urgent: chats.urgent || 0,
      today: msgs(today), week: msgs(week), month: msgs(month), openTickets: tickets.open || 0,
      needsAttention: tickets.attention || 0, unassigned: tickets.unassigned || 0 },
    transactions: { totalBalance: wallets.total, credits: txToday('credit'), debits: txToday('debit') },
    totals: { users: n('SELECT count(*) c FROM customers').c, activeDrivers: n("SELECT count(*) c FROM drivers WHERE online = 1 AND status = 'active'").c,
      drivers: n('SELECT count(*) c FROM drivers').c, bookingsToday: n('SELECT count(*) c FROM bookings WHERE created_at >= ?', today).c,
      activeVehicles: n("SELECT count(*) c FROM vehicles WHERE status = 'active'").c },
    latestBookings: latest, trend, currency: getSetting('currency'),
  });
});

// Errores de la API del panel en JSON
router.use((err, _req, res, _next) => {
  if (/UNIQUE constraint/i.test(err.message)) return res.status(409).json({ error: 'Ya existe un registro con ese valor único (código, email…)' });
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Error interno' });
  if (!err.status) console.error('[admin]', err);
});

module.exports = router;
