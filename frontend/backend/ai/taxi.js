/**
 * Taxi para Willy — consultas FIJAS a la API interna del taxi (taxi-server/routes/internal.js, en 127.0.0.1 con el
 * secreto interno). El modelo no elige direcciones de servidor ni rutas: solo estas tres funciones existen.
 *
 *   const taxi = createTaxi(env)         // null si no hay TAXI_INTERNAL_URL o RTC_SECRET
 *   taxi.nearby({ lat, lng })            → { served, city, radiusKm, rideTypes: [{ name, available, nearestKm, etaMin }] }
 *   taxi.places(q, { lat, lng })         → { places: [{ name, address, lat, lng }] }
 *   taxi.estimate(pickup, dropoff)       → { served, currency, distanceKm, durationMin, options: [{ name, seats, total }] }
 *
 * Willy nunca reserva ni paga: prepara el destino y el usuario pide el taxi en la pantalla del taxi.
 */
const TIMEOUT_MS = 15_000;

class TaxiUnavailable extends Error {}

function createTaxi(env = process.env) {
  const base = String(env.TAXI_INTERNAL_URL || '').replace(/\/+$/, '');
  const secret = env.RTC_SECRET || '';
  if (!base || !secret) return null;

  async function call(method, path, body) {
    let r;
    try {
      r = await fetch(`${base}/taxi/api/internal${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch { throw new TaxiUnavailable('El servicio de taxi no responde ahora mismo'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new TaxiUnavailable(data.error || 'El servicio de taxi no responde ahora mismo');
    return data;
  }

  const q = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString();

  return {
    nearby: ({ lat, lng }) => call('GET', `/nearby?${q({ lat, lng })}`),
    places: (text, near = {}) => call('GET', `/places?${q({ q: text, lat: near.lat, lng: near.lng })}`),
    estimate: (pickup, dropoff) => call('POST', '/estimate', { pickup, dropoff }),
  };
}

module.exports = { createTaxi, TaxiUnavailable };
