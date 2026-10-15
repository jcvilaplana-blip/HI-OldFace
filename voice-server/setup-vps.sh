#!/usr/bin/env bash
# OldFace — activa el servicio de voz de Willy (oldface-voice). Ejecutar UNA vez como root:
#   sudo bash /var/www/vhosts/oldface.app/voice-server/setup-vps.sh
# Antes, el despliegue ya ha dejado en voice-server/ el código, el venv (piper-tts) y el modelo.
# Después, para reiniciarlo sin root basta con: touch /var/www/vhosts/oldface.app/voice-server/.restart
set -euo pipefail
SUB_USER=oldface.app_k1i7f62xmt8
VOICE_DIR=/var/www/vhosts/oldface.app/voice-server

[ "$(id -u)" = 0 ] || { echo "Ejecútalo como root (sudo)"; exit 1; }
[ -x "$VOICE_DIR/venv/bin/python" ] || { echo "Falta $VOICE_DIR/venv: despliega primero"; exit 1; }
[ -f "$VOICE_DIR/models/es_ES-davefx-medium.onnx" ] || { echo "Falta el modelo de voz: despliega primero"; exit 1; }

cp "$VOICE_DIR/oldface-voice.service" /etc/systemd/system/oldface-voice.service

# Reinicio sin root: el despliegue hace "touch $VOICE_DIR/.restart"
cat > /etc/systemd/system/oldface-voice-restart.path <<EOF
[Unit]
Description=Reinicia oldface-voice al tocar .restart
[Path]
PathChanged=$VOICE_DIR/.restart
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/oldface-voice-restart.service <<EOF
[Unit]
Description=Reinicio de oldface-voice
[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl restart oldface-voice.service
EOF
sudo -u "$SUB_USER" touch "$VOICE_DIR/.restart"

systemctl daemon-reload
systemctl enable --now oldface-voice.service oldface-voice-restart.path >/dev/null 2>&1
sleep 4
echo "oldface-voice: $(systemctl is-active oldface-voice)"
curl -s http://127.0.0.1:5010/health && echo
