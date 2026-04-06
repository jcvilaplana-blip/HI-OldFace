/**
 * OldFace — Sonidos de la aplicación (Web Audio API, sin dependencias externas)
 */

let lastMessageSoundTime = 0;

/** Sonido de mensaje entrante — doble ding ascendente */
export function playMessageSound() {
  const now = Date.now();
  // Evitar spam de sonido si llegan varios mensajes seguidos
  if (now - lastMessageSoundTime < 800) return;
  lastMessageSoundTime = now;

  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const play = (freq, startOffset, duration) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime + startOffset;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.22, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      osc.start(t);
      osc.stop(t + duration + 0.02);
    };
    play(880,  0,    0.18);
    play(1320, 0.18, 0.22);
    setTimeout(() => ctx.close(), 800);
  } catch { /* AudioContext no disponible (ej: tab sin foco) */ }
}

/** Sonido de nota de audio enviada — ding suave */
export function playAudioSentSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 660;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.start(t);
    osc.stop(t + 0.32);
    setTimeout(() => ctx.close(), 500);
  } catch {}
}
