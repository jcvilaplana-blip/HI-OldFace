/**
 * auth — identificación y permisos del taxi.
 *
 *   Administradores (panel): email + contraseña → token firmado (12 h). Cada petición del panel comprueba
 *   el permiso "<módulo>.<acción>" de su rol (CRUD).
 *   Apps (cliente / conductor): el mismo token de sesión de OldFace que usa el servidor RTC
 *   (<userId>.<expSeg>.<hmac>, firmado con RTC_SECRET) → no hay un segundo login.
 *   Roles exclusivos: una cuenta de OldFace es cliente O conductor (tabla taxi_accounts), nunca las dos cosas.
 */
const crypto = require('crypto');
const { get, all, run, now, checkPassword } = require('./db');

const RTC_SECRET  = process.env.RTC_SECRET || '';
const PANEL_SECRET = process.env.TAXI_SECRET || crypto.createHash('sha256').update(`taxi-panel:${RTC_SECRET}`).digest('hex');
const ADMIN_TTL = 12 * 3600 * 1000;

const sign = (s) => crypto.createHmac('sha256', PANEL_SECRET).update(s).digest('base64url');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// ── Administradores ──────────────────────────────────────────────────────────
function adminLogin(email, password) {
  const u = get('SELECT * FROM admin_users WHERE email = ?', String(email || '').trim().toLowerCase());
  if (!u || !checkPassword(password, u.password_hash)) return { error: 'Email o contraseña incorrectos' };
  if (u.status !== 'active') return { error: 'Usuario bloqueado' };
  run('UPDATE admin_users SET last_login_at = ? WHERE id = ?', now(), u.id);
  const payload = Buffer.from(JSON.stringify({ id: u.id, exp: now() + ADMIN_TTL })).toString('base64url');
  return { token: `${payload}.${sign(payload)}`, admin: adminProfile(u.id) };
}

function adminProfile(id) {
  const u = get('SELECT a.id, a.name, a.email, a.phone, a.avatar, a.status, a.role_id, r.name AS role, r.is_system FROM admin_users a LEFT JOIN roles r ON r.id = a.role_id WHERE a.id = ?', id);
  if (!u) return null;
  const perms = all('SELECT p.name FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?', u.role_id).map(r => r.name);
  return { ...u, permissions: perms };
}

/** Token de administrador → { admin, can(perm) } o { error } */
function verifyAdminToken(tok) {
  const [payload, sig] = String(tok || '').split('.');
  if (!payload || !sig || !safeEq(sig, sign(payload))) return { error: 'No autenticado' };
  let data; try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return { error: 'No autenticado' }; }
  if (!data.exp || data.exp < now()) return { error: 'Sesión caducada' };
  const admin = adminProfile(data.id);
  if (!admin || admin.status !== 'active') return { error: 'Usuario no válido' };
  const set = new Set(admin.permissions);
  return { admin, can: (perm) => !!admin.is_system || set.has(perm) };
}

/** Middleware: exige sesión de administrador; deja req.admin y req.can(perm) */
function adminAuth(req, res, next) {
  const v = verifyAdminToken((req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query.token);
  if (v.error) return res.status(401).json({ error: v.error });
  req.admin = v.admin;
  req.can = v.can;
  next();
}

/** Middleware: exige el permiso "<módulo>.<acción>" */
const requirePerm = (perm) => (req, res, next) =>
  req.can?.(perm) ? next() : res.status(403).json({ error: 'No tienes permiso para esta acción', permission: perm });

// ── Apps: token de OldFace ───────────────────────────────────────────────────
function verifyAppToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || !RTC_SECRET) return null;
  const [userId, exp, sig] = parts;
  const expected = crypto.createHmac('sha256', RTC_SECRET).update(`${userId}.${exp}`).digest('base64url');
  if (!safeEq(sig, expected) || Number(exp) * 1000 < now() || !/^[A-Za-z0-9_-]{1,64}$/.test(userId)) return null;
  return userId;
}

/** Middleware: usuario de OldFace identificado (req.userId) y su rol de taxi si ya lo eligió (req.taxiRole) */
function appAuth(req, res, next) {
  const userId = verifyAppToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  if (!userId) return res.status(401).json({ error: 'Sesión no válida, vuelve a iniciar sesión en OldFace' });
  req.userId = userId;
  req.taxiRole = get('SELECT role FROM taxi_accounts WHERE user_id = ?', userId)?.role || null;
  next();
}

/** Middleware: exige que la cuenta tenga ESTE rol (cliente o conductor) y carga su ficha */
const requireRole = (role) => (req, res, next) => {
  if (req.taxiRole !== role) {
    return res.status(403).json({
      error: req.taxiRole ? `Esta cuenta es de ${req.taxiRole === 'driver' ? 'conductor' : 'cliente'} y no puede usar esta parte`
                          : 'Primero elige si entras como cliente o como conductor',
      role: req.taxiRole,
    });
  }
  const table = role === 'driver' ? 'drivers' : 'customers';
  req.me = get(`SELECT * FROM ${table} WHERE user_id = ?`, req.userId);
  if (!req.me) return res.status(403).json({ error: 'Cuenta de taxi no encontrada' });
  if (req.me.status === 'blocked') return res.status(403).json({ error: 'Tu cuenta está bloqueada. Contacta con soporte.' });
  next();
};

module.exports = { adminLogin, adminProfile, adminAuth, verifyAdminToken, requirePerm, verifyAppToken, appAuth, requireRole };
