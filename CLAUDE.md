# CLAUDE.md — OldFace

Guía para trabajar en este repositorio. Detalle de despliegue y variables de entorno: [README.md](README.md).

## Qué es OldFace

Mensajería con chats 1 a 1 y de grupo, llamadas y videollamadas, estados, directos con grabación, encuestas,
karaoke y taxi, **con servidores propios** (sin servicios de terceros de pago). Producción: https://oldface.app
(VPS Ubuntu + Plesk, Node.js con Passenger). App Android con Capacitor.

Objetivo en curso: **OldFace AI**, un agente ("Willy") que entiende instrucciones en lenguaje natural, busca en
los datos del propio usuario y propone acciones que el usuario confirma.

## Arquitectura verificada

| Carpeta | Qué es | Tecnología | Datos |
|---|---|---|---|
| `frontend/` | App | React 18, Vite 5, Zustand, Tailwind, react-router 6, Capacitor 7 | Sesión en `localStorage` (`oldface-auth`) |
| `frontend/backend/` | API principal + panel `/admin` (`admin.html`) | Node, Express 4, firebase-admin (push), nodemailer (OTP) | **JSON** en `data/` cargados en `Map` en memoria; `saveX()` reescribe el archivo entero. Archivos en `uploads/` |
| `rtc-server/` | Tiempo real: señalización, SFU, grabación de directos | Socket.IO, mediasoup, ffmpeg-static (+ coturn en el VPS) | En memoria |
| `taxi-server/` | API del taxi | Express, Socket.IO, `node:sqlite` | `data/taxi.db` |
| `taxi-admin/` | Panel del taxi | React + Vite | — |
| `llm-server/` | Cerebro libre de Willy (`oldface-llm`, solo 127.0.0.1:8089; la API lo usa con `AI_PROVIDER=local`) | llama.cpp b11327 + Qwen3 8B (6 núcleos, prioridad baja) | Sin datos; binario y modelo solo en el VPS |
| `voice-server/` | Voz de Willy (`oldface-voice`, solo 127.0.0.1:5010; la API lo usa en `POST /ai/speak`) | Python 3.12, Piper (`es_ES-davefx-medium`) | Sin datos; modelo y venv solo en el VPS |
| `embed-server/` | Búsqueda por significado de Willy (`oldface-embed`, solo 127.0.0.1:8090; la API lo usa con `EMBED_URL`) | llama.cpp de `llm-server/` + EmbeddingGemma 300M (2 núcleos) | Sin datos; modelo solo en el VPS |
| `docs/` | Planes de WebRTC y taxi | — | — |

- No hay base de datos en la API principal ni ningún proveedor de IA todavía.
- `frontend/android/` y `frontend/ios/` **no están en git**: los cambios nativos solo viajan en el APK.
- Sesión: código OTP por email → token `<userId>.<exp>.<hmac>` firmado con `RTC_SECRET` (30 días).
  Comprobación: `verifyRtcToken` / `requireSession` / `bearer` en `frontend/backend/server.js`.
- Avisos: `pushToUser`, `dataToUser` (FCM) y `rtcEmit` / `notifyChatUpdate` (socket).
- Contactos y privacidad: `contactsOf`, `isContactOf`, `privacyAllows`, `canSeeShared`.

## Comandos

```bash
# App
cd frontend && npm install
npm run dev                  # Vite
npm run build                # dist/
npx cap sync android && npx cap open android   # APK (se compila en Android Studio)

# API principal
cd frontend/backend && npm install && npm start      # o: npm run dev (nodemon)

# Tiempo real / taxi / panel del taxi
cd rtc-server && npm install && npm start
cd taxi-server && npm install && npm start && npm test
cd taxi-admin && npm install && npm run build
```

- **No existen**: comprobación de tipos (no hay `tsconfig`), linter, ni pruebas automáticas de la API principal
  o de `rtc-server` en el repositorio. Las pruebas de la API se hacen con scripts `.mjs` contra una copia local
  (ver «Pruebas»).
- Despliegue: `python ../deploy-vps.py` (fuera del repo, contiene credenciales: **no leer ni mostrar su contenido**).

