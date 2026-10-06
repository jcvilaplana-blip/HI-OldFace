# OldFace Taxi — Plan de desarrollo

> Objetivo: módulo de taxi tipo Uber **propio**, sin servicios de pago obligatorios: parte del **cliente** y parte del
> **conductor** dentro de OldFace (cada una con su propia interfaz y su dashboard) y **panel de administración** con todas las secciones del
> documento "TAXI BACKEND.pdf" y permisos CRUD por rol. Todo en **español**, con idiomas gestionables desde el panel.

## Decisiones (confirmadas por el usuario, 2026-10-05)

| Tema | Decisión |
|---|---|
| Mapas, rutas y direcciones | **Propios en el VPS** (OpenStreetMap) — sin Google Maps |
| Entrada al módulo | Menú de OldFace → **TAXI** → elegir **"Entrar como Cliente"** o **"Entrar como Conductor"** (cambio pedido por el usuario el 2026-10-05; sustituye a la idea de un APK aparte). Cada parte tiene **su propia interfaz y su dashboard** |
| Roles exclusivos | **Un conductor no puede ser cliente y un cliente no puede ser conductor.** La primera vez que se pulsa TAXI se elige el rol y queda **fijado a la cuenta de OldFace**; después TAXI abre directamente esa parte y la otra no se ofrece. El servidor lo impone (una cuenta ↔ un rol taxi). Solo un administrador puede cambiarlo desde el panel |
| Cobertura inicial | **España + Europa + Sudamérica + Reino Unido + EE. UU.**; país por defecto **España**, elegible al empezar |
| Pagos | **Efectivo + Monedero + Stripe** (Razorpay configurable en el panel, desactivado) |
| Idioma | Español por defecto; idiomas y traducciones (app y panel) editables desde el panel |

## Arquitectura

```
                        ┌──────────────────────── VPS 212.227.110.244 ────────────────────────┐
 OldFace → Taxi:       ─┤ nginx ─┬─ /api/…            backend actual (chats, karaoke…)          │
  · Cliente / Conductor ┤        ├─ /taxi/api/…       taxi-server (Express + SQLite + Socket.IO)│
 Panel admin (web)     ─┤        ├─ /taxi/socket.io   tiempo real: ofertas, posición, estados   │
                        │        ├─ /maps/tiles/…     mapa vectorial PMTiles (archivo estático)  │
                        │        ├─ /maps/route       Valhalla: rutas, distancia, tiempo, ETA    │
                        │        └─ /maps/search      Photon: buscador de direcciones            │
                        └──────────────────────────────────────────────────────────────────────┘
```

