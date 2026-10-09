/**
 * Idioma de la app = el del dispositivo (español si el móvil/navegador está en español; si no, inglés).
 *
 *   tr('Ajustes')                       → "Settings" en inglés
 *   tr('Hace {n} min', { n: 5 })        → "5 min ago"
 *
 * La clave es la propia frase en español: si falta una traducción se muestra en español (nunca un hueco).
 * El idioma se fija al arrancar, así que también sirve en constantes de módulo.
 */
import en from './en.js';

function detect() {
  try {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language || 'es'];
    return String(langs[0] || 'es').toLowerCase().startsWith('es') ? 'es' : 'en';
  } catch { return 'es'; }
}

export const LANG = detect();
/** Formato de fechas y números (toLocaleDateString, Intl…) */
export const LOCALE = LANG === 'es' ? 'es-ES' : 'en-GB';

try { document.documentElement.lang = LANG; } catch { /* sin DOM */ }

const dict = LANG === 'en' ? en : null;

export function tr(text, vars) {
  if (text == null) return '';
  let s = dict ? (dict[text] ?? text) : text;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return s;
}
