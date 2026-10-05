# OldFace RTC — Plan de migración de ZEGOCLOUD a WebRTC propio

> ✅ **MIGRACIÓN COMPLETADA (2026-10-05).** OldFace ya no contiene ningún código, SDK, variable ni endpoint de
> ZEGOCLOUD (fase 6): llamadas, videollamadas, directos, karaoke y mensajería en tiempo real funcionan solo con
> el servidor propio (`rtc-server/`) y `src/store/callStore.js`. Este documento se conserva como histórico.

> Objetivo: que llamadas, videollamadas, llamadas de grupo, directos y la mensajería en tiempo real
> funcionen con infraestructura propia en el VPS (212.227.110.244), sin ZEGOCLOUD,
> **manteniendo el diseño actual de OldFace**.

## 1. Situación actual (qué hace ZEGOCLOUD hoy)

| Pieza ZEGOCLOUD | Uso en OldFace | Dónde |
|---|---|---|
| **ZIM** (mensajería) | Entrega en tiempo real de mensajes de chat y señalización de llamadas (`call_invite`, `call_accept`, `call_reject`, `call_cancel`, `call_end`) | `src/store/zegoStore.js`, `CallPage.jsx`, `VideoCallPage.jsx` |
| **UIKit Prebuilt** (media) | Audio/vídeo de llamadas 1:1 y de grupo (`GroupCall`) y directos (`VideoConference`, rol Host/Audience) | `CallPage.jsx`, `VideoCallPage.jsx`, `DirectoLivePage.jsx` |
| Tokens | Generados **en el cliente** con `VITE_ZEGOCLOUD_SERVER_SECRET` (el secreto viaja dentro del APK) | `zegoStore.js` |

Lo que **ya es nuestro** y se conserva: FCM para avisar de llamadas con la app cerrada (`/call-notification`),
historial de llamadas (`/call-log`), persistencia de mensajes (`/messages`), enrutado de audio Android
(auricular/altavoz vía `window.OldFaceAudio` en `MainActivity.java`) y toda la UI propia
(modal de llamada entrante, pantalla de llamada de voz estilo WhatsApp, overlay de llamada saliente).

## 2. Arquitectura objetivo

```
 App OldFace (WebView Capacitor / web)
   │  wss://oldface.app/rtc   (Socket.IO: señalización, presencia, mensajes en vivo)
   │  UDP/TCP 40000-40999     (media WebRTC → SFU)
   │  UDP/TCP 3478, TLS 5349  (STUN/TURN si la red bloquea UDP directo)
   ▼
 nginx (Plesk)  ──/api, /admin──▶  Backend Express actual (Passenger)  ──HTTP interno──┐
        └──────────/rtc/────────▶  oldface-rtc (Node 24, systemd, 127.0.0.1:4000)  ◀───┘
                                     ├─ Socket.IO  (señalización + push de mensajes)
                                     └─ mediasoup  (SFU: 1:1, grupo, directos)
 coturn (systemd)  — STUN/TURN con credenciales temporales (TURN REST API)
```

**Decisiones técnicas**

1. **SFU para todo (mediasoup 3)**, también en 1:1. Un único camino de medios para llamadas, grupos
   (ya existe "añadir participante") y directos; permite añadir gente a una llamada en curso sin renegociar
   una malla P2P. Con 12 núcleos y 24 GB el VPS sobra para cientos de flujos simultáneos.
2. **coturn** como TURN para usuarios detrás de NAT/firewalls estrictos (redes móviles, empresas),
   con credenciales efímeras firmadas (HMAC, caducan en 12 h) emitidas por el servidor.
3. **Servicio separado `oldface-rtc`** gestionado por systemd, fuera de Passenger: mediasoup necesita
   procesos de larga duración y estado en memoria que Passenger podría reiniciar o duplicar.
4. **Socket.IO** sustituye a ZIM: presencia, invitaciones de llamada y entrega instantánea de mensajes.
   El backend actual avisa al servicio RTC por HTTP interno (127.0.0.1 + secreto compartido).
5. **Autenticación**: token firmado (HMAC) emitido al hacer login; el socket se autentica con él.
   Hoy la app confía en el `userId` que envía el cliente; esto lo corrige para todo el tiempo real.
