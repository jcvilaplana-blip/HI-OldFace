/**
 * El WebView de Android pinta un cuadro gris con un "play" en todo <video> que aún no tiene imagen
 * (al conectar una llamada o videollamada, al abrir un vídeo…). Con un póster transparente se ve el fondo
 * de la pantalla hasta que llega el primer fotograma, como en una app nativa.
 * Se aplica solo a todos los <video> sin póster propio, también a los que se crean después.
 */
const NO_POSTER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function fix(node) {
  if (node.nodeType !== 1) return;
  if (node.tagName === 'VIDEO') { if (!node.getAttribute('poster')) node.setAttribute('poster', NO_POSTER); return; }
  node.querySelectorAll?.('video:not([poster])').forEach(v => v.setAttribute('poster', NO_POSTER));
}

try {
  fix(document.documentElement);
  new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(fix)))
    .observe(document.documentElement, { childList: true, subtree: true });
} catch { /* sin DOM */ }
