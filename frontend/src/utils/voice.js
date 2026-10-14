/**
 * Voz de Willy — con la voz y el reconocimiento del propio móvil (gratis, sin enviar el audio a ningún servicio
 * nuestro). En el APK usa los plugins nativos; en el navegador (oldface.app), la Web Speech API si existe.
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

/** "OldFace" se pronuncia en inglés ("ould feis"); la voz española lo leería letra a letra en español */
const OLDFACE_SPOKEN = LANG === 'es' ? 'Ould Feis' : 'Old Face';

/** Lo que se lee: sin emojis ni marcas de formato (sonarían raro) y con OldFace bien pronunciado */
const forSpeech = (t) => String(t || '')
  .replace(/old\s?face/gi, OLDFACE_SPOKEN)
  .replace(/[*_#`>]/g, '').replace(/\p{Extended_Pictographic}/gu, '').replace(/\s+/g, ' ').trim();

export async function speak(text) {
  const t = forSpeech(text);
  if (!t) return;
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
