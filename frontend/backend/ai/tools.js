/**
 * Herramientas de OldFace AI — registro EXPLÍCITO: el agente solo puede usar lo que está aquí.
 *
 * Cada herramienta: { name, description, input_schema (estricto), kind, run(ctx, input, ui) }.
 *   · input_schema se valida en el servidor ANTES de ejecutar (ai/validate.js); lo que no encaje no se ejecuta.
 *   · ctx = { my, taxi, location, places }: my = access.forUser(<usuario de la sesión>); taxi = consultas fijas al
 *     taxi (o null); location = { lat, lng } aproximada que manda la app solo si el usuario habla del taxi (o null);
 *     places = destinos de taxi que Willy ha encontrado para este usuario (referencias l_…).
 *   · kind 'read' = solo lectura. Ninguna herramienta envía, borra, reserva, paga ni cambia nada: como mucho añade
 *     un BOTÓN a la respuesta (ui) que el usuario decide pulsar.
 *   · Nada de SQL, comandos, rutas de archivo ni llamadas HTTP libres: solo ai/access.js y ai/taxi.js.
 */
const crypto = require('crypto');
const { validate } = require('./validate');
const { PERIODS, rangeOf, midnight, partsOf, stamp } = require('./dates');
const { CONTAINS, KINDS, fold } = require('./access');
const { TaxiUnavailable } = require('./taxi');

/** Pantallas de la app que Willy puede proponer abrir (la app muestra un botón; el usuario decide) */
const SCREENS = {
  chats:    { path: '/',         label: 'Chats' },
  contacts: { path: '/contacts', label: 'Contactos' },
  settings: { path: '/settings', label: 'Ajustes' },
  directos: { path: '/directo',  label: 'Directos' },
  karaoke:  { path: '/karaoke',  label: 'Karaoke' },
  taxi:     { path: '/taxi',     label: 'Taxi' },
  polls:    { path: '/poll',     label: 'Encuestas' },
  help:     { path: '/help',     label: 'Ayuda' },
  reminders: { path: '/reminders', label: 'Recordatorios' },
};

const REF = { chat: '^c_[0-9a-f]{12}$', person: '^p_[0-9a-f]{12}$', message: '^m_[0-9a-f]{12}$', place: '^l_[0-9a-f]{12}$' };
const DATE = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const WHEN = {
  period: { type: 'string', enum: PERIODS, description: 'Periodo (hora de España): today, yesterday, this_week, last_week…' },
  month: { type: 'integer', minimum: 1, maximum: 12, description: 'Un mes ("en marzo" = 3): el último que ha pasado' },
  from_date: { ...DATE, description: 'Desde este día (incluido), AAAA-MM-DD' },
  to_date: { ...DATE, description: 'Hasta este día (incluido), AAAA-MM-DD' },
};
const PLACE_TTL_MS = 30 * 60 * 1000;

/**
 * Nombre de persona o de chat → su referencia, sin que el modelo tenga que buscarla antes (una vuelta menos).
 * Solo entre las personas y chats del usuario. Si hay varias que encajan y ninguna exacta → { stop } para preguntar.
 */
const NAME_SKIP = new Set(['grupo', 'chat', 'conversacion', 'el', 'la', 'los', 'las', 'de', 'del', 'mi', 'mis', 'con', 'en']);
/** "el grupo de la familia" → "familia" · "mi tío Antonio" → "tio antonio" */
const cleanName = (s) => fold(s).split(/\s+/).filter(w => w && !NAME_SKIP.has(w)).join(' ') || fold(s);

