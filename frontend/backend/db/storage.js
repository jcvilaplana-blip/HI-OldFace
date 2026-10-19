/**
 * Copia de los archivos subidos (fotos, audios, vídeos, grabaciones, documentos del taxi) en Supabase Storage,
 * bucket PRIVADO. Los archivos se siguen sirviendo desde el servidor como siempre; Storage es la copia segura.
 *
 *   require('./db/storage')({ dataDir, dirs: { backend: UPLOADS_DIR, taxi: '/…/taxi-server/data/uploads' } })
 *
 * Cada STORAGE_SCAN_MS (30 s) revisa las carpetas:
 *   · sube lo nuevo o cambiado cuando lleva STORAGE_SETTLE_MS (60 s) sin cambiar (una grabación en curso no se sube);
 *   · borra en Storage lo que ya no está en el disco (mensaje eliminado, "ver una vez" ya visto, cuenta eliminada):
 *     un archivo borrado a propósito NUNCA se resucita;
 *   · si falta el registro data/storage-manifest.json (servidor nuevo o disco perdido) trae de Storage lo que falte.
 * Archivos de más de 50 MB (límite del plan gratuito) se quedan solo en el servidor (aviso en el log).
 * Sin STORAGE_URL/STORAGE_KEY (o STORAGE_MODE=off) no hace nada. Nunca registra nombres completos ni contenidos.
 */
const fs = require('fs');
const path = require('path');

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.aac': 'audio/aac', '.pdf': 'application/pdf',
};
const OFF = { enabled: false, scan: async () => {}, stop() {}, status: () => ({ enabled: false }) };

