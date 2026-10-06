/**
 * i18n — textos del panel. El texto en español es la propia clave; si el idioma elegido tiene
 * traducción (Idiomas → "Traducciones del panel"), se usa esa.
 */
let dict = {};
export const setDictionary = (d) => { dict = d && typeof d === 'object' ? d : {}; };
export const t = (text, vars) => {
  let s = dict[text] || text;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
};

const nf = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (n, symbol = '€') => (n === null || n === undefined || n === '' ? '—' : `${nf.format(Number(n))} ${symbol}`);
export const dateTime = (ms) => (ms ? new Date(Number(ms)).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
