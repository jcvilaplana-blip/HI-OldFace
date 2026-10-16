#!/usr/bin/env bash
# OldFace — compila whisper.cpp (transcripción de audios de Willy) en el VPS SIN root, como usuario de la suscripción:
#   bash /var/www/vhosts/oldface.app/whisper-server/build-vps.sh
# Deja: whisper-server/bin/whisper-server y whisper-server/models/ggml-small-q8_0.bin (comprobado con su SHA-256).
# cmake se instala con pip en un entorno aparte (el VPS no lo trae y no hace falta root).
set -euo pipefail
DIR=/var/www/vhosts/oldface.app/whisper-server
TAG=v1.9.4                       # versión estable (septiembre de 2026)
MODEL=ggml-small-q8_0.bin
SHA=49c8fb02b65e6049d5fa6c04f81f53b867b5ec9540406812c643f177317f779f
mkdir -p "$DIR/bin" "$DIR/models" "$DIR/build-tools"

if [ ! -x "$DIR/bin/whisper-server" ]; then
  [ -x "$DIR/build-tools/venv/bin/cmake" ] || { python3 -m venv "$DIR/build-tools/venv" && "$DIR/build-tools/venv/bin/pip" install -q cmake; }
  rm -rf "$DIR/build-tools/src"
  git clone -q --depth 1 --branch "$TAG" https://github.com/ggml-org/whisper.cpp.git "$DIR/build-tools/src"
  cd "$DIR/build-tools/src"
  "$DIR/build-tools/venv/bin/cmake" -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_EXAMPLES=ON \
    -DWHISPER_BUILD_TESTS=OFF -DGGML_NATIVE=ON >/dev/null
  "$DIR/build-tools/venv/bin/cmake" --build build -j 6 --target whisper-server >/dev/null
  cp build/bin/whisper-server "$DIR/bin/whisper-server"
fi
"$DIR/bin/whisper-server" --help >/dev/null 2>&1 && echo "whisper-server compilado ($TAG)"

cd "$DIR/models"
[ -s "$MODEL" ] || { curl -sSL --retry 5 -o "$MODEL.part" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$MODEL" && mv "$MODEL.part" "$MODEL"; }
echo "$SHA  $MODEL" | sha256sum -c -
