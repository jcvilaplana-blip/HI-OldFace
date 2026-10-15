/**
 * Voz de Willy en el servidor — cambiar de proveedor = añadir un adaptador aquí, sin tocar las rutas.
 *   createVoice(env) → { name, speak(text) → Promise<{ audio: Buffer, mime }> } | null (sin voz: la app usa la del móvil)
 *   TTS_PROVIDER = piper (por defecto si hay PIPER_URL) · mock (pruebas) · off
 *   PIPER_URL    = servicio local de voice-server/ (p. ej. http://127.0.0.1:5010); nunca un servicio externo
 * Los errores salen como ProviderError (503) sin el texto que se iba a leer.
 */
const { ProviderError } = require('./anthropic');

const TIMEOUT_MS = 20_000;
const unavailable = () => new ProviderError('La voz de Willy no está disponible ahora', { status: 503 });

function createPiperVoice(baseUrl) {
  const url = `${baseUrl.replace(/\/+$/, '')}/synthesize`;
  return {
    name: 'piper',
    async speak(text) {
      let r;
      try {
        r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch { throw unavailable(); }
      if (!r.ok) throw unavailable();
      return { audio: Buffer.from(await r.arrayBuffer()), mime: 'audio/wav' };
    },
  };
}

/** Voz de pruebas: un WAV válido de 0,1 s en silencio (no llama a nada) */
function createMockVoice() {
  const rate = 16000, data = (rate / 10) * 2;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data, 40);
  const wav = Buffer.concat([h, Buffer.alloc(data)]);
  return { name: 'mock', async speak() { return { audio: wav, mime: 'audio/wav' }; } };
}

function createVoice(env = process.env) {
  const kind = (env.TTS_PROVIDER || (env.PIPER_URL ? 'piper' : 'off')).toLowerCase();
  if (kind === 'mock') return createMockVoice();
  if (kind === 'piper' && env.PIPER_URL) return createPiperVoice(env.PIPER_URL);
  return null;
}

module.exports = { createVoice };