function refsByName(my, { person, chat }) {
  const out = {};
  const pick = (list, name) => list.find(x => fold(x.name) === name) || (list.length === 1 ? list[0] : null);
  if (person) {
    person = cleanName(person);
    const ms = my.findContacts(person, 6);
    if (!ms.length) return { stop: { error: `Ningún contacto se llama "${person}". Si es un grupo, usa chat.` } };
    const one = pick(ms, person);
    if (!one) return { stop: { ambiguous: true, hint: 'Hay varias personas con ese nombre: pregunta al usuario cuál.', options: ms.map(x => `${x.name} (${x.phone_hint})`) } };
    out.personRef = one.person_ref;
  }
  if (chat) {
    chat = cleanName(chat);
    let cs = my.listChats({ query: chat, limit: 6 });
    // También vale el nombre de una persona: su chat 1 a 1
    if (!cs.length) cs = my.findContacts(chat, 6).filter(x => x.chat_ref).map(x => ({ chat_ref: x.chat_ref, name: x.name }));
    if (!cs.length) return { stop: { error: `No hay ningún chat ni grupo que se llame "${chat}".` } };
    const one = pick(cs, chat);
    if (!one) return { stop: { ambiguous: true, hint: 'Hay varios chats con ese nombre: pregunta al usuario cuál.', options: cs.map(x => x.name) } };
    out.chatRef = one.chat_ref;
  }
  return out;
}

