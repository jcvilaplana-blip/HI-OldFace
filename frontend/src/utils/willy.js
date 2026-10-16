/**
 * Willy (OldFace AI) — API del backend y conversación guardada en el móvil.
 *
 *   willyStatus()            → { available, name, dailyLimit, remaining }
 *   askWilly(history, loc)   → { reply, actions, remaining }   history = [{ role: 'user'|'assistant', content }]
 *   aboutTaxi(text) / taxiLocation() → posición aproximada SOLO si el usuario habla del taxi y ya dio permiso
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

/**
 * Manda la conversación (solo rol y texto, empezando por un mensaje del usuario) y devuelve la respuesta.
 * loc = { lat, lng } aproximada, solo cuando el usuario habla del taxi (el servidor no la guarda).
 */
export async function askWilly(history, loc = null) {
  let msgs = history.map(({ role, content }) => ({ role, content })).slice(-KEEP);
  while (msgs.length && msgs[0].role !== 'user') msgs = msgs.slice(1);
  return json(await fetch(`${BACKEND}/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: me(), messages: msgs, ...(loc ? { location: loc } : {}) }),
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
