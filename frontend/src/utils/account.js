/**
 * Cuenta — privacidad (última vez, foto de perfil, estados) y eliminación de la cuenta.
 *
 *   getPrivacy()                    → { lastSeen, photo, status }   cada uno { mode, userIds }
 *   savePrivacy(patch, contactIds)  → guarda una o varias opciones (y los contactos de la agenda con OldFace)
 *   deleteAccount()                 → borra todos los datos del usuario en el servidor
 *
 * Modos: all (Todos) · contacts (Mis contactos) · except (Mis contactos excepto…) · none (Nadie).
 * Los estados admiten además `only` (Solo compartir con…), que se elige al publicar.
 */
import { useAuthStore } from '../store/authStore';
import { getRtcToken } from './rtcClient';
import { tr } from '../i18n';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

async function authHeaders() {
  const user = useAuthStore.getState().user;
  const token = await getRtcToken(user?.id);
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` };
}

async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || tr('No se pudo conectar con el servidor'));
  return data;
}

export async function getPrivacy() {
  const user = useAuthStore.getState().user;
  return json(await fetch(`${BACKEND}/user/privacy?userId=${encodeURIComponent(user?.id)}`, { headers: await authHeaders() }));
}

export async function savePrivacy(patch, contactIds) {
  const user = useAuthStore.getState().user;
  return json(await fetch(`${BACKEND}/user/privacy`, {
    method: 'PUT', headers: await authHeaders(),
    body: JSON.stringify({ userId: user?.id, ...patch, ...(Array.isArray(contactIds) ? { contactIds } : {}) }),
  }));
}

export async function deleteAccount() {
  const user = useAuthStore.getState().user;
  return json(await fetch(`${BACKEND}/account/delete`, {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify({ userId: user?.id, confirm: 'DELETE' }),
  }));
}

/** Texto corto de una opción de privacidad */
export function privacyModeLabel(rule) {
  const n = rule?.userIds?.length || 0;
  switch (rule?.mode) {
    case 'contacts': return tr('Mis contactos');
    case 'except':   return n ? tr('Mis contactos excepto {n}', { n }) : tr('Mis contactos excepto…');
    case 'only':     return tr('Solo con {n}', { n });
    case 'none':     return tr('Nadie');
    default:         return tr('Todos');
  }
}
