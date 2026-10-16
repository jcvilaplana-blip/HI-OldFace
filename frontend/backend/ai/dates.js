/**
 * Fechas para Willy, siempre en la hora de España (el VPS está en UTC).
 *
 *   rangeOf({ period, month, from_date, to_date }, now) → { from, to } en ms (to excluido) o null si no hay filtro
 *   stamp(ms) → '2026-10-15 18:30 (jueves)'   ·   nowText(now) → 'jueves 15 de octubre de 2026, 23:05'
 *
 * Los modelos pequeños calculan mal las fechas: por eso las herramientas aceptan `period` ("ayer", "la semana
 * pasada"…) y el servidor hace las cuentas. Las fechas exactas llegan como 'AAAA-MM-DD' (incluidas las dos).
 */
const TZ = 'Europe/Madrid';
const DAY = 86_400_000;
const PERIODS = ['today', 'yesterday', 'this_week', 'last_week', 'last_7_days', 'this_month', 'last_month', 'last_30_days', 'this_year', 'this_summer'];

const FMT = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });

/** Partes de la fecha en España: { y, m, d, h, min, wd } (wd: 0 = lunes) */
function partsOf(ms) {
  const p = Object.fromEntries(FMT.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, wd: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) };
}

/** Medianoche (hora de España) del día y/m/d → ms. Admite días fuera de rango (d = 0, 32…) como Date.UTC */
function midnight(y, m, d) {
  const guess = Date.UTC(y, m - 1, d);
  // A las 00:00 UTC en España son las 01:00 o las 02:00: esa es la diferencia que hay que restar
  const p = partsOf(guess);
  const offsetH = p.d === new Date(guess).getUTCDate() ? p.h : p.h - 24;
  return guess - offsetH * 3_600_000;
}

const parseDay = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
};

function rangeOf({ period, month, from_date, to_date } = {}, now = Date.now()) {
  const t = partsOf(now);
  const today = midnight(t.y, t.m, t.d);
  let from = null, to = null;
  switch (period) {
    case 'today': from = today; to = today + DAY; break;
    case 'yesterday': from = midnight(t.y, t.m, t.d - 1); to = today; break;
    case 'this_week': from = midnight(t.y, t.m, t.d - t.wd); to = now + 1; break;
    case 'last_week': from = midnight(t.y, t.m, t.d - t.wd - 7); to = midnight(t.y, t.m, t.d - t.wd); break;
    case 'last_7_days': from = now - 7 * DAY; to = now + 1; break;
    case 'this_month': from = midnight(t.y, t.m, 1); to = now + 1; break;
    case 'last_month': from = midnight(t.y, t.m - 1, 1); to = midnight(t.y, t.m, 1); break;
    case 'last_30_days': from = now - 30 * DAY; to = now + 1; break;
    case 'this_year': from = midnight(t.y, 1, 1); to = now + 1; break;
    case 'this_summer': from = midnight(t.y, 6, 21); to = midnight(t.y, 9, 23); break;
    default: break;
  }
  // "en marzo" = el último marzo (el de este año si ya ha llegado, si no el del año pasado)
  if (Number.isInteger(month) && month >= 1 && month <= 12) {
    const y = month > t.m ? t.y - 1 : t.y;
    from = midnight(y, month, 1); to = midnight(y, month + 1, 1);
  }
  const f = parseDay(from_date), e = parseDay(to_date);
  if (f) from = midnight(f.y, f.m, f.d);
  if (e) to = midnight(e.y, e.m, e.d + 1);
  if (from === null && to === null) return null;
  return { from: from ?? 0, to: to ?? Infinity };
}

const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const two = (n) => String(n).padStart(2, '0');

/** '2026-10-15 18:30 (jueves)' */
function stamp(ms) {
  if (!ms) return null;
  const p = partsOf(ms);
  return `${p.y}-${two(p.m)}-${two(p.d)} ${two(p.h)}:${two(p.min)} (${WEEKDAYS[p.wd]})`;
}

/** 'jueves 15 de octubre de 2026, 23:05' — para que el modelo sepa qué día es hoy */
function nowText(now = Date.now()) {
  const p = partsOf(now);
  return `${WEEKDAYS[p.wd]} ${p.d} de ${MONTHS[p.m - 1]} de ${p.y}, ${two(p.h)}:${two(p.min)}`;
}

module.exports = { PERIODS, rangeOf, stamp, nowText, partsOf, midnight };
