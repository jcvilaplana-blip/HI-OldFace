/**
 * taxiApi — cliente del servidor de taxi propio (taxi-server): REST /taxi/api/app/… y tiempo real /taxi/socket.io.
 * Usa el mismo token de sesión de OldFace que el servidor RTC (no hay un segundo login).
 *
 *   taxiApi(path, { method, body })  → JSON (lanza Error con el mensaje del servidor)
 *   taxiSocket()                     → socket.io conectado a las salas del cliente/conductor
 *   tx(texto)                        → traducción del idioma elegido (el texto en español es la clave)
 *   money(n, currency) · taxiUrl(rutaRelativa)
 */
import { io } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';
import { getRtcToken } from './rtcClient';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
// En producción el taxi vive en el mismo dominio (/taxi/…); VITE_TAXI_URL solo para desarrollo local
export const TAXI_ORIGIN = import.meta.env.VITE_TAXI_URL || new URL(BACKEND).origin;
const API = `${TAXI_ORIGIN}/taxi/api/app`;

export const taxiUrl = (p) => (!p ? p : /^https?:/.test(p) ? p : `${TAXI_ORIGIN}${p}`);

async function token(force = false) {
  const user = useAuthStore.getState().user;
  if (!user?.id) throw new Error('Inicia sesión en OldFace');
  return getRtcToken(user.id, { force });
}

