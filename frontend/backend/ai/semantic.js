/**
 * Búsqueda por significado de Willy — vectores ("embeddings") de los mensajes con el servicio local oldface-embed
 * (embed-server/: llama.cpp + EmbeddingGemma 300M, solo 127.0.0.1). Nada sale del VPS.
 *
 *   const sem = createSemantic(env)            // null si no hay EMBED_URL: Willy busca solo por palabras
 *   await sem.scores(query, items)             // items = [{ key, text }] → Map key → parecido (0-1) o null si el servicio falla
 *   sem.backfill(items)                        // calcula en segundo plano los que falten (mensajes nuevos)
 *   sem.prune(liveKeys)                        // olvida los vectores de mensajes que ya no existen
 *
 * Privacidad: los vectores viven SOLO EN MEMORIA (nunca en disco) y se vuelven a calcular al arrancar. La clave es
 * chatId|msgId: quien llama decide QUÉ mensajes se comparan (solo los que el usuario puede ver), así que un vector
 * nunca hace visible un mensaje ajeno, eliminado, oculto o de "ver una vez". Al borrarse un mensaje, prune() lo olvida.
 * Configuración (.env): EMBED_URL (p. ej. http://127.0.0.1:8090) · AI_SEMANTIC_MIN (parecido mínimo, 0.45) ·
 * AI_SEMANTIC_MARGIN (como mucho esta distancia al mejor resultado, 0.05) · EMBED_QUERY_PREFIX / EMBED_DOC_PREFIX
 * (las instrucciones que espera el modelo; por defecto las de EmbeddingGemma). Valores medidos con frases de chat en
 * español: los parecidos de este modelo están muy juntos, por eso se exige estar cerca del mejor, no solo un mínimo.
 */
const crypto = require('crypto');

const BATCH = 32;              // textos por petición al servicio
const MAX_NEW_PER_QUERY = 256; // como mucho, vectores nuevos que se calculan mientras el usuario espera
const DOWN_MS = 60_000;        // tras un fallo, un minuto sin intentarlo (Willy sigue buscando por palabras)
const TIMEOUT_MS = 30_000;

const hash = (s) => crypto.createHash('sha1').update(s).digest('base64').slice(0, 12);

function normalize(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return Float32Array.from(v, x => x / n);
}
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function createSemantic(env = process.env) {
  const base = String(env.EMBED_URL || '').replace(/\/+$/, '');
  if (!base) return null;
  const num = (v, def, lo, hi) => Math.min(Math.max(Number.isFinite(parseFloat(v)) ? parseFloat(v) : def, lo), hi);
  const minScore = num(env.AI_SEMANTIC_MIN, 0.45, 0.1, 0.99);
  const margin = num(env.AI_SEMANTIC_MARGIN, 0.05, 0, 1);
  const queryPrefix = env.EMBED_QUERY_PREFIX ?? 'task: search result | query: ';
  const docPrefix = env.EMBED_DOC_PREFIX ?? 'title: none | text: ';
  const vectors = new Map();   // key → { h, v }
  let downUntil = 0, busy = null;

  async function embed(texts) {
    const r = await fetch(`${base}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: texts }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) throw new Error(`embeddings ${r.status}`);
    const data = await r.json();
    const out = (data.data || []).sort((a, b) => a.index - b.index).map(d => normalize(d.embedding));
    if (out.length !== texts.length) throw new Error('embeddings incompletos');
    return out;
  }

  /** Calcula los vectores que falten (o cuyo texto cambió al editarse), como mucho `max` */
  async function fill(items, max) {
    const todo = [];
    for (const it of items) {
      const h = hash(it.text);
      if (vectors.get(it.key)?.h !== h) todo.push({ ...it, h });
      if (todo.length >= max) break;
    }
    for (let i = 0; i < todo.length; i += BATCH) {
      const chunk = todo.slice(i, i + BATCH);
      // El modelo distingue la pregunta (queryPrefix) de los textos donde se busca (docPrefix)
      const vs = await embed(chunk.map(it => `${docPrefix}${it.text.slice(0, 600)}`));
      chunk.forEach((it, j) => vectors.set(it.key, { h: it.h, v: vs[j] }));
    }
  }

  return {
    get size() { return vectors.size; },

    /** ¿Cuenta como coincidencia? Por encima del mínimo y cerca del mejor resultado de esa búsqueda */
    accepts: (score, best) => score >= minScore && score >= best - margin,

    async scores(query, items) {
      if (Date.now() < downUntil) return null;
      try {
        await fill(items, MAX_NEW_PER_QUERY);
        const [q] = await embed([`${queryPrefix}${query.slice(0, 300)}`]);
        const out = new Map();
        for (const it of items) {
          const v = vectors.get(it.key)?.v;
          if (v) out.set(it.key, dot(q, v));
        }
        return out;
      } catch (e) {
        downUntil = Date.now() + DOWN_MS;
        console.warn('[ai] búsqueda por significado no disponible:', e.message);
        return null;
      }
    },

    backfill(items) {
      if (busy || Date.now() < downUntil) return busy;
      busy = fill(items, 2000)
        .catch((e) => { downUntil = Date.now() + DOWN_MS; console.warn('[ai] índice por significado:', e.message); })
        .finally(() => { busy = null; });
      return busy;
    },

    prune(liveKeys) {
      for (const k of vectors.keys()) if (!liveKeys.has(k)) vectors.delete(k);
    },
  };
}

module.exports = { createSemantic };
