/**
 * Voz de Willy — en español, la voz de nuestro servidor (POST /ai/speak, Piper en el VPS: el texto no sale de
 * OldFace); si no está disponible, o en otros idiomas, la voz del propio móvil. El reconocimiento (micrófono) es
 * siempre el del móvil. En el APK usa los plugins nativos; en el navegador (oldface.app), la Web Speech API si existe.
 *
 *   speak(text)            → lee el texto en voz alta (corta lo que estuviera diciendo)
 *   stopSpeaking()
 *   listen(onText)         → { done: Promise<string>, stop() }  escucha una frase; onText recibe el texto parcial
 *   canListen()            → ¿hay reconocimiento de voz en este dispositivo?
 *   voiceOn() / setVoiceOn(bool)  → preferencia "Willy habla" (se recuerda en este dispositivo)
 */
import { Capacitor } from '@capacitor/core';
import { TextToSpeech, QueueStrategy } from '@capacitor-community/text-to-speech';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { LANG } from '../i18n';
import { useAuthStore } from '../store/authStore';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const native = Capacitor.isNativePlatform();
const LOCALE = LANG === 'es' ? 'es-ES' : 'en-US';
const PREF = 'oldface-willy-voice';
const MAX_LISTEN_MS = 20_000;   // si nadie para la escucha, se corta sola

export function voiceOn() {
  try { return localStorage.getItem(PREF) !== 'off'; } catch { return true; }
}
export function setVoiceOn(on) {
  try { localStorage.setItem(PREF, on ? 'on' : 'off'); } catch { /* sin almacenamiento */ }
  if (!on) stopSpeaking();
}

/** "OldFace" se pronuncia en inglés; la voz española lo dice bien escrito como "OldFeis" */
const OLDFACE_SPOKEN = LANG === 'es' ? 'OldFeis' : 'Old Face';

