/**
 * screenShare — pista de vídeo con la pantalla del usuario para la videollamada.
 *  · Navegador: getDisplayMedia (el propio navegador pregunta qué compartir).
 *  · APK Android: el WebView no tiene getDisplayMedia → la capta el servicio nativo (window.OldFaceScreen,
 *    MediaProjection) y manda ~8 imágenes JPEG por segundo a window.__ofScreenFrame; aquí se pintan en un
 *    canvas y canvas.captureStream() da la pista que se envía por la llamada. Nada se guarda.
 *
 * startScreenTrack({ onEnded }) → Promise<{ track, stop }>  (rechaza con 'denied' si el usuario no acepta)
 */

const isNative = () => !!window.Capacitor?.isNativePlatform?.();

/** ¿Se puede compartir pantalla en este dispositivo? */
export function canShareScreen() {
  if (isNative()) return !!window.OldFaceScreen;
  return !!navigator.mediaDevices?.getDisplayMedia;
}

export async function startScreenTrack({ onEnded } = {}) {
  if (!isNative()) return startWeb(onEnded);
  if (!window.OldFaceScreen) throw new Error('unsupported');
  return startNative(onEnded);
}

async function startWeb(onEnded) {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('unsupported');
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 20 } }, audio: false });
  } catch (e) {
    throw new Error(e?.name === 'NotAllowedError' ? 'denied' : 'error');
  }
  const track = stream.getVideoTracks()[0];
  let ended = false;
  const stop = () => { if (ended) return; ended = true; track.stop(); };
  // "Dejar de compartir" desde la barra del navegador
  track.addEventListener('ended', () => { if (!ended) { ended = true; onEnded?.(); } });
  return { track, stop };
}

function startNative(onEnded) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = 540; canvas.height = 960;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#111827'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    let busy = false, started = false, ended = false;
    const img = new Image();

    // Cada imagen que llega del móvil se pinta en el canvas (si aún se está pintando la anterior, se salta)
    window.__ofScreenFrame = (b64, w, h) => {
      if (busy || ended) return;
      busy = true;
      img.onload = () => {
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        ctx.drawImage(img, 0, 0, w, h);
        busy = false;
      };
      img.onerror = () => { busy = false; };
      img.src = `data:image/jpeg;base64,${b64}`;
    };

    const stream = canvas.captureStream(10);
    const track = stream.getVideoTracks()[0];
    // Si la pantalla no cambia no llegan imágenes nuevas: repintar un píxel para que la pista siga enviando
    const keepAlive = setInterval(() => {
      if (busy || ended) return;
      const p = ctx.getImageData(0, 0, 1, 1); ctx.putImageData(p, 0, 0);
    }, 1000);

    const cleanup = () => {
      clearInterval(keepAlive);
      window.__ofScreenFrame = null;
      window.__ofScreenState = null;
      track.stop();
    };
    const stop = () => {
      if (ended) return;
      ended = true;
      try { window.OldFaceScreen.stop(); } catch { /* ya parado */ }
      cleanup();
    };

    window.__ofScreenState = (state) => {
      if (state === 'started' && !started) { started = true; resolve({ track, stop }); return; }
      if ((state === 'denied' || state === 'error') && !started) { ended = true; cleanup(); reject(new Error(state)); return; }
      if (state === 'stopped' || state === 'error') {
        // Parado desde el aviso de Android ("Dejar de compartir") o por el sistema
        if (!ended) { ended = true; cleanup(); onEnded?.(); }
      }
    };

    try { window.OldFaceScreen.start(); } catch { ended = true; cleanup(); reject(new Error('error')); }
  });
}
