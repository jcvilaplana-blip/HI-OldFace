/**
 * Acceso a datos de OldFace AI — la ÚNICA puerta del agente a los datos.
 *
 *   const access = createAccess(deps);   // una vez, con los almacenes del backend
 *   const my = access.forUser(userId);   // userId SIEMPRE el de la sesión verificada (nunca el que diga el modelo)
 *   my.listChats({ kind, limit, query, unreadOnly }) · my.findContacts(query, limit) · my.resolveChat(ref) · my.chatTitle(chatId)
 *   my.searchMessages({ query, chatRef, personRef, range, kind, fromMe, contains, limit })   (Fase 2)
 *   my.readChat({ chatRef, range, limit, beforeRef }) · my.pending({ range, unreadOnly }) · my.calls({ direction, range, limit })
 *   my.resolveMessage(ref) → { chatId, msgId, chatName } · access.searchableItems() (para el índice por significado)
 *
 * Todo se filtra por pertenencia: solo los chats en los que está el usuario y sus contactos (misma regla que la
 * privacidad: agenda con OldFace + chats 1 a 1 en los que ha escrito, más con quien ya tiene un chat 1 a 1).
 * Mensajes: nunca los eliminados, los ocultos para él ("eliminar para mí") ni los de "ver una vez".
 * Al modelo nunca le llegan los ids internos (llevan el teléfono: user_34…, chat_user_34…_user_34…): recibe
 * referencias opacas (c_ chats, p_ personas, m_ mensajes) firmadas para ESE usuario, que solo se resuelven entre lo suyo.
 * Lo que devuelven los mensajes es DATO (el agente lo sabe): números de cuenta enmascarados y textos recortados.
 */
const crypto = require('crypto');
const { stamp } = require('./dates');

/** Minúsculas y sin tildes, para comparar nombres */
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const digits = (s) => String(s || '').replace(/\D/g, '');
/** Solo las 3 últimas cifras: suficiente para distinguir a dos personas con el mismo nombre */
const phoneHint = (p) => (digits(p).length >= 3 ? `···${digits(p).slice(-3)}` : null);
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** Tipos de mensaje que entiende el agente → tipos guardados */
const KINDS = { text: ['text'], photo: ['image'], video: ['video'], audio: ['audio'], document: ['document', 'file'],
                location: ['location', 'live_location'], contact: ['contact'], sticker: ['sticker'] };
const kindOf = (m) => Object.keys(KINDS).find(k => KINDS[k].includes(m.type || 'text')) || 'other';

