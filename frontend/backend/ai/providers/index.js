/**
 * Elección del proveedor de IA por .env — cambiar de proveedor = añadir un adaptador aquí, sin tocar el agente.
 *   AI_PROVIDER = anthropic (por defecto si hay ANTHROPIC_API_KEY) · local (modelo libre en llm-server/) · mock (pruebas) · off
 *   AI_MODEL (por defecto claude-opus-5-5) · AI_EFFORT (low|medium|high, por defecto medium) · AI_MAX_TOKENS
 *   AI_FALLBACKS=0 desactiva el reintento automático con otro modelo si Claude rechaza una petición
 *   Local: LOCAL_LLM_URL (p. ej. http://127.0.0.1:8089) · LOCAL_LLM_MODEL (nombre informativo, por defecto qwen3-8b)
 *          LOCAL_LLM_MAX_TOKENS (por defecto 1024) · LOCAL_LLM_THINKING=1 deja que el modelo "piense" (más lento)
 */
const { createAnthropicProvider, ProviderError } = require('./anthropic');
const { createLocalProvider } = require('./local');

/** Modelos que admiten el reintento automático en el servidor de Anthropic si la petición se rechaza */
const FALLBACK_MODELS = /^claude-(opus-5(-5)?|fable-5-1|sonnet-5-5)$/;

/**
 * Proveedor de pruebas: no llama a ninguna IA. Último mensaje del usuario:
 *   "#tool <nombre> <json>"  → pide esa herramienta con esos parámetros (aunque no existan o no sean válidos);
 *                              lo que siga en una línea "## …" se ignora (simula el resto de la pregunta)
 *   "#loop"                  → pide list_chats en cada vuelta (para probar el límite de vueltas)
 *   cualquier otra cosa       → "eco: <texto>"
 * Tras recibir resultados de herramientas responde "resultado: <json>".
 */
function createMockProvider() {
  let n = 0;
  // El agente añade la fecha de hoy al último mensaje ("(Ahora: …)"): el simulador la ignora
  // y lo que vaya tras "\n##" (texto libre de la pregunta, para probar lo que el servidor deduce de ella)
  const plain = (s) => String(s || '').replace(/\n\n\(Ahora: [^)]*\)$/, '').split('\n##')[0];
  return {
    name: 'mock',
    model: 'mock',
    async chat({ messages }) {
      const last = messages[messages.length - 1];
      const usage = { input: 10, output: 5 };
      const firstUser = plain(messages.find(m => m.role === 'user' && m.text)?.text);
      if (last.toolResults && !firstUser.startsWith('#loop')) {
        return { text: `resultado: ${last.toolResults.map(r => r.content).join(' | ')}`, toolCalls: [], stopReason: 'end', usage, raw: null };
      }
      const t = last.toolResults ? firstUser : plain(last.text);
      const m = t.match(/^#tool\s+(\S+)\s*(.*)$/s);
      if (m || t.startsWith('#loop')) {
        let input = {};
        if (m && m[2].trim()) { try { input = JSON.parse(m[2]); } catch { input = m[2]; } }
        const call = { id: `call_${++n}`, name: m ? m[1] : 'list_chats', input };
        return { text: '', toolCalls: [call], stopReason: 'tool_use', usage,
                 raw: [{ type: 'tool_use', id: call.id, name: call.name, input: call.input }] };
      }
      return { text: `eco: ${t}`, toolCalls: [], stopReason: 'end', usage, raw: null };
    },
  };
}

function createProvider(env = process.env) {
  const kind = (env.AI_PROVIDER || (env.ANTHROPIC_API_KEY ? 'anthropic' : 'off')).toLowerCase();
  if (kind === 'mock') return createMockProvider();
  if (kind === 'local' && env.LOCAL_LLM_URL) {
    return createLocalProvider({
      baseUrl: env.LOCAL_LLM_URL,
      model: env.LOCAL_LLM_MODEL || 'qwen3-8b',
      maxTokens: Math.min(Math.max(parseInt(env.LOCAL_LLM_MAX_TOKENS || '1024', 10) || 1024, 128), 8192),
      noThinking: env.LOCAL_LLM_THINKING !== '1',
    });
  }
  if (kind === 'anthropic' && env.ANTHROPIC_API_KEY) {
    const model = env.AI_MODEL || 'claude-opus-5-5';
    return createAnthropicProvider({
      apiKey: env.ANTHROPIC_API_KEY,
      model,
      effort: ['low', 'medium', 'high', 'xhigh', 'max'].includes(env.AI_EFFORT) ? env.AI_EFFORT : 'medium',
      maxTokens: Math.min(Math.max(parseInt(env.AI_MAX_TOKENS || '16000', 10) || 16000, 1024), 64000),
      // El reintento con otro modelo solo existe para algunos (Haiku no lo tiene: la petición fallaría)
      fallbacks: env.AI_FALLBACKS !== '0' && FALLBACK_MODELS.test(model),
    });
  }
  return null;   // sin proveedor: Willy aparece como "no disponible"
}

module.exports = { createProvider, ProviderError };
