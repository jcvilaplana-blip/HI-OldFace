/** geo — utilidades geográficas (distancias, zonas, ciudad de un punto) */

/** Distancia en km entre dos puntos (fórmula de Haversine) */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** ¿Está el punto dentro del polígono [[lng,lat],…]? (ray casting) */
function pointInPolygon(lat, lng, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/** Caja aproximada (grados) que contiene un radio en km alrededor de un punto — para prefiltrar en SQL */
function bbox(lat, lng, km) {
  const dLat = km / 111, dLng = km / (111 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

const validPoint = (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))
  && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

module.exports = { haversineKm, pointInPolygon, bbox, validPoint };