// Datos que se pueden pedir "que contengan" los mensajes
const ACCOUNT = '\\b[A-Z]{2}\\d{2}(?:[ ]?[\\dA-Z]{4}){3,7}(?:[ ]?[\\dA-Z]{1,3})?\\b|\\b\\d{4}(?:[ -]?\\d{4}){3,5}\\b';
const RX = {
  link: /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi,
  email: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,
  account: new RegExp(ACCOUNT, 'g'),
  phone: /(?:\+\d{1,3}[\s.-]?)?\b\d(?:[\s.-]?\d){7,11}\b/g,
  time: /\ba las? (?:\d{1,2}(?:[:.h]\s?[0-5]\d)?|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(?: y (?:media|cuarto))?\b|\b(?:[01]?\d|2[0-3])[:.h]\s?[0-5]\d\b/gi,
  date: /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b|\b\d{1,2} de (?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b|\b(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|mañana|pasado mañana)\b/gi,
  address: /\b(?:calle|c\/|avda\.?|avenida|plaza|pza\.?|paseo|camino|carretera|ctra\.?|ronda|travesía|travesia|glorieta|urbanización|urb\.?|polígono)\s+[^\n,.;]{2,60}(?:,?\s*(?:nº|n\.º|no\.?|número)?\s*\d{1,4}[a-z]?)?/gi,
};
const IS_ACCOUNT = new RegExp(`^(?:${ACCOUNT})$`);
const CONTAINS = ['link', 'email', 'phone', 'account', 'time', 'date', 'address', 'location'];
/** Números de cuenta: nunca enteros al modelo (ni a la voz): primeros 4 y últimos 4 */
const maskAccounts = (s) => String(s || '').replace(RX.account, (a) => { const c = a.replace(/\s|-/g, ''); return `${c.slice(0, 4)} •••• ${c.slice(-4)}`; });

// Palabras que no ayudan a buscar (se ignoran al comparar por palabras)
const STOP = new Set(('a al algo con como cual cuando de del donde el ella ellos en era es esa ese esta este esto fue ha han hay la las le les lo los me mi mis muy no nos o os para pero por que quien se si sin sobre su sus te ti tu tus un una unas uno unos y ya yo '
  + 'busca buscame buscar encuentra encuentrame mensaje mensajes dijo dije decia escribio escribi mando mande envio envie paso pase chat conversacion hablamos hablo').split(' '));

/**
 * Palabras de la búsqueda que en realidad piden un TIPO de mensaje o un DATO ("la foto de Ana", "el enlace del
 * hotel", "a qué hora…"): se convierten en filtro y no se buscan como texto (el mensaje no dice "foto").
 */
const WORD_KIND = { foto: 'photo', fotos: 'photo', imagen: 'photo', imagenes: 'photo', fotografia: 'photo', video: 'video', videos: 'video',
                    audio: 'audio', audios: 'audio', voz: 'audio', pdf: 'document', documento: 'document', documentos: 'document',
                    archivo: 'document', archivos: 'document', fichero: 'document', ubicacion: 'location', localizacion: 'location' };
const WORD_DATA = { enlace: 'link', enlaces: 'link', link: 'link', links: 'link', url: 'link', web: 'link', direccion: 'address',
                    direcciones: 'address', telefono: 'phone', movil: 'phone', iban: 'account', cuenta: 'account', hora: 'time',
                    horas: 'time', email: 'email', correo: 'email' };
const WORD_SKIP = new Set(['numero', 'nota', 'notas', 'mandaste', 'mandado', 'enviado', 'pasado', 'quedamos', 'quedado']);

/** Texto de un mensaje en el que se puede buscar ("[Imagen]", "[Video]"… no son texto de verdad) */
function searchableText(m) {
  const t = String(m.text || '').trim();
  const kind = kindOf(m);
  if (kind === 'document') return `${m.fileName || ''} ${t.replace(/^\[Archivo:\s*|\]$/g, '')}`.trim();
  if (kind === 'contact') {
    let phone = '';
    try { phone = JSON.parse(m.url || '{}').phone || ''; } catch { /* sin teléfono */ }
    return `${t.replace(/^\[Contacto:\s*|\]$/g, '')} ${phone}`.trim();
  }
  if (['photo', 'video', 'audio', 'sticker'].includes(kind)) return /^\[[^\]]*\]$/.test(t) || /^(📷|🎥|🎤|🌟)/u.test(t) ? '' : t;
  return t;
}

/** Cómo ve el modelo un mensaje: tipo entre corchetes + texto recortado y con las cuentas enmascaradas */
function shown(m, n = 220) {
  const kind = kindOf(m), txt = maskAccounts(searchableText(m));
  const dur = m.duration ? ` ${Math.floor(m.duration / 60)}:${String(m.duration % 60).padStart(2, '0')}` : '';
  if (kind === 'document') return `[archivo: ${clip(m.fileName || txt, 80)}]`;
  const tag = { photo: '[foto]', video: '[vídeo]', audio: `[nota de voz${dur}]`, location: '[ubicación]', contact: '[contacto]', sticker: '[sticker]' }[kind];
  return clip(tag ? `${tag}${txt ? ` ${txt}` : ''}` : txt, n);
}

/** Datos del tipo pedido que aparecen en el mensaje (o en lo analizado de su archivo: `extra`) */
function extract(m, what, extra = '') {
  if (what === 'location') return kindOf(m) === 'location' ? [clip(m.text || 'ubicación', 120)] : [];
  // Las cuentas se enmascaran ANTES de buscar otros datos (sus cifras no deben salir como "teléfono")
  const all = `${searchableText(m)} ${extra}`.trim();
  const text = what === 'account' ? all : maskAccounts(all);
  const found = text.match(RX[what]) || [];
  const clean = what === 'phone' ? found.filter(p => digits(p).length >= 9 && !IS_ACCOUNT.test(p.trim())) : found;
  return [...new Set(clean.map(x => (what === 'account' ? maskAccounts(x) : clip(x, 120))))].slice(0, 5);
}

function createAccess({ chatStore, groupStore, messageStore, findUserById, contactsOf, isChatMember, callLogStore, semantic, mediaText = () => '', refSecret }) {
  /** Texto buscable de un mensaje + lo analizado de su archivo (Fase 3: "Parece: …", "Dice: …", "Contiene: …") */
  const fullText = (chatId, m) => [searchableText(m), mediaText(chatId, m)].filter(Boolean).join(' ');
  const secret = refSecret || crypto.randomBytes(32).toString('hex');
  /** Referencia opaca de `id` para el usuario `uid` (la misma en cada petición, distinta para cada usuario) */
  const refOf = (prefix, uid, id) => `${prefix}_${crypto.createHmac('sha256', secret).update(`${prefix}|${uid}|${id}`).digest('hex').slice(0, 12)}`;

  /** Nombre visible de un chat para `uid` (como GET /chats) */
  function chatName(c, uid) {
    if (c.isGroup) return groupStore.get(c.groupId)?.name || c.name || 'Grupo';
    const other = findUserById(c.participants.find(p => p !== uid));
    return other?.name || phoneHint(other?.phone) || 'Usuario';
  }

  /** Mensajes que `uid` puede ver en un chat (los suyos y los de los demás), del más antiguo al más reciente */
  const visibleIn = (chatId, uid) => (messageStore.get(chatId) || [])
    .filter(m => !m.deleted && !m.viewOnce && !(m.hiddenFor || []).includes(uid))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  /** Mensajes de otros que el usuario no ha leído (solo metadatos, sin contenido) */
  const unreadIn = (chatId, uid) => visibleIn(chatId, uid)
    .filter(m => m.senderId !== uid && !(m.readBy || []).includes(uid)).length;

  function forUser(uid) {
    if (!uid || !findUserById(uid)) throw new Error('usuario no válido');
    const myChats = () => [...chatStore.values()]
      .filter(c => Array.isArray(c.participants) && c.participants.includes(uid) && isChatMember(c.id, uid));
    /** Personas que el usuario conoce: contactos + con quien tiene un chat 1 a 1 */
    const people = () => {
      const s = new Set(contactsOf(uid));
      for (const c of myChats()) if (!c.isGroup && c.participants.length === 2) s.add(c.participants.find(p => p !== uid));
      s.delete(uid);
      return s;
    };
    const nameOf = (id) => {
      if (id === uid) return 'tú';
      const u = findUserById(id);
      return u?.name || phoneHint(u?.phone) || 'Usuario';
    };
    const msgRef = (chatId, m) => refOf('m', uid, `${chatId}|${m.id}`);
    const resolveChat = (ref) => (typeof ref === 'string' ? myChats().find(x => refOf('c', uid, x.id) === ref)?.id || null : null);
    const resolvePerson = (ref) => (typeof ref === 'string' ? [...people()].find(id => refOf('p', uid, id) === ref) || null : null);
    const inRange = (m, range) => !range || ((m.createdAt || 0) >= range.from && (m.createdAt || 0) < range.to);
    const row = (c, m, extra = {}) => {
      const media = mediaText(c.id, m);
      return {
        message_ref: msgRef(c.id, m), chat: chatName(c, uid), is_group: !!c.isGroup, from: nameOf(m.senderId),
        date: stamp(m.createdAt), type: kindOf(m), text: shown(m),
        ...(media ? { content: clip(maskAccounts(media), 260), content_note: 'Descripción o transcripción automática: puede tener errores' } : {}),
        ...extra,
      };
    };

    return {
      listChats({ kind = 'all', limit = 10, query = '', unreadOnly = false } = {}) {
        const q = fold(query);
        return myChats()
          .filter(c => kind === 'all' || (kind === 'group' ? !!c.isGroup : !c.isGroup))
          .filter(c => !q || fold(chatName(c, uid)).includes(q))
          .filter(c => !unreadOnly || unreadIn(c.id, uid) > 0)
          .sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0))
          .slice(0, limit)
          .map(c => ({
            chat_ref: refOf('c', uid, c.id),
            name: chatName(c, uid),
            is_group: !!c.isGroup,
            last_activity: c.lastTime ? stamp(c.lastTime) : null,
            unread: unreadIn(c.id, uid),
          }));
      },

      /** Contactos cuyo nombre (o final del teléfono, 4+ cifras) coincide con `query` */
      findContacts(query, limit = 10) {
        const q = fold(query), qd = digits(query);
        const out = [];
        for (const id of people()) {
          const u = findUserById(id);
          if (!u) continue;
          const byName = q && fold(u.name).includes(q);
          const byPhone = qd.length >= 4 && digits(u.phone).endsWith(qd);
          if (!byName && !byPhone) continue;
          const chatId = `chat_${[uid, id].sort().join('_')}`;
          const chat = chatStore.has(chatId) && isChatMember(chatId, uid) ? chatStore.get(chatId) : null;
          out.push({
            person_ref: refOf('p', uid, id), name: u.name || 'Usuario', phone_hint: phoneHint(u.phone),
            chat_ref: chat ? refOf('c', uid, chatId) : null,
            last_activity: chat?.lastTime ? stamp(chat.lastTime) : null,
          });
          if (out.length >= limit) break;
        }
        return out;
      },

      /** chat_ref (lo escribe el modelo) → id real, SOLO si es uno de sus chats; si no, null */
      resolveChat,
      resolvePerson,

      chatTitle(chatId) {
        const c = chatStore.get(chatId);
        return c && c.participants?.includes(uid) ? chatName(c, uid) : null;
      },

      /** person_ref → { id, name, chatId } (chatId = su chat 1 a 1 si ya existe) SOLO entre sus contactos; si no, null */
      personInfo(ref) {
        const id = resolvePerson(ref);
        if (!id) return null;
        const chatId = `chat_${[uid, id].sort().join('_')}`;
        return { id, name: nameOf(id), chatId: chatStore.has(chatId) && isChatMember(chatId, uid) ? chatId : null };
      },

      /**
       * Lo que se reenvía de un mensaje (Fase 4): solo de sus chats, nunca "ver una vez" (visibleIn ya los quita),
       * ni ubicaciones en tiempo real. → { type, text, url, fileName, duration, shown, from } o null
       */
      forwardable(ref) {
        if (typeof ref !== 'string') return null;
        for (const c of myChats()) {
          const m = visibleIn(c.id, uid).find(x => msgRef(c.id, x) === ref);
          if (!m) continue;
          if (m.type === 'live_location' || m.viewOnce) return null;
          return { type: m.type || 'text', text: String(m.text || ''), url: m.url || null, fileName: m.fileName || null,
                   duration: m.duration || null, shown: shown(m, 120), from: nameOf(m.senderId) };
        }
        return null;
      },

      /** message_ref → { chatId, msgId, chatName } SOLO si es un mensaje que el usuario puede ver; si no, null */
      resolveMessage(ref) {
        if (typeof ref !== 'string') return null;
        for (const c of myChats()) {
          const m = visibleIn(c.id, uid).find(x => msgRef(c.id, x) === ref);
          if (m) return { chatId: c.id, msgId: m.id, chatName: chatName(c, uid) };
        }
        return null;
      },

      /**
       * Búsqueda de mensajes: por palabras (sin tildes ni mayúsculas) y, si está el servicio, por significado.
       * Filtros: chat, persona que lo escribió, fechas, tipo, solo míos, que contengan un dato. Máximo 20 resultados.
       */
      async searchMessages({ query = '', chatRef, personRef, range = null, kind = 'any', fromMe = null, contains = null, limit = 10 } = {}) {
        // Palabras de la búsqueda (las que aportan algo); las de tipo o dato pasan a ser filtros
        const words = [];
        for (const w of fold(query).split(/[^a-z0-9ñ@]+/)) {
          if (w.length < 2 || STOP.has(w) || WORD_SKIP.has(w)) continue;
          if (WORD_KIND[w]) { if (kind === 'any') kind = WORD_KIND[w]; continue; }
          if (WORD_DATA[w]) { if (!contains) contains = WORD_DATA[w]; continue; }
          words.push(w);
        }
        let chats = myChats();
        if (chatRef) {
          const id = resolveChat(chatRef);
          if (!id) return { error: 'Ese chat no existe o no es del usuario' };
          chats = chats.filter(c => c.id === id);
        }
        let personId = null;
        if (personRef) {
          personId = resolvePerson(personRef);
          if (!personId) return { error: 'Esa persona no está entre los contactos del usuario' };
        }
        const cands = [];
        for (const c of chats) {
          for (const m of visibleIn(c.id, uid)) {
            if (!inRange(m, range)) continue;
            if (kind !== 'any' && kindOf(m) !== kind) continue;
            if (personId && m.senderId !== personId) continue;
            if (fromMe === true && m.senderId !== uid) continue;
            if (fromMe === false && m.senderId === uid) continue;
            let found = null;
            if (contains) { found = extract(m, contains, mediaText(c.id, m)); if (!found.length) continue; }
            cands.push({ c, m, found, text: fullText(c.id, m) });
          }
        }

        // Raíz corta para "cena" ≈ "cenamos"
        const stems = words.map(w => (w.length > 5 ? w.slice(0, -2) : w));
        let semanticUsed = false;
        if (stems.length) {
          let sem = null, best = 0;
          if (semantic) {
            // Por significado solo los mensajes con algo de contenido ("jajaja vale" se parece a todo)
            const items = cands.filter(x => x.text.split(/\s+/).length >= 3).map(x => ({ key: `${x.c.id}|${x.m.id}`, text: x.text }));
            sem = items.length ? await semantic.scores(query, items) : null;
            semanticUsed = !!sem;
            if (sem) best = Math.max(0, ...sem.values());
          }
          for (const x of cands) {
            const t = fold(x.text);
            const kw = stems.filter(s => t.includes(s)).length / stems.length;
            const s = sem?.get(`${x.c.id}|${x.m.id}`);
            x.score = kw >= (stems.length > 1 ? 0.5 : 1) ? 1 + kw : s !== undefined && semantic.accepts(s, best) ? s : 0;
          }
        }
        let hits = (stems.length ? cands.filter(x => x.score > 0) : cands)
          .sort((a, b) => (stems.length ? b.score - a.score : 0) || (b.m.createdAt || 0) - (a.m.createdAt || 0));
        // Con filtros (persona, chat, fechas, tipo, dato) y sin coincidencias por las palabras: los mensajes que
        // cumplen los filtros, avisando (el modelo suele buscar palabras que no aparecen: "hora", "reunión"…)
        let relaxed = false;
        const filtered = personId || chatRef || range || kind !== 'any' || contains || fromMe !== null;
        if (stems.length && !hits.length && filtered && cands.length) {
          hits = cands.sort((a, b) => (b.m.createdAt || 0) - (a.m.createdAt || 0));
          relaxed = true;
        }
        return {
          results: hits.slice(0, limit).map(x => row(x.c, x.m, x.found ? { found: x.found } : {})),
          total: hits.length,
          more: hits.length > limit,
          ...(stems.length ? { search: semanticUsed ? 'palabras y significado' : 'palabras' } : {}),
          ...(relaxed ? { relaxed: true, note: 'Ninguno contiene esas palabras: son los mensajes que cumplen los demás filtros. Mira si alguno responde a la pregunta.' } : {}),
        };
      },

      /** Mensajes de un chat en orden (para resumir), por páginas: como mucho `limit` (≤ 80) */
      readChat({ chatRef, range = null, limit = 40, beforeRef = null } = {}) {
        const chatId = resolveChat(chatRef);
        if (!chatId) return { error: 'Ese chat no existe o no es del usuario' };
        const c = chatStore.get(chatId);
        let list = visibleIn(chatId, uid).filter(m => inRange(m, range));
        if (beforeRef) {
          const i = list.findIndex(m => msgRef(chatId, m) === beforeRef);
          if (i < 0) return { error: 'Referencia de mensaje no válida para este chat' };
          list = list.slice(0, i);
        }
        const page = list.slice(-limit);
        return {
          chat: chatName(c, uid), is_group: !!c.isGroup, count: page.length,
          messages: page.map(m => {
            const media = mediaText(chatId, m);
            return { from: nameOf(m.senderId), date: stamp(m.createdAt), text: shown(m, 300), ...(media ? { content: clip(maskAccounts(media), 160) } : {}) };
          }),
          older_available: list.length > page.length,
          ...(list.length > page.length && page[0] ? { older_ref: msgRef(chatId, page[0]) } : {}),
        };
      },

      /**
       * Posibles pendientes: chats 1 a 1 donde lo último lo escribió el otro (sin respuesta) y grupos con mensajes
       * sin leer. Las marcas (pregunta, palabras de urgencia) son INDICIOS, no certezas.
       */
      pending({ range = null, unreadOnly = false } = {}) {
        const URGENT = /\b(urgente|urgencia|emergencia|cuanto antes|lo antes posible|asap|importante|ll[aá]mame|ayuda|hospital|r[aá]pido|ya mismo)\b/i;
        const out = [];
        for (const c of myChats()) {
          const list = visibleIn(c.id, uid);
          const lastMine = Math.max(0, ...list.filter(m => m.senderId === uid).map(m => m.createdAt || 0));
          const theirs = list.filter(m => m.senderId !== uid && (m.createdAt || 0) > lastMine && inRange(m, range));
          if (!theirs.length) continue;
          const unread = theirs.filter(m => !(m.readBy || []).includes(uid)).length;
          if ((unreadOnly || c.isGroup) && !unread) continue;
          const texts = theirs.map(searchableText);
          out.push({
            chat_ref: refOf('c', uid, c.id), chat: chatName(c, uid), is_group: !!c.isGroup,
            waiting_since: stamp(theirs[0].createdAt), messages_without_reply: theirs.length, unread,
            possibly_urgent: texts.some(t => URGENT.test(t)), asks_question: texts.some(t => t.includes('?')),
            latest: theirs.slice(-3).map(m => row(c, m)),
            _last: theirs[theirs.length - 1].createdAt || 0,
          });
        }
        return out
          .sort((a, b) => (b.possibly_urgent - a.possibly_urgent) || (b.unread - a.unread) || (b._last - a._last))
          .slice(0, 10)
          .map(({ _last, ...x }) => x);
      },

      /** Registro de llamadas del propio usuario. "Perdida" = entrante sin contestar (duración 0) */
      calls({ direction = 'all', range = null, limit = 10 } = {}) {
        const mine = people();
        return (callLogStore?.get(uid) || [])
          .filter(c => inRange({ createdAt: c.timestamp }, range))
          .map(c => ({ ...c, missed: c.direction === 'incoming' && !(c.duration >= 1) }))
          .filter(c => direction === 'all' || (direction === 'missed' ? c.missed : c.direction === direction))
          .slice(0, limit)
          .map(c => {
            const u = findUserById(c.contactId);
            const name = u?.name || (/^user_/.test(String(c.contactName)) ? phoneHint(c.contactName) : c.contactName) || 'Desconocido';
            return { who: name, ...(mine.has(c.contactId) ? { person_ref: refOf('p', uid, c.contactId) } : {}),
                     type: c.type === 'video' ? 'videollamada' : 'llamada', direction: c.direction, missed: c.missed,
                     duration_s: c.duration || 0, date: stamp(c.timestamp) };
          });
      },
    };
  }

  /** Todos los textos buscables (para el índice por significado en memoria). Los permisos se aplican al buscar */
  function searchableItems() {
    const items = [];
    for (const [chatId, list] of messageStore) {
      for (const m of list) {
        if (m.deleted || m.viewOnce) continue;
        const text = fullText(chatId, m);
        if (text.length >= 3) items.push({ key: `${chatId}|${m.id}`, text });
      }
    }
    return items;
  }

  return { forUser, searchableItems };
}

module.exports = { createAccess, CONTAINS, KINDS, maskAccounts, extract, searchableText, fold };
