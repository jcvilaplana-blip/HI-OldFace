/**
 * Cuenta — privacidad (última vez, foto de perfil, estados) y eliminación de la cuenta.
 *
 *   getPrivacy()                    → { lastSeen, photo, status }   cada uno { mode, userIds }
 *   savePrivacy(patch)              → guarda una o varias opciones
 *   uploadAgenda(phones)            → manda al servidor los teléfonos de la agenda (define "Mis contactos")
 *   syncAgendaOnStart()             → lo mismo al abrir la app, si ya hay permiso de contactos (cada 6 h)
 *   deleteAccount()                 → borra todos los datos del usuario en el servidor
 *
 * Modos: contacts (Mis contactos) · except (Mis contactos excepto…) · none (Nadie). En OldFace todo es privado:
 * no hay "Todos". Los estados admiten además `only` (Solo compartir con…), que se elige al publicar.
 * Mis contactos = los de tu agenda con OldFace + con quien has escrito por chat (los grupos no cuentan).
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

export async function savePrivacy(patch) {
  const user = useAuthStore.getState().user;
  return json(await fetch(`${BACKEND}/user/privacy`, {
    method: 'PUT', headers: await authHeaders(),
    body: JSON.stringify({ userId: user?.id, ...patch }),
  }));
}

export async function uploadAgenda(phones) {
  const user = useAuthStore.getState().user;
  if (!user?.id || !Array.isArray(phones)) return;
  await json(await fetch(`${BACKEND}/user/contacts`, {
    method: 'PUT', headers: await authHeaders(), body: JSON.stringify({ userId: user.id, phones }),
  }));
  try { localStorage.setItem(`oldface-agenda-sync:${user.id}`, String(Date.now())); } catch { /* sin almacenamiento */ }
}

export async function syncAgendaOnStart() {
  const user = useAuthStore.getState().user;
  if (!user?.id) return;
  try {
    const last = Number(localStorage.getItem(`oldface-agenda-sync:${user.id}`)) || 0;
    if (Date.now() - last < 6 * 3600_000) return;
  } catch { /* sin almacenamiento */ }
  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform()) return;
  const { Contacts } = await import('@capacitor-community/contacts');
  // Sin permiso no se pregunta aquí: ya lo pedirá la pestaña Contactos
  if ((await Contacts.checkPermissions())?.contacts !== 'granted') return;
  const { contacts = [] } = await Contacts.getContacts({ projection: { phones: true } });
  await uploadAgenda(contacts.flatMap(c => (c.phones || []).map(p => p.number)).filter(Boolean));
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
    case 'except':   return n ? tr('Mis contactos excepto {n}', { n }) : tr('Mis contactos excepto…');
    case 'only':     return tr('Solo con {n}', { n });
    case 'none':     return tr('Nadie');
    default:         return tr('Mis contactos');
  }
}
