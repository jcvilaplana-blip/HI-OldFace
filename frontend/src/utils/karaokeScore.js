/**
 * karaokeScore — puntuación del karaoke en el propio móvil (sin servicios externos).
 *
 * Las canciones del catálogo son pistas instrumentales sin melodía de referencia, así que la nota
 * se calcula con lo que sí se puede medir con fiabilidad:
 *   · Ritmo  — cantar cuando toca cada frase (presencia de voz durante la línea).
 *   · Afinación — lo cerca que está cada nota cantada de una nota musical (semitono) estable.
 * Cada frase recibe su nota al terminar ("¡Perfecto!", "¡Genial!"…) y al final la media + letra (S/A/B/C/D).
 */
import { isMyLine, lineIndexAt } from './lrc';
import { tr } from '../i18n';

/**
 * Frecuencia fundamental de la voz (Hz) con el algoritmo YIN, o 0 si no hay voz clara.
 * @param buf  muestras en el dominio del tiempo (Float32Array, ~2048)
 */
export function detectPitch(buf, sampleRate) {
  const n = buf.length;
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  if (Math.sqrt(rms / n) < 0.01) return 0;

  const minLag = Math.floor(sampleRate / 1000);                 // voz hasta ~1000 Hz
  const maxLag = Math.min(Math.floor(sampleRate / 70), n >> 1); // y desde ~70 Hz
  const W = n - maxLag;
  const d = new Float32Array(maxLag + 2);
  for (let tau = 1; tau <= maxLag; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const x = buf[i] - buf[i + tau]; s += x * x; }
    d[tau] = s;
  }
  // Diferencia normalizada acumulada
  let run = 0;
  let tau = -1;
  for (let t = 1; t <= maxLag; t++) {
    run += d[t];
    d[t] = run ? d[t] * t / run : 1;
    if (t >= minLag && tau < 0 && d[t] < 0.15) tau = t;
  }
  if (tau < 0) return 0;
  while (tau + 1 <= maxLag && d[tau + 1] < d[tau]) tau++;
  // Interpolación parabólica para afinar el periodo
  const a = d[tau - 1], b = d[tau], c = tau + 1 <= maxLag ? d[tau + 1] : d[tau];
  const den = a + c - 2 * b;
  const exact = den ? tau + (a - c) / (2 * den) : tau;
  const hz = sampleRate / exact;
  return hz >= 70 && hz <= 1000 ? hz : 0;
}

/** Desviación en cents (0-50) respecto al semitono más cercano */
export function centsOff(hz) {
  const cents = 1200 * Math.log2(hz / 440);
  return Math.abs(cents - Math.round(cents / 100) * 100);
}

export function lineLabel(score) {
  if (score >= 85) return { text: tr('¡Perfecto!'), color: '#facc15' };
  if (score >= 70) return { text: tr('¡Genial!'),   color: '#4ade80' };
  if (score >= 50) return { text: tr('¡Bien!'),     color: '#60a5fa' };
  if (score >= 20) return { text: tr('Sigue así'),  color: '#c4b5fd' };
  return { text: tr('¡Canta!'), color: '#fca5a5' };
}

export function grade(score) {
  return score >= 90 ? 'S' : score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : 'D';
}

export class KaraokeScorer {
  /**
   * @param lines   letra (parseLrc / duetParts)
   * @param myPart  'A' | 'B' en un dúo (solo puntúan mis frases); null = todas
   */
  constructor(lines, myPart = null) {
    this.lines = lines;
    this.stats = lines.map((l, i) => {
      const next = lines[i + 1]?.t ?? l.t + 6;
      return { mine: isMyLine(l, myPart), start: l.t, end: Math.min(next - 0.2, l.t + 8), samples: 0, voiced: 0, pitched: 0, dev: 0, score: null };
    });
    this.current = -1;
  }

  reset() {
    for (const s of this.stats) Object.assign(s, { samples: 0, voiced: 0, pitched: 0, dev: 0, score: null, timing: 0, tune: 0 });
    this.current = -1;
  }

  /**
   * Añade una medida. Devuelve { index, score } cuando termina una de mis frases (para mostrar su nota).
   * @param pos    segundos de la canción
   * @param level  nivel del micro 0..1
   * @param hz     tono detectado (0 = sin tono claro)
   */
  sample(pos, level, hz) {
    const idx = lineIndexAt(this.lines, pos);
    let finished = null;
    if (idx !== this.current) {
      const prev = this.stats[this.current];
      if (prev?.mine && prev.score === null && prev.samples) finished = { index: this.current, score: this.scoreLine(prev) };
      this.current = idx;
    }
    const s = this.stats[idx];
    if (s?.mine && pos <= s.end) {
      s.samples++;
      if (level > 0.06) s.voiced++;
      if (hz) { s.pitched++; s.dev += centsOff(hz); }
    }
    return finished;
  }

  scoreLine(s) {
    if (!s.samples) { s.score = 0; s.timing = 0; s.tune = 0; return 0; }
    const timing = Math.min(1, (s.voiced / s.samples) / 0.65);
    const tune = s.pitched >= 3 ? Math.max(0, Math.min(1, (42 - s.dev / s.pitched) / 30)) : (s.voiced ? 0.35 : 0);
    s.timing = timing; s.tune = tune;
    s.score = s.voiced ? Math.round(100 * (0.55 * timing + 0.45 * tune)) : 0;
    return s.score;
  }

  /** Resultado final con las frases que ya han sonado */
  result(pos) {
    const done = this.stats.filter(s => s.mine && s.start <= pos);
    for (const s of done) if (s.score === null) this.scoreLine(s);
    if (!done.length) return { score: 0, timing: 0, tune: 0, grade: 'D', lines: 0 };
    const avg = (k) => done.reduce((a, s) => a + (s[k] || 0), 0) / done.length;
    const score = Math.round(avg('score'));
    return { score, timing: Math.round(avg('timing') * 100), tune: Math.round(avg('tune') * 100), grade: grade(score), lines: done.length };
  }
}
