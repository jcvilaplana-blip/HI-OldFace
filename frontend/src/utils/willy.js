/**
 * Willy (OldFace AI) — API del backend y conversación guardada en el móvil.
 *
 *   willyStatus()            → { available, name, dailyLimit, remaining }
 *   askWilly(history, loc, onEvent) → { reply, actions, remaining }   history = [{ role: 'user'|'assistant', content }]
 *                              onEvent(ev) = respuesta en directo: { type: 'delta', text } · 'reset' · { type: 'status', text }
 *   aboutTaxi(text) / taxiLocation() → posición aproximada SOLO si el usuario habla del taxi y ya dio permiso
 *   confirmAction(id) / cancelAction(id) → tarjetas Confirmar / Cancelar de las propuestas de Willy (Fase 4)
 *   loadChat() / saveChat()  → la conversación con Willy vive solo en este dispositivo (localStorage)
 *
 * La sesión (Bearer) la añade utils/authFetch.js; la clave de la IA nunca está en la app.
 */
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import { setMute, addReminder } from './mutesReminders';
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

/**
 * Manda la conversación (solo rol y texto, empezando por un mensaje del usuario) y devuelve la respuesta.
 * loc = { lat, lng } aproximada, solo cuando el usuario habla del taxi (el servidor no la guarda).
 */
export async function askWilly(history, loc = null, onEvent = null) {
  let msgs = history.map(({ role, content }) => ({ role, content })).slice(-KEEP);
  while (msgs.length && msgs[0].role !== 'user') msgs = msgs.slice(1);
  const res = await fetch(`${BACKEND}/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: me(), messages: msgs, ...(loc ? { location: loc } : {}), ...(onEvent ? { stream: true } : {}) }),
  });
  // Respuesta en directo: una línea JSON por evento (texto a trozos, "Buscando…") y al final 'done' con la respuesta
  if (!onEvent || !res.ok || !res.body || !(res.headers.get('content-type') || '').includes('ndjson')) return json(res);
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '', done = null;
  const handle = (line) => {
    if (!line.trim()) return;
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    if (ev.type === 'error') throw new Error(ev.error || tr('Willy ha tenido un problema. Inténtalo de nuevo.'));
    if (ev.type === 'done') done = ev; else onEvent(ev);
  };
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
  }
  handle(buf);
  if (!done) throw new Error(tr('No se pudo conectar con el servidor'));
  return done;
}

/**
 * El usuario pulsó Confirmar en una propuesta de Willy: el servidor la marca como usada (solo una vez, solo suya,
 * antes de que caduque) y devuelve qué hacer; la app lo hace con sus rutas normales y su sesión.
 * → { chatId } (para el botón "Abrir chat") · lanza Error con el motivo si no se puede
 */
export async function confirmAction(id) {
  const { action: a } = await json(await fetch(`${BACKEND}/ai/actions/${encodeURIComponent(id)}/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: me() }),
  }));
  const uid = me(), chats = useChatStore.getState();
  if (a.kind === 'send' || a.kind === 'forward') {
    let chatId = a.chatId;
    if (!chatId && a.toUserId) chatId = (await chats.createOrGetChat(uid, a.toUserId, a.toName))?.id;   // primer mensaje a ese contacto
    if (!chatId) throw new Error(tr('No se pudo abrir el chat'));
    const m = a.kind === 'send' ? { type: 'text', text: a.text } : a.message;
    const saved = await chats.persistMessage(chatId, uid, m.text || ' ', m.type || 'text', m.url || null, null, m.fileName || null,
                                             m.duration ? { duration: m.duration } : {});
    if (!saved) throw new Error(tr('No se pudo enviar el mensaje'));
    return { chatId };
  }
  if (a.kind === 'mute') { await setMute(a.chatId, a.until); return { chatId: a.chatId }; }
  if (a.kind === 'reminder') { await addReminder({ text: a.text, at: a.at, chatId: a.chatId }); return {}; }
  throw new Error(tr('Acción desconocida'));
}

/** El usuario pulsó Cancelar */
export async function cancelAction(id) {
  return json(await fetch(`${BACKEND}/ai/actions/${encodeURIComponent(id)}/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: me() }),
  }));
}

/** ¿Habla del taxi? (solo entonces se manda la ubicación) */
export const aboutTaxi = (text) => /\b(taxis?|cab|coche|ll[eé]vame|rec[oó]ge(me)?|recoger|viaje|carrera)\b/i.test(String(text || ''));

/** Posición aproximada (~100 m) sin pedir permiso: si aún no lo ha dado, null (Willy le dirá que lo active) */
export async function taxiLocation() {
  const round = (lat, lng) => ({ lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000 });
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const { Geolocation } = await import('@capacitor/geolocation');
      if ((await Geolocation.checkPermissions()).location !== 'granted') return null;
      const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
      return round(p.coords.latitude, p.coords.longitude);
    }
    if ((await navigator.permissions?.query({ name: 'geolocation' }))?.state !== 'granted') return null;
    const p = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, maximumAge: 60000 }));
    return round(p.coords.latitude, p.coords.longitude);
  } catch { return null; }
}

const key = () => `oldface-willy:${me()}`;

export function loadChat() {
  try { const v = JSON.parse(localStorage.getItem(key()) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

export function saveChat(messages) {
  try { localStorage.setItem(key(), JSON.stringify(messages.slice(-KEEP))); } catch { /* sin espacio: no pasa nada */ }
}