module.exports = function createStorage({ dataDir, dirs = {}, env = process.env, log = console, autoStart = true } = {}) {
  const base = String(env.STORAGE_URL || '').replace(/\/+$/, '');
  const key = env.STORAGE_KEY || '';
  if (!base || !key || env.STORAGE_MODE === 'off') return OFF;
  const bucket = env.STORAGE_BUCKET || 'oldface-files';
  const scanMs = Number(env.STORAGE_SCAN_MS) || 30_000;
  const settleMs = env.STORAGE_SETTLE_MS != null ? Number(env.STORAGE_SETTLE_MS) : 60_000;
  const maxBytes = Number(env.STORAGE_MAX_BYTES) || 50 * 1024 * 1024;
  const roots = Object.entries(dirs).filter(([prefix, dir]) => /^[a-z0-9_-]+$/.test(prefix) && dir && fs.existsSync(dir));
  if (!roots.length) return OFF;

  const manifestFile = path.join(dataDir, 'storage-manifest.json');
  const firstRun = !fs.existsSync(manifestFile);
  let manifest = {};   // "prefijo/nombre" → { size, mtime }
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch { /* primera vez */ }
  const tooBig = new Set();
  const state = { lastScanAt: null, lastError: null, failures: 0, uploaded: 0, deleted: 0, restored: 0 };
  let timer = null, running = false, restoreDone = !firstRun;

  const headers = (extra = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, ...extra });
  const objUrl = (p) => `${base}/storage/v1/object/${bucket}/${p.split('/').map(encodeURIComponent).join('/')}`;
  async function ok(r, what) {
    if (r.ok) return r;
    const body = (await r.text().catch(() => '')).slice(0, 120).replace(/sb_secret_[\w-]+/g, '***');
    const e = new Error(`${what}: HTTP ${r.status} ${body}`); e.code = `HTTP_${r.status}`; throw e;
  }
  async function upload(p, file) {
    const ext = path.extname(file).toLowerCase();
    await ok(await fetch(objUrl(p), { method: 'POST', body: fs.readFileSync(file),
      headers: headers({ 'Content-Type': MIME[ext] || 'application/octet-stream', 'x-upsert': 'true', 'cache-control': '31536000' }) }), 'subir');
  }
  async function remove(paths) {
    for (let i = 0; i < paths.length; i += 100) {
      await ok(await fetch(`${base}/storage/v1/object/${bucket}`, { method: 'DELETE', headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prefixes: paths.slice(i, i + 100) }) }), 'borrar');
    }
  }
  async function list(prefix) {
    const out = [];
    for (let offset = 0; ; offset += 1000) {
      const r = await ok(await fetch(`${base}/storage/v1/object/list/${bucket}`, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prefix: `${prefix}/`, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }) }), 'listar');
      const page = (await r.json()).filter(o => o.id);   // las «carpetas» no tienen id
      out.push(...page.map(o => ({ name: o.name, size: o.metadata?.size ?? null })));
      if (page.length < 1000) return out;
    }
  }
  async function download(p, dest) {
    const r = await ok(await fetch(objUrl(p), { headers: headers() }), 'bajar');
    const tmp = `${dest}.restore-tmp`;
    fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
    fs.renameSync(tmp, dest);
  }
  function saveManifest() {
    const tmp = `${manifestFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(manifest));
    fs.renameSync(tmp, manifestFile);
  }

  /** Primera vez sin registro: trae lo que falte y apunta lo que ya está igual en los dos lados */
  async function restoreMissing() {
    for (const [prefix, dir] of roots) {
      for (const o of await list(prefix)) {
        if (!/^[\w.-]+$/.test(o.name)) continue;
        const dest = path.join(dir, o.name);
        if (!fs.existsSync(dest)) { await download(`${prefix}/${o.name}`, dest); state.restored++; }
        const st = fs.statSync(dest);
        if (o.size == null || o.size === st.size) manifest[`${prefix}/${o.name}`] = { size: st.size, mtime: st.mtimeMs };
      }
    }
    restoreDone = true;
    saveManifest();
  }

  async function scan() {
    if (running) return;
    running = true;
    let changed = false;
    try {
      if (!restoreDone) await restoreMissing();
      const now = Date.now();
      for (const [prefix, dir] of roots) {
        const seen = new Set();
        for (const name of fs.readdirSync(dir)) {
          if (name.startsWith('.') || /\.(tmp|part|restore-tmp)$/.test(name) || !/^[\w.-]+$/.test(name)) continue;
          let st; try { st = fs.statSync(path.join(dir, name)); } catch { continue; }
          if (!st.isFile()) continue;
          const p = `${prefix}/${name}`;
          seen.add(p);
          const rec = manifest[p];
          if (rec && rec.size === st.size && rec.mtime === st.mtimeMs) continue;
          if (settleMs > 0 && now - st.mtimeMs < settleMs) continue;   // aún se está escribiendo
          if (st.size > maxBytes) {
            if (!tooBig.has(p)) { tooBig.add(p); log.warn(`[storage] ⚠️  un archivo de ${(st.size / 1048576).toFixed(0)} MB supera el límite de Storage: queda solo en el servidor`); }
            continue;
          }
          await upload(p, path.join(dir, name));
          manifest[p] = { size: st.size, mtime: st.mtimeMs };
          state.uploaded++; changed = true;
        }
        const gone = Object.keys(manifest).filter(p => p.startsWith(`${prefix}/`) && !seen.has(p));
        if (gone.length) {
          await remove(gone);
          for (const p of gone) delete manifest[p];
          state.deleted += gone.length; changed = true;
        }
      }
      if (changed) saveManifest();
      if (state.failures) log.log('[storage] ✅ Supabase Storage vuelve a responder');
      state.failures = 0; state.lastError = null; state.lastScanAt = Date.now();
    } catch (e) {
      if (changed) { try { saveManifest(); } catch { /* ignorar */ } }
      state.failures++; state.lastError = e.code || 'error';
      if (state.failures === 1 || state.failures % 20 === 0) log.error(`[storage] ⚠️  Error con Supabase Storage (${String(e.message).split('\n')[0]}); se reintentará`);
    } finally {
      running = false;
    }
  }

  const tick = () => { timer = setTimeout(() => scan().finally(tick), state.failures ? Math.min(600_000, scanMs * 2 ** Math.min(state.failures, 4)) : scanMs); timer.unref?.(); };
  if (autoStart) {
    setTimeout(() => scan().then(() => {
      log.log(`[storage] Supabase Storage (${bucket}): ${Object.keys(manifest).length} archivos copiados`
        + (state.restored ? ` · ${state.restored} restaurados` : '') + (state.uploaded ? ` · ${state.uploaded} subidos ahora` : ''));
    }).finally(tick), 3000).unref?.();
  }
  return { enabled: true, scan, stop: () => clearTimeout(timer), status: () => ({ enabled: true, bucket, files: Object.keys(manifest).length, ...state }) };
};
