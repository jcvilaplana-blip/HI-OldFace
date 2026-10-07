/**
 * Ubicación en tiempo real del chat (como WhatsApp): quien la comparte manda su posición al backend
 * (POST /messages/:chatId/:msgId/live) cada ~15 s o al moverse más de ~25 m, hasta la hora elegida o hasta
 * pulsar "Dejar de compartir". En el móvil sigue funcionando con la app en segundo plano o la pantalla apagada
 * (servicio nativo de ubicación, con su notificación fija). Las comparticiones activas se guardan para
 * retomarlas al volver a abrir la app (resumeLiveShares en App.jsx).
 */
const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const KEY = 'oldface_live_shares_v1';
const EVENT = 'oldface-live-change';

let shares = load();
let stopWatch = null;
let last = { t: 0, lat: 0, lng: 0 };
let bgPlugin = null;

function load() {
  try { return (JSON.parse(localStorage.getItem(KEY) || '[]') || []).filter(s => s.until > Date.now()); } catch { return []; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(shares)); } catch { /* sin almacenamiento */ }
  window.dispatchEvent(new Event(EVENT));
}

async function post(share, body) {
  const url = `${BACKEND}/messages/${encodeURIComponent(share.chatId)}/${encodeURIComponent(share.msgId)}/live`;
  const data = { senderId: share.senderId, ...body };
  try {
    const { Capacitor, CapacitorHttp } = await import('@capacitor/core');
    // En nativo por HTTP nativo: funciona aunque el WebView esté dormido (pantalla apagada)
    if (Capacitor.isNativePlatform()) return (await CapacitorHttp.post({ url, headers: { 'Content-Type': 'application/json' }, data })).status;
  } catch { /* web */ }
  try { return (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })).status; }
  catch { return 0; }
}

async function onPosition(p) {
  const now = Date.now();
  const expired = shares.filter(s => s.until <= now);
  if (expired.length) { shares = shares.filter(s => s.until > now); save(); }
  if (!shares.length) { unwatch(); return; }
  const moved = Math.abs(p.lat - last.lat) + Math.abs(p.lng - last.lng) > 0.00025;
  if (now - last.t < 15000 && !moved) return;
  last = { t: now, lat: p.lat, lng: p.lng };
  for (const s of [...shares]) {
    const status = await post(s, { lat: p.lat, lng: p.lng });
    // 404/403/410: el mensaje ya no existe o se dejó de compartir desde otro sitio
    if ([403, 404, 410].includes(status)) { shares = shares.filter(x => x.msgId !== s.msgId); save(); }
  }
  if (!shares.length) unwatch();
}

async function watch() {
  if (stopWatch) return;
  let stopped = false, stop = () => {};
  stopWatch = () => { stopped = true; stop(); };
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      bgPlugin ||= registerPlugin('BackgroundGeolocation');
      const id = await bgPlugin.addWatcher({
        backgroundTitle: 'OldFace: compartiendo tu ubicación',
        backgroundMessage: 'Ubicación en tiempo real en un chat. Para pararla, pulsa "Dejar de compartir" en el chat.',
        requestPermissions: true, stale: false, distanceFilter: 10,
      }, (loc, error) => { if (!error && loc) onPosition({ lat: loc.latitude, lng: loc.longitude }); });
      stop = () => bgPlugin.removeWatcher({ id });
      if (stopped) stop();
      return;
    }
  } catch { /* sigue con el navegador */ }
  if (!navigator.geolocation) return;
  const id = navigator.geolocation.watchPosition((p) => onPosition({ lat: p.coords.latitude, lng: p.coords.longitude }),
    () => {}, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
  stop = () => navigator.geolocation.clearWatch(id);
  if (stopped) stop();
}

function unwatch() {
  stopWatch?.();
  stopWatch = null;
  last = { t: 0, lat: 0, lng: 0 };
}

/** Empezar a compartir (el mensaje live_location ya está creado en el backend) */
export function startLiveShare({ chatId, msgId, senderId, until }) {
  shares = [...shares.filter(s => s.msgId !== msgId), { chatId, msgId, senderId, until }];
  save();
  last = { t: 0, lat: 0, lng: 0 };   // mandar la primera posición en cuanto llegue
  watch();
}

/** Dejar de compartir */
export async function stopLiveShare(msgId) {
  const s = shares.find(x => x.msgId === msgId);
  shares = shares.filter(x => x.msgId !== msgId);
  save();
  if (!shares.length) unwatch();
  if (s) await post(s, { stop: true });
}

export const isSharingLive = (msgId) => shares.some(s => s.msgId === msgId && s.until > Date.now());

/** Al abrir la app: retomar las comparticiones que no han caducado */
export function resumeLiveShares() {
  shares = load();
  save();
  if (shares.length) watch();
}

/** Avisar a la interfaz cuando cambia lo que se comparte */
export function onLiveSharesChange(fn) {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
