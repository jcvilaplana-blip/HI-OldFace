#!/bin/bash
# setup-vps.sh — infraestructura de OldFace Taxi en el VPS (ejecutar como root, idempotente)
#   · servicio systemd oldface-taxi (puerto 4100) + reinicio por fichero para el script de despliegue
#   · proxy nginx /taxi/ → 127.0.0.1:4100 (API, Socket.IO y panel /taxi/admin/)
#   · mapa propio: /maps/tiles/ y /maps/assets/ servidos por nginx desde /srv/maps (rangos + CORS para la app)
#   · OLDFACE_API_URL en httpdocs/backend/.env (avisos push del taxi a través del backend)
#   · paso del taxi en ~/deploy-oldface.sh (compila el panel y copia el servidor)
# Requisito previo: mapas en /srv/maps (Valhalla :8002, Photon :2322, tiles/world.pmtiles, assets/)
set -euo pipefail

DOMAIN=oldface.app
SUB_USER=oldface.app_k1i7f62xmt8
BASE=/var/www/vhosts/$DOMAIN
ENV_FILE=$BASE/httpdocs/backend/.env
TAXI_DIR=$BASE/taxi-server
NODE=/opt/plesk/node/24/bin/node
CONF_DIR=/var/www/vhosts/system/$DOMAIN/conf
DEPLOY=$(getent passwd "$SUB_USER" | cut -d: -f6)/deploy-oldface.sh
TS=$(date +%Y%m%d%H%M%S)

echo "== 1. Variables en $ENV_FILE"
cp -a "$ENV_FILE" "$ENV_FILE.bak.$TS"
add_env() { grep -q "^$1=" "$ENV_FILE" || { echo "$1=$2" >> "$ENV_FILE"; echo "  + $1"; }; }
add_env OLDFACE_API_URL "https://$DOMAIN/api"
add_env TAXI_PORT 4100
chown "$SUB_USER":psacln "$ENV_FILE"; chmod 600 "$ENV_FILE"

echo "== 2. Servicio systemd oldface-taxi"
install -d -o "$SUB_USER" -g psacln "$TAXI_DIR" "$TAXI_DIR/data"
cat > /etc/systemd/system/oldface-taxi.service <<EOF
[Unit]
Description=OldFace Taxi (API + Socket.IO + panel)
After=network-online.target oldface-valhalla.service oldface-photon.service
Wants=network-online.target

[Service]
User=$SUB_USER
Group=psacln
WorkingDirectory=$TAXI_DIR
Environment=NODE_ENV=production
Environment=ENV_FILE=$ENV_FILE
ExecStart=$NODE $TAXI_DIR/server.js
Restart=always
RestartSec=2
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF
# Reinicio sin root: el despliegue hace "touch $TAXI_DIR/.restart"
cat > /etc/systemd/system/oldface-taxi-restart.path <<EOF
[Unit]
Description=Reinicia oldface-taxi al tocar .restart
[Path]
PathChanged=$TAXI_DIR/.restart
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/oldface-taxi-restart.service <<EOF
[Unit]
Description=Reinicio de oldface-taxi
[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl restart oldface-taxi.service
EOF
systemctl daemon-reload
systemctl enable oldface-taxi.service oldface-taxi-restart.path >/dev/null 2>&1
systemctl restart oldface-taxi-restart.path

echo "== 3. nginx: /taxi/ y /maps/"
VHOST_NGINX=$CONF_DIR/vhost_nginx.conf
[ -f "$VHOST_NGINX" ] && cp -a "$VHOST_NGINX" "$VHOST_NGINX.bak.$TS"
if ! grep -q "oldface-taxi" "$VHOST_NGINX" 2>/dev/null; then
cat >> "$VHOST_NGINX" <<'EOF'
# oldface-taxi — API, tiempo real (Socket.IO) y panel /taxi/admin/
location ^~ /taxi/ {
    proxy_pass http://127.0.0.1:4100;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    client_max_body_size 15m;
}
# oldface-maps — mapa propio (PMTiles por rangos, fuentes e iconos) con CORS para la app móvil
location ^~ /maps/tiles/ {
    alias /srv/maps/tiles/;
    add_header Access-Control-Allow-Origin "*" always;
    add_header Access-Control-Allow-Headers "Range, If-Match" always;
    add_header Access-Control-Expose-Headers "Content-Length, Content-Range, ETag" always;
    add_header Cache-Control "public, max-age=86400" always;
    if ($request_method = OPTIONS) { return 204; }
}
location ^~ /maps/assets/ {
    alias /srv/maps/assets/;
    add_header Access-Control-Allow-Origin "*" always;
    add_header Cache-Control "public, max-age=604800" always;
}
EOF
fi
/usr/local/psa/admin/sbin/httpdmng --reconfigure-domain "$DOMAIN" >/dev/null
grep -q vhost_nginx.conf "$CONF_DIR/nginx.conf" && echo "  incluido en nginx.conf" || echo "  AVISO: vhost_nginx.conf NO incluido"
nginx -t 2>&1 | tail -1
systemctl reload nginx

echo "== 4. Paso del taxi en $DEPLOY"
cp -a "$DEPLOY" "$DEPLOY.bak.$TS"
if ! grep -q "taxi-server" "$DEPLOY"; then
python3 - "$DEPLOY" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
block = r'''# Servidor del taxi (servicio systemd oldface-taxi, ver taxi-server/setup-vps.sh) + panel /taxi/admin/
if [ -d "$REPO/taxi-server" ]; then
  TAXI=$BASE/taxi-server
  (cd "$REPO/taxi-admin" && npm ci --no-audit --no-fund && npm run build)      # → taxi-server/public/admin
  mkdir -p "$TAXI"
  tar -C "$REPO/taxi-server" --exclude=node_modules --exclude=data --exclude=test -cf - . | tar -C "$TAXI" -xf -
  (cd "$TAXI" && npm ci --omit=dev --no-audit --no-fund)
  touch "$TAXI/.restart"
fi
'''
marker = '# Reinicio de la app Node (Phusion Passenger)'
s = s.replace(marker, block + marker, 1) if marker in s else s.replace('echo "Deploy OK', block + 'echo "Deploy OK', 1)
open(p, 'w').write(s)
PY
chown "$SUB_USER":psacln "$DEPLOY"
echo "  + paso del taxi añadido"
fi

echo "== OK (el código llega con el siguiente despliegue: python deploy-vps.py)"
