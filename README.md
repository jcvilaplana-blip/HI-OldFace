# OldFace

Mensajería, llamadas, videollamadas, directos, encuestas y karaoke — **todo con servidores propios**, sin servicios de terceros de pago.

- **Producción:** https://oldface.app (VPS Ubuntu + Plesk, Node.js con Phusion Passenger)
- **App:** React + Vite + Capacitor (Android); colores de marca `#000080` (azul marino) y rojo para "en directo"
- **Tiempo real:** servidor RTC propio — Socket.IO (señalización) + mediasoup (SFU) + coturn (TURN)

---

## Estructura

```
oldface-app/
├── frontend/                 ← App React + Vite + Capacitor
│   ├── src/
│   │   ├── pages/            ← Login, Home, Chat, Call, VideoCall, Directo, Poll, Karaoke…
│   │   ├── components/       ← Avatar, ChatList, PopupMenu, LyricsView…
│   │   ├── store/            ← Zustand: authStore, chatStore, callStore (llamadas + tiempo real)
│   │   └── utils/            ← rtcClient (Socket.IO), rtcCall (mediasoup-client),
│   │                           karaokeEngine / karaokeScore / lrc, deepLinks
│   ├── backend/              ← API Express (server.js) + panel /admin (admin.html)
│   └── android/              ← Proyecto Android (NO está en git: se genera con Capacitor)
├── rtc-server/               ← Servidor RTC propio (Socket.IO + mediasoup), servicio systemd
├── docs/webrtc/PLAN.md       ← Plan de la migración a WebRTC propio (completada)
└── nginx.conf                ← Referencia de configuración nginx
```

## Arquitectura en producción

| Componente | Dónde | Notas |
|---|---|---|
| Web (SPA) | `~/httpdocs/frontend/dist/` | servida por Express (fallback a `index.html`) |
| API | `~/httpdocs/backend/server.js` | rutas bajo `/api/…`; datos JSON en `backend/data/`, archivos en `backend/uploads/` |
| Panel admin | `https://oldface.app/admin` | credenciales en `.env` (`ADMIN_EMAIL`, `ADMIN_PASSWORD`) |
| Servidor RTC | `/var/www/vhosts/oldface.app/rtc-server` | servicio `oldface-rtc`, puerto 4000, proxy nginx `/rtc/`; reinicio: `touch rtc-server/.restart` |
| TURN | coturn | 3478 UDP/TCP, 5349 TLS, relay 49160-49999 UDP |
| Media (mediasoup) | 4 workers | UDP/TCP 40000-40003 |
| App Links | `/.well-known/assetlinks.json` | los enlaces `https://oldface.app/directo/…` abren la app |

## Variables de entorno

`frontend/backend/.env` (ver `frontend/backend/.env.example`): `RTC_SECRET`, `TURN_SECRET`, `RTC_INTERNAL_URL`,
`ADMIN_EMAIL`, `ADMIN_PASSWORD`, SMTP para los códigos OTP por email y, opcional, `ANDROID_CERT_SHA256`.
El servidor RTC lee el mismo `.env` (`ENV_FILE`). **Nunca** se suben a git.

`frontend/.env.production`: `VITE_BACKEND_URL=https://oldface.app/api` (lo genera el script de despliegue).

## Desarrollo local

```bash
cd frontend/backend && npm install && node server.js          # API en :3001
cd rtc-server && npm install && node server.js                 # RTC en :4000 (necesita el .env)
cd frontend && npm install --legacy-peer-deps && npm run dev   # App en :5173 (VITE_RTC_URL=http://localhost:4000)
```

## Despliegue

Se despliega **desde el PC** con `python deploy-vps.py` (en la carpeta superior, fuera del repo porque contiene
credenciales): empaqueta la rama `master` en un git bundle, lo sube por SFTP y ejecuta `~/deploy-oldface.sh` en el VPS
(build del frontend, copia de backend y rtc-server, `npm ci` y reinicio). Solo despliega lo que esté commiteado.

Comprobación rápida: `https://oldface.app/api/health` y `https://oldface.app/rtc/health`.

## APK Android

```bash
cd frontend
npm run build
npx cap sync android
npx cap open android      # Android Studio → Build → Build APK(s)
```

El código nativo propio está en `android/app/src/main/java/com/oldface/app/MainActivity.java`: puente JS
`window.OldFaceAudio` para el audio (auricular/altavoz en llamadas, modo multimedia en karaoke y directos,
detección de auriculares) y en `AndroidManifest.xml` el intent-filter de App Links.

## Karaoke

- Catálogo gestionado en `/admin → Karaoke`: pista instrumental + letra LRC (`[mm:ss.xx] verso`).
  En dúos, cada verso puede empezar por `A:`, `B:` o `AB:`; sin marcas se alternan.
- Cantar solo o a dúo (se graba la parte A y otros se unen después), cámara de fondo, reverb de estudio,
  tono (±6 semitonos sin cambiar la velocidad), velocidad y puntuación por frase (ritmo + afinación).
- Salas en directo por turnos con el servidor RTC propio.
