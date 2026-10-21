/**
 * Tablas de Supabase (Postgres) — una por cada archivo de data/.
 *
 * Todas tienen la misma forma: k (clave), k2 (segunda clave, '' si no hay), pos (orden), data (el objeto tal cual,
 * jsonb) y updated_at. Las columnas de `cols` se rellenan solas desde data (columnas generadas) para poder leer y
 * filtrar las tablas en el panel de Supabase sin cambiar nada en el código.
 *
 * Tipos (kind):
 *   map  — objeto { clave: valor } → una fila por clave
 *   rows — objeto { clave: [ {id,…}, … ] } → una fila por elemento (k = clave, k2 = id del elemento)
 *   list — array [ {id,…}, … ] → una fila por elemento (k = id)
 *   doc  — el archivo entero en una fila de app_docs (k = nombre del archivo)
 * `part`: el archivo es { part: {…}, otraPart: {…} } y esta tabla guarda solo esa parte.
 */
const TABLES = [
  { file: 'users.json',              table: 'users',              kind: 'map',  cols: { user_id: 'userId', name: 'name', phone: 'phone', email: 'email' } },
  { file: 'chats.json',              table: 'chats',              kind: 'map',  cols: { name: 'name', is_group: 'isGroup', group_id: 'groupId' } },
  { file: 'messages.json',           table: 'messages',           kind: 'rows', cols: { sender_id: 'senderId', type: 'type', created_at_ms: 'createdAt' } },
  { file: 'directos.json',           table: 'directos',           kind: 'map',  cols: { creator_id: 'creatorId', title: 'title', status: 'status' } },
  { file: 'live_recordings.json',    table: 'live_recordings',    kind: 'map' },
  { file: 'fcm_tokens.json',         table: 'fcm_tokens',         kind: 'map' },
  { file: 'call_log.json',           table: 'call_log',           kind: 'rows', cols: { contact_id: 'contactId', type: 'type', direction: 'direction', at_ms: 'timestamp' } },
  { file: 'stories.json',            table: 'stories',            kind: 'list', cols: { user_id: 'userId' } },
  { file: 'groups.json',             table: 'groups',             kind: 'map',  cols: { name: 'name', admin_id: 'adminId' } },
  { file: 'subscriptions.json',      table: 'subscriptions',      kind: 'map' },
  { file: 'poll_polls.json',         table: 'poll_polls',         kind: 'map',  cols: { title: 'title' } },
  { file: 'poll_votes.json',         table: 'poll_votes',         kind: 'map' },
  { file: 'poll_categories.json',    table: 'poll_categories',    kind: 'map' },
  { file: 'poll_profiles.json',      table: 'poll_profiles',      kind: 'map' },
  { file: 'karaoke_songs.json',      table: 'karaoke_songs',      kind: 'map',  cols: { title: 'title', artist: 'artist' } },
  { file: 'karaoke_recordings.json', table: 'karaoke_recordings', kind: 'map',  cols: { user_id: 'userId' } },
  { file: 'karaoke_genres.json',     table: 'karaoke_genres',     kind: 'map',  cols: { name: 'name' } },
  { file: 'karaoke_bans.json',       table: 'karaoke_bans',       kind: 'map' },
  { file: 'stickers.json',           table: 'stickers',           kind: 'map' },
  { file: 'user_prefs.json',         table: 'user_prefs',         kind: 'map' },
  { file: 'user_privacy.json',       table: 'user_privacy',       kind: 'map' },
  { file: 'user_contacts.json',      table: 'user_contacts',      kind: 'map' },
  { file: 'story_privacy.json',      table: 'story_privacy',      kind: 'map' },
  { file: 'devices.json',            table: 'devices',            kind: 'map',  part: 'byUser' },
  { file: 'devices.json',            table: 'revoked_devices',    kind: 'map',  part: 'revoked' },
  { file: 'muted_chats.json',        table: 'muted_chats',        kind: 'map' },
  { file: 'reminders.json',          table: 'reminders',          kind: 'map' },
  { file: 'ai_media.json',           table: 'ai_media',           kind: 'map',  cols: { kind: 'kind' } },
  { file: 'live_passes.json',        table: 'live_passes',        kind: 'map',  cols: { directo_id: 'directoId', user_id: 'userId', via: 'via' } },
  { file: 'live_payments.json',      table: 'live_payments',      kind: 'map',  cols: { owner_id: 'ownerId', buyer_id: 'buyerId', status: 'status' } },
  { file: 'live_codes.json',         table: 'live_codes',         kind: 'map',  cols: { directo_id: 'directoId', owner_id: 'ownerId' } },
  { file: 'live_earnings.json',      table: 'live_earnings',      kind: 'map' },
  { file: 'live_withdrawals.json',   table: 'live_withdrawals',   kind: 'map',  cols: { owner_id: 'ownerId', status: 'status' } },
  { file: 'live_settings.json',      table: 'app_docs',           kind: 'doc' },
  { file: 'ai_usage.json',           table: 'app_docs',           kind: 'doc' },
];

/** Registros que solo se añaden (nunca se leen al arrancar): una fila por línea */
const APPEND_TABLES = ['ai_audit'];

/** Valor por defecto de cada archivo cuando no hay nada guardado (el mismo que usa server.js al cargar) */
const EMPTY = { 'stories.json': [], 'devices.json': { byUser: {}, revoked: {} } };

const FILES = [...new Set(TABLES.map(t => t.file))];
const tablesOf = (file) => TABLES.filter(t => t.file === file);
const TABLE_NAMES = [...new Set(TABLES.map(t => t.table))];

module.exports = { TABLES, APPEND_TABLES, EMPTY, FILES, TABLE_NAMES, tablesOf };
