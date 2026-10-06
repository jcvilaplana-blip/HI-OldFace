/**
 * TaxiMap — mapa propio de OldFace: MapLibre GL + archivo PMTiles (OpenStreetMap) servido desde nuestro VPS,
 * con fuentes e iconos también propios. Sin Google Maps ni cuotas.
 *
 * Props: config {tiles, assets} · lang · center {lat,lng} · pickup · dropoff · driver {lat,lng,heading}
 *        route [[lng,lat]…] · centerPin (elegir punto moviendo el mapa) · onCenterChange(lat,lng)
 *        fit (cambia → encuadra ruta/marcadores) · padding {top,bottom}
 */
import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import { layers, namedFlavor } from '@protomaps/basemaps';
import { taxiUrl } from '../../utils/taxiApi';

const BRAND = '#000080';
let protocolReady = false;

const LANGS = ['es', 'en', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'ar', 'zh', 'ja', 'ko'];

function markerEl(kind) {
  const el = document.createElement('div');
  if (kind === 'driver') {
    el.innerHTML = `<div style="width:38px;height:38px;border-radius:50%;background:white;box-shadow:0 2px 10px rgba(0,0,0,.3);
      display:flex;align-items:center;justify-content:center;font-size:22px">🚕</div>`;
  } else if (kind === 'pickup') {
    el.innerHTML = `<div style="width:20px;height:20px;border-radius:50%;background:#16a34a;border:4px solid white;box-shadow:0 2px 8px rgba(0,0,0,.35)"></div>`;
  } else {
    el.innerHTML = `<div style="width:20px;height:20px;background:${BRAND};border:4px solid white;box-shadow:0 2px 8px rgba(0,0,0,.35)"></div>`;
  }
  return el;
}

export default function TaxiMap({ config, lang = 'es', center, pickup, dropoff, driver, route, centerPin, onCenterChange, fit, padding }) {
  const box = useRef(null);
  const map = useRef(null);
  const marks = useRef({});
  const onMove = useRef(onCenterChange);
  onMove.current = onCenterChange;

  // Crear el mapa una vez
  useEffect(() => {
    if (!protocolReady) { maplibregl.addProtocol('pmtiles', new Protocol().tile); protocolReady = true; }
    const assets = taxiUrl(config?.assets || '/maps/assets');
    const m = new maplibregl.Map({
      container: box.current,
      style: {
        version: 8,
        glyphs: `${assets}/fonts/{fontstack}/{range}.pbf`,
        sprite: `${assets}/sprites/v4/light`,
        sources: { protomaps: { type: 'vector', url: `pmtiles://${taxiUrl(config?.tiles || '/maps/tiles/world.pmtiles')}`,
                                attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>' } },
        layers: layers('protomaps', namedFlavor('light'), { lang: LANGS.includes(lang) ? lang : 'es' }),
      },
      center: [center?.lng ?? -3.7038, center?.lat ?? 40.4168],
      zoom: 15,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    m.touchZoomRotate.disableRotation();
    m.on('moveend', () => { const c = m.getCenter(); onMove.current?.(c.lat, c.lng); });
    map.current = m;
    return () => { m.remove(); map.current = null; marks.current = {}; };
  }, [config?.tiles, config?.assets, lang]); // eslint-disable-line

  // Centrar cuando cambia el centro pedido
  useEffect(() => {
    if (map.current && center && Number.isFinite(center.lat)) map.current.easeTo({ center: [center.lng, center.lat], duration: 600 });
  }, [center?.lat, center?.lng]); // eslint-disable-line

  // Marcadores
  const setMark = (kind, p) => {
    const m = map.current;
    if (!m) return;
    if (!p || !Number.isFinite(p.lat)) { marks.current[kind]?.remove(); delete marks.current[kind]; return; }
    if (!marks.current[kind]) marks.current[kind] = new maplibregl.Marker({ element: markerEl(kind), rotationAlignment: 'map' }).setLngLat([p.lng, p.lat]).addTo(m);
    else marks.current[kind].setLngLat([p.lng, p.lat]);
  };
  useEffect(() => setMark('pickup', centerPin ? null : pickup), [pickup?.lat, pickup?.lng, centerPin]); // eslint-disable-line
  useEffect(() => setMark('dropoff', dropoff), [dropoff?.lat, dropoff?.lng]); // eslint-disable-line
  useEffect(() => setMark('driver', driver), [driver?.lat, driver?.lng, driver?.heading]); // eslint-disable-line

  // Ruta
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const draw = () => {
      const data = { type: 'Feature', geometry: { type: 'LineString', coordinates: route?.length > 1 ? route : [] } };
      if (m.getSource('route')) m.getSource('route').setData(data);
      else {
        m.addSource('route', { type: 'geojson', data });
        m.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 9 } });
        m.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': BRAND, 'line-width': 5 } });
      }
    };
    if (m.isStyleLoaded()) draw(); else m.once('load', draw);
  }, [route]);

  // Encuadrar ruta y marcadores
  useEffect(() => {
    const m = map.current;
    if (!m || !fit) return;
    const pts = [...(route || []), ...[pickup, dropoff, driver].filter(p => p && Number.isFinite(p.lat)).map(p => [p.lng, p.lat])];
    if (pts.length < 2) return;
    const b = pts.reduce((acc, p) => acc.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
    m.fitBounds(b, { padding: { top: (padding?.top ?? 60) + 20, bottom: (padding?.bottom ?? 60) + 20, left: 40, right: 40 }, maxZoom: 16, duration: 700 });
  }, [fit]); // eslint-disable-line

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={box} style={{ position: 'absolute', inset: 0 }} />
      {centerPin && (
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -100%)', pointerEvents: 'none', zIndex: 2 }}>
          <svg width="36" height="46" viewBox="0 0 36 46"><path d="M18 0C8 0 0 8 0 18c0 13 18 28 18 28s18-15 18-28C36 8 28 0 18 0z" fill={BRAND} /><circle cx="18" cy="18" r="7" fill="white" /></svg>
        </div>
      )}
    </div>
  );
}