/** Botón "Ver mensaje" (la app abre el chat y resalta el mensaje) */
const offerMessage = (my, ui, ref) => {
  const r = my.resolveMessage(ref);
  if (!r) return false;
  ui.push({ type: 'navigate', kind: 'message', path: `/chat/${encodeURIComponent(r.chatId)}`, state: { focusMessage: r.msgId }, label: r.chatName });
  return true;
};
const offerChat = (my, ui, ref) => {
  const chatId = my.resolveChat(ref);
  if (!chatId) return false;
  ui.push({ type: 'navigate', path: `/chat/${encodeURIComponent(chatId)}`, label: my.chatTitle(chatId) });
  return true;
};
const MAX_TAXI_KM = 300;
/** Distancia en línea recta en km */
const kmBetween = (a, b) => {
  const r = (x) => x * Math.PI / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
/** "Calle Mayor, Alcalá de Henares" (nombre + localidad) para distinguir lugares que se llaman igual */
const shortAddress = (p) => {
  const parts = String(p.address || '').split(',').map(s => s.trim()).filter(Boolean);
  const rest = parts.filter(s => s !== p.name);
  return [p.name || parts[0], rest[rest.length >= 3 ? rest.length - 3 : 0]].filter(Boolean).join(', ');
};

/**
 * Destino de un envío (Fase 4): persona (su chat 1 a 1, o se creará al confirmar) o chat/grupo, SOLO del usuario.
 * → { chatId?, toUserId?, label } o { stop } (no existe / hay varios: preguntar)
 */
function targetOf(my, { person, chat }) {
  if (!person && !chat) return { stop: { error: 'Falta a quién: pon el nombre de la persona en person o del chat o grupo en chat' } };
  const named = refsByName(my, { person, chat });
  if (named.stop) return named;
  if (named.chatRef) {
    const chatId = my.resolveChat(named.chatRef);
    return chatId ? { chatId, label: my.chatTitle(chatId) } : { stop: { error: 'Ese chat no existe o no es del usuario' } };
  }
  const p = my.personInfo(named.personRef);
  if (!p) return { stop: { error: 'Esa persona no está entre los contactos del usuario' } };
  return p.chatId ? { chatId: p.chatId, label: p.name } : { toUserId: p.id, label: p.name };
}

/** Crea la acción pendiente y la tarjeta Confirmar/Cancelar de la app; al modelo solo le dice que está propuesta */
function propose({ actions, uid }, ui, payload, card) {
  if (!actions || !uid) return { error: 'Las acciones no están disponibles ahora mismo' };
  const { id, expiresAt } = actions.propose(uid, payload);
  ui.push({ type: 'confirm', id, kind: payload.kind, expiresAt, ...card });
  return { proposed: true, hint: 'Propuesta creada: la app muestra Confirmar y Cancelar. Dile al usuario qué se hará y que pulse '
    + 'Confirmar si está bien. NO digas que ya está hecho: no se hace nada hasta que confirme.' };
}

const MUTES = { '1h': 'durante 1 hora', '8h': 'durante 8 horas', until_tomorrow: 'hasta mañana', '1w': 'durante 1 semana', always: 'siempre', off: 'volver a avisar' };
/** Hasta cuándo se silencia (ms; 0 = siempre; null = quitar el silencio) */
function muteUntil(d, now = Date.now()) {
  if (d === '1h') return now + 3_600_000;
  if (d === '8h') return now + 8 * 3_600_000;
  if (d === '1w') return now + 7 * 86_400_000;
  if (d === 'until_tomorrow') { const t = partsOf(now); return midnight(t.y, t.m, t.d + 1) + 8 * 3_600_000; }   // mañana a las 8:00
  if (d === 'always') return 0;
  return null;
}

/** Cuándo avisar: en X minutos, o día (hoy/mañana/AAAA-MM-DD) + hora HH:MM, en hora de España → ms o null */
function reminderAt({ in_minutes, day = 'today', time }, now = Date.now()) {
  if (in_minutes) return now + in_minutes * 60_000;
  if (!time) return null;
  const [h, mi] = time.split(':').map(Number);
  const t = partsOf(now);
  let y = t.y, m = t.m, d = t.d;
  if (day === 'tomorrow') d += 1;
  else if (day !== 'today') [y, m, d] = day.split('-').map(Number);
  return midnight(y, m, d) + (h * 60 + mi) * 60_000;
}

/** Botón "Pedir taxi a …": abre la pantalla del taxi con el destino puesto; el viaje lo pide el usuario allí */
const offerTaxi = (ui, place) => ui.push({ type: 'navigate', kind: 'taxi', path: '/taxi',
  state: { taxiDropoff: { lat: place.lat, lng: place.lng, address: place.address } }, label: place.name || place.address });

const TOOLS = [
  {
    name: 'list_chats',
    kind: 'read',
    description: 'Lista los chats del usuario (individuales y de grupo) ordenados por actividad reciente: nombre, '
      + 'si es grupo, última actividad y mensajes sin leer. No devuelve el contenido de los mensajes. '
      + 'Con query busca un chat o GRUPO por su nombre (úsalo para abrir un grupo: los grupos no son contactos). '
      + 'Con unread_only solo los que tienen mensajes sin leer.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['all', 'direct', 'group'], description: 'Tipo de chat (por defecto all)' },
        limit: { type: 'integer', minimum: 1, maximum: 30, description: 'Cuántos chats (por defecto 10)' },
        query: { type: 'string', minLength: 1, maxLength: 60, description: 'SOLO el nombre (o parte) del chat o grupo; no otras palabras' },
        unread_only: { type: 'boolean', description: 'true = solo chats con mensajes sin leer' },
      },
      required: [],
      additionalProperties: false,
    },
    run: ({ my }, { kind = 'all', limit = 10, query = '', unread_only = false }) =>
      ({ chats: my.listChats({ kind, limit, query, unreadOnly: unread_only }) }),
  },
  {
    name: 'find_contact',
    kind: 'read',
    description: 'Busca PERSONAS entre los contactos del usuario por nombre (o por las últimas cifras del teléfono). '
      + 'Devuelve person_ref (para buscar sus mensajes), chat_ref de su chat y la última vez que hablaron. '
      + 'Si hay más de una persona, pregunta al usuario cuál es antes de seguir. Para grupos usa list_chats con query.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 60, description: 'Nombre o parte del nombre' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    run: ({ my }, { query }) => {
      const matches = my.findContacts(query, 10);
      // Sin personas con ese nombre puede ser un grupo: se lo indicamos al modelo en vez de que se rinda
      return { matches, count: matches.length, ambiguous: matches.length > 1,
               ...(matches.length ? {} : { hint: 'Ninguna persona se llama así. Si es un grupo o chat, búscalo con list_chats y query.' }) };
    },
  },
  {
    name: 'search_messages',
    kind: 'read',
    description: 'Busca mensajes del usuario (los suyos y los que recibió) por palabras o significado, persona, chat, '
      + 'fechas y tipo (foto, vídeo, audio, documento, ubicación…), también por lo que se ve en fotos y vídeos, lo que se '
      + 'dice en los audios y lo que pone en los documentos (campo content). Con contains encuentra datos: enlaces, teléfonos, '
      + 'emails, números de cuenta, horas, fechas o direcciones. Devuelve fecha, chat, quién lo escribió, el texto y '
      + 'message_ref; la app muestra el botón "Ver mensaje" de los primeros. Para mensajes DE una persona pon su nombre '
      + 'en person; para un chat o grupo, su nombre en chat. Usa period para "hoy", "ayer", "la semana pasada"… y month para un mes.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 120, description: 'Qué se busca, en pocas palabras (p. ej. "cena restaurante"); vacío si solo filtras' },
        person: { type: 'string', minLength: 1, maxLength: 60, description: 'Nombre de la persona que lo escribió (p. ej. "Pedro")' },
        chat: { type: 'string', minLength: 1, maxLength: 60, description: 'Nombre del chat o grupo (p. ej. "Familia")' },
        person_ref: { type: 'string', pattern: REF.person, description: 'person_ref de find_contact (en vez de person)' },
        chat_ref: { type: 'string', pattern: REF.chat, description: 'chat_ref de list_chats (en vez de chat)' },
        ...WHEN,
        type: { type: 'string', enum: ['any', ...Object.keys(KINDS)], description: 'photo, video, audio, document, location, contact, text… (por defecto any)' },
        from_me: { type: 'boolean', description: 'true = solo los que escribió el usuario; false = solo los que recibió' },
        contains: { type: 'string', enum: CONTAINS, description: 'Solo mensajes que contengan ese dato' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Cuántos resultados (por defecto 10)' },
      },
      required: [],
      additionalProperties: false,
    },
    run: async ({ my, question }, i, ui) => {
      const noTarget = () => !i.person && !i.person_ref && !i.chat && !i.chat_ref;
      // "mensajes de Pedro" con Pedro escrito en query: si es el nombre de un solo contacto, es la persona
      if (i.query && noTarget()) {
        const rest = [];
        for (const w of i.query.split(/\s+/)) {
          const ms = !i.person && fold(w).length >= 3 ? my.findContacts(w, 3).filter(x => fold(x.name).split(/\s+/).includes(fold(w))) : [];
          if (ms.length === 1) i = { ...i, person: ms[0].name }; else rest.push(w);
        }
        i = { ...i, query: rest.join(' ') || undefined };
      }
      // Si el modelo no dice de quién pero la pregunta del usuario nombra a UN solo contacto, es esa persona
      if (noTarget() && question) {
        const found = new Map();
        for (const w of question.split(/[^\p{L}]+/u)) {
          if (fold(w).length < 3) continue;
          for (const x of my.findContacts(w, 3)) if (fold(x.name).split(/\s+/).includes(fold(w))) found.set(x.person_ref, x.name);
        }
        if (found.size === 1) i = { ...i, person: [...found.values()][0] };
      }
      const named = refsByName(my, i);
      if (named.stop) return named.stop;
      const base = { query: i.query || '', chatRef: named.chatRef || i.chat_ref, personRef: named.personRef || i.person_ref, range: rangeOf(i),
                     fromMe: typeof i.from_me === 'boolean' ? i.from_me : null, limit: i.limit || 10 };
      let out = await my.searchMessages({ ...base, kind: i.type || 'any', contains: i.contains || null });
      if (out.error) return out;
      // Sin nada con el tipo o dato que eligió el modelo (p. ej. "ubicación" para una dirección escrita): sin ese filtro
      if (!out.total && ((i.type && i.type !== 'any') || i.contains)) {
        const wider = await my.searchMessages({ ...base, kind: 'any', contains: null });
        if (wider.total) out = { ...wider, widened: true, note: 'Con ese tipo o dato no había nada; estos resultados son sin ese filtro.' };
      }
      for (const r of out.results.slice(0, 3)) offerMessage(my, ui, r.message_ref);
      if (!out.total) out.hint = 'No hay mensajes que coincidan. Dilo claramente; puedes probar con otras palabras o fechas.';
      else if (out.total > 1) out.hint = 'Si no está claro cuál busca el usuario, pregúntale antes de dar uno por bueno.';
      return out;
    },
  },
  {
    name: 'read_chat',
    kind: 'read',
    description: 'Lee los mensajes de UN chat o grupo en orden (los últimos, o los de un periodo) para resumirlos o '
      + 'responder sobre ellos. Como mucho 80 por vez; si older_available, puedes pedir los anteriores con before_ref = older_ref.',
    input_schema: {
      type: 'object',
      properties: {
        chat: { type: 'string', minLength: 1, maxLength: 60, description: 'Nombre del chat, grupo o persona (p. ej. "Familia", "Ana")' },
        chat_ref: { type: 'string', pattern: REF.chat, description: 'chat_ref de list_chats o find_contact (en vez de chat)' },
        ...WHEN,
        limit: { type: 'integer', minimum: 1, maximum: 80, description: 'Cuántos mensajes (por defecto 40)' },
        before_ref: { type: 'string', pattern: REF.message, description: 'older_ref de una lectura anterior' },
      },
      required: [],
      additionalProperties: false,
    },
    run: ({ my }, i) => {
      if (!i.chat && !i.chat_ref) return { error: 'Falta el chat: indica su nombre en chat' };
      const named = refsByName(my, { chat: i.chat });
      if (named.stop) return named.stop;
      return my.readChat({ chatRef: named.chatRef || i.chat_ref, range: rangeOf(i), limit: i.limit || 40, beforeRef: i.before_ref || null });
    },
  },
  {
    name: 'pending_messages',
    kind: 'read',
    description: 'Chats con mensajes que podrían estar esperando respuesta del usuario o ser urgentes: quién, desde '
      + 'cuándo, si hay preguntas o palabras de urgencia y los últimos mensajes. Son INDICIOS: dilo como "podría", '
      + 'nunca como seguro. Por defecto los últimos 7 días.',
    input_schema: {
      type: 'object',
      properties: {
        ...WHEN,
        unread_only: { type: 'boolean', description: 'true = solo con mensajes sin leer' },
      },
      required: [],
      additionalProperties: false,
    },
    run: ({ my }, i, ui) => {
      const range = rangeOf(i) || rangeOf({ period: 'last_7_days' });
      const chats = my.pending({ range, unreadOnly: !!i.unread_only });
      for (const c of chats.slice(0, 3)) offerChat(my, ui, c.chat_ref);
      // Separados para que el modelo no presente como urgente lo que solo está pendiente
      const urgent = chats.filter(c => c.possibly_urgent), other = chats.filter(c => !c.possibly_urgent);
      return { possibly_urgent: urgent, other_pending: other,
               hint: chats.length ? 'Solo los de possibly_urgent podrían ser urgentes (dilo como posibilidad); los demás solo están sin responder.' : 'No hay nada pendiente en ese periodo.' };
    },
  },
  {
    name: 'call_history',
    kind: 'read',
    description: 'Llamadas y videollamadas del usuario: quién, cuándo, si fue entrante, saliente o perdida y cuánto duró.',
    input_schema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['all', 'missed', 'incoming', 'outgoing'], description: 'missed = perdidas (por defecto all)' },
        ...WHEN,
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Cuántas (por defecto 10)' },
      },
      required: [],
      additionalProperties: false,
    },
    run: ({ my }, i) => {
      const calls = my.calls({ direction: i.direction || 'all', range: rangeOf(i), limit: i.limit || 10 });
      return { calls, count: calls.length };
    },
  },
  {
    name: 'taxi_nearby',
    kind: 'read',
    description: 'Cuántos taxis libres de OldFace Taxi hay cerca del usuario ahora mismo, por tipo de viaje, y en cuántos '
      + 'minutos llegaría el más cercano. Usa la ubicación aproximada del móvil.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    run: async ({ taxi, location }, _i, ui) => {
      if (!taxi) return { error: 'El servicio de taxi no está disponible ahora mismo' };
      if (!location) return { needs_location: true, hint: 'No tengo la ubicación del usuario: que active la ubicación de OldFace y lo vuelva a preguntar, o que abra el taxi.' };
      const r = await taxi.nearby(location);
      ui.push({ type: 'navigate', path: SCREENS.taxi.path, label: SCREENS.taxi.label, translate: true });
      if (!r.served) return { served: false, hint: 'OldFace Taxi todavía no da servicio en la zona del usuario.' };
      return { served: true, city: r.city, radius_km: r.radiusKm,
               ride_types: r.rideTypes.map(t => ({ type: t.name, available: t.available, nearest_km: t.nearestKm, arrives_in_min: t.etaMin })) };
    },
  },
  {
    name: 'taxi_destination',
    kind: 'read',
    description: 'Prepara un viaje en taxi: busca la dirección de destino y da el precio aproximado de cada tipo de viaje. '
      + 'Si hay un único lugar, la app muestra el botón "Pedir taxi a …" (el usuario elige allí tipo y pago y pide él '
      + 'el viaje). Si hay varios, pregunta cuál y luego usa open_screen con screen "taxi" y su place_ref. Willy nunca reserva ni paga.',
    input_schema: {
      type: 'object',
      properties: {
        destination: { type: 'string', minLength: 2, maxLength: 120, description: 'Lugar o dirección de destino' },
      },
      required: ['destination'],
      additionalProperties: false,
    },
    run: async ({ taxi, location, places }, { destination }, ui) => {
      if (!taxi) return { error: 'El servicio de taxi no está disponible ahora mismo' };
      // "el municipio de Castellar de Santiago" → "Castellar de Santiago"
      const dest = destination.replace(/^\s*(?:(?:el|la)\s+)?(?:municipio|pueblo|ciudad|localidad|villa|aldea)\s+(?:de\s+)?/i, '').trim() || destination;
      let { places: found = [] } = await taxi.places(dest, location || {});
      // Con la ubicación del usuario: lo más cercano primero y nada a más de 300 km (un taxi no va a otro país)
      if (location) {
        found = found.map(p => ({ ...p, km: kmBetween(location, p) })).filter(p => p.km <= MAX_TAXI_KM).sort((a, b) => a.km - b.km);
      }
      if (!found.length) {
        ui.push({ type: 'navigate', path: SCREENS.taxi.path, label: SCREENS.taxi.label, translate: true });
        return { places: [], hint: 'No encuentro ese destino cerca del usuario. Pide una dirección más concreta o que la busque en la pantalla del taxi.' };
      }
      // Si uno se llama exactamente como lo pedido, es ese (los demás quedan como alternativas)
      const exact = found.filter(p => fold(p.name) === fold(dest));
      if (exact.length === 1) found = [exact[0], ...found.filter(p => p !== exact[0])];
      const now = Date.now();
      for (const [k, v] of places) if (v.exp < now) places.delete(k);
      const list = found.slice(0, 5).map(p => {
        const ref = `l_${crypto.randomBytes(6).toString('hex')}`;
        places.set(ref, { ...p, exp: now + PLACE_TTL_MS });
        return { place_ref: ref, name: p.name, address: p.address, ...(p.km !== undefined ? { km_from_user: Math.round(p.km) } : {}) };
      });
      const clear = list.length === 1 || exact.length === 1;
      const out = { places: list, ambiguous: !clear };
      if (location) {
        try {
          const e = await taxi.estimate(location, found[0]);
          out.estimate_for_first = e.served
            ? { distance_km: e.distanceKm, duration_min: e.durationMin, prices: e.options.map(o => `${o.name}: ${o.total} ${e.currency}`) }
            : { served: false };
        } catch { /* sin precio: no pasa nada */ }
      } else out.hint_price = 'Sin la ubicación del usuario no hay precio; en la pantalla del taxi lo verá.';
      // Botones: el destino claro, o los 3 primeros para que el usuario elija pulsando (aunque el modelo no los nombre)
      for (const p of clear ? found.slice(0, 1) : found.slice(0, 3)) offerTaxi(ui, { ...p, name: clear ? p.name : shortAddress(p) });
      ui.push({ type: 'navigate', path: SCREENS.taxi.path, label: SCREENS.taxi.label, translate: true });
      out.hint = clear ? 'Di el destino y el precio aproximado; el usuario pide el taxi con el botón "Pedir taxi a …".'
        : 'Hay varios lugares: ENUMÉRALOS al usuario (nombre y dirección) y pregúntale cuál; también puede pulsar su botón.';
      return out;
    },
  },
  // ══ Fase 4: acciones con confirmación (solo PROPONEN; la app enseña Confirmar / Cancelar) ══
  {
    name: 'propose_message',
    kind: 'action',
    description: 'Propone ENVIAR un mensaje de texto a una persona (person) o a un chat o grupo (chat). No lo envía: la app '
      + 'muestra la tarjeta con Confirmar y solo se envía si el usuario la pulsa. Escribe el texto tal como lo enviaría el '
      + 'usuario (en primera persona, p. ej. "Llego en 10 minutos"). Si hay varias personas con ese nombre, pregunta cuál.',
    input_schema: {
      type: 'object',
      properties: {
        person: { type: 'string', minLength: 1, maxLength: 60, description: 'Nombre de la persona' },
        chat: { type: 'string', minLength: 1, maxLength: 60, description: 'Nombre del chat o grupo' },
        text: { type: 'string', minLength: 1, maxLength: 2000, description: 'El mensaje que se enviará' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    run: (ctx, i, ui) => {
      const t = targetOf(ctx.my, i);
      if (t.stop) return t.stop;
      const text = i.text.trim();
      if (!text) return { error: 'El mensaje está vacío' };
      return propose(ctx, ui, { kind: 'send', chatId: t.chatId || null, toUserId: t.toUserId || null, toName: t.label, text },
                     { to: t.label, text });
    },
  },
  {
    name: 'propose_forward',
    kind: 'action',
    description: 'Propone REENVIAR un mensaje, foto, vídeo, audio o archivo (su message_ref de search_messages) a una persona '
      + 'o a un chat o grupo. No lo reenvía: el usuario tiene que pulsar Confirmar. Las fotos y vídeos de "ver una vez" no se pueden reenviar.',
    input_schema: {
      type: 'object',
      properties: {
        message_ref: { type: 'string', pattern: REF.message, description: 'message_ref del mensaje (de search_messages)' },
        person: { type: 'string', minLength: 1, maxLength: 60, description: 'A qué persona' },
        chat: { type: 'string', minLength: 1, maxLength: 60, description: 'A qué chat o grupo' },
      },
      required: ['message_ref'],
      additionalProperties: false,
    },
    run: (ctx, i, ui) => {
      const src = ctx.my.forwardable(i.message_ref);
      if (!src) return { error: 'Ese mensaje no existe, no es del usuario o no se puede reenviar' };
      const t = targetOf(ctx.my, i);
      if (t.stop) return t.stop;
      const { shown, from, ...message } = src;
      return propose(ctx, ui, { kind: 'forward', chatId: t.chatId || null, toUserId: t.toUserId || null, toName: t.label, message },
                     { to: t.label, text: shown, from });
    },
  },
  {
    name: 'propose_mute',
    kind: 'action',
    description: 'Propone SILENCIAR los avisos de un chat o grupo (los mensajes siguen llegando, sin notificación) durante '
      + '1 hora, 8 horas, hasta mañana, 1 semana o siempre; "off" vuelve a activar los avisos. El usuario confirma.',
    input_schema: {
      type: 'object',
      properties: {
        chat: { type: 'string', minLength: 1, maxLength: 60, description: 'Nombre del chat o grupo' },
        person: { type: 'string', minLength: 1, maxLength: 60, description: 'O el nombre de la persona (su chat)' },
        duration: { type: 'string', enum: Object.keys(MUTES), description: '1h, 8h, until_tomorrow, 1w, always u off' },
      },
      required: ['duration'],
      additionalProperties: false,
    },
    run: (ctx, i, ui) => {
      const t = targetOf(ctx.my, i);
      if (t.stop) return t.stop;
      if (!t.chatId) return { error: `Todavía no hay un chat con ${t.label}: no hay nada que silenciar` };
      const until = muteUntil(i.duration);
      return propose(ctx, ui, { kind: 'mute', chatId: t.chatId, toName: t.label, until },
                     { to: t.label, text: i.duration === 'off' ? 'Volver a recibir avisos' : `Silenciar ${MUTES[i.duration]}${until ? ` (hasta ${stamp(until)})` : ''}` });
    },
  },
  {
    name: 'propose_reminder',
    kind: 'action',
    description: 'Propone un RECORDATORIO para el usuario: le llegará un aviso a esa hora. Usa in_minutes ("dentro de 20 '
      + 'minutos") o day + time ("esta tarde" = today 18:00, "mañana a las 9" = tomorrow 09:00). Puede ir ligado a una '
      + 'persona o chat ("recuérdame contestar a Pedro"). El usuario confirma.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', minLength: 1, maxLength: 200, description: 'Qué recordar (p. ej. "Contestar a Pedro")' },
        in_minutes: { type: 'integer', minimum: 1, maximum: 525600, description: 'Dentro de cuántos minutos' },
        day: { type: 'string', pattern: '^(today|tomorrow|\\d{4}-\\d{2}-\\d{2})$', description: 'today, tomorrow o AAAA-MM-DD' },
        time: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', description: 'Hora HH:MM (hora de España)' },
        person: { type: 'string', minLength: 1, maxLength: 60, description: 'Persona relacionada (opcional)' },
        chat: { type: 'string', minLength: 1, maxLength: 60, description: 'Chat o grupo relacionado (opcional)' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    run: (ctx, i, ui) => {
      const at = reminderAt(i);
      if (!at) return { error: 'Falta cuándo: in_minutes, o day y time (HH:MM)' };
      if (at <= Date.now() + 30_000) return { error: 'Esa hora ya ha pasado: pregunta al usuario para cuándo lo quiere' };
      if (at - Date.now() > 366 * 86_400_000) return { error: 'Como mucho dentro de un año' };
      let chatId = null, label = null;
      if (i.person || i.chat) {
        const t = targetOf(ctx.my, i);
        if (t.stop) return t.stop;
        chatId = t.chatId || null; label = t.label;
      }
      return propose(ctx, ui, { kind: 'reminder', text: i.text.trim(), at, chatId },
                     { to: label, text: i.text.trim(), when: stamp(at) });
    },
  },
  {
    name: 'open_screen',
    kind: 'read',
    description: 'Propone al usuario abrir una pantalla de OldFace (aparece un botón; no se abre sola). '
      + 'Un chat o grupo: screen "chat" con chat_ref. Un mensaje concreto: screen "message" con message_ref. '
      + 'El taxi con un destino ya elegido: screen "taxi" con place_ref (de taxi_destination).',
    input_schema: {
      type: 'object',
      properties: {
        screen: { type: 'string', enum: ['chat', 'message', ...Object.keys(SCREENS)] },
        chat_ref: { type: 'string', pattern: REF.chat, description: 'chat_ref de list_chats o find_contact' },
        message_ref: { type: 'string', pattern: REF.message, description: 'message_ref de search_messages' },
        place_ref: { type: 'string', pattern: REF.place, description: 'place_ref de taxi_destination' },
      },
      required: ['screen'],
      additionalProperties: false,
    },
    run: ({ my, places }, { screen, chat_ref, message_ref, place_ref }, ui) => {
      // Las referencias las ha escrito el modelo: solo valen si son del usuario
      if (screen === 'chat') return offerChat(my, ui, chat_ref) ? { offered: true } : { error: 'Ese chat no existe o no es del usuario' };
      if (screen === 'message') return offerMessage(my, ui, message_ref) ? { offered: true } : { error: 'Ese mensaje no existe o no es del usuario' };
      if (screen === 'taxi' && place_ref) {
        const p = places.get(place_ref);
        if (!p || p.exp < Date.now()) return { error: 'Ese destino ya no es válido: búscalo otra vez con taxi_destination' };
        offerTaxi(ui, p);
        return { offered: true };
      }
      ui.push({ type: 'navigate', path: SCREENS[screen].path, label: SCREENS[screen].label, translate: true });
      return { offered: true };
    },
  },
];

const byName = new Map(TOOLS.map(t => [t.name, t]));

/** Definiciones que se mandan al modelo (sin el código) */
const toolSpecs = () => TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));

/**
 * Ejecuta una herramienta pedida por el modelo con todas las comprobaciones.
 * Devuelve { ok, result } o { ok: false, error } — nunca lanza (el error vuelve al modelo como tool_result).
 */
async function runTool(name, input, ctx, ui) {
  const tool = byName.get(name);
  if (!tool) return { ok: false, error: `Herramienta desconocida: ${String(name).slice(0, 40)}` };
  const v = validate(tool.input_schema, input ?? {});
  if (!v.ok) return { ok: false, error: `Parámetros no válidos (${v.error})` };
  try {
    const result = await tool.run({ taxi: null, location: null, places: new Map(), ...ctx }, v.value, ui);
    if (result?.error) return { ok: false, error: result.error };
    return { ok: true, result };
  } catch (e) {
    console.warn(`[ai] herramienta ${name}:`, e.message);
    return { ok: false, error: e instanceof TaxiUnavailable ? e.message : 'No se pudo completar la consulta' };
  }
}

module.exports = { TOOLS, toolSpecs, runTool };
