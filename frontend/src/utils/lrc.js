/**
 * Letras sincronizadas en formato LRC:  [mm:ss.xx] texto
 * Admite varias marcas por línea ([00:12.00][01:30.00] estribillo) y descarta metadatos ([ar:], [ti:]…).
 */
export function parseLrc(text) {
  const lines = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const lyric = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) {
      const frac = m[3] ? Number(m[3].padEnd(3, '0')) / 1000 : 0;
      lines.push({ t: Number(m[1]) * 60 + Number(m[2]) + frac, text: lyric });
    }
  }
  return lines.sort((a, b) => a.t - b.t);
}

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
