/**
 * Proveedor Anthropic (Claude) para OldFace AI — SDK oficial @anthropic-ai/sdk.
 *
 * Interfaz común de los proveedores (el agente no sabe cuál hay detrás):
 *   chat({ system, messages, tools }) → { text, toolCalls: [{ id, name, input }], stopReason, usage: { input, output }, raw }
 *   stopReason: 'end' | 'tool_use' | 'max_tokens' | 'refusal'
 *
 * Mensajes neutros: { role: 'user', text } · { role: 'user', toolResults: [{ id, content, isError }] }
 *                   { role: 'assistant', text, toolCalls, raw }  (raw = contenido tal cual lo devolvió Claude)
 * Dentro de una misma petición el turno del asistente se devuelve sin tocar (raw), con sus bloques de razonamiento:
 * el historial solo crece, nunca se edita. Los turnos de peticiones anteriores llegan de la app como texto.
 */
const Anthropic = require('@anthropic-ai/sdk');
const AnthropicClient = Anthropic.default || Anthropic;

/** Error del proveedor con un mensaje para el usuario y si merece la pena reintentar más tarde */
class ProviderError extends Error {
  constructor(message, { status = 502, retryable = false } = {}) { super(message); this.status = status; this.retryable = retryable; }
}

function toApiMessages(messages) {
  return messages.map((m) => {
    if (m.role === 'assistant') return { role: 'assistant', content: m.raw || [{ type: 'text', text: m.text || '…' }] };
    if (m.toolResults) {
      return {
        role: 'user',
        content: m.toolResults.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, ...(r.isError ? { is_error: true } : {}) })),
      };
    }
    return { role: 'user', content: m.text };
  });
}

const STOP = { end_turn: 'end', tool_use: 'tool_use', max_tokens: 'max_tokens', refusal: 'refusal' };

function createAnthropicProvider({ apiKey, model, effort, maxTokens, fallbacks }) {
  const client = new AnthropicClient({ apiKey, maxRetries: 2, timeout: 90_000 });

  return {
    name: 'anthropic',
    model,
    async chat({ system, messages, tools, toolChoice }) {
      const params = {
        model,
        max_tokens: maxTokens,
        // Instrucciones y herramientas fijas → se pueden reutilizar en caché entre peticiones
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools,
        // 'required' (el agente lo pide si el modelo contestó sin hacer nada) = usar alguna herramienta
        ...(toolChoice === 'required' ? { tool_choice: { type: 'any' } } : {}),
        messages: toApiMessages(messages),
        output_config: { effort },
      };
      let res;
      try {
        // Si Claude rechaza la petición por sus filtros de seguridad, el servidor reintenta con otro modelo
        res = fallbacks
          ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
          : await client.messages.create(params);
      } catch (err) {
        if (err instanceof AnthropicClient.AuthenticationError) throw new ProviderError('Willy no está bien configurado (clave de la IA no válida)', { status: 503 });
        if (err instanceof AnthropicClient.RateLimitError) throw new ProviderError('Willy está muy ocupado ahora mismo. Inténtalo en un momento.', { status: 503, retryable: true });
        if (err instanceof AnthropicClient.BadRequestError) {
          console.warn('[ai] petición rechazada:', err.message);
          // Sin saldo en la cuenta de Anthropic: no es culpa del usuario
          if (/credit balance/i.test(err.message)) throw new ProviderError('Willy no está disponible ahora mismo', { status: 503 });
          throw new ProviderError('Willy no ha podido procesar esa petición');
        }
        if (err instanceof AnthropicClient.APIError) { console.warn(`[ai] error ${err.status}:`, err.message); throw new ProviderError('Willy no está disponible ahora mismo', { status: 503, retryable: true }); }
        throw err;
      }
      const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      const toolCalls = res.content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, input: b.input }));
      const u = res.usage || {};
      return {
        text, toolCalls,
        stopReason: STOP[res.stop_reason] || 'end',
        usage: { input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), output: u.output_tokens || 0 },
        raw: res.content,
      };
    },
  };
}

module.exports = { createAnthropicProvider, ProviderError };
