/**
 * dispatch — reparto de viajes a conductores por RONDAS DE RADIO (ajuste "Driver Search Radius").
 *
 *   Ronda 1, 2, 3 (km del panel): se ofrece el viaje al conductor disponible más cercano del tipo pedido,
 *   de uno en uno, durante `offerSeconds`. Si rechaza o no responde → siguiente. Sin candidatos → siguiente ronda.
 *   Tras la última ronda se reintenta cada 10 s hasta `searchTimeoutSec`; después la reserva caduca.
 *   Al arrancar el servidor se retoman las búsquedas pendientes.
 */
const { all, get, run, tx, now, getSetting } = require('./db');
const { haversineKm, bbox } = require('./geo');
const rt = require('./realtime');

const timers = new Map();      // bookingId → timeout
const LOCATION_FRESH_MS = 5 * 60 * 1000;

const cfg = () => ({ ...{ round1Km: 3, round2Km: 6, round3Km: 10, offerSeconds: 20 }, ...getSetting('driverSearch', {}),
                     searchTimeoutSec: getSetting('booking', {}).searchTimeoutSec || 120 });

function clear(bookingId) { clearTimeout(timers.get(bookingId)); timers.delete(bookingId); }
function later(bookingId, ms, fn) { clear(bookingId); timers.set(bookingId, setTimeout(() => { timers.delete(bookingId); fn(); }, ms)); }

function logEvent(bookingId, type, data) {
  run('INSERT INTO booking_events (booking_id, type, data, created_at) VALUES (?, ?, ?, ?)', bookingId, type, data ? JSON.stringify(data) : null, now());
}

/** Conductores candidatos para una reserva dentro de un radio, del más cercano al más lejano */
function candidates(b, radiusKm) {
  const box = bbox(b.pickup_lat, b.pickup_lng, radiusKm);
  const rows = all(`
    SELECT d.id, d.lat, d.lng, v.id AS vehicle_id FROM drivers d
    JOIN vehicles v ON v.driver_id = d.id AND v.status = 'active' AND v.ride_type_id = ?
    WHERE d.status = 'active' AND d.verified = 1 AND d.online = 1 AND d.available = 1
      AND d.location_at > ? AND d.lat BETWEEN ? AND ? AND d.lng BETWEEN ? AND ?
      AND d.id NOT IN (SELECT driver_id FROM booking_offers WHERE booking_id = ?)
      AND d.id NOT IN (SELECT driver_id FROM bookings WHERE status IN ('accepted','arrived','started') AND driver_id IS NOT NULL)`,
    b.ride_type_id, now() - LOCATION_FRESH_MS, box.minLat, box.maxLat, box.minLng, box.maxLng, b.id);
  return rows.map(r => ({ ...r, km: haversineKm(b.pickup_lat, b.pickup_lng, r.lat, r.lng) }))
             .filter(r => r.km <= radiusKm).sort((a, c) => a.km - c.km);
}

/** Datos de la oferta que ve el conductor */
function offerPayload(b, km, seconds) {
  const rtName = get('SELECT name FROM ride_types WHERE id = ?', b.ride_type_id)?.name;
  return { code: b.code, rideType: rtName, pickup: { address: b.pickup_address, lat: b.pickup_lat, lng: b.pickup_lng },
           dropoff: { address: b.dropoff_address, lat: b.dropoff_lat, lng: b.dropoff_lng },
           distanceKm: b.distance_km, durationMin: b.duration_min, pickupKm: Math.round(km * 10) / 10,
           fare: b.total_amount ?? b.estimated_fare, currency: b.currency, paymentMethod: b.payment_method,
           expiresIn: seconds, expiresAt: now() + seconds * 1000 };
}

