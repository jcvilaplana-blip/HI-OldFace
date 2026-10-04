#!/bin/bash
# setup-vps.sh — Fase 0: infraestructura OldFace RTC en el VPS (ejecutar como root, idempotente)
#   · coturn (STUN/TURN) con credenciales temporales y TLS de Let's Encrypt (Plesk)
#   · servicio systemd oldface-rtc (+ reinicio por fichero para el script de despliegue)
#   · proxy nginx /rtc/ → 127.0.0.1:4000 (WebSocket)
#   · secretos en httpdocs/backend/.env (compartidos backend ↔ rtc-server)
set -euo pipefail

DOMAIN=oldface.app
PUBLIC_IP=212.227.110.244
SUB_USER=oldface.app_k1i7f62xmt8
BASE=/var/www/vhosts/$DOMAIN
ENV_FILE=$BASE/httpdocs/backend/.env
RTC_DIR=$BASE/rtc-server
NODE=/opt/plesk/node/24/bin/node
CONF_DIR=/var/www/vhosts/system/$DOMAIN/conf
TS=$(date +%Y%m%d%H%M%S)

echo "== 1. Paquetes"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq coturn build-essential python3-pip >/dev/null
echo "coturn instalado: $(dpkg-query -W -f='${Version}' coturn)"

echo "== 2. Secretos en $ENV_FILE"
cp -a "$ENV_FILE" "$ENV_FILE.bak.$TS"
add_env() { grep -q "^$1=" "$ENV_FILE" || { echo "$1=$2" >> "$ENV_FILE"; echo "  + $1"; }; }
add_env RTC_SECRET "$(openssl rand -hex 32)"
add_env TURN_SECRET "$(openssl rand -hex 32)"
add_env RTC_PUBLIC_IP "$PUBLIC_IP"
add_env RTC_PORT 4000
add_env RTC_BASE_PORT 40000
add_env RTC_WORKERS 4
add_env TURN_HOST "$DOMAIN"
add_env RTC_ALLOW_GUESTS 1
add_env RTC_INTERNAL_URL "http://127.0.0.1:4000"
chown "$SUB_USER":psacln "$ENV_FILE"; chmod 600 "$ENV_FILE"
TURN_SECRET=$(grep '^TURN_SECRET=' "$ENV_FILE" | cut -d= -f2-)

echo "== 3. Certificado TLS para coturn"
cat > /usr/local/bin/oldface-turn-cert.sh <<EOF
#!/bin/bash
# Copia el certificado Let's Encrypt de Plesk para coturn (se ejecuta semanalmente)
SRC=\$(grep -m1 -oP 'ssl_certificate\s+"\K[^"]+' $CONF_DIR/nginx.conf)
install -d -o turnserver -g turnserver -m 750 /etc/coturn
awk '/BEGIN CERTIFICATE/,/END CERTIFICATE/' "\$SRC" > /etc/coturn/cert.pem   # cadena completa
openssl pkey -in "\$SRC" -out /etc/coturn/key.pem
chown turnserver:turnserver /etc/coturn/cert.pem /etc/coturn/key.pem
chmod 640 /etc/coturn/cert.pem /etc/coturn/key.pem
systemctl try-restart coturn
EOF
chmod 750 /usr/local/bin/oldface-turn-cert.sh
echo "17 4 * * 1 root /usr/local/bin/oldface-turn-cert.sh" > /etc/cron.d/oldface-turn-cert

echo "== 4. Configuración coturn"
[ -f /etc/turnserver.conf ] && cp -a /etc/turnserver.conf "/etc/turnserver.conf.bak.$TS"
cat > /etc/turnserver.conf <<EOF
# OldFace TURN — generado por rtc-server/setup-vps.sh
listening-port=3478
tls-listening-port=5349
listening-ip=$PUBLIC_IP
relay-ip=$PUBLIC_IP
external-ip=$PUBLIC_IP
min-port=49160
max-port=49999
realm=$DOMAIN
server-name=$DOMAIN
use-auth-secret
static-auth-secret=$TURN_SECRET
cert=/etc/coturn/cert.pem
pkey=/etc/coturn/key.pem
no-tlsv1
no-tlsv1_1
fingerprint
no-multicast-peers
no-cli
total-quota=1200
user-quota=12
stale-nonce=600
# Evita usar el TURN para llegar a la red interna / localhost
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=::1
syslog
EOF
chmod 640 /etc/turnserver.conf; chown root:turnserver /etc/turnserver.conf
[ -f /etc/default/coturn ] && sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
/usr/local/bin/oldface-turn-cert.sh
systemctl enable coturn >/dev/null 2>&1
systemctl restart coturn
sleep 1; echo "coturn: $(systemctl is-active coturn)"

echo "== 5. Servicio systemd oldface-rtc"
install -d -o "$SUB_USER" -g psacln "$RTC_DIR"
cat > /etc/systemd/system/oldface-rtc.service <<EOF
[Unit]
Description=OldFace RTC (Socket.IO + mediasoup)
After=network-online.target
Wants=network-online.target

[Service]
User=$SUB_USER
Group=psacln
WorkingDirectory=$RTC_DIR
Environment=NODE_ENV=production
Environment=ENV_FILE=$ENV_FILE
ExecStart=$NODE $RTC_DIR/server.js
Restart=always
RestartSec=2
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF
# Reinicio sin root: el despliegue hace "touch $RTC_DIR/.restart"
cat > /etc/systemd/system/oldface-rtc-restart.path <<EOF
[Unit]
Description=Reinicia oldface-rtc al tocar .restart
[Path]
PathChanged=$RTC_DIR/.restart
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/oldface-rtc-restart.service <<EOF
[Unit]
Description=Reinicio de oldface-rtc
[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl restart oldface-rtc.service
EOF
sudo -u "$SUB_USER" touch "$RTC_DIR/.restart"
systemctl daemon-reload
systemctl enable oldface-rtc.service oldface-rtc-restart.path >/dev/null 2>&1
systemctl restart oldface-rtc-restart.path

echo "== 6. Proxy nginx /rtc/"
VHOST_NGINX=$CONF_DIR/vhost_nginx.conf
[ -f "$VHOST_NGINX" ] && cp -a "$VHOST_NGINX" "$VHOST_NGINX.bak.$TS"
if ! grep -q "oldface-rtc" "$VHOST_NGINX" 2>/dev/null; then
cat >> "$VHOST_NGINX" <<'EOF'
# oldface-rtc — señalización WebSocket y página de prueba
location ^~ /rtc/internal/ { deny all; }
location ^~ /rtc/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
EOF
fi
/usr/local/psa/admin/sbin/httpdmng --reconfigure-domain "$DOMAIN" >/dev/null
grep -q vhost_nginx.conf "$CONF_DIR/nginx.conf" && echo "  incluido en nginx.conf" || echo "  AVISO: vhost_nginx.conf NO incluido"
nginx -t 2>&1 | tail -1
systemctl reload nginx

echo "== OK"
