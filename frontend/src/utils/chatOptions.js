/**
 * Opciones del chat — API del backend (la sesión Bearer la añade utils/authFetch.js).
 *
 *   getBlocks(force) / setBlocked(userId, blocked) / isBlockedNow(blocks, userId)   bloquear contactos (chats 1 a 1)
 *   clearChat(chatId)        vaciar el chat solo para mí
 *   openSelfChat()           crea o abre el chat "Tú" (contigo mismo)
 *   getAutoSave(chatId) / setAutoSave(chatId, mode)   guardar fotos y vídeos recibidos: 'always' | 'never' (en este móvil)
 *   peerOf(chatId, me)       el otro participante de un chat 1 a 1 (null en grupos y en el chat "Tú")
 *   shareContact(toChatId, contact)   envía la tarjeta de un contacto de OldFace a otro chat
 */
import { useAuthStore } from '../store/authStore';
import { tr } from '../i18n';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const me = () => useAuthStore.getState().user?.id || '';
let blocksCache = null;   // Set de userId bloqueados

async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || tr('No se pudo conectar con el servidor'));
  return data;
}

export async function getBlocks(force = false) {
  if (blocksCache && !force) return blocksCache;
  const { blocked = [] } = await json(await fetch(`${BACKEND}/blocks?userId=${encodeURIComponent(me())}`));
  blocksCache = new Set(blocked.map(b => b.userId));
  return blocksCache;
}

export const isBlockedNow = (blocks, userId) => !!userId && !!blocks?.has?.(userId);

export async function setBlocked(userId, blocked) {
  await json(await fetch(`${BACKEND}/blocks/${encodeURIComponent(userId)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: me(), blocked }),
  }));
  blocksCache = new Set(blocksCache || []);
  if (blocked) blocksCache.add(userId); else blocksCache.delete(userId);
  return blocked;
}

export async function clearChat(chatId) {
  return json(await fetch(`${BACKEND}/chats/${encodeURIComponent(chatId)}/clear`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: me() }),
  }));
}

export async function openSelfChat() {
  return json(await fetch(`${BACKEND}/chats/self`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: me() }),
  }));
}

/** ¿Es el chat "Tú" (contigo mismo)? */
export const isSelfChatId = (chatId, uid = me()) => !!uid && chatId === `chat_${uid}_${uid}`;

export function peerOf(chatId, uid = me()) {
  if (!chatId || chatId.startsWith('group_') || !chatId.startsWith('chat_')) return null;
  const parts = chatId.replace(/^chat_/, '').split(/_(?=user_)/);
  return parts.find(p => p && p !== uid) || null;
}

// ── Guardar fotos y vídeos recibidos (preferencia de este móvil, por chat) ──
const AUTOSAVE_KEY = 'oldface-autosave';
const SAVED_KEY = 'oldface-autosaved';
const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || '') || d; } catch { return d; } };

export const getAutoSave = (chatId) => (readJSON(AUTOSAVE_KEY, {})[chatId] === 'always' ? 'always' : 'never');

export function setAutoSave(chatId, mode) {
  const all = readJSON(AUTOSAVE_KEY, {});
  if (mode === 'always') all[chatId] = 'always'; else delete all[chatId];
  try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(all)); } catch { /* sin espacio: no se recuerda */ }
  // Lo que ya estaba en el chat no se descarga de golpe: solo lo que llegue a partir de ahora
  if (mode === 'always') markAutoSaved(chatId, null, Date.now());
}

/** Mensajes ya guardados (para no descargarlos dos veces) y desde cuándo está activado */
export function autoSavedState(chatId) {
  return readJSON(SAVED_KEY, {})[chatId] || { since: Date.now(), ids: [] };
}

export function markAutoSaved(chatId, msgId, since) {
  const all = readJSON(SAVED_KEY, {});
  const cur = all[chatId] || { since: Date.now(), ids: [] };
  if (since) { cur.since = since; cur.ids = []; }
  if (msgId) cur.ids = [...cur.ids, msgId].slice(-300);
  all[chatId] = cur;
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(all)); } catch { /* sin espacio */ }
}

/** Teléfono a partir del userId (user_34600… → +34600…) cuando el id es un número */
export const phoneOfUserId = (userId) => (/^user_\d{6,15}$/.test(userId || '') ? `+${userId.slice(5)}` : '');

export async function shareContact(toChatId, contact) {
  const name = contact.name || tr('Contacto');
  const payload = JSON.stringify({ name, phone: phoneOfUserId(contact.userId), userId: contact.userId });
  return json(await fetch(`${BACKEND}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId: toChatId, senderId: me(), text: `[Contacto: ${name}]`, type: 'contact', url: payload }),
  }));
}
