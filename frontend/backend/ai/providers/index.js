/**
 * Elección del proveedor de IA por .env — cambiar de proveedor = añadir un adaptador aquí, sin tocar el agente.
 *   AI_PROVIDER = anthropic (por defecto si hay ANTHROPIC_API_KEY) · mock (pruebas) · off
 *   AI_MODEL (por defecto claude-opus-5-5) · AI_EFFORT (low|medium|high, por defecto medium) · AI_MAX_TOKENS
 *   AI_FALLBACKS=0 desactiva el reintento automático con otro modelo si Claude rechaza una petición
 */
const { createAnthropicProvider, ProviderError } = require('./anthropic');

/**
 * Proveedor de pruebas: no llama a ninguna IA. Último mensaje del usuario:
 *   "#tool <nombre> <json>"  → pide esa herramienta con esos parámetros (aunque no existan o no sean válidos)
 *   "#loop"                  → pide list_chats en cada vuelta (para probar el límite de vueltas)
 *   cualquier otra cosa       → "eco: <texto>"
 * Tras recibir resultados de herramientas responde "resultado: <json>".
 */
function createMockProvider() {
  let n = 0;
  return {
    name: 'mock',
    model: 'mock',
    async chat({ messages }) {
      const last = messages[messages.length - 1];
      const usage = { input: 10, output: 5 };
      const firstUser = messages.find(m => m.role === 'user' && m.text)?.text || '';
      if (last.toolResults && !firstUser.startsWith('#loop')) {
        return { text: `resultado: ${last.toolResults.map(r => r.content).join(' | ')}`, toolCalls: [], stopReason: 'end', usage, raw: null };
      }
      const t = last.toolResults ? firstUser : String(last.text || '');
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
  if (kind === 'anthropic' && env.ANTHROPIC_API_KEY) {
    return createAnthropicProvider({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.AI_MODEL || 'claude-opus-5-5',
      effort: ['low', 'medium', 'high', 'xhigh', 'max'].includes(env.AI_EFFORT) ? env.AI_EFFORT : 'medium',
      maxTokens: Math.min(Math.max(parseInt(env.AI_MAX_TOKENS || '16000', 10) || 16000, 1024), 64000),
      fallbacks: env.AI_FALLBACKS !== '0',
    });
  }
  return null;   // sin proveedor: Willy aparece como "no disponible"
}

module.exports = { createProvider, ProviderError };
