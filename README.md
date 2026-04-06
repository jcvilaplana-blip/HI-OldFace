# 📱 OldFace — Guía Completa de Instalación y Despliegue

**Stack:** React + Vite + Capacitor + ZEGOCLOUD + Node.js  
**Color principal:** `#77BD94`  
**Plataformas:** Web, Android, iOS  
**Servidor:** Ubuntu 24 + Plesk + Nginx

---

## 📁 Estructura del Proyecto

```
oldface-app/
├── frontend/              ← React + Vite + Capacitor
│   ├── src/
│   │   ├── pages/         ← Login, Home, Chat, Call, Video, Contacts, Settings
│   │   ├── components/    ← Avatar, ChatList, PopupMenu, BottomNav
│   │   ├── store/         ← Zustand (auth, chats)
│   │   └── hooks/         ← useZego, useContacts, useGeolocation
│   ├── public/
│   │   └── logo-oldface.png
│   ├── capacitor.config.ts
│   ├── vite.config.js
│   └── package.json
├── backend/               ← Node.js token server ZEGOCLOUD
│   ├── server.js
│   ├── .env
│   └── package.json
├── ecosystem.config.js    ← PM2 para producción
├── nginx.conf             ← Nginx para Plesk/VPS
├── deploy.sh              ← Script de despliegue automático
├── install-vps.sh         ← Setup inicial del VPS
└── README.md
```

---

## 🖥️ PARTE 1 — PREPARAR EL VPS (primera vez)

### Requisitos del VPS
- Ubuntu 24.04 LTS
- Plesk instalado
- Dominio apuntando al VPS (DNS configurado)
- Acceso root via SSH

### 1.1 Subir y ejecutar el script de instalación

```bash
# Desde tu máquina local, sube el script al VPS:
scp install-vps.sh root@TU_VPS_IP:/tmp/

# Conéctate al VPS y ejecútalo:
ssh root@TU_VPS_IP
bash /tmp/install-vps.sh
```

Este script instala: Node.js 20, PM2, Nginx config, UFW firewall, certbot.

### 1.2 Configurar variables de entorno en el VPS

Editar el backend `.env`:
```bash
nano /var/www/oldface/backend/.env
```
```env
ZEGOCLOUD_APP_ID=377576855
ZEGOCLOUD_SERVER_SECRET=86c4874a72ff45007da20a0b913ac0b2
NODE_ENV=production
PORT=3001
FRONTEND_URL=https://TUDOMINIO.COM    ← cambiar
```

Editar el frontend `.env.production`:
```bash
nano /var/www/oldface/frontend/.env.production
```
```env
VITE_ZEGOCLOUD_APP_ID=377576855
VITE_BACKEND_URL=https://TUDOMINIO.COM/api    ← cambiar
VITE_POLL_URL=https://poll.fullstark.es
```

---

## 🌐 PARTE 2 — CONFIGURAR NGINX EN PLESK

### Opción A: Vía Panel Plesk (recomendado)

1. Entra a Plesk → **Dominios** → tu dominio → **Apache & Nginx Settings**
2. En la sección **"Additional nginx directives"** pega este contenido:

```nginx
# OldFace SPA — todas las rutas van a index.html
location / {
    try_files $uri $uri/ /index.html;
}

# Proxy al backend Node.js
location /api/ {
    proxy_pass         http://127.0.0.1:3001/;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade $http_upgrade;
    proxy_set_header   Connection 'upgrade';
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
    proxy_read_timeout 60s;
}

# Cache assets estáticos
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

3. En **Document Root** poner: `/var/www/oldface/frontend/dist`
4. Guardar y aplicar

### Opción B: Fichero nginx.conf directo

```bash
# En el VPS:
cp /tmp/nginx-oldface.conf /etc/nginx/conf.d/oldface.conf
nginx -t && systemctl reload nginx
```

### 2.1 Activar SSL (HTTPS) en Plesk

1. Plesk → Dominio → **SSL/TLS Certificates**
2. Instalar **Let's Encrypt** (gratis, se renueva automático)
3. Marcar "Redirect from HTTP to HTTPS"

---

## 🚀 PARTE 3 — DESPLIEGUE (cada actualización)

### 3.1 Configurar deploy.sh en tu máquina local

Editar `deploy.sh` con tus datos:
```bash
VPS_USER="root"
VPS_HOST="TU_VPS_IP_O_DOMINIO"
VPS_DIR="/var/www/oldface"
DOMAIN="TUDOMINIO.COM"
```

### 3.2 Ejecutar despliegue

```bash
# Primera vez — dar permisos al script:
chmod +x deploy.sh

