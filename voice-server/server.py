"""
OldFace — servicio de voz de Willy (Piper, en nuestro servidor: el texto no sale del VPS).

Solo escucha en 127.0.0.1: lo usa la API principal (frontend/backend/ai/providers/tts.js), nunca la app directamente.
  POST /synthesize  {"text": "..."}  → audio/wav
  GET  /health                        → {"ok": true, "voice": "<modelo>"}

Configuración por variables de entorno (ver oldface-voice.service):
  VOICE_MODEL    ruta al modelo .onnx de Piper (con su .onnx.json al lado)   [obligatoria]
  VOICE_PORT     puerto local (por defecto 5010)
  VOICE_THREADS  frases que se generan a la vez como máximo (por defecto 2; el resto espera)
No registra el texto que lee.
"""
import io
import json
import os
import sys
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from piper import PiperVoice

MAX_CHARS = 800          # lo mismo que acepta la API principal
MAX_BODY = 8 * 1024      # bytes del cuerpo JSON

MODEL = os.environ.get("VOICE_MODEL", "")
PORT = int(os.environ.get("VOICE_PORT", "5010"))
SLOTS = threading.BoundedSemaphore(max(int(os.environ.get("VOICE_THREADS", "2")), 1))

if not MODEL or not Path(MODEL).is_file():
    sys.exit(f"[voz] falta el modelo: VOICE_MODEL={MODEL!r}")
VOICE = PiperVoice.load(MODEL)
VOICE_NAME = Path(MODEL).stem


def synthesize(text: str) -> bytes:
    buf = io.BytesIO()
    with SLOTS, wave.open(buf, "wb") as wf:
        VOICE.synthesize_wav(text, wf)
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    server_version = "oldface-voice"

    def log_message(self, *args):  # sin registro de peticiones (podría acabar llevando texto)
        pass

    def reply(self, status: int, body: bytes, ctype: str):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def error(self, status: int, msg: str):
        self.reply(status, json.dumps({"error": msg}, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def do_GET(self):
        if self.path == "/health":
            return self.reply(200, json.dumps({"ok": True, "voice": VOICE_NAME}).encode(), "application/json")
        self.error(404, "No existe")

    def do_POST(self):
        if self.path != "/synthesize":
            return self.error(404, "No existe")
        try:
            size = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            size = -1
        if size <= 0 or size > MAX_BODY:
            return self.error(400, "Cuerpo no válido")
        try:
            data = json.loads(self.rfile.read(size))
        except ValueError:
            return self.error(400, "JSON no válido")
        text = data.get("text") if isinstance(data, dict) else None
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_CHARS:
            return self.error(400, f"El texto debe tener entre 1 y {MAX_CHARS} caracteres")
        try:
            audio = synthesize(text.strip())
        except Exception as e:  # sin el texto en el mensaje
            print(f"[voz] error al generar: {type(e).__name__}", file=sys.stderr, flush=True)
            return self.error(500, "No se pudo generar la voz")
        self.reply(200, audio, "audio/wav")


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    srv.daemon_threads = True
    print(f"[voz] {VOICE_NAME} en 127.0.0.1:{PORT}", flush=True)
    srv.serve_forever()
