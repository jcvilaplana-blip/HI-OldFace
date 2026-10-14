/**
 * Willy (OldFace AI) — API del backend y conversación guardada en el móvil.
 *
 *   willyStatus()            → { available, name, dailyLimit, remaining }
 *   askWilly(history)        → { reply, actions, remaining }   history = [{ role: 'user'|'assistant', content }]
 *   loadChat() / saveChat()  → la conversación con Willy vive solo en este dispositivo (localStorage)
 *
 * La sesión (Bearer) la añade utils/authFetch.js; la clave de la IA nunca está en la app.
 */
import { useAuthStore } from '../store/authStore';
import { tr } from '../i18n';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const me = () => useAuthStore.getState().user?.id || '';
const KEEP = 40;   // turnos que se guardan (y el máximo que acepta el servidor)

async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || tr('No se pudo conectar con el servidor'));
  return data;
}

export async function willyStatus() {
  return json(await fetch(`${BACKEND}/ai/status?userId=${encodeURIComponent(me())}`));
}

/** Manda la conversación (solo rol y texto, empezando por un mensaje del usuario) y devuelve la respuesta */
export async function askWilly(history) {
  let msgs = history.map(({ role, content }) => ({ role, content })).slice(-KEEP);
  while (msgs.length && msgs[0].role !== 'user') msgs = msgs.slice(1);
  return json(await fetch(`${BACKEND}/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: me(), messages: msgs }),
  }));
}

const key = () => `oldface-willy:${me()}`;

export function loadChat() {
  try { const v = JSON.parse(localStorage.getItem(key()) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

export function saveChat(messages) {
  try { localStorage.setItem(key(), JSON.stringify(messages.slice(-KEEP))); } catch { /* sin espacio: no pasa nada */ }
}