- **taxi-server/** — servicio systemd propio (como rtc-server), puerto 4100. Base de datos **SQLite** integrada en
  Node 24 (`node:sqlite`, sin dependencias), con migraciones. REST para apps y panel + Socket.IO para el tiempo real.
- **Mapas propios** (sin límites ni cuotas):
  - **Mapa:** Protomaps **PMTiles** (OpenStreetMap vectorial) recortado a la cobertura, servido por nginx con
    peticiones por rangos; se pinta en el móvil con **MapLibre GL JS** (libre).
  - **Rutas / ETA / precio por distancia y tiempo:** **Valhalla** (motor por baldosas, poca RAM: apto para 23 GB).
  - **Buscador de direcciones y geocodificación inversa:** **Photon** (Java 21) con las descargas por país.
- **Llamadas y chat cliente ↔ conductor:** el servidor RTC propio que ya existe (sin mostrar teléfonos).
- **Notificaciones push:** FCM (ya integrado en OldFace).

## Modelo de datos (SQLite)

Usuarios y roles: `admin_users`, `roles`, `permissions`, `role_permissions` (CRUD por módulo: view/create/edit/delete).
Negocio: `countries`, `cities`, `zones` (polígono + recargo dinámico + franjas semanales), `ride_types`
(icono app/mapa, base, €/km, €/min, mínimo, comisión), `cancellation_policies`, `customers` (enlazado al usuario de
OldFace), `drivers`, `vehicles`, `document_types`, `driver_documents`, `bookings` (+ `booking_events`, `booking_offers`),
`ratings`, `promo_codes` + `promo_uses`, `referrals` + `referral_bonuses`, `city_taxes`, `commissions`, `invoices`,
`wallets` + `wallet_transactions`, `withdrawal_requests`, `cash_collection_points`, `driver_incentives`,
`refund_requests`, `support_tickets` + `ticket_messages`, `support_chats` + `chat_messages`, `banners`, `faq_categories`
+ `faqs`, `notifications_log`, `languages` (+ JSON de traducciones app/panel), `settings` (clave → valor: app,
pagos, moneda, OTP, integraciones, reembolsos, referidos, radio de búsqueda).

## Flujo de un viaje

1. Cliente elige origen/destino → Valhalla calcula distancia y tiempo → precio por tipo de viaje
   (base + km + min, recargo de zona, impuesto de la ciudad, promo) → "Pedir".
2. Búsqueda de conductor por **rondas de radio** (ajuste "Driver Search Radius": ronda 1/2/3 en km): oferta al más
   cercano disponible del tipo pedido → acepta / rechaza / caduca → siguiente.
3. Conductor asignado → el cliente ve su posición en directo y la hora de llegada; chat y llamada.
4. "He llegado" → el cliente da un **código de 4 cifras** al conductor para empezar (seguridad) → viaje en curso.
5. Fin → precio final por recorrido real → cobro (efectivo / monedero / Stripe) → comisión y
   ganancias del conductor → factura → valoraciones mutuas.
6. Cancelaciones según la política (ventana gratuita, cargo fijo o %), reembolsos y soporte.

## Fases

| Fase | Contenido | Resultado comprobable |
|---|---|---|
| **0. Mapas propios** | Instalar Valhalla, Photon y PMTiles en el VPS; **España primero** (operativa en horas), luego el resto de la cobertura en segundo plano | `/maps/route`, `/maps/search` y el mapa funcionando |
| **1. taxi-server + BD** | Servicio, esquema completo, migraciones, ajustes, roles/permisos, API base, tiempo real | Pruebas automáticas de API |
| **2. Panel de administración** | Login de administradores, roles y permisos CRUD, **todas las secciones del PDF**, idiomas | Panel en `/taxi/admin` |
| **3. App cliente** | OldFace → Taxi → **Entrar como Cliente**: mapa, buscador, tipos y precios, pedir, seguimiento, chat/llamada, pago, valoración, Mis viajes, Monedero, Perfil (notificaciones, seguridad/SOS, invita y gana, idioma, valorar, compartir, contacto, acerca de) | Viaje completo simulado |
| **4. App conductor** | OldFace → Taxi → **Entrar como Conductor** (si aún no es conductor: alta y verificación): registro con documentos, verificación, conectado/desconectado, ofertas, navegación, estados, ganancias, retiradas, incentivos, deuda de efectivo, puntos de cobro | Viaje real entre los dos móviles |
| **5. Pagos y promociones** | Stripe (tarjeta + webhooks), monedero, promos, referidos, impuestos, comisiones, facturas, reembolsos | Pagos de prueba de Stripe |
| **6. Soporte y operación** | Tickets, chat de soporte, notificaciones push masivas, mapa en vivo de conductores, dashboard con estadísticas | Panel completo |

## Riesgos y notas

- La preparación de rutas para Europa + América tarda **horas** y usa mucho disco (~150–250 GB entre mapas, rutas y
  buscador); el VPS tiene 683 GB libres. España se prepara primero para no bloquear el desarrollo.
- Los datos de OpenStreetMap exigen mostrar la atribución "© OpenStreetMap" en el mapa.
- Stripe cobra comisión por pago y requiere cuenta del usuario; queda desactivado hasta que se configuren las claves.
- El envío de OTP por SMS (MSG91/WhatsApp del PDF) es de pago; OldFace ya usa OTP por email propio. Se dejan
  configurables pero el proveedor por defecto es el email propio.
