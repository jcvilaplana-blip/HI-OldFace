#!/usr/bin/env bash
# OldFace — activa la visión de Willy (oldface-vision: llama.cpp + Qwen3-VL 2B). Ejecutar UNA vez como root:
#   sudo bash /var/www/vhosts/oldface.app/vision-server/setup-vps.sh
# Antes deben estar: llm-server/llama/llama-server (el mismo llama.cpp b11327 del cerebro) y en vision-server/models/
# (ggml-org/Qwen3-VL-2B-Instruct-GGUF):
#   Qwen3-VL-2B-Instruct-Q8_0.gguf        SHA-256 b7802e29f71a9e5b5e3f83f613df898a2204342dcea71a231ea501d481813c39
#   mmproj-Qwen3-VL-2B-Instruct-Q8_0.gguf SHA-256 69066c8f279ec85ff48ab4059f6ebba0d2932ca57667f2bbdac7d9805bca9e7b
# Después, para reiniciarlo sin root basta con: touch /var/www/vhosts/oldface.app/vision-server/.restart
# La API lo usa con VISION_URL=http://127.0.0.1:8091 en backend/.env.
set -euo pipefail
SUB_USER=oldface.app_k1i7f62xmt8
DIR=/var/www/vhosts/oldface.app/vision-server
LLAMA=/var/www/vhosts/oldface.app/llm-server/llama/llama-server

[ "$(id -u)" = 0 ] || { echo "Ejecútalo como root (sudo)"; exit 1; }
[ -x "$LLAMA" ] || { echo "Falta $LLAMA"; exit 1; }
for f in Qwen3-VL-2B-Instruct-Q8_0.gguf mmproj-Qwen3-VL-2B-Instruct-Q8_0.gguf; do
  [ -f "$DIR/models/$f" ] || { echo "Falta $DIR/models/$f"; exit 1; }
done

cp "$DIR/oldface-vision.service" /etc/systemd/system/oldface-vision.service
cat > /etc/systemd/system/oldface-vision-restart.path <<EOF
[Unit]
Description=Reinicia oldface-vision al tocar .restart
[Path]
PathChanged=$DIR/.restart
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/oldface-vision-restart.service <<EOF
[Unit]
Description=Reinicio de oldface-vision
[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl restart oldface-vision.service
EOF
sudo -u "$SUB_USER" touch "$DIR/.restart"

systemctl daemon-reload
systemctl enable --now oldface-vision.service oldface-vision-restart.path >/dev/null 2>&1
for i in $(seq 1 90); do curl -sf http://127.0.0.1:8091/health >/dev/null && break; sleep 1; done
echo "oldface-vision: $(systemctl is-active oldface-vision)"
curl -s http://127.0.0.1:8091/health && echo
