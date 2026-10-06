-- OldFace Taxi — esquema de la base de datos (SQLite, node:sqlite)
-- Importes en la moneda del país (REAL con 2 decimales). Fechas en milisegundos (INTEGER, Date.now()).

PRAGMA foreign_keys = ON;

-- ── Ajustes (clave → JSON) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,            -- JSON
  updated_at INTEGER
);

-- ── Administración: usuarios, roles y permisos ───────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  is_system   INTEGER NOT NULL DEFAULT 0,  -- el superadministrador no se puede borrar
  created_at  INTEGER
);
CREATE TABLE IF NOT EXISTS permissions (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE,              -- p. ej. "booking.view"
  module TEXT NOT NULL,
  action TEXT NOT NULL                       -- view | create | edit | delete
);
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE IF NOT EXISTS admin_users (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT,
  password_hash TEXT NOT NULL,
  role_id       INTEGER REFERENCES roles(id),
  avatar        TEXT,
  status        TEXT NOT NULL DEFAULT 'active',   -- active | blocked
  last_login_at INTEGER,
  created_at    INTEGER
);

-- ── Geografía y tarifas ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS countries (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  code             TEXT NOT NULL UNIQUE,     -- ISO 3166-1 alfa-2 (ES, GB, US…)
  currency_code    TEXT NOT NULL,            -- EUR, GBP, USD…
  currency_symbol  TEXT NOT NULL,
  phone_code       TEXT,
  default_language TEXT DEFAULT 'es',
  lat REAL, lng REAL, zoom INTEGER DEFAULT 5, -- centro del mapa al elegir el país
  is_default       INTEGER NOT NULL DEFAULT 0,
  active           INTEGER NOT NULL DEFAULT 1,
  sort_order       INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cities (
  id         INTEGER PRIMARY KEY,
  country_id INTEGER NOT NULL REFERENCES countries(id),
  name       TEXT NOT NULL,
  state      TEXT,
  lat REAL, lng REAL,
  radius_km  REAL DEFAULT 30,                -- área de servicio
  timezone   TEXT DEFAULT 'Europe/Madrid',
  active     INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS zones (
  id           INTEGER PRIMARY KEY,
  city_id      INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  polygon      TEXT,                          -- JSON [[lng,lat],…]
  surge        REAL NOT NULL DEFAULT 1,       -- multiplicador actual
  weekly_slots TEXT,                          -- JSON [{day:0-6, from:"08:00", to:"10:00", surge:1.3}]
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER
);
CREATE TABLE IF NOT EXISTS ride_types (
  id              INTEGER PRIMARY KEY,
  city_id         INTEGER REFERENCES cities(id), -- NULL = todas las ciudades
  name            TEXT NOT NULL,
  code            TEXT NOT NULL,
  description     TEXT,
  app_icon        TEXT,
  map_icon        TEXT,
  seats           INTEGER DEFAULT 4,
  base_price      REAL NOT NULL DEFAULT 0,
  price_per_km    REAL NOT NULL DEFAULT 0,
  price_per_min   REAL NOT NULL DEFAULT 0,
  min_fare        REAL NOT NULL DEFAULT 0,
  waiting_per_min REAL NOT NULL DEFAULT 0,
  commission_rate REAL NOT NULL DEFAULT 15,  -- % para la plataforma
  sort_order      INTEGER DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER
);
CREATE TABLE IF NOT EXISTS cancellation_policies (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  city_id         INTEGER REFERENCES cities(id),
  ride_type_id    INTEGER REFERENCES ride_types(id),
  applies_to      TEXT NOT NULL DEFAULT 'customer',  -- customer | driver
  free_window_min INTEGER NOT NULL DEFAULT 2,        -- minutos sin cargo tras aceptar
  fixed_fee       REAL NOT NULL DEFAULT 0,
  fee_percent     REAL NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS city_taxes (
  id      INTEGER PRIMARY KEY,
  city_id INTEGER REFERENCES cities(id),     -- NULL = todas
  name    TEXT NOT NULL,                     -- IVA…
  rate    REAL NOT NULL DEFAULT 0,           -- %
  active  INTEGER NOT NULL DEFAULT 1
);

-- ── Clientes y conductores (cada cuenta de OldFace tiene UN solo rol de taxi) ─
CREATE TABLE IF NOT EXISTS taxi_accounts (
  user_id    TEXT PRIMARY KEY,               -- id de usuario de OldFace (user_34…)
  role       TEXT NOT NULL CHECK (role IN ('customer','driver')),
  created_at INTEGER,
  changed_by INTEGER                          -- admin que cambió el rol (si lo hizo)
);
CREATE TABLE IF NOT EXISTS customers (
  id            INTEGER PRIMARY KEY,
  user_id       TEXT NOT NULL UNIQUE REFERENCES taxi_accounts(user_id),
  name          TEXT NOT NULL,
  phone         TEXT,
  email         TEXT,
  photo         TEXT,
  country_id    INTEGER REFERENCES countries(id),
  language      TEXT DEFAULT 'es',
  referral_code TEXT UNIQUE,
  referred_by   TEXT,                         -- código de quien le invitó
  rating        REAL DEFAULT 5,
  rating_count  INTEGER DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active',  -- active | blocked
  verified      INTEGER NOT NULL DEFAULT 1,
  emergency_contact TEXT,                     -- JSON {name, phone}
  created_at    INTEGER
);
CREATE TABLE IF NOT EXISTS drivers (
  id            INTEGER PRIMARY KEY,
  user_id       TEXT NOT NULL UNIQUE REFERENCES taxi_accounts(user_id),
  name          TEXT NOT NULL,
  phone         TEXT,
  email         TEXT,
  photo         TEXT,
  country_id    INTEGER REFERENCES countries(id),
  city_id       INTEGER REFERENCES cities(id),
  language      TEXT DEFAULT 'es',
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | active | blocked
  verified      INTEGER NOT NULL DEFAULT 0,
  online        INTEGER NOT NULL DEFAULT 0,       -- conectado (acepta viajes)
  available     INTEGER NOT NULL DEFAULT 0,       -- conectado y sin viaje en curso
  lat REAL, lng REAL, heading REAL, location_at INTEGER,
  rating        REAL DEFAULT 5,
  rating_count  INTEGER DEFAULT 0,
  referral_code TEXT UNIQUE,
  referred_by   TEXT,
  debt          REAL NOT NULL DEFAULT 0,          -- comisiones pendientes de viajes en efectivo
  created_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_drivers_avail ON drivers(available, online, status);
CREATE TABLE IF NOT EXISTS vehicles (
  id           INTEGER PRIMARY KEY,
  driver_id    INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  ride_type_id INTEGER REFERENCES ride_types(id),
  brand        TEXT, model TEXT, color TEXT,
  plate        TEXT,
  year         INTEGER,
  seats        INTEGER DEFAULT 4,
  photo        TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',   -- pending | active | blocked
  created_at   INTEGER
);
CREATE TABLE IF NOT EXISTS document_types (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'driver',      -- driver | vehicle
  required   INTEGER NOT NULL DEFAULT 1,
  has_expiry INTEGER NOT NULL DEFAULT 1,
  active     INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS driver_documents (
  id               INTEGER PRIMARY KEY,
  driver_id        INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  document_type_id INTEGER NOT NULL REFERENCES document_types(id),
  vehicle_id       INTEGER REFERENCES vehicles(id),
  file_url         TEXT NOT NULL,
  number           TEXT,
  expires_at       TEXT,                         -- AAAA-MM-DD
  status           TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  note             TEXT,
  created_at       INTEGER
);

-- ── Promociones (antes que bookings, que la referencia) ──────────────────────
CREATE TABLE IF NOT EXISTS promo_codes (
  id                INTEGER PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,
  description       TEXT,
  type              TEXT NOT NULL DEFAULT 'percent',  -- percent | fixed
  value             REAL NOT NULL DEFAULT 0,
  min_order         REAL DEFAULT 0,
  max_discount      REAL DEFAULT 0,                  -- 0 = sin límite
  max_uses          INTEGER DEFAULT 0,               -- 0 = ilimitado
  used              INTEGER NOT NULL DEFAULT 0,
  max_uses_per_user INTEGER DEFAULT 1,
  city_id           INTEGER REFERENCES cities(id),
  status            TEXT NOT NULL DEFAULT 'active',
  starts_at         TEXT, expires_at TEXT,           -- AAAA-MM-DD
  created_at        INTEGER
);

-- ── Viajes ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id                INTEGER PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,         -- BK261005C1FE
  customer_id       INTEGER NOT NULL REFERENCES customers(id),
  driver_id         INTEGER REFERENCES drivers(id),
  vehicle_id        INTEGER REFERENCES vehicles(id),
  ride_type_id      INTEGER NOT NULL REFERENCES ride_types(id),
  city_id           INTEGER REFERENCES cities(id),
  zone_id           INTEGER REFERENCES zones(id),
  status            TEXT NOT NULL DEFAULT 'searching',
      -- searching | accepted | arrived | started | completed | cancelled | expired
  pickup_address    TEXT, pickup_lat REAL, pickup_lng REAL,
  dropoff_address   TEXT, dropoff_lat REAL, dropoff_lng REAL,
  distance_km       REAL, duration_min REAL,
  route_shape       TEXT,                         -- polilínea codificada (Valhalla)
  currency          TEXT,
  base_fare         REAL DEFAULT 0, distance_fare REAL DEFAULT 0, time_fare REAL DEFAULT 0,
  waiting_fare      REAL DEFAULT 0,
  surge             REAL DEFAULT 1,
  discount          REAL DEFAULT 0,
  promo_code_id     INTEGER REFERENCES promo_codes(id),
  tax_amount        REAL DEFAULT 0,
  estimated_fare    REAL DEFAULT 0,
  total_amount      REAL,
  commission_amount REAL,
  driver_earning    REAL,
  payment_method    TEXT NOT NULL DEFAULT 'cash',  -- cash | wallet | stripe
  payment_status    TEXT NOT NULL DEFAULT 'pending', -- pending | paid | failed | refunded
  payment_ref       TEXT,
  start_otp         TEXT,                          -- código de 4 cifras para empezar el viaje
  search_round      INTEGER DEFAULT 0,
  search_started_at INTEGER,                       -- inicio de la búsqueda actual de conductor
  cancelled_by      TEXT, cancel_reason TEXT, cancel_fee REAL DEFAULT 0,
  scheduled_at      INTEGER,
  created_at        INTEGER, accepted_at INTEGER, arrived_at INTEGER,
  started_at        INTEGER, completed_at INTEGER, cancelled_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status, created_at);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bookings_driver ON bookings(driver_id, created_at);
CREATE TABLE IF NOT EXISTS booking_events (
  id         INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  data       TEXT,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS booking_offers (
  id           INTEGER PRIMARY KEY,
  booking_id   INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  driver_id    INTEGER NOT NULL REFERENCES drivers(id),
  round        INTEGER NOT NULL DEFAULT 1,
  distance_km  REAL,
  status       TEXT NOT NULL DEFAULT 'offered',  -- offered | accepted | rejected | expired
  created_at   INTEGER,
  responded_at INTEGER
);
CREATE TABLE IF NOT EXISTS ratings (
  id         INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  from_type  TEXT NOT NULL, from_id INTEGER NOT NULL,
  to_type    TEXT NOT NULL, to_id INTEGER NOT NULL,
  stars      INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment    TEXT,
  created_at INTEGER,
  UNIQUE (booking_id, from_type)
);
CREATE TABLE IF NOT EXISTS promo_uses (
  id          INTEGER PRIMARY KEY,
  promo_id    INTEGER NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  booking_id  INTEGER REFERENCES bookings(id),
  discount    REAL,
  created_at  INTEGER
);
CREATE TABLE IF NOT EXISTS referral_bonuses (
  id            INTEGER PRIMARY KEY,
  referrer_type TEXT NOT NULL, referrer_id INTEGER NOT NULL,
  referred_type TEXT NOT NULL, referred_id INTEGER NOT NULL,
  type          TEXT NOT NULL,                 -- referrer | referred
  amount        REAL NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | paid | cancelled
  created_at    INTEGER, paid_at INTEGER
);

-- ── Dinero: comisiones, facturas, monederos, retiradas, reembolsos ───────────
CREATE TABLE IF NOT EXISTS commissions (
  id             INTEGER PRIMARY KEY,
  booking_id     INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
  driver_id      INTEGER REFERENCES drivers(id),
  service        TEXT,
  fare           REAL, commission REAL, tax REAL,
  debt_amount    REAL DEFAULT 0,               -- comisión pendiente (viaje en efectivo)
  driver_earning REAL,
  created_at     INTEGER
);
CREATE TABLE IF NOT EXISTS invoices (
  id                  INTEGER PRIMARY KEY,
  number              TEXT NOT NULL UNIQUE,
  booking_id          INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
  customer_id         INTEGER REFERENCES customers(id),
  driver_id           INTEGER REFERENCES drivers(id),
  invoice_date        INTEGER,
  amount              REAL, driver_amount REAL, platform_commission REAL, tax REAL,
  currency            TEXT,
  payment_method      TEXT, payment_status TEXT
);
CREATE TABLE IF NOT EXISTS wallets (
  id            INTEGER PRIMARY KEY,
  owner_type    TEXT NOT NULL,                 -- customer | driver
  owner_id      INTEGER NOT NULL,
  balance       REAL NOT NULL DEFAULT 0,
  credits       REAL NOT NULL DEFAULT 0,
  debits        REAL NOT NULL DEFAULT 0,
  currency      TEXT DEFAULT 'EUR',
  status        TEXT NOT NULL DEFAULT 'active',
  last_tx_at    INTEGER,
  UNIQUE (owner_type, owner_id)
);
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id            INTEGER PRIMARY KEY,
  wallet_id     INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,                 -- credit | debit
  amount        REAL NOT NULL,
  balance_after REAL NOT NULL,
  description   TEXT,
  ref_type      TEXT, ref_id INTEGER,
  status        TEXT NOT NULL DEFAULT 'completed',
  created_at    INTEGER
);
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id              INTEGER PRIMARY KEY,
  driver_id       INTEGER NOT NULL REFERENCES drivers(id),
  amount          REAL NOT NULL,
  method          TEXT DEFAULT 'bank',          -- bank | cash_point
  account_details TEXT,                         -- IBAN / titular
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | paid
  note            TEXT,
  created_at      INTEGER, processed_at INTEGER
);
CREATE TABLE IF NOT EXISTS cash_collection_points (
  id             INTEGER PRIMARY KEY,
  city_id        INTEGER REFERENCES cities(id),
  name           TEXT NOT NULL,
  address        TEXT,
  lat REAL, lng REAL,
  contact_person TEXT,
  phone          TEXT,
  opening_hours  TEXT,
  active         INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS driver_incentives (
  id           INTEGER PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT,
  type         TEXT NOT NULL DEFAULT 'rides',   -- rides | earnings | hours
  target       REAL NOT NULL DEFAULT 0,
  reward       REAL NOT NULL DEFAULT 0,
  city_id      INTEGER REFERENCES cities(id),
  ride_type_id INTEGER REFERENCES ride_types(id),
  start_time   TEXT, end_time TEXT,             -- AAAA-MM-DDTHH:MM
  status       TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | running | finished
  active       INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS refund_requests (
  id               INTEGER PRIMARY KEY,
  booking_id       INTEGER NOT NULL REFERENCES bookings(id),
  customer_id      INTEGER NOT NULL REFERENCES customers(id),
  reason           TEXT,
  amount_requested REAL,
  amount_approved  REAL,
  status           TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  source           TEXT DEFAULT 'app',              -- app | support | admin
  created_at       INTEGER, processed_at INTEGER
);

-- ── Soporte ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_tickets (
  id            INTEGER PRIMARY KEY,
  number        TEXT NOT NULL UNIQUE,
  owner_type    TEXT NOT NULL, owner_id INTEGER NOT NULL,
  booking_id    INTEGER REFERENCES bookings(id),
  subject       TEXT NOT NULL,
  category      TEXT,
  status        TEXT NOT NULL DEFAULT 'open',     -- open | pending | closed
  priority      TEXT NOT NULL DEFAULT 'normal',   -- low | normal | high | urgent
  assigned_to   INTEGER REFERENCES admin_users(id),
  last_reply_at INTEGER,
  created_at    INTEGER
);
CREATE TABLE IF NOT EXISTS ticket_messages (
  id          INTEGER PRIMARY KEY,
  ticket_id   INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL, sender_id INTEGER,
  message     TEXT NOT NULL,
  attachment  TEXT,
  created_at  INTEGER
);
CREATE TABLE IF NOT EXISTS support_chats (
  id              INTEGER PRIMARY KEY,
  booking_id      INTEGER REFERENCES bookings(id),
  owner_type      TEXT NOT NULL DEFAULT 'customer', owner_id INTEGER NOT NULL,
  assigned_admin  INTEGER REFERENCES admin_users(id),
  status          TEXT NOT NULL DEFAULT 'open',
  priority        TEXT NOT NULL DEFAULT 'normal',
  refund_flag     INTEGER NOT NULL DEFAULT 0,
  unread_admin    INTEGER NOT NULL DEFAULT 0,
  last_message_at INTEGER,
  created_at      INTEGER
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id          INTEGER PRIMARY KEY,
  chat_id     INTEGER NOT NULL REFERENCES support_chats(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL, sender_id INTEGER,
  message     TEXT NOT NULL,
  created_at  INTEGER
);

-- ── Contenido de la app ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS banners (
  id         INTEGER PRIMARY KEY,
  title      TEXT,
  image_url  TEXT NOT NULL,
  cities     TEXT,                              -- JSON [id,…]; vacío = todas
  row        TEXT NOT NULL DEFAULT 'first',     -- first | second (fila en el inicio)
  link       TEXT,
  sort_order INTEGER DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS faq_categories (
  id         INTEGER PRIMARY KEY,
  title      TEXT NOT NULL,
  key        TEXT,
  audience   TEXT NOT NULL DEFAULT 'customer',  -- customer | driver | all
  icon       TEXT,
  sort_order INTEGER DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS faqs (
  id          INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES faq_categories(id) ON DELETE CASCADE,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  sort_order  INTEGER DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS notifications_log (
  id         INTEGER PRIMARY KEY,
  audience   TEXT NOT NULL,                     -- customers | drivers
  target_ids TEXT,                              -- JSON; NULL = todos
  title      TEXT NOT NULL,
  body       TEXT,
  sent_count INTEGER DEFAULT 0,
  created_by INTEGER REFERENCES admin_users(id),
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS languages (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,                   -- Español
  name_en      TEXT,                            -- Spanish
  code         TEXT NOT NULL UNIQUE,            -- es
  country_code TEXT,                            -- ES
  image        TEXT,
  rtl          INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  is_default   INTEGER NOT NULL DEFAULT 0,
  app_json     TEXT,                            -- traducciones de las apps (JSON clave → texto)
  panel_json   TEXT                             -- traducciones del panel
);

-- Pagos con tarjeta de crédito (Stripe): uno por viaje (reserva del importe y cobro al terminar) o por recarga del monedero
CREATE TABLE IF NOT EXISTS card_payments (
  id          INTEGER PRIMARY KEY,
  intent_id   TEXT NOT NULL UNIQUE,            -- PaymentIntent de Stripe (pi_…)
  kind        TEXT NOT NULL,                   -- booking | topup
  owner_type  TEXT NOT NULL,                   -- customer
  owner_id    INTEGER NOT NULL,
  booking_id  INTEGER REFERENCES bookings(id),
  amount      REAL NOT NULL,                   -- importe reservado / a cobrar
  currency    TEXT NOT NULL,
  captured    REAL NOT NULL DEFAULT 0,         -- importe cobrado de verdad
  refunded    REAL NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'created', -- created | authorized | succeeded | canceled | failed
  created_at  INTEGER, updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_card_payments_booking ON card_payments(booking_id);
