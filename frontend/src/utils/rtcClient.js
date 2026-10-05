/**
 * rtcClient — conexión con el servidor RTC propio de OldFace (rtc-server, Socket.IO):
 * señalización de llamadas, mensajes en tiempo real, directos y karaoke.
 *
 *   connectRtc(user, { onSignal, onChatMessage, onConnectionChange })
 *   sendSignal(to, type, payload) → Promise<boolean>  (true si el destinatario estaba conectado)
 *   isRtcConnected(), disconnectRtc()
 */
import { io } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
// El servidor RTC vive en el mismo dominio que el backend, bajo /rtc/ (VITE_RTC_URL solo para desarrollo local)
const RTC_ORIGIN = import.meta.env.VITE_RTC_URL || new URL(BACKEND).origin;
export const RTC_HTTP = `${RTC_ORIGIN}/rtc`;

let socket = null;
let currentUserId = null;

function tokenExpired(token) {
  const exp = Number(String(token || '').split('.')[1]);
  return !exp || exp * 1000 < Date.now() + 24 * 3600 * 1000; // renovar con 1 día de margen
}

async function getRtcToken(userId, { force = false } = {}) {
  const { rtcToken, setRtcToken } = useAuthStore.getState();
  if (!force && rtcToken && rtcToken.startsWith(`${userId}.`) && !tokenExpired(rtcToken)) return rtcToken;
  const res = await fetch(`${BACKEND}/rtc-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw new Error(`rtc-token ${res.status}`);
  const { token } = await res.json();
  setRtcToken(token);
  return token;
}

export async function connectRtc(user, { onSignal, onChatMessage, onConnectionChange } = {}) {
  if (socket && currentUserId === user.id) return socket;
  disconnectRtc();
  currentUserId = user.id;

  const token = await getRtcToken(user.id);
  socket = io(RTC_ORIGIN, {
    path: '/rtc/socket.io',
    auth: { token, name: user.name || user.id },
    transports: ['websocket', 'polling'],
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });

  socket.on('connect', () => {
    console.log('[RTC] conectado', socket.id);
    onConnectionChange?.(true);
  });
  socket.on('disconnect', (reason) => {
    console.log('[RTC] desconectado:', reason);
    onConnectionChange?.(false);
  });
  socket.on('connect_error', async (err) => {
    // Token caducado o firmado con otro secreto → pedir uno nuevo y reintentar
    if (err?.message === 'unauthorized' && socket) {
      try {
        socket.auth.token = await getRtcToken(user.id, { force: true });
        socket.connect();
      } catch (e) { console.warn('[RTC] no se pudo renovar el token:', e.message); }
    }
  });
  socket.on('signal', (sig) => onSignal?.(sig));
  socket.on('chat:message', (msg) => onChatMessage?.(msg));
  return socket;
}

export function sendSignal(to, type, payload = {}) {
  return new Promise((resolve) => {
    if (!socket?.connected) return resolve(false);
    socket.timeout(5000).emit('signal:send', { to, type, payload }, (err, res) => {
      resolve(!err && !!res?.ok && !!res.delivered);
    });
  });
}

export const isRtcConnected = () => !!socket?.connected;

/** Garantiza la conexión con el servidor RTC (p. ej. al aceptar una llamada). */
export async function ensureRtcConnected(user, timeoutMs = 8000) {
  if (!socket || currentUserId !== user.id) await connectRtc(user);
  if (socket.connected) return;
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Sin conexión con el servidor de llamadas')), timeoutMs);
    socket.once('connect', () => { clearTimeout(t); resolve(); });
  });
}

/** Petición con respuesta al servidor RTC (rtc:join, rtc:produce…). Rechaza con el error del servidor. */
export function rtcRequest(event, data = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) return reject(new Error('Sin conexión con el servidor de llamadas'));
    socket.timeout(timeoutMs).emit(event, data, (err, res) => {
      if (err) return reject(new Error('El servidor de llamadas no responde'));
      if (!res?.ok) return reject(new Error(res?.error || 'Error del servidor de llamadas'));
      resolve(res);
    });
  });
}

/** Envío sin respuesta y descartable si hay congestión (p. ej. posición de la canción del karaoke) */
export function rtcEmit(event, data = {}) {
  if (socket?.connected) socket.volatile.emit(event, data);
}

/** Suscribirse a un evento del servidor RTC. Devuelve la función para darse de baja. */
export function onRtc(event, handler) {
  socket?.on(event, handler);
  return () => socket?.off(event, handler);
}

export function disconnectRtc() {
  if (socket) { socket.removeAllListeners(); socket.disconnect(); }
  socket = null;
  currentUserId = null;
}
