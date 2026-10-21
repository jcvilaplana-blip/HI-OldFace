/**
 * Directos — API del backend.
 *
 *   getPermissions()              → { canBroadcast, mode }   (de momento solo las cuentas autorizadas emiten)
 *   listDirectos()                → directos que puedo ver (públicos, de mis contactos y los míos)
 *   saveDirecto(id|null, campos)  → crear o editar uno mío { title, description, scheduledAt, visibility, contacts, price, status }
 *   deleteDirecto(id)
 *   listRecordings(ownerId?)      → { recordings, channel } grabaciones que puedo ver (de un canal o de todos)
 *   saveRecording(id, campos)     → { title, description, published, visibility } (solo las mías)
 *   deleteRecording(id)
 *   countView(id)                 → una reproducción más
 *   payConfig() · startPay(kind, id) · confirmPay(paymentId) · redeemCode(kind, id, code)   → directos de pago
 *   listCodes(directoId) · createCodes(directoId, n) · deleteCode(directoId, code)        → códigos (solo el emisor)
 *   getEarnings() · requestWithdrawal({ amount, holder, iban })                         → ganancias del emisor
 *
 * Solo el emisor y sus contactos (los `contacts` elegidos o, si no hay, todos). Si tiene precio, el contacto necesita
 * pagarlo o canjear un código del emisor (locked: true hasta entonces; la grabación llega sin `url`).
 * Crear, editar, borrar y pagar van con la sesión (token RTC): el servidor lo comprueba todo.
 */
import { useAuthStore } from '../store/authStore';
import { getRtcToken } from './rtcClient';
import { tr } from '../i18n';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const me = () => useAuthStore.getState().user?.id || '';

async function authHeaders() {
  const token = await getRtcToken(me()).catch(() => '');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` };
}

async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || tr('No se pudo conectar con el servidor'));
  return data;
}

const q = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();

export async function getPermissions() {
  return json(await fetch(`${BACKEND}/directos/permissions?${q({ userId: me() })}`));
}

export async function listDirectos() {
  return (await json(await fetch(`${BACKEND}/directos?${q({ userId: me() })}`))).directos || [];
}

export async function saveDirecto(id, fields) {
  return json(await fetch(id ? `${BACKEND}/directos/${encodeURIComponent(id)}` : `${BACKEND}/directos`, {
    method: id ? 'PUT' : 'POST', headers: await authHeaders(), body: JSON.stringify({ userId: me(), ...fields }),
  }));
}

export async function deleteDirecto(id) {
  return json(await fetch(`${BACKEND}/directos/${encodeURIComponent(id)}?${q({ userId: me() })}`, {
    method: 'DELETE', headers: await authHeaders(),
  }));
}

export async function listRecordings(ownerId) {
  return json(await fetch(`${BACKEND}/directos/recordings?${q({ userId: me(), ownerId })}`));
}

export async function saveRecording(id, fields) {
  return json(await fetch(`${BACKEND}/directos/recordings/${encodeURIComponent(id)}`, {
    method: 'PUT', headers: await authHeaders(), body: JSON.stringify({ userId: me(), ...fields }),
  }));
}

export async function deleteRecording(id) {
  return json(await fetch(`${BACKEND}/directos/recordings/${encodeURIComponent(id)}?${q({ userId: me() })}`, {
    method: 'DELETE', headers: await authHeaders(),
  }));
}

export function countView(id) {
  fetch(`${BACKEND}/directos/recordings/${encodeURIComponent(id)}/view`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: me() }),
  }).catch(() => {});
}

// ── Directos de pago ──
const post = async (path, body) => json(await fetch(`${BACKEND}${path}`, {
  method: 'POST', headers: await authHeaders(), body: JSON.stringify({ userId: me(), ...body }),
}));

export async function payConfig() {
  return json(await fetch(`${BACKEND}/directos/pay/config?${q({ userId: me() })}`));
}
/** kind: 'directo' | 'recording' → { paymentId, clientSecret, publishableKey, testMode, amount } o { already: true } */
export const startPay = (kind, id) => post('/directos/pay', { kind, id });
export const confirmPay = (paymentId) => post('/directos/pay/confirm', { paymentId });
export const redeemCode = (kind, id, code) => post('/directos/redeem', { kind, id, code });

export async function listCodes(directoId) {
  return (await json(await fetch(`${BACKEND}/directos/${encodeURIComponent(directoId)}/codes?${q({ userId: me() })}`, { headers: await authHeaders() }))).codes || [];
}
export const createCodes = async (directoId, count) => (await post(`/directos/${encodeURIComponent(directoId)}/codes`, { count })).codes || [];
export async function deleteCode(directoId, code) {
  return json(await fetch(`${BACKEND}/directos/${encodeURIComponent(directoId)}/codes/${encodeURIComponent(code)}?${q({ userId: me() })}`, {
    method: 'DELETE', headers: await authHeaders(),
  }));
}

export async function getEarnings() {
  return json(await fetch(`${BACKEND}/directos/earnings?${q({ userId: me() })}`, { headers: await authHeaders() }));
}
export const requestWithdrawal = (fields) => post('/directos/earnings/withdraw', fields);

/** 4.5 → "4,50 €" */
export const formatMoney = (n) => `${(Number(n) || 0).toFixed(2).replace('.', ',')} €`;

/** 3725 → "1:02:05" · 65 → "1:05" */
export function formatDuration(s) {
  const t = Math.max(0, Math.round(Number(s) || 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