/** Lo que se lee: sin emojis ni marcas de formato (sonarían raro) y con OldFace bien pronunciado */
const forSpeech = (t) => String(t || '')
  .replace(/old\s?face/gi, OLDFACE_SPOKEN)
  .replace(/\bwilly\b/gi, LANG === 'es' ? 'Güili' : 'Willy')
  .replace(/[*_#`>]/g, '').replace(/\p{Extended_Pictographic}/gu, '').replace(/\s+/g, ' ').trim();

// ── Voz del servidor (solo español: es una voz española) ──
const SERVER_VOICE = LANG === 'es';
const RETRY_SERVER_MS = 5 * 60_000;   // si falla, voz del móvil durante un rato antes de volver a probar
let serverOffUntil = 0;
let turn = 0;                          // cada speak() o stopSpeaking() invalida lo que estuviera sonando
let stopPlayer = null;

/** Trozos para el servidor: por frases (la primera llega antes y empieza a sonar enseguida), máx. 280 caracteres */
function sentences(t, max = 280) {
  const out = [];
  for (let piece of t.split(/(?<=[.!?…;:])\s+/)) {
    piece = piece.trim();
    while (piece.length > max) {
      let cut = piece.lastIndexOf(' ', max);
      if (cut < max / 2) cut = max;
      out.push(piece.slice(0, cut).trim());
      piece = piece.slice(cut).trim();
    }
    if (!piece) continue;
    const last = out[out.length - 1];
    if (last && last.length + piece.length < 120) out[out.length - 1] = `${last} ${piece}`;
    else out.push(piece);
  }
  return out;
}

async function fetchSpeech(text) {
  const r = await fetch(`${BACKEND}/ai/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: useAuthStore.getState().user?.id || '', text }),
  });
  if (!r.ok) throw new Error(`voz ${r.status}`);
  return URL.createObjectURL(await r.blob());
}

function play(url) {
  return new Promise((resolve, reject) => {
    const a = new Audio(url);
    stopPlayer = () => { a.pause(); resolve(); };
    a.onended = () => resolve();
    a.onerror = () => reject(new Error('audio'));
    a.play().catch(reject);
  }).finally(() => { stopPlayer = null; });
}

/** Lee con la voz del servidor frase a frase (pide la siguiente mientras suena la actual). Devuelve el texto que
 *  no se pudo leer (para la voz del móvil) o '' si terminó o se cortó. */
async function speakFromServer(parts, my) {
  let next = fetchSpeech(parts[0]);
  for (let i = 0; i < parts.length; i++) {
    let url;
    try { url = await next; } catch { serverOffUntil = Date.now() + RETRY_SERVER_MS; return parts.slice(i).join(' '); }
    next = i + 1 < parts.length ? fetchSpeech(parts[i + 1]) : null;
    next?.catch(() => {});
    if (my !== turn) { URL.revokeObjectURL(url); next?.then(u => URL.revokeObjectURL(u), () => {}); return ''; }
    try { await play(url); }
    catch { next?.then(u => URL.revokeObjectURL(u), () => {}); return parts.slice(i).join(' '); }
    finally { URL.revokeObjectURL(url); }
    if (my !== turn) { next?.then(u => URL.revokeObjectURL(u), () => {}); return ''; }
  }
  return '';
}

export async function speak(text) {
  let t = forSpeech(text);
  if (!t) return;
  stopSpeaking();
  const my = turn;
  if (SERVER_VOICE && Date.now() >= serverOffUntil) {
    t = await speakFromServer(sentences(t), my);
    if (!t || my !== turn) return;
  }
  speakOnDevice(t);
}

async function speakOnDevice(t) {
  try {
    if (native) {
      await TextToSpeech.speak({ text: t, lang: LOCALE, rate: 1.0, queueStrategy: QueueStrategy.Flush });
    } else if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(t);
      u.lang = LOCALE;
      window.speechSynthesis.speak(u);
    }
  } catch (e) { console.warn('[voz] no se pudo hablar:', e?.message); }
}

export function stopSpeaking() {
  turn++;
  stopPlayer?.();
  try {
    if (native) TextToSpeech.stop().catch(() => {});
    else window.speechSynthesis?.cancel();
  } catch { /* nada que parar */ }
}

const WebRecognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

export async function canListen() {
  if (!native) return !!WebRecognition;
  try { return (await SpeechRecognition.available()).available; } catch { return false; }
}

/** Escucha una frase. Si no hay permiso de micrófono o falla, `done` se rechaza con un mensaje legible. */
export function listen(onText) {
  let last = '';
  let finish, fail;
  const done = new Promise((res, rej) => { finish = res; fail = rej; });
  let stopped = false, timer = null;

  if (native) {
    const handles = [];
    const end = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      handles.forEach(h => h.remove?.());
      finish(last.trim());
    };
    (async () => {
      try {
        let perm = await SpeechRecognition.checkPermissions();
        if (perm.speechRecognition !== 'granted') perm = await SpeechRecognition.requestPermissions();
        if (perm.speechRecognition !== 'granted') throw new Error('Necesito permiso del micrófono para escucharte');
        handles.push(await SpeechRecognition.addListener('partialResults', (d) => { last = d?.matches?.[0] || last; onText?.(last); }));
        handles.push(await SpeechRecognition.addListener('listeningState', (d) => { if (d?.status === 'stopped') end(); }));
        await SpeechRecognition.start({ language: LOCALE, maxResults: 1, partialResults: true, popup: false });
        timer = setTimeout(() => SpeechRecognition.stop().catch(() => {}).finally(end), MAX_LISTEN_MS);
      } catch (e) {
        stopped = true;
        handles.forEach(h => h.remove?.());
        fail(new Error(e?.message || 'No se pudo usar el micrófono'));
      }
    })();
    return { done, stop: () => { SpeechRecognition.stop().catch(() => {}).finally(end); } };
  }

  if (!WebRecognition) { fail(new Error('Este dispositivo no permite hablarle a Willy')); return { done, stop() {} }; }
  const rec = new WebRecognition();
  rec.lang = LOCALE;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.onresult = (ev) => { last = Array.from(ev.results).map(r => r[0].transcript).join(' '); onText?.(last); };
  rec.onerror = (ev) => { if (!stopped) { stopped = true; fail(new Error(ev.error === 'not-allowed' ? 'Necesito permiso del micrófono para escucharte' : 'No te he entendido')); } };
  rec.onend = () => { if (!stopped) { stopped = true; clearTimeout(timer); finish(last.trim()); } };
  try { rec.start(); } catch { fail(new Error('No se pudo usar el micrófono')); }
  timer = setTimeout(() => rec.stop(), MAX_LISTEN_MS);
  return { done, stop: () => rec.stop() };
}
