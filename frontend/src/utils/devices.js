/**
 * Dispositivos vinculados — identidad de este dispositivo y API de vinculación (QR + código).
 *
 *   getDeviceId()      id propio de este dispositivo (se guarda en el navegador / la app)
 *   deviceInfo()       { deviceId, deviceName, platform } para el servidor
 *   startLink()        dispositivo nuevo: pedir código → { linkId, code, expiresAt }
 *   linkStatus(id)     dispositivo nuevo: ¿ya lo aprobaron? → { status, user, rtcToken, deviceId }
 *   approveLink(code)  móvil con sesión: aprobar el código escaneado o escrito
 *   listDevices() / revokeDevice(id) / heartbeat()
 */
import { useAuthStore } from '../store/authStore';
import { getRtcToken } from './rtcClient';
import { tr } from '../i18n';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const KEY = 'oldface-device-id';

export function getDeviceId() {
  let id = null;
  try { id = localStorage.getItem(KEY); } catch { /* sin almacenamiento */ }
  if (!id) {
    const rnd = crypto.getRandomValues(new Uint8Array(12));
    id = 'dev_' + Array.from(rnd, b => b.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem(KEY, id); } catch { /* nada */ }
  }
  return id;
}

export function setDeviceId(id) {
  try { localStorage.setItem(KEY, id); } catch { /* nada */ }
}

function isNative() {
  return !!window.Capacitor?.isNativePlatform?.();
}

/** Nombre legible: "Chrome en Windows", "Móvil Android", "Tablet Android"… */
export function deviceName() {
  const ua = navigator.userAgent || '';
  const os = /Windows/i.test(ua) ? 'Windows' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
           : /Mac OS X|Macintosh/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'otro sistema';
  if (isNative()) {
    const tablet = Math.min(window.screen.width, window.screen.height) >= 600;
    return `${tablet ? 'Tablet' : tr('Móvil')} ${os}`;
  }
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
                : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  return `${browser} en ${os}`;
}

export function devicePlatform() {
  if (isNative()) return /iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'ios' : 'android';
  return 'web';
}

export const deviceInfo = () => ({ deviceId: getDeviceId(), deviceName: deviceName(), platform: devicePlatform() });

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

// ── Dispositivo nuevo (ordenador / tablet) ─────────────────────────────────
export async function startLink() {
  return json(await fetch(`${BACKEND}/link/start`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceName: deviceName(), platform: devicePlatform() }),
  }));
}

export async function linkStatus(linkId) {
  return json(await fetch(`${BACKEND}/link/status/${encodeURIComponent(linkId)}`));
}

// ── Móvil con la sesión iniciada ───────────────────────────────────────────
export async function approveLink(code) {
  const user = useAuthStore.getState().user;
  return json(await fetch(`${BACKEND}/link/approve`, {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify({ userId: user?.id, code }),
  }));
}

export async function listDevices() {
  const user = useAuthStore.getState().user;
  const d = await json(await fetch(`${BACKEND}/devices/${encodeURIComponent(user?.id)}`, { headers: await authHeaders() }));
  return d.devices || [];
}

export async function revokeDevice(deviceId) {
  const user = useAuthStore.getState().user;
  return json(await fetch(`${BACKEND}/devices/${encodeURIComponent(user?.id)}/${encodeURIComponent(deviceId)}`, {
    method: 'DELETE', headers: await authHeaders(),
  }));
}

/** Al abrir la app: avisar de que este dispositivo sigue activo. Devuelve true si se cerró su sesión desde otro. */
export async function heartbeat() {
  const user = useAuthStore.getState().user;
  if (!user?.id) return false;
  try {
    const res = await fetch(`${BACKEND}/devices/heartbeat`, {
      method: 'POST', headers: await authHeaders(), body: JSON.stringify({ userId: user.id, ...deviceInfo() }),
    });
    if (!res.ok) return false;
    return !!(await res.json()).revoked;
  } catch { return false; }
}
