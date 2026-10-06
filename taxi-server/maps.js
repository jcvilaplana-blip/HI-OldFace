/**
 * maps — servicios de mapas PROPIOS del VPS (sin Google):
 *   · Valhalla (rutas, distancia, tiempo, polilínea)   VALHALLA_URL (por defecto http://127.0.0.1:8002)
 *   · Photon   (buscador y dirección de un punto)      PHOTON_URL   (por defecto http://127.0.0.1:2322)
 * Si Valhalla no responde (p. ej. en desarrollo), se estima por línea recta × 1,3 a 30 km/h.
 */
const { haversineKm } = require('./geo');

const VALHALLA = process.env.VALHALLA_URL || 'http://127.0.0.1:8002';
const PHOTON   = process.env.PHOTON_URL   || 'http://127.0.0.1:2322';

async function fetchJson(url, opts = {}, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

/**
 * Ruta en coche entre varios puntos [{lat,lng},…]
 * → { distanceKm, durationMin, shape (polilínea precisión 6), estimated: bool }
 */
async function route(points, { costing = 'auto' } = {}) {
  try {
    const body = { locations: points.map(p => ({ lat: Number(p.lat), lon: Number(p.lng) })), costing, units: 'kilometers',
                   directions_options: { language: 'es-ES' }, directions_type: 'none' };
    const d = await fetchJson(`${VALHALLA}/route`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const s = d.trip.summary;
    return { distanceKm: round(s.length, 2), durationMin: round(s.time / 60, 1), shape: d.trip.legs.map(l => l.shape).join(''), estimated: false };
  } catch {
    let km = 0;
    for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
    km *= 1.3;
    return { distanceKm: round(km, 2), durationMin: round(km / 30 * 60, 1), shape: null, estimated: true };
  }
}

/** Formatea un resultado de Photon como dirección legible */
function label(p) {
  const pr = p.properties || {};
  const street = [pr.street, pr.housenumber].filter(Boolean).join(' ');
  const main = pr.name && pr.name !== pr.street ? pr.name : street || pr.name;
  const parts = [main, main === street ? null : street, pr.district || pr.locality, pr.city || pr.town || pr.village, pr.state, pr.country];
  return [...new Set(parts.filter(Boolean))].join(', ');
}
const toPlace = (f) => ({ address: label(f), name: f.properties?.name || null, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0],
                          city: f.properties?.city || f.properties?.town || f.properties?.village || null, country: f.properties?.countrycode || null });

/** Buscador de direcciones (prioriza resultados cerca de lat/lng) */
async function search(q, { lat, lng, lang = 'es', limit = 8 } = {}) {
  const u = new URL(`${PHOTON}/api`);
  u.searchParams.set('q', q); u.searchParams.set('limit', String(limit));
  if (PHOTON_LANGS.includes(lang)) u.searchParams.set('lang', lang);
  if (Number.isFinite(lat) && Number.isFinite(lng)) { u.searchParams.set('lat', lat); u.searchParams.set('lon', lng); }
  const d = await fetchJson(u.href, {}, 5000);
  // Photon devuelve a veces el mismo sitio varias veces (nodo y vía de OSM): uno por dirección
  const seen = new Set();
  return (d.features || []).map(toPlace).filter(p => !seen.has(p.address) && seen.add(p.address));
}

/** Dirección de un punto (geocodificación inversa) */
async function reverse(lat, lng, { lang = 'es' } = {}) {
  try {
    const u = new URL(`${PHOTON}/reverse`);
    u.searchParams.set('lat', lat); u.searchParams.set('lon', lng);
    if (PHOTON_LANGS.includes(lang)) u.searchParams.set('lang', lang);
    const d = await fetchJson(u.href, {}, 4000);
    return d.features?.[0] ? toPlace(d.features[0]) : null;
  } catch { return null; }
}

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
// Idiomas que admite la base de datos de Photon; sin `lang` devuelve los nombres locales (español en España/LatAm)
const PHOTON_LANGS = ['en', 'de', 'fr'];

module.exports = { route, search, reverse };
