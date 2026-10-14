/**
 * authFetch — añade la sesión (Authorization: Bearer <rtcToken>) a TODAS las peticiones al backend de OldFace.
 *
 * El backend ya no se fía del userId que manda la app: la identidad sale del token. En vez de tocar cada fetch de
 * la app, se envuelve window.fetch una sola vez (main.jsx importa este archivo antes que nada):
 *   · solo para direcciones del backend (VITE_BACKEND_URL); el resto de peticiones no cambia;
 *   · si la petición ya trae su propia cabecera Authorization (p. ej. el taxi), se respeta;
 *   · si el token está a punto de caducar, se renueva antes con getRtcToken (una sola renovación a la vez).
 */
import { useAuthStore } from '../store/authStore';
import { getRtcToken } from './rtcClient';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
// Rutas que no necesitan sesión (o que la consiguen): no se renueva el token antes de llamarlas
const NO_RENEW = /\/(send-otp|verify-otp|rtc-token|link\/start|link\/status)\b/;

const nativeFetch = window.fetch.bind(window);
let renewing = null;

function expiresSoon(token) {
  const exp = Number(String(token || '').split('.')[1]);
  return !exp || exp * 1000 < Date.now() + 24 * 3600 * 1000;
}

/** Token vigente (lo renueva si caduca en menos de un día) */
async function currentToken(url) {
  const { user, rtcToken } = useAuthStore.getState();
  if (!user?.id || NO_RENEW.test(url) || (rtcToken && !expiresSoon(rtcToken))) return rtcToken;
  if (!renewing) renewing = getRtcToken(user.id).catch(() => null).finally(() => { renewing = null; });
  return (await renewing) || useAuthStore.getState().rtcToken;
}

window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : (input?.url || String(input));
  if (!url.startsWith(BACKEND)) return nativeFetch(input, init);
  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
  if (!headers.has('Authorization')) {
    const token = await currentToken(url);
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  return nativeFetch(input, { ...init, headers });
};
