/**
 * KaraokeEngine — mezcla en el móvil la voz (micrófono) y la pista, con cámara, efectos de estudio,
 * cambio de tono/velocidad y detección de afinación.
 *
 *   pista ─► [tono] ─► música ──┬─► auriculares (el cantante la oye sin retraso)
 *                               └─► mezcla ──► stream (sala en directo y grabación)
 *   micro ─► filtro 85 Hz ─► compresor ─► presencia ─┬──────────────┬─► voz ─► mezcla
 *                                                    └─► reverb ────┘   └─► retorno ─► auriculares
 *   cámara ─────────────────────────────────────────────────────────────► stream
 *
 * Sin servicios externos: Web Audio + AudioWorklet + MediaRecorder del propio WebView.
 */
import { detectPitch } from './karaokeScore';
import { tr } from '../i18n';

const DEFAULT_MONITOR = 70; // con auriculares el cantante se oye a sí mismo desde el principio

/** Tipos de reverb: duración (s) y pre-retardo (s) */
export const REVERB_PRESETS = {
  estudio: { label: tr('Estudio'), decay: 1.2, pre: 0.012 },
  sala:    { label: tr('Sala'),    decay: 2.2, pre: 0.025 },
  hall:    { label: tr('Hall'),    decay: 3.6, pre: 0.04 },
};

// Cambio de tono sin cambiar la velocidad: dos lecturas con retardo variable y fundido cruzado.
const PITCH_WORKLET = `
class PitchShifter extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'ratio', defaultValue: 1, minValue: 0.5, maxValue: 2 }]; }
  constructor() {
    super();
    this.W = Math.round(sampleRate * 0.07);   // ventana ~70 ms
    this.len = 1; while (this.len < this.W * 2 + 8) this.len <<= 1;
    this.mask = this.len - 1;
    this.buf = [new Float32Array(this.len), new Float32Array(this.len)];
    this.w = 0; this.phase = 0;
  }
  read(b, pos) {
    const i = Math.floor(pos), f = pos - i;
    return b[i & this.mask] * (1 - f) + b[(i + 1) & this.mask] * f;
  }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0];
    if (!out.length) return true;
    const n = out[0].length, ratio = params.ratio[0];
    const step = (1 - ratio) / this.W;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < out.length; c++) {
        const src = inp[c] || inp[0];
        this.buf[c & 1][this.w] = src ? src[i] : 0;
      }
      if (ratio === 1) {
        for (let c = 0; c < out.length; c++) out[c][i] = this.buf[c & 1][this.w];
      } else {
        let p = this.phase + step; p -= Math.floor(p); this.phase = p;
        const p2 = (p + 0.5) % 1;
        const g1 = Math.sin(Math.PI * p) ** 2, g2 = Math.sin(Math.PI * p2) ** 2;
        const r1 = this.w - p * this.W - 1 + this.len, r2 = this.w - p2 * this.W - 1 + this.len;
        for (let c = 0; c < out.length; c++) {
          const b = this.buf[c & 1];
          out[c][i] = this.read(b, r1) * g1 + this.read(b, r2) * g2;
        }
      }
      this.w = (this.w + 1) & this.mask;
    }
    return true;
  }
}
registerProcessor('oldface-pitch-shifter', PitchShifter);
`;

/** Respuesta de impulso sintética (ruido con caída exponencial y amortiguación de agudos) */
function makeImpulse(ac, { decay, pre }) {
  const sr = ac.sampleRate;
  const len = Math.floor(sr * (decay + pre));
  const ir = ac.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = Math.floor(sr * pre); i < len; i++) {
      const t = i / sr - pre;
      const env = Math.exp(-6.9 * t / decay);             // -60 dB al final
      const damp = 0.85 - 0.65 * (t / decay);               // los agudos se apagan antes
      lp += damp * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * env;
    }
  }
  return ir;
}

export class KaraokeEngine {
  /**
   * @param audioUrl      URL absoluta de la pista instrumental
   * @param mediaElement  en vez de audioUrl: <audio>/<video> ya preparado (dúo: grabación de la pareja)
   * @param headphones    true = con auriculares (sin cancelación de eco, retorno de voz)
   * @param camera        true = abrir también la cámara frontal (si falla, se canta solo con audio)
   */
  constructor({ audioUrl, mediaElement = null, headphones = true, camera = true, headphoneKind = 'unknown' }) {
    this.audioUrl = audioUrl;
    this.mediaElement = mediaElement;
    this.headphones = headphones;
    this.headphoneKind = headphoneKind;   // 'wired' | 'bluetooth' | 'usb' | 'none' | 'unknown' (para estimar el retardo)
    this.wantCamera = camera;
    this.recorder = null;
    this.chunks = [];
    this.destroyed = false;
    this.key = 0;
    this.speed = 1;
    this.reverb = 25;
    this.reverbType = 'estudio';
  }

