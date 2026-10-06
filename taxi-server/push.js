/**
 * push — avisos push del taxi a través del backend de OldFace (que ya tiene Firebase/FCM y los tokens de cada usuario).
 *   Conductor: nueva oferta de viaje · el cliente ha cancelado
 *   Cliente:   cambios del viaje con mensaje (conductor en camino, ha llegado, fin, sin conductores…)
 * Llama a POST {OLDFACE_API_URL}/internal/push con el secreto interno (RTC_SECRET). Sin OLDFACE_API_URL no hace nada.
 */
const { get } = require('./db');

const API = (process.env.OLDFACE_API_URL || '').replace(/\/+$/, '');
const SECRET = process.env.RTC_SECRET || '';
const APP = 'OldFace Taxi';

function send(userId, title, body, data) {
  if (!API || !SECRET || !userId) return;
  fetch(`${API}/internal/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': SECRET },
    body: JSON.stringify({ userId, title, body, data }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}

const money = (n, cur) => { try { return new Intl.NumberFormat('es-ES', { style: 'currency', currency: cur || 'EUR' }).format(Number(n) || 0); } catch { return `${n} ${cur || ''}`; } };

function forDriver(driverId, event, p = {}) {
  if (event === 'offer:new') {
    const uid = get('SELECT user_id FROM drivers WHERE id = ?', driverId)?.user_id;
    send(uid, `🚕 Nuevo viaje · ${money(p.fare, p.currency)}`, `${p.pickup?.address || ''} · a ${p.pickupKm} km`, { type: 'taxi_offer', code: p.code });
  } else if (event === 'booking:update' && p.status === 'cancelled' && p.cancelledBy === 'customer') {
    const uid = get('SELECT user_id FROM drivers WHERE id = ?', driverId)?.user_id;
    send(uid, APP, 'El cliente ha cancelado el viaje', { type: 'taxi_trip', code: p.code });
  }
}

function forCustomer(customerId, event, p = {}) {
  if (event !== 'booking:update' || !p.message || p.cancelledBy === 'customer') return;
  const uid = get('SELECT user_id FROM customers WHERE id = ?', customerId)?.user_id;
  send(uid, APP, p.message, { type: 'taxi_trip', code: p.code });
}

module.exports = { forDriver, forCustomer };
