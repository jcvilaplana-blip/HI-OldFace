/**
 * Herramientas de OldFace AI — registro EXPLÍCITO: el agente solo puede usar lo que está aquí.
 *
 * Cada herramienta: { name, description, input_schema (estricto), kind, run(ctx, input) }.
 *   · input_schema se valida en el servidor ANTES de ejecutar (ai/validate.js); lo que no encaje no se ejecuta.
 *   · ctx = { my } con my = access.forUser(<usuario de la sesión>): las herramientas no ven nada más.
 *   · kind 'read' = solo lectura. En la Fase 1 no hay herramientas que envíen, borren o cambien nada; las acciones
 *     (Fase 4) devolverán una propuesta que el usuario confirma en la app, nunca se ejecutarán aquí.
 *   · Nada de SQL, comandos, rutas de archivo ni llamadas HTTP: solo funciones de ai/access.js.
 */
const { validate } = require('./validate');

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
};

const TOOLS = [
  {
    name: 'list_chats',
    kind: 'read',
    description: 'Lista los chats del usuario (individuales y de grupo) ordenados por actividad reciente: nombre, '
      + 'si es grupo, última actividad y mensajes sin leer. No devuelve el contenido de los mensajes.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['all', 'direct', 'group'], description: 'Tipo de chat (por defecto all)' },
        limit: { type: 'integer', minimum: 1, maximum: 30, description: 'Cuántos chats (por defecto 10)' },
      },
      required: [],
      additionalProperties: false,
    },
    run: ({ my }, { kind = 'all', limit = 10 }) => ({ chats: my.listChats({ kind, limit }) }),
  },
  {
    name: 'find_contact',
    kind: 'read',
    description: 'Busca entre los contactos del usuario por nombre (o por las últimas cifras del teléfono). '
      + 'Puede devolver varias personas: si hay más de una, pregunta al usuario cuál es antes de seguir.',
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
      return { matches, count: matches.length, ambiguous: matches.length > 1 };
    },
  },
  {
    name: 'open_screen',
    kind: 'read',
    description: 'Propone al usuario abrir una pantalla de OldFace (aparece un botón; no se abre sola). '
      + 'Para abrir un chat concreto usa screen "chat" con su chat_ref (de list_chats o find_contact).',
    input_schema: {
      type: 'object',
      properties: {
        screen: { type: 'string', enum: ['chat', ...Object.keys(SCREENS)] },
        chat_ref: { type: 'string', pattern: '^c_[0-9a-f]{12}$', description: 'chat_ref de list_chats o find_contact' },
      },
      required: ['screen'],
      additionalProperties: false,
    },
    run: ({ my }, { screen, chat_ref }, ui) => {
      if (screen === 'chat') {
        // La referencia la ha escrito el modelo: solo vale si es uno de los chats del usuario
        const chatId = chat_ref ? my.resolveChat(chat_ref) : null;
        if (!chatId) return { error: 'Ese chat no existe o no es del usuario' };
        ui.push({ type: 'navigate', path: `/chat/${encodeURIComponent(chatId)}`, label: my.chatTitle(chatId) });
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
    const result = await tool.run(ctx, v.value, ui);
    if (result?.error) return { ok: false, error: result.error };
    return { ok: true, result };
  } catch (e) {
    console.warn(`[ai] herramienta ${name}:`, e.message);
    return { ok: false, error: 'No se pudo completar la consulta' };
  }
}

module.exports = { TOOLS, toolSpecs, runTool };