/** Busca el siguiente conductor y le ofrece el viaje */
function next(bookingId) {
  const b = get('SELECT * FROM bookings WHERE id = ?', bookingId);
  if (!b || b.status !== 'searching') return clear(bookingId);
  const c = cfg();
  const radii = [c.round1Km, c.round2Km, c.round3Km].map(Number).filter(n => n > 0);

  if (now() - (b.search_started_at || b.created_at) > c.searchTimeoutSec * 1000) {
    run("UPDATE bookings SET status = 'expired' WHERE id = ? AND status = 'searching'", b.id);
    run("UPDATE booking_offers SET status = 'expired', responded_at = ? WHERE booking_id = ? AND status = 'offered'", now(), b.id);
    logEvent(b.id, 'expired');
    rt.toCustomer(b.customer_id, 'booking:update', { code: b.code, status: 'expired', message: 'No hay conductores disponibles ahora mismo' });
    rt.toAdmins('booking:update', { code: b.code, status: 'expired' });
    return clear(b.id);
  }

  let round = Math.max(1, b.search_round || 1);
  while (round <= radii.length) {
    const list = candidates(b, radii[round - 1]);
    if (list.length) {
      const d = list[0];
      run('UPDATE bookings SET search_round = ? WHERE id = ?', round, b.id);
      run('INSERT INTO booking_offers (booking_id, driver_id, round, distance_km, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          b.id, d.id, round, Math.round(d.km * 100) / 100, 'offered', now());
      logEvent(b.id, 'offer', { driverId: d.id, round, km: d.km });
      rt.toDriver(d.id, 'offer:new', offerPayload(b, d.km, c.offerSeconds));
      later(b.id, c.offerSeconds * 1000, () => {
        const changed = run("UPDATE booking_offers SET status = 'expired', responded_at = ? WHERE booking_id = ? AND driver_id = ? AND status = 'offered'", now(), b.id, d.id);
        if (changed.changes) rt.toDriver(d.id, 'offer:expired', { code: b.code });
        next(b.id);
      });
      return;
    }
    round++;
    run('UPDATE bookings SET search_round = ? WHERE id = ?', Math.min(round, radii.length), b.id);
  }
  // Ningún conductor en ninguna ronda: reintentar en 10 s (permitiendo repetir conductores que caducaron)
  run("DELETE FROM booking_offers WHERE booking_id = ? AND status = 'expired'", b.id);
  run('UPDATE bookings SET search_round = 1 WHERE id = ?', b.id);
  later(b.id, 10000, () => next(b.id));
}

/** Empezar a buscar conductor para una reserva recién creada */
function start(bookingId) {
  run('UPDATE bookings SET search_round = 1, search_started_at = ? WHERE id = ?', now(), bookingId);
  setImmediate(() => next(bookingId));
}

/** El conductor acepta la oferta → la reserva es suya (solo uno puede ganar) */
function accept(driverId, code) {
  return tx(() => {
    const b = get('SELECT * FROM bookings WHERE code = ?', code);
    if (!b) throw Object.assign(new Error('Viaje no encontrado'), { status: 404 });
    const offer = get("SELECT * FROM booking_offers WHERE booking_id = ? AND driver_id = ? AND status = 'offered'", b.id, driverId);
    if (!offer || b.status !== 'searching') throw Object.assign(new Error('Esta oferta ya no está disponible'), { status: 409 });
    const vehicle = get("SELECT id FROM vehicles WHERE driver_id = ? AND status = 'active' AND ride_type_id = ? LIMIT 1", driverId, b.ride_type_id);
    const otp = String(Math.floor(1000 + Math.random() * 9000));
    run("UPDATE bookings SET status = 'accepted', driver_id = ?, vehicle_id = ?, accepted_at = ?, start_otp = ? WHERE id = ?", driverId, vehicle?.id || null, now(), otp, b.id);
    run("UPDATE booking_offers SET status = 'accepted', responded_at = ? WHERE id = ?", now(), offer.id);
    run('UPDATE drivers SET available = 0 WHERE id = ?', driverId);
    logEvent(b.id, 'accepted', { driverId });
    clear(b.id);
    return b.id;
  });
}

/** El conductor rechaza la oferta → siguiente conductor */
function reject(driverId, code) {
  const b = get('SELECT * FROM bookings WHERE code = ?', code);
  if (!b) throw Object.assign(new Error('Viaje no encontrado'), { status: 404 });
  const r = run("UPDATE booking_offers SET status = 'rejected', responded_at = ? WHERE booking_id = ? AND driver_id = ? AND status = 'offered'", now(), b.id, driverId);
  if (!r.changes) throw Object.assign(new Error('Esta oferta ya no está disponible'), { status: 409 });
  logEvent(b.id, 'rejected', { driverId });
  next(b.id);
}

/** Volver a buscar (el conductor canceló tras aceptar); no se vuelve a ofrecer a ese conductor */
function restart(bookingId) {
  run("UPDATE bookings SET status = 'searching', driver_id = NULL, vehicle_id = NULL, accepted_at = NULL, arrived_at = NULL, start_otp = NULL, search_round = 1, search_started_at = ? WHERE id = ?", now(), bookingId);
  next(bookingId);
}

/** Al arrancar: retomar búsquedas pendientes */
function resume() {
  for (const b of all("SELECT id FROM bookings WHERE status = 'searching'")) {
    run("UPDATE booking_offers SET status = 'expired' WHERE booking_id = ? AND status = 'offered'", b.id);
    setTimeout(() => next(b.id), 1000);
  }
}

/** Oferta que el conductor tiene abierta ahora (para reabrir la app sin perderla) o null */
function pendingOffer(driverId, code) {
  const o = get(`SELECT o.distance_km, o.created_at AS offered_at, b.* FROM booking_offers o JOIN bookings b ON b.id = o.booking_id
                 WHERE o.driver_id = ? AND b.code = ? AND o.status = 'offered' AND b.status = 'searching'`, driverId, code);
  if (!o) return null;
  const left = Math.round((o.offered_at + cfg().offerSeconds * 1000 - now()) / 1000);
  return left > 0 ? offerPayload(o, o.distance_km || 0, left) : null;
}

module.exports = { start, accept, reject, restart, resume, clear, next, candidates, logEvent, pendingOffer };