## Convenciones del código

- Comentarios, textos y mensajes de error **en español**; errores como `res.status(4xx).json({ error: '…' })`.
- Servidores en CommonJS; app en ESM. Cada ruta lleva encima `/** MÉTODO /ruta — qué hace */`.
- Secciones de `server.js` separadas con banners `// ═══`. Almacenes: `xStore = new Map(...)` + `saveX()`.
- App: estilos en línea, constante `BACKEND = import.meta.env.VITE_BACKEND_URL`, textos con `tr('frase en español')`
  (diccionario en `src/i18n/en*.js`: añadir ahí la traducción inglesa de cada frase nueva).
- Commits: `feat: …` / `fix: …` en español. Rama `master`; push con `git push origin master`.
- **Commit, push y despliegue solo cuando el usuario lo pida.** No subir los archivos ajenos de la raíz
  (`*.php`, `poll/`, `.claude/`).

## No romper lo que ya funciona

- Cambiar solo lo que pide la tarea. Nada de refactorizar, renombrar, reformatear ni «mejorar» código ajeno.
- No sustituir tecnologías existentes (JSON + `Map`, Express, Zustand, Socket.IO…) sin justificarlo y sin aprobación.
- Mantener compatibles los APK ya instalados: un cambio de contrato de la API necesita periodo de transición.
- `server.js` es un único archivo grande: el código nuevo de IA va en módulos aparte (`frontend/backend/ai/`) y en
  `server.js` solo la conexión mínima.
- Antes de cambios grandes: explicar plan, archivos, dependencias y riesgos, y esperar aprobación.

## Seguridad, privacidad y autorización (obligatorio)

- **Nunca acceder a datos de otro usuario.** Cada consulta y operación se autoriza **en el servidor** con el usuario
  de la sesión verificada (token Bearer), nunca con un `userId`, `senderId` o `chatId` que mande el cliente.
- Para leer un chat, sus mensajes o sus archivos hay que **pertenecer al chat** (`participants` / miembros del grupo).
- Hoy muchas rutas aún confían en el `userId` del cliente (p. ej. `GET /messages/:chatId`, `POST /messages`,
  `DELETE /chats/:chatId`). **Fase 0 aprobada**: exigir sesión en todas las rutas de usuario antes de dar datos a la IA.
- Respetar siempre la privacidad existente: "ver una vez", `hiddenFor`, mensajes eliminados, reglas de contactos,
  estados y directos. Eliminar cuenta o mensaje también borra sus datos derivados (índices, resúmenes).
- Nunca registrar en logs el contenido de mensajes, tokens, códigos OTP ni teléfonos completos.

## Secretos y credenciales

- Secretos **solo** en los `.env` del servidor (`frontend/backend/.env`, `rtc-server/.env`, `taxi-server/.env`).
  En git solo `.env.example` con nombres, sin valores.
- Prohibido: escribir claves en el código, en el frontend (`VITE_*` es público), en commits, en logs o en respuestas.
- No abrir ni mostrar `deploy-vps.py`, archivos de cuentas de servicio de Firebase, `google-services.json` ni
  credenciales del VPS de la carpeta superior. Si se encuentra un secreto, avisar sin reproducirlo.
- La clave de la IA (`ANTHROPIC_API_KEY`) vive solo en el backend; la app nunca habla directamente con el proveedor.

## OldFace AI — arquitectura acordada

- **Proveedor: Anthropic (Claude)**, detrás de una interfaz propia para poder cambiarlo:
  `chat({ system, messages, tools }) → { text, toolCalls, usage }`, `embed(texts)`, `describeImage(buffer)`.
  Adaptadores en `frontend/backend/ai/providers/`. Proveedor y modelo por `.env`, nunca fijos en el código.
- **Dónde vive**: módulo dentro de la API principal (`frontend/backend/ai/`), porque los datos están en memoria en
  ese proceso. Rutas `/ai/*` siempre con `requireSession`.
