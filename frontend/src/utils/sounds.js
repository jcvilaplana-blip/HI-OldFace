/**
 * OldFace — Sonidos de la aplicación (Web Audio API, sin dependencias externas)
 */

import { usePrefsStore } from '../store/prefsStore.js';

let lastMessageSoundTime = 0;
const toneCache = new Map();   // id → HTMLAudioElement

/** Reproducir un tono de mensaje (public/sounds/msg_<id>.wav). También para la vista previa en Ajustes. */
export function playTone(id) {
  if (!id || id === 'ninguno') return;
  try {
    let a = toneCache.get(id);
    if (!a) {
      a = new Audio(`${import.meta.env.BASE_URL || '/'}sounds/msg_${id}.wav`);
      a.preload = 'auto';
      toneCache.set(id, a);
    }
    a.currentTime = 0;
    a.play().catch(() => playAlertSound());
  } catch { playAlertSound(); }
}

/** Sonido de mensaje entrante — con el tono elegido en Ajustes */
export function playMessageSound() {
  const now = Date.now();
  if (now - lastMessageSoundTime < 800) return;
  lastMessageSoundTime = now;
  playTone(usePrefsStore.getState().messageTone || 'clasico');
}

/** Aviso fijo (ping brillante doble), independiente del tono elegido: ofertas del taxi */
export function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    const play = (freq, startOffset, duration, peakGain = 0.9) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      // Compressor para dar punch sin distorsionar
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -6;
      comp.knee.value      = 3;
      comp.ratio.value     = 4;
      comp.attack.value    = 0.001;
      comp.release.value   = 0.1;

      osc.connect(gain);
      gain.connect(comp);
      comp.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + startOffset);

      const t = ctx.currentTime + startOffset;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peakGain, t + 0.008); // ataque rápido
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      osc.start(t);
      osc.stop(t + duration + 0.02);
    };

    // Dos tonos estilo WhatsApp: Do6 → Mi6 (brillantes y reconocibles)
    play(1046.5, 0,    0.14, 0.85); // C6
    play(1318.5, 0.14, 0.18, 0.90); // E6

    setTimeout(() => ctx.close(), 800);
  } catch { /* AudioContext no disponible */ }
}

/** Sonido de nota de audio enviada — ding suave */
export function playAudioSentSound() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 880;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.7, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc.start(t);
    osc.stop(t + 0.3);
    setTimeout(() => ctx.close(), 500);
  } catch {}
}

/** Tono de llamada entrante — ring repetitivo estilo teléfono */
export function playRingSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    const ring = (startOffset) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -3;
      comp.ratio.value = 4;
      osc.connect(gain); gain.connect(comp); comp.connect(ctx.destination);
      osc.type = 'sine';
      // Modulación de frecuencia para simular tono de llamada
      osc.frequency.setValueAtTime(480, ctx.currentTime + startOffset);
      osc.frequency.linearRampToValueAtTime(440, ctx.currentTime + startOffset + 0.4);
      const t = ctx.currentTime + startOffset;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.9, t + 0.01);
      gain.gain.setValueAtTime(0.9, t + 0.38);
      gain.gain.linearRampToValueAtTime(0, t + 0.4);
      osc.start(t);
      osc.stop(t + 0.42);
    };

    ring(0);
    ring(0.5);

    setTimeout(() => ctx.close(), 1200);
  } catch {}
}
