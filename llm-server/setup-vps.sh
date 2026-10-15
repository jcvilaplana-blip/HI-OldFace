#!/usr/bin/env bash
# OldFace — activa el cerebro libre de Willy (oldface-llm: llama.cpp + Qwen3 8B). Ejecutar UNA vez como root:
#   sudo bash /var/www/vhosts/oldface.app/llm-server/setup-vps.sh
# Antes deben estar en llm-server/: llama/llama-server (llama.cpp b11327, Linux x64) y models/qwen3-8b-q4km.gguf.
# Después, para reiniciarlo sin root basta con: touch /var/www/vhosts/oldface.app/llm-server/.restart
# La API lo usa con AI_PROVIDER=local y LOCAL_LLM_URL=http://127.0.0.1:8089 en backend/.env.
set -euo pipefail
SUB_USER=oldface.app_k1i7f62xmt8
LLM_DIR=/var/www/vhosts/oldface.app/llm-server

[ "$(id -u)" = 0 ] || { echo "Ejecútalo como root (sudo)"; exit 1; }
[ -x "$LLM_DIR/llama/llama-server" ] || { echo "Falta $LLM_DIR/llama/llama-server"; exit 1; }
[ -f "$LLM_DIR/models/qwen3-8b-q4km.gguf" ] || { echo "Falta el modelo en $LLM_DIR/models"; exit 1; }

cp "$LLM_DIR/oldface-llm.service" /etc/systemd/system/oldface-llm.service

# Reinicio sin root: el despliegue hace "touch $LLM_DIR/.restart"
cat > /etc/systemd/system/oldface-llm-restart.path <<EOF
[Unit]
Description=Reinicia oldface-llm al tocar .restart
[Path]
PathChanged=$LLM_DIR/.restart
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/oldface-llm-restart.service <<EOF
[Unit]
Description=Reinicio de oldface-llm
[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl restart oldface-llm.service
EOF
sudo -u "$SUB_USER" touch "$LLM_DIR/.restart"

systemctl daemon-reload
systemctl enable --now oldface-llm.service oldface-llm-restart.path >/dev/null 2>&1
for i in $(seq 1 60); do curl -sf http://127.0.0.1:8089/health >/dev/null && break; sleep 1; done
echo "oldface-llm: $(systemctl is-active oldface-llm)"
curl -s http://127.0.0.1:8089/health && echo
