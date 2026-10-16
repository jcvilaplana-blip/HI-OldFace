#!/usr/bin/env bash
# OldFace — activa la búsqueda por significado de Willy (oldface-embed: llama.cpp + EmbeddingGemma 300M).
# Ejecutar UNA vez como root:
#   sudo bash /var/www/vhosts/oldface.app/embed-server/setup-vps.sh
# Antes deben estar: llm-server/llama/llama-server (el mismo llama.cpp b11327 del cerebro) y
# embed-server/models/embeddinggemma-300m-qat-Q8_0.gguf (ggml-org/embeddinggemma-300m-qat-q8_0-GGUF,
# SHA-256 6fa0c02a9c302be6f977521d399b4de3a46310a4f2621ee0063747881b673f67).
# Después, para reiniciarlo sin root basta con: touch /var/www/vhosts/oldface.app/embed-server/.restart
# La API lo usa con EMBED_URL=http://127.0.0.1:8090 en backend/.env.
set -euo pipefail
SUB_USER=oldface.app_k1i7f62xmt8
EMBED_DIR=/var/www/vhosts/oldface.app/embed-server
LLAMA=/var/www/vhosts/oldface.app/llm-server/llama/llama-server

[ "$(id -u)" = 0 ] || { echo "Ejecútalo como root (sudo)"; exit 1; }
[ -x "$LLAMA" ] || { echo "Falta $LLAMA"; exit 1; }
[ -f "$EMBED_DIR/models/embeddinggemma-300m-qat-Q8_0.gguf" ] || { echo "Falta el modelo en $EMBED_DIR/models"; exit 1; }

cp "$EMBED_DIR/oldface-embed.service" /etc/systemd/system/oldface-embed.service

# Reinicio sin root: el despliegue hace "touch $EMBED_DIR/.restart"
cat > /etc/systemd/system/oldface-embed-restart.path <<EOF
[Unit]
Description=Reinicia oldface-embed al tocar .restart
[Path]
PathChanged=$EMBED_DIR/.restart
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/oldface-embed-restart.service <<EOF
[Unit]
Description=Reinicio de oldface-embed
[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl restart oldface-embed.service
EOF
sudo -u "$SUB_USER" touch "$EMBED_DIR/.restart"

systemctl daemon-reload
systemctl enable --now oldface-embed.service oldface-embed-restart.path >/dev/null 2>&1
for i in $(seq 1 60); do curl -sf http://127.0.0.1:8090/health >/dev/null && break; sleep 1; done
echo "oldface-embed: $(systemctl is-active oldface-embed)"
curl -s http://127.0.0.1:8090/health && echo
