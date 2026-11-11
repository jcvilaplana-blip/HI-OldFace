/**
 * Social — API del backend (rutas /social/*; la sesión la pone authFetch en cada petición).
 *
 *   getMe() · saveMe({ handle, name, bio, avatar, cover })            → mi canal
 *   getChannel(key) · channelPosts(key, { type, visibility, sort, page }) · followers(key) · following(key)
 *   feed(tab, page)                  → tab: foryou | following | reels
 *   explore({ scope, category, type, page })   → scope: public | contacts ("Privado" = de mis contactos)
 *   search(q)                        → { channels, posts, authors }
 *   createPost({ text, media, category, visibility }) · updatePost(id, campos) · deletePost(id) · getPost(id)
 *   like(id, on) · save(id, on) · countView(id) · saved(page)
 *   comments(id, page) · addComment(id, text) · deleteComment(id)
 *   follow(userId, bell?) · unfollow(userId) · block(userId) · unblock(userId) · report(kind, targetId, reason)
 *   notifications() · readNotifications()
 *   uploadMedia(file)                → URL de /files/ (fotos reducidas a 1600 px; vídeos tal cual, máx. 150 MB)
 *
 * Cada publicación es "Público" (cualquier usuario de OldFace) o "Solo mis contactos": lo decide y lo comprueba el servidor.
 */
import { useAuthStore } from '../store/authStore';
import { tr, LOCALE } from '../i18n';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const me = () => useAuthStore.getState().user?.id || '';
const q = (params) => new URLSearchParams(Object.entries({ userId: me(), ...params })
  .filter(([, v]) => v != null && v !== '')).toString();
const enc = encodeURIComponent;

async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || tr('No se pudo conectar con el servidor'));
  return data;
}
const get = async (path, params = {}) => json(await fetch(`${BACKEND}${path}?${q(params)}`));
const send = async (method, path, body = {}) => json(await fetch(method === 'DELETE' ? `${BACKEND}${path}?${q()}` : `${BACKEND}${path}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: method === 'DELETE' ? undefined : JSON.stringify({ userId: me(), ...body }),
}));

export const CATEGORIES = [
  { id: 'musica', label: tr('Música'), icon: '🎵' }, { id: 'juegos', label: tr('Juegos'), icon: '🎮' },
  { id: 'deportes', label: tr('Deportes'), icon: '⚽' }, { id: 'viajes', label: tr('Viajes'), icon: '✈️' },
  { id: 'cocina', label: tr('Cocina'), icon: '🍴' }, { id: 'belleza', label: tr('Belleza'), icon: '💄' },
  { id: 'animales', label: tr('Animales'), icon: '🐾' }, { id: 'fitness', label: tr('Fitness'), icon: '💪' },
  { id: 'charla', label: tr('Charla'), icon: '💬' }, { id: 'otros', label: tr('Otros'), icon: '✨' },
];

export const getMe = () => get('/social/me');
export const saveMe = (fields) => send('PUT', '/social/me', fields);
export const getChannel = (key) => get(`/social/channels/${enc(key)}`);
export const channelPosts = (key, params = {}) => get(`/social/channels/${enc(key)}/posts`, params);
export const followers = (key, page = 0) => get(`/social/channels/${enc(key)}/followers`, { page });
export const following = (key, page = 0) => get(`/social/channels/${enc(key)}/following`, { page });
export const feed = (tab, page = 0) => get('/social/feed', { tab, page });
export const explore = (params = {}) => get('/social/explore', params);
export const search = (text) => get('/social/search', { q: text });
export const getPost = (id) => get(`/social/posts/${enc(id)}`);
export const createPost = (fields) => send('POST', '/social/posts', fields);
export const updatePost = (id, fields) => send('PUT', `/social/posts/${enc(id)}`, fields);
export const deletePost = (id) => send('DELETE', `/social/posts/${enc(id)}`);
export const like = (id, on) => send(on ? 'POST' : 'DELETE', `/social/posts/${enc(id)}/like`);
export const save = (id, on) => send(on ? 'POST' : 'DELETE', `/social/posts/${enc(id)}/save`);
export const saved = (page = 0) => get('/social/saved', { page });
export const countView = (id) => { send('POST', `/social/posts/${enc(id)}/view`).catch(() => {}); };
export const comments = (id, page = 0) => get(`/social/posts/${enc(id)}/comments`, { page });
export const addComment = (id, text) => send('POST', `/social/posts/${enc(id)}/comments`, { text });
export const deleteComment = (id) => send('DELETE', `/social/comments/${enc(id)}`);
export const follow = (userId, bell) => send('POST', `/social/follow/${enc(userId)}`, bell === undefined ? {} : { bell });
export const unfollow = (userId) => send('DELETE', `/social/follow/${enc(userId)}`);
export const block = (userId) => send('POST', `/social/block/${enc(userId)}`);
export const unblock = (userId) => send('DELETE', `/social/block/${enc(userId)}`);
export const report = (kind, targetId, reason) => send('POST', '/social/report', { kind, targetId, reason });
export const notifications = () => get('/social/notifications');
export const readNotifications = () => send('POST', '/social/notifications/read');

// ── Subir fotos y vídeos (como los estados: /chat/upload, en binario) ──
const MAX_VIDEO = 150 * 1024 * 1024;
function shrinkImage(file, max = 1600) {
  return new Promise((resolve, reject) => {
    if (file.type === 'image/gif') return resolve(file);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => (b ? resolve(b) : reject(new Error(tr('No se pudo procesar la foto')))), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(tr('No se pudo leer la foto'))); };
    img.src = url;
  });
}
export async function uploadMedia(file) {
  const isVideo = String(file.type).startsWith('video/');
  if (isVideo && file.size > MAX_VIDEO) throw new Error(tr('El vídeo no puede superar 150 MB'));
  const blob = isVideo ? file : await shrinkImage(file);
  const res = await fetch(`${BACKEND}/chat/upload?userId=${enc(me())}`, {
    method: 'POST', headers: { 'Content-Type': (blob.type || 'application/octet-stream').split(';')[0] }, body: blob,
  });
  const d = await json(res);
  return d.url.startsWith('http') ? d.url : `${BACKEND}${d.url}`;
}

// ── Formatos ──
/** 2300 → "2,3K" · 5200000 → "5,2M" */
export function compact(n) {
  const v = Number(n) || 0;
  if (v < 1000) return String(v);
  const [d, s] = v >= 1e6 ? [1e6, 'M'] : [1e3, 'K'];
  return `${(v / d).toFixed(v / d >= 100 ? 0 : 1).replace(/\.0$/, '').replace('.', LOCALE === 'es-ES' ? ',' : '.')}${s}`;
}
/** "hace 3 días" */
export function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return tr('ahora');
  if (s < 3600) return tr('hace {n} min', { n: Math.floor(s / 60) });
  if (s < 86400) return tr('hace {n} h', { n: Math.floor(s / 3600) });
  const d = Math.floor(s / 86400);
  if (d < 7) return d === 1 ? tr('hace 1 día') : tr('hace {n} días', { n: d });
  if (d < 30) return Math.floor(d / 7) === 1 ? tr('hace 1 semana') : tr('hace {n} semanas', { n: Math.floor(d / 7) });
  if (d < 365) return Math.floor(d / 30) === 1 ? tr('hace 1 mes') : tr('hace {n} meses', { n: Math.floor(d / 30) });
  return new Date(ts).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
}
