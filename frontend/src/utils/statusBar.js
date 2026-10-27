/**
 * Iconos de la barra de estado de Android (hora, batería, cobertura): oscuros sobre fondo claro y blancos sobre
 * fondo oscuro. La barra es transparente y deja ver lo que pinta la app debajo (cabecera clara, cabecera azul,
 * llamada, visor de fotos…), así que se mira el color real de lo que hay arriba y se avisa a la app nativa
 * solo cuando cambia. APK antiguos sin window.OldFaceUI: no hace nada.
 */
import { useEffect } from 'react';

function parseColor(str) {
  const m = String(str).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return { r, g, b, a };
}

const isLight = ({ r, g, b }) => (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55;

/** true si lo que se ve en lo alto de la pantalla es claro (→ iconos oscuros) */
function topIsLight() {
  let el = document.elementFromPoint(window.innerWidth / 2, 4);
  while (el && el !== document.documentElement) {
    if (el.tagName === 'VIDEO') return false;
    const cs = getComputedStyle(el);
    const bg = parseColor(cs.backgroundColor);
    if (bg && bg.a >= 0.5) return isLight(bg);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') {
      const first = parseColor(cs.backgroundImage);   // primer color del degradado
      if (first && first.a >= 0.5) return isLight(first);
    }
    el = el.parentElement;
  }
  const body = parseColor(getComputedStyle(document.body).backgroundColor);
  return body && body.a > 0 ? isLight(body) : !document.documentElement.classList.contains('dark');
}

/** Mantiene los iconos de la barra de estado legibles en todas las pantallas */
export function useStatusBarIcons() {
  useEffect(() => {
    const ui = window.OldFaceUI;
    if (!ui?.setStatusBarIcons) return undefined;
    let last = null;
    const check = () => {
      if (document.hidden) return;
      let dark;
      try { dark = topIsLight(); } catch { return; }
      if (dark === last) return;
      last = dark;
      try { ui.setStatusBarIcons(dark); } catch { /* nada */ }
    };
    const onVisible = () => { last = null; check(); };   // al volver a la app, aplicarlo otra vez
    check();
    const iv = setInterval(check, 500);
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVisible); };
  }, []);
}