# Desplegar:
./deploy.sh
```

El script automáticamente:
1. Compila el frontend (`npm run build`)
2. Sube los archivos via rsync
3. Instala dependencias del backend
4. Reinicia el servidor con PM2
5. Recarga Nginx

### 3.3 Verificar que funciona

```bash
# Health check del backend:
curl https://TUDOMINIO.COM/api/health

# Respuesta esperada:
# {"status":"ok","service":"OldFace API","ts":"..."}
```

---

## 🤖 PARTE 4 — COMPILAR ANDROID

### Requisitos
- Android Studio instalado (en tu máquina local)
- JDK 17+
- Android SDK

### 4.1 Preparar

```bash
cd frontend

# Instalar dependencias
npm install

# Añadir plataforma Android (solo primera vez)
npx cap add android
```

### 4.2 Actualizar la URL del backend para producción

Antes de compilar para producción, asegúrate de que `.env.production` existe con:
```
VITE_BACKEND_URL=https://TUDOMINIO.COM/api
```

### 4.3 Build y sync

```bash
# Build del frontend con config de producción
npm run build

# Sincronizar con Android
npx cap sync android
```

### 4.4 Añadir permisos en AndroidManifest.xml

Abrir: `android/app/src/main/AndroidManifest.xml`

Dentro de `<manifest>` (antes de `<application>`):
```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.READ_CONTACTS" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-feature android:name="android.hardware.camera" android:required="false" />
<uses-feature android:name="android.hardware.microphone" android:required="false" />
```

### 4.5 Abrir en Android Studio y compilar

```bash
npx cap open android
```

En Android Studio:
- **Modo debug:** Conectar dispositivo → Run ▶
- **APK release:** Build → Generate Signed Bundle/APK → APK

### 4.6 Instalar APK en dispositivo

```bash
adb install -r app-release.apk
```

---

## 🍎 PARTE 5 — COMPILAR iOS

### Requisitos
- Mac con Xcode 15+
- CocoaPods: `sudo gem install cocoapods`
- Apple Developer Account (para dispositivo real)

### 5.1 Preparar

```bash
cd frontend
npm install
npx cap add ios      # Solo primera vez
npm run build
npx cap sync ios
```

### 5.2 Añadir permisos en Info.plist

Abrir: `ios/App/App/Info.plist`

Añadir antes de `</dict>`:
```xml
<key>NSCameraUsageDescription</key>
<string>OldFace necesita la cámara para videollamadas</string>
<key>NSMicrophoneUsageDescription</key>
<string>OldFace necesita el micrófono para llamadas de voz</string>
<key>NSContactsUsageDescription</key>
<string>OldFace necesita los contactos para comunicarte con ellos</string>
<key>NSLocationWhenInUseUsageDescription</key>
<string>OldFace puede compartir tu ubicación en los chats</string>
```

### 5.3 Abrir en Xcode

```bash
npx cap open ios
```

- Seleccionar tu equipo de desarrollo
- Conectar dispositivo o usar simulador
- Build → Run ▶

---

## 🔄 PARTE 6 — FLUJO DE ACTUALIZACIÓN

### Actualizar web (más rápido)

```bash
cd frontend
npm run build
./deploy.sh     # Desde raíz del proyecto
```

### Actualizar Android

```bash
cd frontend
npm run build
npx cap sync android
# Abrir Android Studio y compilar de nuevo
```

### Monitorear el backend en producción

```bash
ssh root@TU_VPS
pm2 status                    # Estado del proceso
pm2 logs oldface-backend      # Ver logs en tiempo real
pm2 restart oldface-backend   # Reiniciar manualmente
```

---

## 🔌 ZEGOCLOUD — Cómo funcionan las llamadas reales

### Flujo de autenticación

```
App (usuario) ──POST /api/generate-token──► Backend Node.js
                                                  │
                                    Genera token con serverSecret
                                                  │
