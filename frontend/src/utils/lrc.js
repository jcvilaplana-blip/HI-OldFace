/**
 * Letras sincronizadas en formato LRC:  [mm:ss.xx] texto
 * Admite varias marcas por línea ([00:12.00][01:30.00] estribillo) y descarta metadatos ([ar:], [ti:]…).
 * Dúos: la línea puede empezar por "A:", "B:" o "AB:" para indicar quién la canta → `part`.
 */
export function parseLrc(text) {
  const lines = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    let lyric = raw.replace(/\[[^\]]*\]/g, '').trim();
    let part = null;
    const pm = lyric.match(/^(AB|A|B)\s*:\s*/i);
    if (pm) { part = pm[1].toUpperCase(); lyric = lyric.slice(pm[0].length); }
    for (const m of stamps) {
      const frac = m[3] ? Number(m[3].padEnd(3, '0')) / 1000 : 0;
      lines.push({ t: Number(m[1]) * 60 + Number(m[2]) + frac, text: lyric, part });
    }
  }
  return lines.sort((a, b) => a.t - b.t);
}

/**
 * Reparto de un dúo: usa las marcas A:/B:/AB: de la letra; si la canción no las tiene,
 * alterna las frases con texto (A, B, A, B…) y la última frase la cantan los dos.
 * Devuelve las líneas con `part` siempre relleno ('A' | 'B' | 'AB'; las líneas vacías → null).
 */
export function duetParts(lines) {
  if (lines.some(l => l.part)) return lines.map(l => ({ ...l, part: l.text ? (l.part || 'AB') : null }));
  const sung = lines.filter(l => l.text);
  let n = 0;
  return lines.map(l => {
    if (!l.text) return { ...l, part: null };
    const last = l === sung[sung.length - 1] && sung.length > 2;
    return { ...l, part: last ? 'AB' : (n++ % 2 === 0 ? 'A' : 'B') };
  });
}

/** ¿Le toca cantar a `myPart` en esta línea? (sin dúo: todas las líneas con texto) */
export const isMyLine = (line, myPart) => !!line?.text && (!myPart || !line.part || line.part === 'AB' || line.part === myPart);

/** Índice de la línea que suena en `pos` segundos (-1 antes de la primera) */
export function lineIndexAt(lines, pos) {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= pos) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

export function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
