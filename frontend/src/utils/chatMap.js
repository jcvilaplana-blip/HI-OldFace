/**
 * Mapas del chat con los mapas propios de OldFace (los mismos del taxi: PMTiles + MapLibre, nada de Google):
 *   · renderMapSnapshot(lat, lng) → imagen JPEG (data URL) del sitio, como la vista previa de WhatsApp.
 *     Se dibuja una sola vez fuera de la pantalla, de una en una, y se guarda en caché.
 *   · createChatMap(container, lat, lng) → mapa interactivo (pantalla completa) con su marcador.
 * MapLibre se carga solo cuando hace falta (no engorda la página del chat).
 */
import { taxiUrl } from './taxiApi';

const BRAND = '#3D5A80';
const CACHE_KEY = 'oldface_mapsnap_v1';
const CACHE_MAX = 60;
let libs = null;

async function loadLibs() {
  if (!libs) {
    libs = Promise.all([import('maplibre-gl'), import('pmtiles'), import('@protomaps/basemaps'), import('maplibre-gl/dist/maplibre-gl.css')])
      .then(([ml, pm, bm]) => {
        const maplibregl = ml.default || ml;
        // El protocolo pmtiles:// puede estar ya registrado por el mapa del taxi
        try { maplibregl.addProtocol('pmtiles', new pm.Protocol().tile); } catch { /* ya registrado */ }
        return { maplibregl, layers: bm.layers, namedFlavor: bm.namedFlavor };
      });
  }
  return libs;
}

function style({ layers, namedFlavor }) {
  const assets = taxiUrl('/maps/assets');
  return {
    version: 8,
    glyphs: `${assets}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${assets}/sprites/v4/light`,
    sources: { protomaps: { type: 'vector', url: `pmtiles://${taxiUrl('/maps/tiles/world.pmtiles')}`,
                            attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>' } },
    layers: layers('protomaps', namedFlavor('light'), { lang: 'es' }),
  };
}

/** Coordenadas de un mensaje de ubicación (nuevo: live/url con ?q=lat,lng; antiguo: texto "lat, lng") */
export function messageLatLng(msg) {
  if (msg?.live && Number.isFinite(msg.live.lat)) return { lat: msg.live.lat, lng: msg.live.lng };
  const src = `${msg?.url || ''} ${msg?.text || ''}`;
  const m = src.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
}

// ── Caché de capturas ──────────────────────────────────────────────────────
const memory = new Map();
function cacheGet(key) {
  if (memory.has(key)) return memory.get(key);
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')[key];
    if (v) memory.set(key, v);
    return v || null;
  } catch { return null; }
}
function cachePut(key, url) {
  memory.set(key, url);
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    all[key] = url;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - CACHE_MAX))) delete all[k];
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch { /* sin almacenamiento o lleno: queda en memoria */ }
}

// Las capturas se hacen de una en una (cada una usa un contexto WebGL)
let queue = Promise.resolve();

/** Captura del mapa centrado en el punto, con el marcador. Devuelve data URL (JPEG) o null si no se pudo */
export function renderMapSnapshot(lat, lng, { width = 320, height = 170, zoom = 15 } = {}) {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)},${zoom}`;
  const hit = cacheGet(key);
  if (hit) return Promise.resolve(hit);
  const job = queue.then(async () => {
    const again = cacheGet(key);
    if (again) return again;
    const lib = await loadLibs();
    const box = document.createElement('div');
    box.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;`;
    document.body.appendChild(box);
    let map = null;
    try {
      map = new lib.maplibregl.Map({
        container: box, style: style(lib), center: [lng, lat], zoom,
        interactive: false, attributionControl: false, fadeDuration: 0,
        canvasContextAttributes: { preserveDrawingBuffer: true },
      });
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('El mapa tarda demasiado')), 15000);
        map.once('idle', () => { clearTimeout(t); resolve(); });
        map.once('error', (e) => { if (!map.loaded()) { clearTimeout(t); reject(e.error || e); } });
      });
      // Marcador dibujado encima de la imagen del mapa
      const src = map.getCanvas();
      const out = document.createElement('canvas');
      out.width = src.width; out.height = src.height;
      const g = out.getContext('2d');
      g.fillStyle = '#ffffff';   // fondo blanco: lo transparente del mapa saldría negro en el JPEG
      g.fillRect(0, 0, out.width, out.height);
      g.drawImage(src, 0, 0);
      const s = src.width / width, x = out.width / 2, y = out.height / 2;
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.beginPath(); g.ellipse(x, y + 2 * s, 7 * s, 3 * s, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = BRAND; g.strokeStyle = 'white'; g.lineWidth = 3 * s;
      g.beginPath();
      g.moveTo(x, y);
      g.bezierCurveTo(x - 4 * s, y - 10 * s, x - 13 * s, y - 16 * s, x - 13 * s, y - 25 * s);
      g.arc(x, y - 25 * s, 13 * s, Math.PI, 0);
      g.bezierCurveTo(x + 13 * s, y - 16 * s, x + 4 * s, y - 10 * s, x, y);
      g.fill(); g.stroke();
      g.fillStyle = 'white';
      g.beginPath(); g.arc(x, y - 25 * s, 5 * s, 0, Math.PI * 2); g.fill();
      const url = out.toDataURL('image/jpeg', 0.82);
      cachePut(key, url);
      return url;
    } catch {
      return null;
    } finally {
      try { map?.remove(); } catch { /* nada */ }
      box.remove();
    }
  });
  queue = job.catch(() => null);
  return job;
}

/** Mapa interactivo a pantalla completa. Devuelve { setPosition(lat, lng), remove() } */
export async function createChatMap(container, lat, lng) {
  const lib = await loadLibs();
  const map = new lib.maplibregl.Map({
    container, style: style(lib), center: [lng, lat], zoom: 16,
    attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  const el = document.createElement('div');
  el.innerHTML = `<div style="width:22px;height:22px;border-radius:50%;background:${BRAND};border:4px solid white;box-shadow:0 2px 10px rgba(0,0,0,.4)"></div>`;
  const marker = new lib.maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
  return {
    setPosition(la, ln, follow = true) {
      marker.setLngLat([ln, la]);
      if (follow) map.easeTo({ center: [ln, la], duration: 600 });
    },
    remove() { try { map.remove(); } catch { /* nada */ } },
  };
}
