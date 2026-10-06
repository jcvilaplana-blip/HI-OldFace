/**
 * pricing — precio de un viaje (precio cerrado al pedir, como Uber):
 *   bajada de bandera + km × precio/km + min × precio/min   (mínimo: tarifa mínima)
 *   × recargo de la zona (actual o por franja semanal)
 *   − descuento del código promocional
 *   + impuesto de la ciudad (IVA…)
 */
const { all, get, getSetting } = require('./db');
const { haversineKm, pointInPolygon } = require('./geo');

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Ciudad activa más cercana que cubre el punto (dentro de su radio de servicio) */
function cityAt(lat, lng) {
  let best = null;
  for (const c of all('SELECT * FROM cities WHERE active = 1 AND lat IS NOT NULL')) {
    const d = haversineKm(lat, lng, c.lat, c.lng);
    if (d <= (c.radius_km || 30) && (!best || d < best.d)) best = { ...c, d };
  }
  return best;
}

/** Zona de la ciudad que contiene el punto y su recargo efectivo ahora */
function zoneAt(cityId, lat, lng, when = new Date()) {
  if (!cityId) return null;
  for (const z of all('SELECT * FROM zones WHERE city_id = ? AND active = 1', cityId)) {
    let poly; try { poly = JSON.parse(z.polygon || '[]'); } catch { poly = []; }
    if (!pointInPolygon(lat, lng, poly)) continue;
    let surge = Number(z.surge) || 1;
    let slots; try { slots = JSON.parse(z.weekly_slots || '[]'); } catch { slots = []; }
    const day = when.getDay(), hm = when.toTimeString().slice(0, 5);
    for (const s of Array.isArray(slots) ? slots : []) {
      if (Number(s.day) === day && s.from <= hm && hm <= s.to) surge = Math.max(surge, Number(s.surge) || 1);
    }
    return { ...z, surge };
  }
  return null;
}

/** Tipos de viaje disponibles en la ciudad (los de la ciudad y los generales) */
function rideTypesFor(cityId) {
  return all(`SELECT * FROM ride_types WHERE active = 1 AND (city_id IS NULL OR city_id = ?) ORDER BY sort_order, id`, cityId || 0);
}

function taxRateFor(cityId) {
  const rows = all('SELECT rate FROM city_taxes WHERE active = 1 AND (city_id IS NULL OR city_id = ?)', cityId || 0);
  return rows.reduce((a, r) => a + (Number(r.rate) || 0), 0);
}

/**
 * Comprueba un código promocional para un cliente e importe.
 * → { promo, discount } o { error }
 */
function checkPromo(code, customerId, amount, cityId) {
  if (!code) return { promo: null, discount: 0 };
  const p = get("SELECT * FROM promo_codes WHERE code = ? AND status = 'active'", String(code).trim().toUpperCase());
  const today = new Date().toISOString().slice(0, 10);
  if (!p) return { error: 'Código promocional no válido' };
  if (p.starts_at && today < p.starts_at) return { error: 'Este código aún no está activo' };
  if (p.expires_at && today > p.expires_at) return { error: 'Este código ha caducado' };
  if (p.city_id && p.city_id !== cityId) return { error: 'Este código no es válido en esta ciudad' };
  if (p.max_uses && p.used >= p.max_uses) return { error: 'Este código ya se ha agotado' };
  if (customerId && p.max_uses_per_user) {
    const n = get('SELECT count(*) n FROM promo_uses WHERE promo_id = ? AND customer_id = ?', p.id, customerId).n;
    if (n >= p.max_uses_per_user) return { error: 'Ya has usado este código' };
  }
  if (p.min_order && amount < p.min_order) return { error: `Pedido mínimo para este código: ${money(p.min_order)}` };
  let discount = p.type === 'fixed' ? Number(p.value) : amount * Number(p.value) / 100;
  if (p.max_discount) discount = Math.min(discount, p.max_discount);
  return { promo: p, discount: money(Math.min(discount, amount)) };
}

/** Desglose de precio de un tipo de viaje */
function priceFor(rt, { distanceKm, durationMin, surge = 1, taxRate = 0, discount = 0 }) {
  const base = money(rt.base_price), distance = money(distanceKm * rt.price_per_km), time = money(durationMin * rt.price_per_min);
  let subtotal = Math.max(base + distance + time, Number(rt.min_fare) || 0) * (surge || 1);
  subtotal = money(subtotal);
  const disc = money(Math.min(discount, subtotal));
  const tax = money((subtotal - disc) * taxRate / 100);
  const total = money(subtotal - disc + tax);
  return { base, distance, time, surge, subtotal, discount: disc, tax, total };
}

/**
 * Presupuesto de un viaje para todos los tipos de la ciudad.
 * @param route { distanceKm, durationMin }
 */
function quote({ pickup, route, promoCode, customerId, rideTypeId }) {
  const city = cityAt(pickup.lat, pickup.lng);
  const zone = zoneAt(city?.id, pickup.lat, pickup.lng);
  const surge = zone?.surge || 1;
  const taxRate = taxRateFor(city?.id);
  const currency = city ? get('SELECT currency_code code, currency_symbol symbol FROM countries WHERE id = ?', city.country_id) : getSetting('currency');
  let types = rideTypesFor(city?.id);
  if (rideTypeId) types = types.filter(t => t.id === Number(rideTypeId));
  let promoError = null;
  const options = types.map(rt => {
    const pre = priceFor(rt, { distanceKm: route.distanceKm, durationMin: route.durationMin, surge, taxRate });
    const pc = checkPromo(promoCode, customerId, pre.subtotal, city?.id);
    if (pc.error) promoError = pc.error;
    const price = pc.discount ? priceFor(rt, { distanceKm: route.distanceKm, durationMin: route.durationMin, surge, taxRate, discount: pc.discount }) : pre;
    return { rideType: { id: rt.id, name: rt.name, code: rt.code, description: rt.description, seats: rt.seats, icon: rt.app_icon, mapIcon: rt.map_icon, commissionRate: rt.commission_rate },
             price, promoId: pc.promo?.id || null };
  });
  return { city: city ? { id: city.id, name: city.name } : null, zone: zone ? { id: zone.id, name: zone.name, surge } : null,
           currency: currency || { code: 'EUR', symbol: '€' }, taxRate, options, promoError, served: !!city };
}

module.exports = { quote, priceFor, checkPromo, cityAt, zoneAt, rideTypesFor, taxRateFor, money };