6. **Interruptor de proveedor** (`rtcProvider: 'zego' | 'oldface'` servido por `/api/config`):
   el APK lleva las dos implementaciones durante la transición y podemos volver a ZEGOCLOUD sin publicar
   otro APK si algo falla.
7. **Mismo diseño**: un nuevo `rtcStore` expone **la misma interfaz** que `zegoStore`
   (`incomingCall`, `sendVoiceCall`, `acceptCall`, `callEnded`…), así `App.jsx`, `HomePage`, modales y
   overlays no cambian. En `CallPage`/`VideoCallPage` se sustituyen los mosaicos de ZEGOCLOUD por
   componentes `<video>` propios con el mismo estilo.

## 3. Puertos e infraestructura (requiere root)

| Servicio | Puerto | Protocolo |
|---|---|---|
| Señalización | 443 (nginx → 127.0.0.1:4000) | TCP/WSS |
| mediasoup (WebRTC) | 40000–40999 | UDP + TCP |
| TURN/STUN | 3478 | UDP + TCP |
| TURN sobre TLS | 5349 | TCP |
| TURN relay | 49160–49999 | UDP |

Abrir en: firewall del servidor (ufw/Plesk Firewall) **y** en el firewall del panel de IONOS si está activo.
Certificado TLS: el de Let's Encrypt de `oldface.app` que ya gestiona Plesk.

## 4. Fases

| Fase | Contenido | Criterio de aceptación |
|---|---|---|
| **0. Infraestructura** | coturn, puertos, servicio systemd `oldface-rtc`, proxy nginx `/rtc/`, secretos en `.env` | `wss://oldface.app/rtc` conecta; TURN responde; ICE con candidatos `relay` |
| **1. Servidor RTC** | Socket.IO autenticado, presencia, salas mediasoup (crear/unirse, transports, produce/consume), credenciales TURN, endpoint interno para el backend | Página de prueba: llamada de vídeo entre dos navegadores a través del VPS |
| **2. Señalización y chat** | `rtcStore` con la interfaz de `zegoStore`; invitaciones de llamada y mensajes en vivo por socket; FCM se mantiene | Mensajes instantáneos y llamada entrante/saliente sin ZIM |
| **3. Llamadas 1:1** | Voz (pantalla WhatsApp actual, auricular por defecto, toggle altavoz) y vídeo con UI propia | Llamadas Android↔Android, Android↔web, 4G y WiFi |
| **4. Llamadas de grupo** | "Añadir participante" sobre la misma sala SFU | 4+ participantes estables |
| **5. Directos** | Host produce, audiencia consume (sin límite práctico de espectadores con pipe entre workers); invitar a hablar en el directo (estilo Instagram) | 1 host + 50 espectadores sin cortes |
| **6. Retirada de ZEGOCLOUD** | Quitar SDKs (−5 MB del bundle), variables y claves; revocar el proyecto ZEGOCLOUD | APK sin dependencias de ZEGOCLOUD |
| **7. Karaoke** (posterior) | Sala SFU + pista de música mezclada en cliente; referencia funcional: zego_karaoke_examples | — |

Rollout: fases 2–5 se activan con el interruptor `rtcProvider`, primero para teléfonos de prueba y luego para todos.

## 5. Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| Firewall de IONOS bloquea UDP | Comprobación en fase 0; TURN sobre TCP/TLS 5349 como último recurso |
| Redes móviles con NAT simétrico | TURN con relay UDP y TLS |
| Audio Android (auricular/altavoz) con WebRTC del WebView | Se reutiliza el puente `OldFaceAudio` existente; prueba específica en fase 3 |
| Llamadas con la app cerrada | Sin cambios: FCM (`/call-notification`) ya es propio |
| Directos masivos (>500 espectadores) | Repartir consumidores entre workers (`pipeToRouter`); si crece, HLS para audiencia pasiva |
| Caída del servicio RTC | systemd `Restart=always`, log en journald, interruptor de vuelta a ZEGOCLOUD |

## 6. Seguridad

- Secretos (TURN, interno, firma de tokens) solo en `backend/.env` del servidor; nunca en el APK.
- Credenciales TURN temporales; tokens de socket firmados y con caducidad.
- Al terminar la fase 6, revocar el `SERVER_SECRET` de ZEGOCLOUD (ha estado público en el repo y en el APK).
