/**
 * Proveedor "local": modelo libre en nuestro propio servidor (llm-server/, llama.cpp con API compatible con OpenAI,
 * solo en 127.0.0.1). Gratis y sin enviar datos fuera del VPS; más lento y menos fiable que Claude.
 *
 * Misma interfaz que anthropic.js:
 *   chat({ system, messages, tools }) → { text, toolCalls: [{ id, name, input }], stopReason, usage: { input, output }, raw }
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

  return {
    name: 'local',
    model,
    async chat({ system, messages, tools }) {
      const data = await post({ max_tokens: maxTokens, temperature: 0.2, messages: toApiMessages(system, messages), tools: toApiTools(tools) });
      const choice = data.choices?.[0] || {};
      const msg = choice.message || {};
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
      const text = String(msg.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      const u = data.usage || {};
      return {
        text, toolCalls,
        stopReason: toolCalls.length ? 'tool_use' : choice.finish_reason === 'length' ? 'max_tokens' : 'end',
        usage: { input: u.prompt_tokens || 0, output: u.completion_tokens || 0 },
        raw: { role: 'assistant', content: msg.content || '', ...(rawCalls.length ? { tool_calls: rawCalls } : {}) },
      };
    },
    async warmUp({ system, tools }) {
      await post({ max_tokens: 1, messages: toApiMessages(system, [{ role: 'user', text: 'Hola' }]), tools: toApiTools(tools) });
    },
  };
}

module.exports = { createLocalProvider };