  async init() {
    const audio = {
      echoCancellation: !this.headphones,  // sin auriculares, evitar que la música del altavoz entre por el micro
      noiseSuppression: false,             // la supresión de ruido "come" las notas largas al cantar
      autoGainControl: false,
      sampleRate: { ideal: 48000 },        // calidad de estudio (no la de llamada)
      channelCount: { ideal: 1 },
      latency: { ideal: 0.01 },            // pedir la menor latencia de entrada posible
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

    // ── Pista (o grabación de la pareja en un dúo) ──
    if (this.mediaElement) {
      this.audio = this.mediaElement;
    } else {
      this.audio = new Audio();
      this.audio.crossOrigin = 'anonymous';    // necesario para pasar la pista por Web Audio
      this.audio.preload = 'auto';
      this.audio.src = this.audioUrl;
    }
    this.audio.preservesPitch = true; this.audio.webkitPreservesPitch = true; // la velocidad no cambia el tono
    if (this.audio.readyState < 3) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(tr('No se pudo cargar la canción'))), 25000);
        this.audio.addEventListener('canplay', () => { clearTimeout(t); resolve(); }, { once: true });
        this.audio.addEventListener('error', () => { clearTimeout(t); reject(new Error(tr('No se pudo cargar la canción'))); }, { once: true });
        this.audio.load();
      });
    }

    const dest = this.ac.createMediaStreamDestination();
    // Bus de mezcla de la grabación → limitador (nunca satura) → stream
    this.mixBus  = this.ac.createGain();
    const limiter = this.ac.createDynamicsCompressor();
    limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.12;
    const master = this.ac.createGain(); master.gain.value = 0.92;
    this.mixBus.connect(limiter); limiter.connect(master); master.connect(dest);

    this.musicGain = this.ac.createGain();
    const music = this.ac.createMediaElementSource(this.audio);

    // Cambio de tono (AudioWorklet); si el WebView no lo soporta, la pista va directa
    this.pitchNode = null;
    try {
      if (this.ac.audioWorklet) {
        const url = URL.createObjectURL(new Blob([PITCH_WORKLET], { type: 'application/javascript' }));
        await this.ac.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        this.pitchNode = new AudioWorkletNode(this.ac, 'oldface-pitch-shifter', { outputChannelCount: [2] });
      }
    } catch { this.pitchNode = null; }
    if (this.pitchNode) { music.connect(this.pitchNode); this.pitchNode.connect(this.musicGain); }
    else music.connect(this.musicGain);
    this.musicGain.connect(this.ac.destination);                  // lo que oye el cantante: sin retraso
    // En la grabación la música se retrasa lo mismo que tarda la voz en volver por el micro
    // (salida a auriculares + entrada del micro): así la voz cae a tiempo, como otra pista de la canción.
    this.syncDelay = this.ac.createDelay(1.0);
    this.musicGain.connect(this.syncDelay); this.syncDelay.connect(this.mixBus);

    // ── Voz: cadena de estudio ──
    const mic = this.ac.createMediaStreamSource(new MediaStream(this.media.getAudioTracks()));
    const pre = this.ac.createGain(); pre.gain.value = 2.2;      // el micro del móvil entrega poco nivel
    const hp = this.ac.createBiquadFilter();                     // quita graves de manejo/ruido
    hp.type = 'highpass'; hp.frequency.value = 90; hp.Q.value = 0.7;
    const mud = this.ac.createBiquadFilter();                    // menos "voz de caja"
    mud.type = 'peaking'; mud.frequency.value = 280; mud.Q.value = 1; mud.gain.value = -2.5;
    const comp = this.ac.createDynamicsCompressor();             // voz pareja y delante de la música
    comp.threshold.value = -22; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    const makeup = this.ac.createGain(); makeup.gain.value = 1.6;
    const presence = this.ac.createBiquadFilter();               // inteligibilidad
    presence.type = 'peaking'; presence.frequency.value = 3200; presence.Q.value = 0.8; presence.gain.value = 3;
    const air = this.ac.createBiquadFilter();                    // brillo de estudio
    air.type = 'highshelf'; air.frequency.value = 9000; air.gain.value = 2.5;
    mic.connect(pre); pre.connect(hp); hp.connect(mud); mud.connect(comp); comp.connect(makeup); makeup.connect(presence); presence.connect(air);

    this.convolver = this.ac.createConvolver();
    this.wetGain   = this.ac.createGain();
    const voiceOut = this.ac.createGain();
    air.connect(voiceOut);                                                  // seca
    air.connect(this.convolver); this.convolver.connect(this.wetGain); this.wetGain.connect(voiceOut); // reverb

    this.voiceGain   = this.ac.createGain();
    this.monitorGain = this.ac.createGain();
    voiceOut.connect(this.voiceGain);   this.voiceGain.connect(this.mixBus);
    voiceOut.connect(this.monitorGain); this.monitorGain.connect(this.ac.destination);

    // Medidores: nivel (rápido) y tono (ventana larga)
    this.analyser = this.ac.createAnalyser();
    this.analyser.fftSize = 512;
    this.pitchAnalyser = this.ac.createAnalyser();
    this.pitchAnalyser.fftSize = 2048;
    mic.connect(this.analyser); mic.connect(this.pitchAnalyser);
    this.levelBuf = new Uint8Array(this.analyser.fftSize);
    this.pitchBuf = new Float32Array(this.pitchAnalyser.fftSize);

    // Sin auriculares el retorno haría acople (pitido) con el altavoz
    this.setMusic(45); this.setVoice(85); this.setMonitor(this.headphones ? DEFAULT_MONITOR : 0);
    this.setReverbType(this.reverbType); this.setReverb(this.reverb);
    this.autoSyncMs = this.estimateLatencyMs();
    this.setSync(this.autoSyncMs);

    // Stream final: mezcla de audio + cámara
    this.mixTracks = dest.stream.getAudioTracks();
    this.stream = new MediaStream([...this.mixTracks, ...(this.videoTrack ? [this.videoTrack] : [])]);
    this.preview = this.videoTrack ? new MediaStream([this.videoTrack]) : null; // para el <video> de fondo (sin audio)
    return this;
  }

  get hasVideo() { return !!this.videoTrack; }
  get canShiftKey() { return !!this.pitchNode; }

  /**
   * Retardo de ida y vuelta (ms): música → auriculares → oído → voz → micro.
   * Usa lo que informa el navegador y, si no, valores típicos de Android (Bluetooth tarda mucho más).
   */
  estimateLatencyMs() {
    const bt = this.headphoneKind === 'bluetooth';
    const out = Number.isFinite(this.ac.outputLatency) && this.ac.outputLatency > 0
      ? this.ac.outputLatency
      : (this.ac.baseLatency || 0.01) + (bt ? 0.22 : 0.05);
    const inLat = this.media.getAudioTracks()[0]?.getSettings?.().latency;
    const input = Number.isFinite(inLat) && inLat > 0 ? inLat : 0.04;
    return Math.round(Math.max(40, Math.min(500, (out + input) * 1000)));
  }

  /** Sincronizar voz y música en la grabación (ms que se retrasa la música) */
  setSync(ms) {
    this.syncMs = Math.max(0, Math.min(600, Math.round(ms)));
    this.syncDelay.delayTime.setValueAtTime(this.syncMs / 1000, this.ac.currentTime);
  }

  /** Posición de la canción que corresponde a la voz que entra AHORA por el micro (puntuación y salas) */
  songTime() { return Math.max(0, this.position - (this.syncMs || 0) / 1000); }

  /** Grabar con otra imagen (dúo: lienzo con las dos cámaras) en vez de la cámara */
  setRecordVideoTrack(track) {
    this.stream = new MediaStream([...this.mixTracks, ...(track ? [track] : [])]);
    this.recVideo = !!track;
  }

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
  setReverb(v)  { this.reverb = v; this.wetGain.gain.value = (v / 100) * 1.1; }
  setReverbType(type) {
    if (!REVERB_PRESETS[type]) return;
    this.reverbType = type;
    this.convolver.buffer = makeImpulse(this.ac, REVERB_PRESETS[type]);
  }

  /** Tono de la pista en semitonos (-6..+6) sin cambiar la velocidad */
  setKey(semitones) {
    if (!this.pitchNode) return;
    this.key = Math.max(-6, Math.min(6, Math.round(semitones)));
    this.pitchNode.parameters.get('ratio').setValueAtTime(Math.pow(2, this.key / 12), this.ac.currentTime);
  }

  /** Velocidad de la pista (0.75..1.25) sin cambiar el tono */
  setSpeed(rate) {
    this.speed = Math.max(0.75, Math.min(1.25, rate));
    this.audio.playbackRate = this.speed;
  }

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

  /** Tono de la voz en Hz (0 = sin voz clara) */
  pitch() {
    if (!this.pitchAnalyser) return 0;
    this.pitchAnalyser.getFloatTimeDomainData(this.pitchBuf);
    return detectPitch(this.pitchBuf, this.ac.sampleRate);
  }

  // ── Grabación de la mezcla (con vídeo si hay imagen) ─────────────────────
  startRecording() {
    const withVideo = this.stream.getVideoTracks().length > 0;
    const types = withVideo
      ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4']
      : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    const mime = types.find(t => window.MediaRecorder?.isTypeSupported?.(t));
    if (!window.MediaRecorder || !mime) return false;
    this.chunks = [];
    this.recMime = mime;
    this.recorder = new MediaRecorder(this.stream, {
      mimeType: mime, audioBitsPerSecond: 128000, ...(withVideo ? { videoBitsPerSecond: 1_200_000 } : {}),
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