App ◄──────────── { token, appId } ───────────────┘
      │
      ├── ZegoUIKitPrebuilt.create(token)
      ├── joinRoom(roomId, config)
      └── Llamada de voz/video en tiempo real ◄──► ZEGOCLOUD Servers
```

### SDK instalado en el frontend

```bash
cd frontend
npm install @zegocloud/zego-uikit-prebuilt
```

La config exacta usada (1 a 1):
```javascript
{
  turnOnMicrophoneWhenJoining: true,
  turnOnCameraWhenJoining: true,
  showMyCameraToggleButton: true,
  showMyMicrophoneToggleButton: true,
  showAudioVideoSettingsButton: true,
  showScreenSharingButton: false,
  showTextChat: false,
  showUserList: false,
  maxUsers: 2,
  layout: "Auto",
  scenario: {
    mode: "OneONoneCall",
    config: { role: "Host" }
  }
}
```

---

## ⚙️ PARTE 7 — DESARROLLO LOCAL

### Iniciar backend local

```bash
cd backend
npm install
npm run dev        # Puerto 3001
```

### Iniciar frontend local

```bash
cd frontend
npm install
npm run dev        # Puerto 5173
```

### Acceder

- App web: `http://localhost:5173`
- Backend: `http://localhost:3001/health`

---

## 🐛 Solución de Problemas

| Problema | Solución |
|---|---|
| Backend no responde | `pm2 status` en el VPS; verificar `.env` |
| CORS error | Verificar `FRONTEND_URL` en `.env` del backend |
| Token inválido ZEGOCLOUD | Confirmar `ZEGOCLOUD_APP_ID` y `ZEGOCLOUD_SERVER_SECRET` |
| Cámara no funciona Android | Verificar permisos en AndroidManifest.xml |
| Build de Android falla | `cd android && ./gradlew clean` |
| 502 Bad Gateway Nginx | El backend no está corriendo: `pm2 restart oldface-backend` |
| SSL no funciona | Verificar Let's Encrypt en Plesk o `certbot renew` |

---

## 📦 Dependencias Clave

| Paquete | Versión | Uso |
|---|---|---|
| `@zegocloud/zego-uikit-prebuilt` | latest | UI llamadas/video |
| `zego-express-engine-webrtc` | ^3 | WebRTC Engine |
| `@capacitor/core` | ^6 | Bridge nativo |
| `@capacitor/geolocation` | ^6 | GPS |
| `@capacitor/contacts` | ^6 | Contactos |
| `@capacitor/browser` | ^6 | InAppBrowser (POLL) |
| `zustand` | ^4 | Estado global |
| `react-router-dom` | ^6 | Navegación |
| `tailwindcss` | ^3 | Estilos |
| `express` | ^4 | Backend API |

---

## 🔐 Seguridad

- ✅ `ZEGOCLOUD_SERVER_SECRET` **NUNCA** en el frontend
- ✅ Solo en `backend/.env` — no subir a Git (añadir `.env` a `.gitignore`)
- ✅ Rate limiting en el backend (60 req/min por IP)
- ✅ CORS configurado solo para el dominio de producción
- ✅ Puerto 3001 bloqueado externamente (solo acceso via Nginx proxy)
- ✅ HTTPS obligatorio en producción

---

**OldFace v1.0.0** | Color `#77BD94` | React + ZEGOCLOUD + Capacitor
