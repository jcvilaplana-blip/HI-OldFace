/**
 * Búsqueda multimedia de Willy (Fase 3) — qué se ve en las fotos y vídeos, qué se dice en los audios y qué pone en
 * los documentos, para poder buscarlos ("la foto donde Luis lleva la camisa roja", "el audio del contrato").
 *
 *   const media = createMedia({ env, dataDir, uploadsDir, messageStore, allowed });
 *   media.textOf(chatId, m)  → texto analizado del archivo ('' si aún no hay) — lo usa la búsqueda (ai/access.js)
 *   media.start()            → analiza en segundo plano, de uno en uno, los archivos nuevos (y poco a poco los antiguos)
 *   media.prune() · media.forgetSender(uid) · media.status()
 *
 * Todo en nuestro servidor (nada sale del VPS):
 *   fotos     → vision-server (llama.cpp + Qwen3-VL 2B, VISION_URL): descripción breve + texto que se lea (OCR)
 *   vídeos    → 2 fotogramas con ffmpeg → el mismo modelo
 *   audios    → whisper-server (whisper.cpp, WHISPER_URL): transcripción (ffmpeg los pasa a WAV 16 kHz)
 *   documentos→ texto de los PDF (pdf.js de Mozilla) y de los .txt/.csv/.md
 * Privacidad: nunca "ver una vez", eliminados ni archivos de quien lo ha desactivado en Ajustes (allowed(senderId) =
 * false). Los resultados se guardan en data/ai_media.json (analizar es lento) y se BORRAN cuando el mensaje se elimina,
 * deja de cumplir esas reglas o su archivo desaparece. Solo se leen archivos de uploads/ (nunca rutas que diga nadie).
 * Configuración (.env): VISION_URL · WHISPER_URL · FFMPEG_PATH (si no, el de rtc-server; "none" = sin ffmpeg) ·
 * AI_MEDIA=off lo desactiva · AI_MEDIA_START_MS / AI_MEDIA_LOOP_MS (cuándo empieza y cada cuánto mira; pruebas).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const KIND = { image: 'photo', video: 'video', audio: 'audio', document: 'document', file: 'document' };
const LOOP_MS = 60_000;          // cada minuto mira si hay archivos nuevos
const MAX_PER_LOOP = 30;         // y analiza como mucho estos seguidos (de uno en uno)
const MAX_TRIES = 2;
const MAX_TEXT = 6000;           // caracteres que se guardan de un documento o audio
// Solo lo que SÍ se ve: si dijera "no hay playa", la foto saldría al buscar "playa"
const PHOTO_PROMPT = 'Describe esta imagen en español en una o dos frases cortas, para poder encontrarla después con una '
  + 'búsqueda: las personas que aparecen (su ropa y sus colores), el lugar, los objetos y colores principales y la ocasión '
  + 'si se nota (por ejemplo una fiesta o una comida). Di SOLO lo que se ve; nunca menciones lo que no aparece y no '
  + 'inventes nada. Si se lee algún texto en la imagen, añádelo al final tras "Texto:".';

function createMedia({ env = process.env, dataDir, db = null, uploadsDir, messageStore, allowed = () => true }) {
  if (env.AI_MEDIA === 'off') return null;
  const visionUrl = String(env.VISION_URL || '').replace(/\/+$/, '');
  const whisperUrl = String(env.WHISPER_URL || '').replace(/\/+$/, '');
  const ffmpeg = env.FFMPEG_PATH === 'none' ? null : [env.FFMPEG_PATH, path.join(__dirname, '..', '..', '..', 'rtc-server', 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')]
    .find(p => p && fs.existsSync(p)) || null;
  const file = path.join(dataDir, 'ai_media.json');
  let store = {};
  try { store = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* primera vez */ }
  let saveTimer = null, busy = false, pdfjs;
  const save = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      fs.promises.writeFile(file, JSON.stringify(store)).catch(e => console.warn('[ai] media:', e.message));
      db?.save('ai_media.json', store);
    }, 2000);
    saveTimer.unref?.();
  };

  const key = (chatId, m) => `${chatId}|${m.id}`;
  /** Archivo local de un mensaje: solo nombres simples dentro de uploads/ (las data: antiguas no) */
  function localFile(url) {
    if (!url || String(url).startsWith('data:')) return null;
    const name = path.basename(String(url).split('?')[0]);
    if (!/^[\w.-]+$/.test(name)) return null;
    const p = path.join(uploadsDir, name);
    return fs.existsSync(p) ? p : null;
  }
  const isPdf = (p) => /\.pdf$/i.test(p), isText = (p) => /\.(txt|csv|md)$/i.test(p);
  /** ¿Se puede analizar este tipo con los servicios que hay? */
  const can = (kind, p) => (kind === 'photo' ? !!visionUrl
    : kind === 'video' ? !!(visionUrl && ffmpeg)
    : kind === 'audio' ? !!(whisperUrl && ffmpeg)
    : kind === 'document' ? isPdf(p) || isText(p) : false);
  const eligible = (m) => !m.deleted && !m.viewOnce && KIND[m.type] && allowed(m.senderId);

  // ── Herramientas ──
  function run(cmd, args, timeoutMs = 60_000) {
    return new Promise((resolve, reject) => {
      const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      p.stderr.on('data', d => { err = (err + d).slice(-4000); });
      const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('tiempo agotado')); }, timeoutMs);
      p.on('error', e => { clearTimeout(t); reject(e); });
      p.on('close', code => { clearTimeout(t); code === 0 ? resolve(err) : reject(new Error(`ffmpeg ${code}`)); });
    });
  }
  const tmp = (ext) => path.join(os.tmpdir(), `oldface-media-${crypto.randomBytes(6).toString('hex')}.${ext}`);
  const rm = (p) => fs.promises.unlink(p).catch(() => {});

  async function vision(jpegBuf) {
    const r = await fetch(`${visionUrl}/v1/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(240_000),
      body: JSON.stringify({ max_tokens: 220, temperature: 0.1, messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpegBuf.toString('base64')}` } },
        { type: 'text', text: PHOTO_PROMPT }] }] }),
    });
    if (!r.ok) throw new Error(`visión ${r.status}`);
    const d = await r.json();
    return String(d.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  }
  /** Imagen (o fotograma de vídeo en el segundo `at`) reducida a 768 px → JPEG */
  async function frame(src, at = null) {
    if (!ffmpeg) return fs.promises.readFile(src);
    const out = tmp('jpg');
    try {
      await run(ffmpeg, ['-y', ...(at !== null ? ['-ss', String(at)] : []), '-i', src, '-frames:v', '1', '-vf', "scale='min(768,iw)':-2", '-q:v', '4', out]);
      return await fs.promises.readFile(out);
    } finally { rm(out); }
  }
  async function durationOf(src) {
    const err = await run(ffmpeg, ['-i', src, '-f', 'null', '-t', '0', '-']).catch(() => '');
    const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
    return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0;
  }

  async function analyze(kind, src) {
    if (kind === 'photo') return { desc: await vision(await frame(src)) };
    if (kind === 'video') {
      const d = await durationOf(src);
      const a = await vision(await frame(src, Math.min(1, d / 10)));
      const b = d > 6 ? await vision(await frame(src, d / 2)) : '';
      return { desc: b ? `Al principio: ${a} Más adelante: ${b}` : a };
    }
    if (kind === 'audio') {
      const wav = tmp('wav');
      try {
        await run(ffmpeg, ['-y', '-i', src, '-ar', '16000', '-ac', '1', '-f', 'wav', wav], 120_000);
        const secs = await durationOf(wav);
        const form = new FormData();
        form.append('file', new Blob([await fs.promises.readFile(wav)], { type: 'audio/wav' }), 'audio.wav');
        form.append('language', 'auto');
        form.append('response_format', 'json');
        const r = await fetch(`${whisperUrl}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(Math.max(120_000, secs * 6000)) });
        if (!r.ok) throw new Error(`whisper ${r.status}`);
        return { text: String((await r.json()).text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) };
      } finally { rm(wav); }
    }
    if (isText(src)) return { text: (await fs.promises.readFile(src, 'utf8')).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) };
    // PDF: texto de las primeras 20 páginas
    // (require.resolve sigue NODE_PATH; import() solo no lo haría)
    pdfjs = pdfjs || await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await fs.promises.readFile(src)), disableFontFace: true, isEvalSupported: false, verbosity: 0 }).promise;
    let text = '';
    for (let i = 1; i <= Math.min(doc.numPages, 20) && text.length < MAX_TEXT; i++) {
      const c = await (await doc.getPage(i)).getTextContent();
      text += ` ${c.items.map(x => x.str).join(' ')}`;
    }
    await doc.destroy();
    return { text: text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) };
  }

  /** Olvida lo analizado de mensajes que ya no existen, ya no cumplen las reglas o cuyo archivo desapareció */
  function prune() {
    const live = new Set();
    for (const [chatId, list] of messageStore) for (const m of list) if (eligible(m) && localFile(m.url)) live.add(key(chatId, m));
    let changed = false;
    for (const k of Object.keys(store)) if (!live.has(k)) { delete store[k]; changed = true; }
    if (changed) save();
  }

  /** Siguiente archivo por analizar: los más recientes primero */
  function next() {
    let best = null;
    for (const [chatId, list] of messageStore) {
      for (const m of list) {
        if (!eligible(m)) continue;
        const k = key(chatId, m), e = store[k];
        if (e && (!e.err || e.tries >= MAX_TRIES)) continue;
        const src = localFile(m.url), kind = KIND[m.type];
        if (!src || !can(kind, src)) continue;
        if (!best || (m.createdAt || 0) > best.at) best = { k, kind, src, at: m.createdAt || 0 };
      }
    }
    return best;
  }

  async function drain() {
    if (busy) return;
    busy = true;
    try {
      prune();
      for (let n = 0; n < MAX_PER_LOOP; n++) {
        const job = next();
        if (!job) break;
        try {
          store[job.k] = { kind: job.kind, ...(await analyze(job.kind, job.src)), at: Date.now() };
        } catch (e) {
          store[job.k] = { kind: job.kind, err: String(e.message || e).slice(0, 80), tries: (store[job.k]?.tries || 0) + 1, at: Date.now() };
          console.warn(`[ai] media: no se pudo analizar un ${job.kind}: ${store[job.k].err}`);
        }
        save();
      }
    } finally { busy = false; }
  }

  return {
    services: { vision: !!visionUrl, whisper: !!whisperUrl, ffmpeg: !!ffmpeg },
    /** Texto analizado de un archivo, con una etiqueta para el modelo ("Parece:", "Dice:", "Contiene:") */
    textOf(chatId, m) {
      const e = store[key(chatId, m)];
      if (!e || e.err) return '';
      if (e.desc) return `Parece: ${e.desc}`;
      if (e.text) return e.kind === 'audio' ? `Dice: ${e.text}` : `Contiene: ${e.text}`;
      return '';
    },
    start() {
      setTimeout(() => drain().catch(() => {}), Number(env.AI_MEDIA_START_MS) || 15_000).unref?.();
      setInterval(() => drain().catch(() => {}), Number(env.AI_MEDIA_LOOP_MS) || LOOP_MS).unref?.();
    },
    drain,
    prune,
    /** Quien desactiva el análisis: se borra lo analizado de los archivos que ENVIÓ */
    forgetSender(uid) {
      for (const [chatId, list] of messageStore) for (const m of list) if (m.senderId === uid) delete store[key(chatId, m)];
      save();
    },
    status() {
      const v = Object.values(store);
      return { done: v.filter(e => !e.err).length, failed: v.filter(e => e.err).length };
    },
  };
}

module.exports = { createMedia, PHOTO_PROMPT };
