/**
 * realtime — Socket.IO del taxi (path /taxi/socket.io).
 *
 * Salas: driver:<id> · customer:<id> · admins (mapa en vivo del panel)
 * Del conductor:  'driver:location' { lat, lng, heading }  → se guarda; si lleva un viaje, se reenvía al cliente
 * Hacia las apps: 'offer:new' · 'offer:expired' · 'booking:update' · 'trip:location'
 * Hacia el panel: 'driver:location' · 'booking:update'
 */
const { Server } = require('socket.io');
const { get, run, now } = require('./db');
const { verifyAppToken, verifyAdminToken } = require('./auth');
const push = require('./push');

let io = null;

function init(server) {
  io = new Server(server, { path: '/taxi/socket.io', cors: { origin: '*' } });

  io.use((socket, next) => {
    const { token, adminToken } = socket.handshake.auth || {};
    if (adminToken) {
      const v = verifyAdminToken(adminToken);
      if (v.error || !v.can('live_map.view')) return next(new Error('unauthorized'));
      socket.data = { admin: v.admin.id };
      return next();
    }
    const userId = verifyAppToken(token);
    if (!userId) return next(new Error('unauthorized'));
    const acc = get('SELECT role FROM taxi_accounts WHERE user_id = ?', userId);
    if (!acc) return next(new Error('no-role'));
    const me = get(`SELECT id FROM ${acc.role === 'driver' ? 'drivers' : 'customers'} WHERE user_id = ?`, userId);
    if (!me) return next(new Error('no-role'));
    socket.data = { userId, role: acc.role, id: me.id };
    next();
  });

  io.on('connection', (socket) => {
    const d = socket.data;
    if (d.admin) { socket.join('admins'); return; }
    socket.join(`${d.role}:${d.id}`);

    if (d.role === 'driver') socket.on('driver:location', (p = {}) => driverLocation(d.id, p));
  });
  return io;
}

/**
 * Nueva posición del conductor (por el socket o por HTTP desde el servicio en segundo plano del móvil):
 * se guarda y, si lleva un viaje, se reenvía al cliente. Máx. ~1 posición cada 1,5 s por conductor.
 */
const lastFix = new Map();
function driverLocation(driverId, p = {}) {
  const lat = Number(p.lat), lng = Number(p.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  const t = now();
  if (t - (lastFix.get(driverId) || 0) < 1500) return true;
  lastFix.set(driverId, t);
  const heading = p.heading !== null && p.heading !== undefined && Number.isFinite(Number(p.heading)) ? Number(p.heading) : null;
  run('UPDATE drivers SET lat = ?, lng = ?, heading = ?, location_at = ? WHERE id = ?', lat, lng, heading, t, driverId);
  const trip = get("SELECT id, code, customer_id FROM bookings WHERE driver_id = ? AND status IN ('accepted','arrived','started') ORDER BY id DESC LIMIT 1", driverId);
  if (trip) io?.to(`customer:${trip.customer_id}`).emit('trip:location', { code: trip.code, lat, lng, heading, at: t });
  io?.to('admins').emit('driver:location', { id: driverId, lat, lng, heading, busy: !!trip, at: t });
  return true;
}

const emit = (room, event, data) => io?.to(room).emit(event, data);
// Además del tiempo real, avisos push para lo importante (llegan con la app cerrada o el móvil bloqueado)
const toDriver = (id, event, data) => { emit(`driver:${id}`, event, data); push.forDriver(id, event, data); };
const toCustomer = (id, event, data) => { emit(`customer:${id}`, event, data); push.forCustomer(id, event, data); };
const toAdmins = (event, data) => emit('admins', event, data);

module.exports = { init, emit, toDriver, toCustomer, toAdmins, driverLocation };