- **Acceso a datos**: solo a través de `ai/access.js`, que recibe el `userId` verificado y aplica pertenencia y
  privacidad. El modelo **no** ejecuta SQL, comandos del sistema, lecturas de archivos ni llamadas HTTP arbitrarias.
- **Herramientas**: registro explícito; cada una con esquema estricto de parámetros (se rechaza lo que no encaje) y
  su propia comprobación de permisos. Lo que devuelven los mensajes de otros es **dato, nunca instrucción**.
- **Índice** (decidido 2026-10-15): búsqueda EN MEMORIA sobre `messageStore` (pocos datos), por palabras y por
  significado (vectores de `oldface-embed` guardados solo en memoria, `ai/semantic.js`; se recalculan al arrancar y
  se olvidan al borrar). Sin copia en disco que mantener. Excluye "ver una vez", ocultos y eliminados. Pasar a
  SQLite (`node:sqlite` con FTS5, como el taxi) cuando crezca el volumen de mensajes.
- **Taxi**: Willy solo consulta la API interna del taxi (`taxi-server/routes/internal.js`, secreto interno) para
  taxis cerca, destinos y precio aproximado; prepara el destino y el usuario pide el viaje en la pantalla del taxi.
  La ubicación la manda la app solo si se habla del taxi y ya hay permiso; redondeada a ~100 m y sin guardarse.
- **Disponibilidad**: Willy para administradores y para el resto de usuarios. Límites de uso por usuario y registro
  de auditoría (sin guardar el contenido de los mensajes).

### Acciones: confirmación explícita y aclaraciones

- Enviar mensajes, reenviar archivos, iniciar llamadas o videollamadas y cualquier otra acción que cambie algo:
  el agente **solo propone**. El servidor crea una acción pendiente (un solo uso, caduca) y se ejecuta únicamente
  cuando el usuario pulsa **Confirmar** en la app, con su sesión y las rutas normales.
- **Si hay varios contactos, chats o archivos que coinciden, el agente pregunta cuál** antes de proponer nada.
  Nunca elegir por su cuenta un destinatario o archivo dudoso.
- Nunca por IA: eliminar para todos, eliminar cuenta, cambiar privacidad, pagos del taxi, directos.

### Fases

0. Seguridad base (sesión obligatoria en las rutas de usuario).
1. Infraestructura del agente (proveedor, registro de herramientas, validación, permisos), sin envíos reales.
2. Búsqueda y resúmenes (solo lectura).
3. Búsqueda multimedia (descripciones de imágenes, OCR, búsqueda por contenido).
4. Envíos y acciones con aprobación (mensajes, reenvíos; silenciar chats y recordatorios **no existen aún** en OldFace).
5. Voz y videollamadas, con la infraestructura real de `rtc-server`.

Cada fase: plan → aprobación → implementación → pruebas → resumen. Solo la fase pedida.

### Pendiente de decidir

- Modelos concretos de Claude (uno económico y uno avanzado) y presupuesto/cuotas por usuario.
- Si Willy viene activado por defecto o el usuario lo activa, y si se pueden excluir chats.
- Qué acciones exactas se permiten en las fases 4 y 5.
- Revisión legal (RGPD) del envío de contenido de chats al proveedor; los textos legales actuales son borrador.
- Comprobar en el VPS que la versión de Node de la API principal incluye `node:sqlite` con FTS5.

## Pruebas y criterios de aceptación

- Pruebas con scripts Node (`.mjs`) que arrancan la API contra una **copia** de datos de prueba (nunca contra
  producción) y comprueban las respuestas; el taxi usa `npm test`.
- Obligatorio en cada cambio de la IA o de autorización: casos de **acceso no autorizado** (sin token, token de otro
  usuario, chat ajeno, "ver una vez", mensaje oculto o eliminado → 401/403/sin resultados).
- Cada herramienta: parámetros válidos, inválidos y fuera de esquema. Cada acción: no se ejecuta sin confirmar, ni dos
  veces, ni caducada, ni con otro usuario.
- Antes de dar por terminada una fase: `npm run build` de la app sin errores, pruebas en verde, funcionalidades
  existentes comprobadas, y resumen con archivos tocados, pruebas y pendientes.
