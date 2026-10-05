/**
 * KaraokeEngine — mezcla en el móvil la voz (micrófono) y la pista instrumental, y añade la cámara.
 *
 *   música ──► ganancia música ──┬─► altavoz/auriculares (el cantante la oye sin retraso)
 *                                └─► mezcla ──► stream (para la sala en directo y la grabación)
 *   micro  ──► ganancia voz ─────────► mezcla
 *          └─► retorno de voz ──► auriculares        └─► medidor de nivel
 *   cámara ─────────────────────────► stream (vídeo de fondo, sala en directo y grabación)
 *
 * Sin servicios externos: Web Audio + MediaRecorder del propio WebView.
 */
const DEFAULT_MONITOR = 70; // con auriculares el cantante se oye a sí mismo desde el principio

export class KaraokeEngine {
  /**
   * @param audioUrl    URL absoluta de la pista instrumental
   * @param headphones  true = con auriculares (sin cancelación de eco, mejor calidad de voz, retorno de voz)
   * @param camera      true = abrir también la cámara frontal (si falla, se canta solo con audio)
   */
  constructor({ audioUrl, headphones = true, camera = true }) {
    this.audioUrl = audioUrl;
    this.headphones = headphones;
    this.wantCamera = camera;
    this.recorder = null;
    this.chunks = [];
    this.destroyed = false;
  }

  async init() {
    const audio = {
      echoCancellation: !this.headphones,  // sin auriculares, evitar que la música del altavoz entre por el micro
      noiseSuppression: false,             // la supresión de ruido "come" las notas largas al cantar
      autoGainControl: false,
    };
    const video = { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } };
    this.media = null;
    if (this.wantCamera) {
      try { this.media = await navigator.mediaDevices.getUserMedia({ audio, video }); }
      catch { /* sin cámara o permiso denegado: seguir solo con audio */ }
    }
    if (!this.media) this.media = await navigator.mediaDevices.getUserMedia({ audio });
    this.videoTrack = this.media.getVideoTracks()[0] || null;

    const AC = window.AudioContext || window.webkitAudioContext;
    this.ac = new AC({ latencyHint: 'interactive' });  // menor retraso en el retorno de voz

    this.audio = new Audio();
    this.audio.crossOrigin = 'anonymous';    // necesario para pasar la pista por Web Audio
    this.audio.preload = 'auto';
    this.audio.src = this.audioUrl;
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('No se pudo cargar la canción')), 20000);
      this.audio.addEventListener('canplay', () => { clearTimeout(t); resolve(); }, { once: true });
      this.audio.addEventListener('error', () => { clearTimeout(t); reject(new Error('No se pudo cargar la canción')); }, { once: true });
      this.audio.load();
    });

    const dest = this.ac.createMediaStreamDestination();
    this.musicGain   = this.ac.createGain();
    this.voiceGain   = this.ac.createGain();
    this.monitorGain = this.ac.createGain();
    this.analyser    = this.ac.createAnalyser();
    this.analyser.fftSize = 512;

    const music = this.ac.createMediaElementSource(this.audio);
    music.connect(this.musicGain);
    this.musicGain.connect(this.ac.destination);
    this.musicGain.connect(dest);

    const mic = this.ac.createMediaStreamSource(new MediaStream(this.media.getAudioTracks()));
    mic.connect(this.voiceGain);
    this.voiceGain.connect(dest);
    mic.connect(this.analyser);
    mic.connect(this.monitorGain);
    this.monitorGain.connect(this.ac.destination);

    // Sin auriculares el retorno haría acople (pitido) con el altavoz
    this.setMusic(50); this.setVoice(80); this.setMonitor(this.headphones ? DEFAULT_MONITOR : 0);

    // Stream final: mezcla de audio + cámara
    this.stream = new MediaStream([...dest.stream.getAudioTracks(), ...(this.videoTrack ? [this.videoTrack] : [])]);
    this.preview = this.videoTrack ? new MediaStream([this.videoTrack]) : null; // para el <video> de fondo (sin audio)
    this.levelBuf = new Uint8Array(this.analyser.fftSize);
    return this;
  }

  get hasVideo() { return !!this.videoTrack; }

  // ── Reproducción ─────────────────────────────────────────────────────────
  async play()  { await this.ac.resume(); await this.audio.play(); }
  pause()       { this.audio.pause(); }
  restart()     { this.audio.currentTime = 0; }
  get paused()   { return this.audio?.paused ?? true; }
  get position() { return this.audio?.currentTime || 0; }
  get duration() { return Number.isFinite(this.audio?.duration) ? this.audio.duration : 0; }
  onEnded(fn)   { this.audio.addEventListener('ended', fn); }

  // ── Mezclador (0-100) ────────────────────────────────────────────────────
  setMusic(v)   { this.musicGain.gain.value   = (v / 100) * 1.4; }
  setVoice(v)   { this.voiceGain.gain.value   = (v / 100) * 1.6; }
  setMonitor(v) { this.monitor = v; this.monitorGain.gain.value = (v / 100) * 1.3; }   // retorno de voz: solo con auriculares

  /** Encender/apagar la cámara (apagada se envía y se graba en negro) */
  setCamera(on) { if (this.videoTrack) this.videoTrack.enabled = on; }
  get cameraOn() { return !!this.videoTrack?.enabled; }

  /** Nivel del micrófono 0..1 (para el medidor) */
  level() {
    if (!this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.levelBuf);
    let sum = 0;
    for (const v of this.levelBuf) { const x = (v - 128) / 128; sum += x * x; }
    return Math.min(1, Math.sqrt(sum / this.levelBuf.length) * 4);
  }

  // ── Grabación de la mezcla (con vídeo si hay cámara) ─────────────────────
  startRecording() {
    const types = this.hasVideo
      ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4']
      : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    const mime = types.find(t => window.MediaRecorder?.isTypeSupported?.(t));
    if (!window.MediaRecorder || !mime) return false;
    this.chunks = [];
    this.recMime = mime;
    this.recorder = new MediaRecorder(this.stream, {
      mimeType: mime, audioBitsPerSecond: 128000, ...(this.hasVideo ? { videoBitsPerSecond: 1_200_000 } : {}),
    });
    this.recorder.ondataavailable = (e) => { if (e.data?.size) this.chunks.push(e.data); };
    this.recorder.start(1000);
    return true;
  }

  pauseRecording()  { if (this.recorder?.state === 'recording') this.recorder.pause(); }
  resumeRecording() { if (this.recorder?.state === 'paused') this.recorder.resume(); }

  stopRecording() {
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === 'inactive') return resolve(null);
      this.recorder.onstop = () => resolve(new Blob(this.chunks, { type: this.recMime }));
      this.recorder.stop();
    });
  }

  get recIsVideo() { return !!this.recMime?.startsWith('video/'); }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    try { if (this.recorder?.state !== 'inactive') this.recorder?.stop(); } catch {}
    try { this.audio?.pause(); } catch {}
    this.media?.getTracks().forEach(t => t.stop());
    try { this.ac?.close(); } catch {}
  }
}
