#!/usr/bin/env bash
# OldFace — activa la transcripción de audios de Willy (oldface-whisper). Ejecutar UNA vez como root, DESPUÉS de
# build-vps.sh (que compila whisper.cpp y descarga el modelo sin root):
#   sudo bash /var/www/vhosts/oldface.app/whisper-server/setup-vps.sh
# Después, para reiniciarlo sin root basta con: touch /var/www/vhosts/oldface.app/whisper-server/.restart
# La API lo usa con WHISPER_URL=http://127.0.0.1:8092 en backend/.env.
set -euo pipefail
SUB_USER=oldface.app_k1i7f62xmt8
DIR=/var/www/vhosts/oldface.app/whisper-server

[ "$(id -u)" = 0 ] || { echo "Ejecútalo como root (sudo)"; exit 1; }
[ -x "$DIR/bin/whisper-server" ] || { echo "Falta $DIR/bin/whisper-server (ejecuta antes build-vps.sh)"; exit 1; }
[ -f "$DIR/models/ggml-small-q8_0.bin" ] || { echo "Falta el modelo en $DIR/models"; exit 1; }

cp "$DIR/oldface-whisper.service" /etc/systemd/system/oldface-whisper.service
cat > /etc/systemd/system/oldface-whisper-restart.path <<EOF
[Unit]
Description=Reinicia oldface-whisper al tocar .restart
[Path]
PathChanged=$DIR/.restart
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/oldface-whisper-restart.service <<EOF
[Unit]
Description=Reinicio de oldface-whisper
[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl restart oldface-whisper.service
EOF
sudo -u "$SUB_USER" touch "$DIR/.restart"

systemctl daemon-reload
systemctl enable --now oldface-whisper.service oldface-whisper-restart.path >/dev/null 2>&1
for i in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:8092/ && break; sleep 1; done
echo "oldface-whisper: $(systemctl is-active oldface-whisper)"