export async function taxiApi(path, { method = 'GET', body, raw, retried } = {}) {
  const t = await token();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${t}`, ...(raw ? { 'Content-Type': raw.type } : body ? { 'Content-Type': 'application/json' } : {}) },
    body: raw || (body ? JSON.stringify(body) : undefined),
  });
  if (res.status === 401 && !retried) { await token(true); return taxiApi(path, { method, body, raw, retried: true }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || tx('Error de conexión')); e.status = res.status; e.data = data; throw e; }
  return data;
}

let socket = null;
export async function taxiSocket() {
  if (socket) return socket;
  const t = await token();
  socket = io(TAXI_ORIGIN, { path: '/taxi/socket.io', auth: { token: t }, transports: ['websocket', 'polling'], reconnectionDelayMax: 10000 });
  return socket;
}
export function closeTaxiSocket() { socket?.disconnect(); socket = null; }

// ── Idioma ───────────────────────────────────────────────────────────────────
let dict = {};
let locale = 'es-ES';
export function setTaxiLanguage(lang) {
  dict = lang?.texts || {};
  locale = lang?.code ? (lang.code.includes('-') ? lang.code : `${lang.code}-${lang.code === 'en' ? 'GB' : lang.code.toUpperCase()}`) : 'es-ES';
  document.documentElement.dir = lang?.rtl ? 'rtl' : 'ltr';
}
export const tx = (s, vars) => {
  let out = dict[s] || s;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, v);
  return out;
};

export function money(n, currency = 'EUR') {
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(n) || 0); }
  catch { return `${(Number(n) || 0).toFixed(2)} ${currency}`; }
}
export const dateTime = (ms) => (ms ? new Date(ms).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/** Polilínea de Valhalla (precisión 6) → [[lng, lat], …] */
export function decodePolyline(str, precision = 6) {
  if (!str) return [];
  const f = 10 ** precision, out = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let b, shift = 0, result = 0;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d; else lng += d;
    }
    out.push([lng / f, lat / f]);
  }
  return out;
}

/**
 * Seguir la posición (conductor conectado): onPos({lat,lng,heading}) en cada cambio → devuelve una función para parar.
 * Capacitor en el móvil, navegador en la web.
 */
export function watchPosition(onPos, onError) {
  let stop = () => {};
  let stopped = false;
  const handle = (c) => onPos({ lat: c.latitude, lng: c.longitude, heading: Number.isFinite(c.heading) ? c.heading : null });
  (async () => {
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (Capacitor.isNativePlatform()) {
        const { Geolocation } = await import('@capacitor/geolocation');
        const perm = await Geolocation.requestPermissions();
        if (perm.location !== 'granted') { onError?.(new Error(tx('Permiso de ubicación denegado'))); return; }
        const id = await Geolocation.watchPosition({ enableHighAccuracy: true, timeout: 15000 }, (p, e) => { if (p) handle(p.coords); else if (e) onError?.(e); });
        stop = () => Geolocation.clearWatch({ id });
        if (stopped) stop();
        return;
      }
    } catch { /* sigue con el navegador */ }
    if (!navigator.geolocation) { onError?.(new Error(tx('Ubicación no disponible'))); return; }
    const id = navigator.geolocation.watchPosition((p) => handle(p.coords), (e) => onError?.(e), { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    stop = () => navigator.geolocation.clearWatch(id);
    if (stopped) stop();
  })();
  return () => { stopped = true; stop(); };
}

/**
 * Posición del CONDUCTOR conectado, también con el móvil bloqueado o la app en segundo plano:
 *   · Móvil: servicio nativo de ubicación en primer plano (notificación fija "estás conectado") y envío por HTTP
 *     nativo a /driver/location (el WebView en segundo plano se duerme y frena sus propias peticiones).
 *   · Web: watchPosition del navegador (solo con la página abierta).
 * onPos({lat,lng,heading}) en cada posición → devuelve una función para parar.
 */
let bgPlugin = null;
export function trackDriver(onPos, onError) {
  let stop = () => {};
  let stopped = false;
  (async () => {
    const { Capacitor, registerPlugin, CapacitorHttp } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) { stop = watchPosition(onPos, onError); if (stopped) stop(); return; }
    bgPlugin ||= registerPlugin('BackgroundGeolocation');
    let last = { t: 0, lat: 0, lng: 0 };
    const id = await bgPlugin.addWatcher({
      backgroundTitle: tx('OldFace Taxi: estás conectado'),
      backgroundMessage: tx('Compartiendo tu ubicación para recibir viajes. Desconéctate en la app para pararlo.'),
      requestPermissions: true,
      stale: false,
      distanceFilter: 0,
    }, async (loc, error) => {
      if (error) {
        if (error.code === 'NOT_AUTHORIZED') onError?.(new Error(tx('Permite la ubicación a OldFace para recibir viajes')));
        return;
      }
      const p = { lat: loc.latitude, lng: loc.longitude, heading: Number.isFinite(loc.bearing) ? loc.bearing : null };
      onPos(p);
      // Al servidor: cada 10 s, o antes si se ha movido más de 30 m
      const moved = Math.abs(p.lat - last.lat) + Math.abs(p.lng - last.lng) > 0.0003;
      if (Date.now() - last.t < 10000 && !moved) return;
      last = { t: Date.now(), lat: p.lat, lng: p.lng };
      try {
        await CapacitorHttp.post({ url: `${API}/driver/location`, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` }, data: p });
      } catch { /* sin conexión: la siguiente posición lo reintenta */ }
    });
    stop = () => bgPlugin.removeWatcher({ id });
    if (stopped) stop();
  })().catch((e) => onError?.(e));
  return () => { stopped = true; stop(); };
}

/** Abrir la navegación paso a paso en la app de mapas del móvil (Google Maps, Waze, OsmAnd…) */
export async function openNavigation(lat, lng, label = '') {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) { window.location.href = `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(label)})`; return; }
  } catch { /* web */ }
  window.open(`https://www.openstreetmap.org/directions?route=;${lat},${lng}#map=16/${lat}/${lng}`, '_blank');
}

/** Posición actual (Capacitor en el móvil, navegador en la web) */
export async function currentPosition() {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const { Geolocation } = await import('@capacitor/geolocation');
      const perm = await Geolocation.requestPermissions();
      if (perm.location !== 'granted') throw new Error('denied');
      const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
      return { lat: p.coords.latitude, lng: p.coords.longitude };
    }
  } catch { /* sigue con el navegador */ }
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error(tx('Ubicación no disponible')));
    navigator.geolocation.getCurrentPosition(p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => reject(new Error(tx('No se pudo obtener tu ubicación'))), { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  });
}
