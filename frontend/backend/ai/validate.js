/**
 * Validación estricta de los parámetros que el modelo manda a una herramienta (subconjunto de JSON Schema).
 *   validate(schema, value) → { ok: true, value } | { ok: false, error }
 * Admite: object (properties, required, additionalProperties: false obligatorio), string (minLength, maxLength,
 * enum, pattern), integer (minimum, maximum), boolean. Cualquier otra cosa en el esquema es un error de programación.
 * Lo que no encaje se rechaza: el modelo nunca llega a la herramienta con datos sin comprobar.
 */

function check(schema, value, at) {
  switch (schema.type) {
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return `${at}: se esperaba un objeto`;
      if (schema.additionalProperties !== false) throw new Error(`esquema ${at}: falta additionalProperties: false`);
      const props = schema.properties || {};
      for (const k of Object.keys(value)) if (!(k in props)) return `${at}: campo no permitido "${k}"`;
      for (const k of schema.required || []) if (value[k] === undefined) return `${at}: falta "${k}"`;
      for (const [k, sub] of Object.entries(props)) {
        if (value[k] === undefined) continue;
        const err = check(sub, value[k], `${at}.${k}`);
        if (err) return err;
      }
      return null;
    }
    case 'string':
      if (typeof value !== 'string') return `${at}: se esperaba texto`;
      if (schema.minLength !== undefined && value.length < schema.minLength) return `${at}: demasiado corto`;
      if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${at}: demasiado largo`;
      if (schema.enum && !schema.enum.includes(value)) return `${at}: valor no permitido`;
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) return `${at}: formato no válido`;
      return null;
    case 'integer':
      if (!Number.isInteger(value)) return `${at}: se esperaba un número entero`;
      if (schema.minimum !== undefined && value < schema.minimum) return `${at}: menor que ${schema.minimum}`;
      if (schema.maximum !== undefined && value > schema.maximum) return `${at}: mayor que ${schema.maximum}`;
      return null;
    case 'boolean':
      return typeof value === 'boolean' ? null : `${at}: se esperaba true/false`;
    default:
      throw new Error(`esquema ${at}: tipo no admitido "${schema.type}"`);
  }
}

function validate(schema, value) {
  const error = check(schema, value, 'input');
  return error ? { ok: false, error } : { ok: true, value };
}

module.exports = { validate };
