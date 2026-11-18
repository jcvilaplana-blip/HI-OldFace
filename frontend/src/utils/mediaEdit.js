/**
 * Editar fotos y vídeos — API del backend (la sesión Bearer la añade utils/authFetch.js).
 *
 *   uploadMedia(blob)                       sube un archivo (POST /chat/upload) → URL absoluta
 *   editVideo(url, edits, { discardSource }) el servidor aplica recorte/giro/sonido/capa → URL del vídeo nuevo
 *   replaceMessageMedia(chatId, messageId, url)   el mensaje (mío) pasa a usar el archivo nuevo, para los dos
 *   replaceStoryMedia(storyId, url)               mi estado publicado pasa a usar el archivo nuevo
 *   editedFile(kind, result, srcUrl)        resultado del editor → URL subida/editada lista para usar (o null si nada cambió)
 */
import { useAuthStore } from '../store/authStore';
import { tr } from '../i18n';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const me = () => useAuthStore.getState().user?.id || '';
const abs = (u) => (/^https?:/.test(u) ? u : `${BACKEND}${u}`);

async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || tr('No se pudo conectar con el servidor'));
  return data;
}

export async function uploadMedia(blob) {
  const { url } = await json(await fetch(`${BACKEND}/chat/upload?userId=${encodeURIComponent(me())}`, {
    method: 'POST', headers: { 'Content-Type': (blob.type || 'application/octet-stream').split(';')[0] }, body: blob,
  }));
  return abs(url);
}

export async function editVideo(url, edits, { discardSource = false } = {}) {
  const r = await json(await fetch(`${BACKEND}/media/edit-video`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: me(), url, ...edits, discardSource }),
  }));
  return abs(r.url);
}

export async function replaceMessageMedia(chatId, messageId, url) {
  return json(await fetch(`${BACKEND}/messages/${encodeURIComponent(chatId)}/${encodeURIComponent(messageId)}/media`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: me(), url }),
  }));
}

export async function replaceStoryMedia(storyId, url) {
  return json(await fetch(`${BACKEND}/stories/${encodeURIComponent(storyId)}/media`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: me(), content: url }),
  }));
}

/**
 * Resultado del editor de algo YA subido (srcUrl) → URL del archivo nuevo, o null si no cambió nada.
 * Foto: se sube el JPEG nuevo. Vídeo: el servidor crea el editado a partir del que ya está subido.
 */
export async function editedFile(kind, result, srcUrl) {
  if (kind === 'image') return result?.blob ? uploadMedia(result.blob) : null;
  return result?.edits ? editVideo(srcUrl, result.edits) : null;
}
