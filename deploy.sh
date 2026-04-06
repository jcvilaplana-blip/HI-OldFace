#!/bin/bash
# ══════════════════════════════════════════════════════════════════
# deploy.sh — Script de despliegue OldFace en VPS Ubuntu 24 + Plesk
# Uso: chmod +x deploy.sh && ./deploy.sh
# ══════════════════════════════════════════════════════════════════

set -e  # Parar si hay error

# ── Variables ── CAMBIAR ESTAS ANTES DE EJECUTAR ─────────────────
VPS_USER="root"
VPS_HOST="212.227.80.115"
VPS_DIR="/var/www/oldface"
DOMAIN="oldface.fullstark.es"
# ─────────────────────────────────────────────────────────────────

echo "🚀 Desplegando OldFace en $VPS_HOST..."

# 1. Build del frontend
echo "📦 Compilando frontend..."
cd frontend
npm install
npm run build
cd ..

# 2. Crear directorios en el VPS
echo "📤 Subiendo archivos..."
ssh $VPS_USER@$VPS_HOST "mkdir -p $VPS_DIR/frontend/dist $VPS_DIR/backend /var/log/oldface"

# Frontend: comprimir, subir y descomprimir (evita rsync, compatible con Windows)
echo "   → Subiendo frontend/dist..."
tar -czf /tmp/oldface-dist.tar.gz -C frontend/dist .
scp /tmp/oldface-dist.tar.gz $VPS_USER@$VPS_HOST:/tmp/
ssh $VPS_USER@$VPS_HOST "rm -rf $VPS_DIR/frontend/dist/* && tar -xzf /tmp/oldface-dist.tar.gz -C $VPS_DIR/frontend/dist/ && rm /tmp/oldface-dist.tar.gz"
rm /tmp/oldface-dist.tar.gz 2>/dev/null || true

# Archivos públicos (logo, etc.)
if [ -d "frontend/public" ]; then
  echo "   → Subiendo frontend/public..."
  tar -czf /tmp/oldface-public.tar.gz -C frontend/public .
  scp /tmp/oldface-public.tar.gz $VPS_USER@$VPS_HOST:/tmp/
  ssh $VPS_USER@$VPS_HOST "tar -xzf /tmp/oldface-public.tar.gz -C $VPS_DIR/frontend/dist/ && rm /tmp/oldface-public.tar.gz"
  rm /tmp/oldface-public.tar.gz 2>/dev/null || true
fi

# Backend: excluir node_modules y .env
echo "   → Subiendo backend..."
tar -czf /tmp/oldface-backend.tar.gz -C frontend/backend --exclude='node_modules' --exclude='.env' .
scp /tmp/oldface-backend.tar.gz $VPS_USER@$VPS_HOST:/tmp/
ssh $VPS_USER@$VPS_HOST "tar -xzf /tmp/oldface-backend.tar.gz -C $VPS_DIR/backend/ && rm /tmp/oldface-backend.tar.gz"
rm /tmp/oldface-backend.tar.gz 2>/dev/null || true

# 3. Instalar dependencias backend en VPS
echo "📦 Instalando dependencias backend..."
ssh $VPS_USER@$VPS_HOST "cd $VPS_DIR/backend && npm install --production"

# 4. Reiniciar backend con PM2
echo "🔄 Reiniciando backend..."
ssh $VPS_USER@$VPS_HOST "pm2 restart oldface-backend --update-env && pm2 save"

# 5. Verificar Nginx
echo "🌐 Verificando Nginx..."
ssh $VPS_USER@$VPS_HOST "nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true"

echo ""
echo "✅ ¡Despliegue completado!"
echo "🌍 App disponible en: https://$DOMAIN"
echo "🔧 Backend en: https://$DOMAIN/api/health"
