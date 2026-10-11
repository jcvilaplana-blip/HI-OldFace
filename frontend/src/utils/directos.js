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
 *
 * Visibilidad: 'public' (todo OldFace) · 'contacts' (los `contacts` elegidos o, si no hay, todos mis contactos).
 * Crear, editar y borrar van con la sesión (token RTC): el servidor comprueba que es tuyo.
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

/** 3725 → "1:02:05" · 65 → "1:05" */
export function formatDuration(s) {
  const t = Math.max(0, Math.round(Number(s) || 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
