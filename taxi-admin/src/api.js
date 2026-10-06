/** api — llamadas al servidor del taxi con la sesión del administrador */
const BASE = '/taxi/api/admin';
const KEY = 'oldface-taxi-admin';

export const session = {
  get: () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } },
  set: (s) => localStorage.setItem(KEY, JSON.stringify(s)),
  clear: () => localStorage.removeItem(KEY),
};

let onExpired = () => {};
export const setOnExpired = (fn) => { onExpired = fn; };

export async function api(path, { method = 'GET', body, raw, contentType } = {}) {
  const s = session.get();
  const headers = {};
  if (s?.token) headers.Authorization = `Bearer ${s.token}`;
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
  if (raw) headers['Content-Type'] = contentType || 'application/octet-stream';
  const r = await fetch(BASE + path, { method, headers, body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/login') { session.clear(); onExpired(); }
  if (!r.ok) throw Object.assign(new Error(d.error || `Error ${r.status}`), { status: r.status, data: d });
  return d;
}

export const upload = (file) => api('/upload', { method: 'POST', raw: true, body: file, contentType: file.type });

/** Construye la query string de un listado */
export const qs = (o) => '?' + Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null)
  .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
