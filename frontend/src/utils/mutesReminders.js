/**
 * Silenciar chats y recordatorios — API del backend (la sesión Bearer la añade utils/authFetch.js).
 *
 *   getMutes()               → { chatId: until }  (0 = siempre)  · se guarda en memoria para no pedirlo en cada chat
 *   isMutedNow(mutes, id)    → ¿silenciado ahora?
 *   setMute(chatId, until)   → until: ms en el futuro, 0 = siempre, null = volver a avisar
 *   listReminders() / addReminder({ text, at, chatId }) / deleteReminder(id)
 */
import { useAuthStore } from '../store/authStore';
import { tr } from '../i18n';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const me = () => useAuthStore.getState().user?.id || '';
let mutesCache = null;

async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || tr('No se pudo conectar con el servidor'));
  return data;
}

export async function getMutes(force = false) {
  if (mutesCache && !force) return mutesCache;
  const { muted = {} } = await json(await fetch(`${BACKEND}/mutes?userId=${encodeURIComponent(me())}`));
  mutesCache = muted;
  return muted;
}

export const isMutedNow = (mutes, chatId) => {
  const u = mutes?.[chatId];
  return u === 0 || (typeof u === 'number' && u > Date.now());
};

export async function setMute(chatId, until) {
  const r = await json(await fetch(`${BACKEND}/mutes/${encodeURIComponent(chatId)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: me(), until }),
  }));
  mutesCache = { ...(mutesCache || {}) };
  if (r.until === null) delete mutesCache[chatId]; else mutesCache[chatId] = r.until;
  return r;
}

export async function listReminders() {
  return (await json(await fetch(`${BACKEND}/reminders?userId=${encodeURIComponent(me())}`))).reminders || [];
}

export async function addReminder({ text, at, chatId = null }) {
  return (await json(await fetch(`${BACKEND}/reminders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: me(), text, at, chatId }),
  }))).reminder;
}

export async function deleteReminder(id) {
  return json(await fetch(`${BACKEND}/reminders/${encodeURIComponent(id)}?userId=${encodeURIComponent(me())}`, { method: 'DELETE' }));
}
