/**
 * API interna del taxi — /taxi/api/internal/…  (solo para la API de OldFace, con el secreto interno RTC_SECRET en
 * la cabecera x-internal-secret). La usa Willy (frontend/backend/ai/taxi.js) para informar al usuario; nunca reserva,
 * cobra ni devuelve datos de conductores (ni nombres, ni matrículas, ni posiciones).
 *
 *   GET  /nearby?lat=&lng=      → cuántos taxis libres hay cerca por tipo de viaje, distancia y llegada del más cercano
 *   GET  /places?q=&lat=&lng=   → direcciones que coinciden (buscador del mapa propio)
 *   POST /estimate { pickup, dropoff } → distancia, duración y precio aproximado de cada tipo de viaje
 */
const express = require('express');
const crypto = require('crypto');
const { getSetting } = require('../db');
const { validPoint } = require('../geo');
const maps = require('../maps');
const pricing = require('../pricing');
const dispatch = require('../dispatch');

const router = express.Router();
const err = (status, message) => Object.assign(new Error(message), { status, expose: true });
const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const pt = (p) => ({ lat: Number(p?.lat), lng: Number(p?.lng), address: String(p?.address || '').slice(0, 300) });
const round1 = (n) => Math.round(n * 10) / 10;

/** Solo con el secreto interno (comparación de tiempo constante); sin secreto configurado, cerrado */
router.use((req, res, next) => {
  const secret = process.env.RTC_SECRET || '';
  const given = String(req.headers['x-internal-secret'] || '');
  const ok = secret && given.length === secret.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return res.status(403).json({ error: 'Prohibido' });
  next();
});

router.get('/nearby', (req, res) => {
  const p = pt(req.query);
  if (!validPoint(p)) throw err(400, 'Punto no válido');
  const radius = Number(getSetting('driverSearch', {}).round3Km) || 10;
  const city = pricing.cityAt(p.lat, p.lng);
  const rideTypes = pricing.rideTypesFor(city?.id).map(rt => {
    const near = dispatch.candidates({ id: 0, pickup_lat: p.lat, pickup_lng: p.lng, ride_type_id: rt.id }, radius);
    const km = near[0] ? round1(near[0].km) : null;
    return { name: rt.name, available: near.length, nearestKm: km, etaMin: km === null ? null : Math.max(2, Math.round(km / 25 * 60)) };
  });
  res.json({ served: !!city, city: city?.name || null, radiusKm: radius, rideTypes });
});

router.get('/places', a(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  if (q.length < 2) return res.json({ places: [] });
  try {
    const places = await maps.search(q, { lat: Number(req.query.lat), lng: Number(req.query.lng), lang: 'es', limit: 5 });
    res.json({ places: places.slice(0, 5).map(x => ({ name: x.name, address: x.address, lat: x.lat, lng: x.lng })) });
  } catch { res.status(503).json({ error: 'El buscador de direcciones no está disponible ahora mismo', places: [] }); }
}));

router.post('/estimate', a(async (req, res) => {
  const pickup = pt(req.body?.pickup), dropoff = pt(req.body?.dropoff);
  if (!validPoint(pickup) || !validPoint(dropoff)) throw err(400, 'Indica origen y destino');
  const route = await maps.route([pickup, dropoff]);
  const q = pricing.quote({ pickup, route });
  res.json({
    served: q.served, city: q.city?.name || null, currency: q.currency.code,
    distanceKm: round1(route.distanceKm), durationMin: Math.round(route.durationMin), estimated: !!route.estimated,
    options: q.options.map(o => ({ name: o.rideType.name, seats: o.rideType.seats, total: o.price.total })),
  });
}));

module.exports = router;
