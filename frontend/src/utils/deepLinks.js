/**
 * deepLinks — enlaces https://oldface.app/... que abren la app instalada (Android App Links).
 *
 * Android abre la app (en vez del navegador) gracias al intent-filter con autoVerify del
 * AndroidManifest y al archivo https://oldface.app/.well-known/assetlinks.json del backend.
 * Aquí se traduce el enlace recibido a una ruta de la app. Si el usuario aún no ha iniciado
 * sesión, el enlace se guarda y se abre al terminar el login.
 */
const HOSTS = ['oldface.app', 'www.oldface.app'];
// Rutas que se pueden abrir desde un enlace compartido (deben coincidir con el AndroidManifest)
const ALLOWED = [/^\/directo\/[\w-]+\/live$/, /^\/karaoke\/sala\/[\w-]+$/, /^\/poll\/[\w-]+$/];
const PENDING_KEY = 'oldface_pending_link';

/** URL completa → ruta interna ("/directo/abc/live") o null si no es un enlace de la app */
export function toAppPath(url) {
  try {
    const u = new URL(url);
    if (!['https:', 'http:'].includes(u.protocol) || !HOSTS.includes(u.hostname)) return null;
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return ALLOWED.some(re => re.test(path)) ? path + u.search : null;
  } catch { return null; }
}

export function savePendingLink(path) {
  try { sessionStorage.setItem(PENDING_KEY, path); } catch {}
}

export function takePendingLink() {
  try {
    const p = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    return p;
  } catch { return null; }
}

/**
 * Escucha los enlaces con los que se abre la app (arranque en frío y app ya abierta).
 * @param onLink(path)  recibe la ruta interna
 * @returns función para dejar de escuchar
 */
export async function listenDeepLinks(onLink) {
  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform()) return () => {};
  const { App: CapApp } = await import('@capacitor/app');
  let last = { path: null, at: 0 };
  const handle = (url) => {
    const path = toAppPath(url);
    if (!path) return;
    // El enlace de arranque puede llegar dos veces (getLaunchUrl + appUrlOpen)
    if (path === last.path && Date.now() - last.at < 3000) return;
    last = { path, at: Date.now() };
    onLink(path);
  };
  const sub = await CapApp.addListener('appUrlOpen', ({ url }) => handle(url));
  try { const launch = await CapApp.getLaunchUrl(); if (launch?.url) handle(launch.url); } catch {}
  return () => sub.remove();
}
