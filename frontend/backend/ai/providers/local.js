/**
 * Proveedor "local": modelo libre en nuestro propio servidor (llm-server/, llama.cpp con API compatible con OpenAI,
 * solo en 127.0.0.1). Gratis y sin enviar datos fuera del VPS; más lento y menos fiable que Claude.
 *
 * Misma interfaz que anthropic.js:
 *   chat({ system, messages, tools }) → { text, toolCalls: [{ id, name, input }], stopReason, usage: { input, output }, raw }
 *   chatStream({ system, messages, tools }, onDelta) → lo mismo, con el texto a trozos según se escribe
 *   warmUp({ system, tools }) → deja procesadas en el servidor las instrucciones fijas (la 1.ª pregunta va más rápida)
 * Dentro de una petición el turno del asistente se devuelve tal cual (raw, formato OpenAI) con sus tool_calls.
 */
const { ProviderError } = require('./anthropic');

const TIMEOUT_MS = 180_000;
const unavailable = () => new ProviderError('Willy no está disponible ahora mismo', { status: 503, retryable: true });

function toApiMessages(system, messages) {
  const out = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'assistant') out.push(m.raw || { role: 'assistant', content: m.text || '' });
    else if (m.toolResults) for (const r of m.toolResults) out.push({ role: 'tool', tool_call_id: r.id, content: r.content });
    else out.push({ role: 'user', content: m.text });
  }
  return out;
}

/** Quita los "pensamientos" (<think>…</think>); con open = true también uno que aún no se ha cerrado (streaming) */
const stripThink = (s, open = false) => String(s || '').replace(open ? /<think>[\s\S]*?(<\/think>|$)/g : /<think>[\s\S]*?<\/think>/g, '');

/** No enseñar aún el final si puede ser el principio de "<think>" (llega a trozos: "<thi" + "nk>") */
const holdBack = (s) => {
  for (let n = Math.min(6, s.length); n > 0; n--) if ('<think>'.startsWith(s.slice(-n))) return s.slice(0, -n);
  return s;
};

const toApiTools = (tools) => tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));

function createLocalProvider({ baseUrl, model, maxTokens, noThinking }) {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
  // Qwen3 y similares "piensan" en voz alta antes de responder: más lento y no aporta en estas tareas
  const extra = noThinking ? { chat_template_kwargs: { enable_thinking: false } } : {};

  async function post(body) {
    let r;
    try {
      r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, ...extra, ...body }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch { throw unavailable(); }
    if (!r.ok) { console.warn(`[ai] modelo local: error ${r.status}`); throw unavailable(); }
    return r.json();
  }

  /** Respuesta del modelo (completa o reconstruida del streaming) → formato común del proveedor */
  function toResult(msg, finishReason, u = {}) {
    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    const toolCalls = calls.map((tc, i) => {
      // Si el modelo escribe mal los parámetros, llegan como texto y la validación de la herramienta los rechaza
      let input;
      try { input = JSON.parse(tc.function?.arguments || '{}'); } catch { input = String(tc.function?.arguments || ''); }
      return { id: tc.id || `call_${i}`, name: String(tc.function?.name || ''), input };
    });
    // Al devolverle el turno, los ids deben coincidir con los de los resultados (algunos modelos no los ponen)
    const rawCalls = calls.map((tc, i) => ({ id: toolCalls[i].id, type: 'function',
      function: { name: toolCalls[i].name, arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function?.arguments || {}) } }));
    const text = stripThink(msg.content).trim();
    return {
      text, toolCalls,
      stopReason: toolCalls.length ? 'tool_use' : finishReason === 'length' ? 'max_tokens' : 'end',
      usage: { input: u.prompt_tokens || 0, output: u.completion_tokens || 0 },
      raw: { role: 'assistant', content: msg.content || '', ...(rawCalls.length ? { tool_calls: rawCalls } : {}) },
    };
  }

  return {
    name: 'local',
    model,
    // toolChoice 'required' = obligar a usar una herramienta (el agente lo pide cuando el modelo contesta sin hacer nada)
    async chat({ system, messages, tools, toolChoice }) {
      const data = await post({ max_tokens: maxTokens, temperature: 0.2, messages: toApiMessages(system, messages), tools: toApiTools(tools),
                                ...(toolChoice ? { tool_choice: toolChoice } : {}) });
      const choice = data.choices?.[0] || {};
      return toResult(choice.message || {}, choice.finish_reason, data.usage);
    },

    /**
     * Igual que chat(), pero el texto llega a trozos: onDelta(texto) con cada parte nueva visible (sin "pensamientos").
     * Las llamadas a herramientas se van juntando y se devuelven al final, como en chat().
     */
    async chatStream({ system, messages, tools, toolChoice }, onDelta) {
      let r;
      try {
        r = await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS),
          body: JSON.stringify({ model, ...extra, max_tokens: maxTokens, temperature: 0.2, messages: toApiMessages(system, messages),
                                 tools: toApiTools(tools), stream: true, stream_options: { include_usage: true },
                                 ...(toolChoice ? { tool_choice: toolChoice } : {}) }),
        });
      } catch { throw unavailable(); }
      if (!r.ok || !r.body) { console.warn(`[ai] modelo local: error ${r.status}`); throw unavailable(); }
      const dec = new TextDecoder();
      let buf = '', content = '', shown = 0, finish = null, usage = {};
      const calls = [];
      const handle = (line) => {
        if (!line.startsWith('data:')) return;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') return;
        let j;
        try { j = JSON.parse(data); } catch { return; }
        if (j.usage) usage = j.usage;
        const ch = j.choices?.[0];
        if (!ch) return;
        if (ch.finish_reason) finish = ch.finish_reason;
        const d = ch.delta || {};
        if (d.content) {
          content += d.content;
          const visible = holdBack(stripThink(content, true).replace(/^\s+/, ''));
          if (visible.length > shown) { onDelta?.(visible.slice(shown)); shown = visible.length; }
        }
        for (const tc of d.tool_calls || []) {
          const c = calls[tc.index ?? calls.length] ||= { id: '', type: 'function', function: { name: '', arguments: '' } };
          if (tc.id) c.id = tc.id;
          if (tc.function?.name) c.function.name += tc.function.name;
          if (tc.function?.arguments) c.function.arguments += tc.function.arguments;
        }
      };
      try {
        for await (const chunk of r.body) {
          buf += dec.decode(chunk, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
        }
        if (buf.trim()) handle(buf.trim());
      } catch { throw unavailable(); }
      return toResult({ content, tool_calls: calls.filter(Boolean) }, finish, usage);
    },
    async warmUp({ system, tools }) {
      await post({ max_tokens: 1, messages: toApiMessages(system, [{ role: 'user', text: 'Hola' }]), tools: toApiTools(tools) });
    },
  };
}

module.exports = { createLocalProvider };
