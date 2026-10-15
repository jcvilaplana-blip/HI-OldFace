/**
 * Acceso a datos de OldFace AI — la ÚNICA puerta del agente a los datos.
 *
 *   const access = createAccess(deps);   // una vez, con los almacenes del backend
 *   const my = access.forUser(userId);   // userId SIEMPRE el de la sesión verificada (nunca el que diga el modelo)
 *   my.listChats({ kind, limit, query, unreadOnly }) · my.findContacts(query, limit) · my.resolveChat(ref) · my.chatTitle(chatId)
 *
 * Todo se filtra por pertenencia: solo los chats en los que está el usuario y sus contactos (misma regla que la
 * privacidad: agenda con OldFace + chats 1 a 1 en los que ha escrito, más con quien ya tiene un chat 1 a 1).
 * Al modelo nunca le llegan los ids internos (llevan el teléfono: user_34…, chat_user_34…_user_34…): recibe
 * referencias opacas (c_… chats, p_… personas) firmadas para ESE usuario, que solo se resuelven entre lo suyo.
 * Fase 1: no se devuelve el contenido de ningún mensaje (eso llega con la búsqueda de la Fase 2).
 */
const crypto = require('crypto');

/** Minúsculas y sin tildes, para comparar nombres */
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const digits = (s) => String(s || '').replace(/\D/g, '');
/** Solo las 3 últimas cifras: suficiente para distinguir a dos personas con el mismo nombre */
const phoneHint = (p) => (digits(p).length >= 3 ? `···${digits(p).slice(-3)}` : null);

function createAccess({ chatStore, groupStore, messageStore, findUserById, contactsOf, isChatMember, refSecret }) {
  const secret = refSecret || crypto.randomBytes(32).toString('hex');
  /** Referencia opaca de `id` para el usuario `uid` (la misma en cada petición, distinta para cada usuario) */
  const refOf = (prefix, uid, id) => `${prefix}_${crypto.createHmac('sha256', secret).update(`${prefix}|${uid}|${id}`).digest('hex').slice(0, 12)}`;

  /** Nombre visible de un chat para `uid` (como GET /chats) */
  function chatName(c, uid) {
    if (c.isGroup) return groupStore.get(c.groupId)?.name || c.name || 'Grupo';
    const other = findUserById(c.participants.find(p => p !== uid));
    return other?.name || phoneHint(other?.phone) || 'Usuario';
  }

  /** Mensajes de otros que el usuario no ha leído (solo metadatos, sin contenido) */
  const unreadIn = (chatId, uid) => (messageStore.get(chatId) || [])
    .filter(m => !m.deleted && m.senderId !== uid && !(m.hiddenFor || []).includes(uid) && !(m.readBy || []).includes(uid)).length;

  function forUser(uid) {
    if (!uid || !findUserById(uid)) throw new Error('usuario no válido');
    const myChats = () => [...chatStore.values()].filter(c => Array.isArray(c.participants) && c.participants.includes(uid));

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
            last_activity: c.lastTime ? new Date(c.lastTime).toISOString() : null,
            unread: unreadIn(c.id, uid),
          }));
      },

      /** Contactos cuyo nombre (o final del teléfono, 4+ cifras) coincide con `query` */
      findContacts(query, limit = 10) {
        const q = fold(query), qd = digits(query);
        const people = new Set(contactsOf(uid));
        for (const c of myChats()) if (!c.isGroup && c.participants.length === 2) people.add(c.participants.find(p => p !== uid));
        people.delete(uid);
        const out = [];
        for (const id of people) {
          const u = findUserById(id);
          if (!u) continue;
          const byName = q && fold(u.name).includes(q);
          const byPhone = qd.length >= 4 && digits(u.phone).endsWith(qd);
          if (!byName && !byPhone) continue;
          const chatId = `chat_${[uid, id].sort().join('_')}`;
          out.push({
            person_ref: refOf('p', uid, id), name: u.name || 'Usuario', phone_hint: phoneHint(u.phone),
            chat_ref: chatStore.has(chatId) && isChatMember(chatId, uid) ? refOf('c', uid, chatId) : null,
          });
          if (out.length >= limit) break;
        }
        return out;
      },

      /** chat_ref (lo escribe el modelo) → id real, SOLO si es uno de sus chats; si no, null */
      resolveChat(ref) {
        if (typeof ref !== 'string') return null;
        const c = myChats().find(x => refOf('c', uid, x.id) === ref);
        return c && isChatMember(c.id, uid) ? c.id : null;
      },

      chatTitle(chatId) {
        const c = chatStore.get(chatId);
        return c && c.participants?.includes(uid) ? chatName(c, uid) : null;
      },
    };
  }

  return { forUser };
}

module.exports = { createAccess };
