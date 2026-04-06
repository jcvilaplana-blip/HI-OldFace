/**
 * Hook para geolocalización con Capacitor
 */
import { useState, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';

export function useGeolocation() {
  const [location, setLocation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const getCurrentPosition = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      if (Capacitor.isNativePlatform()) {
        const { Geolocation } = await import('@capacitor/geolocation');
        
        const permission = await Geolocation.requestPermissions();
        if (permission.location !== 'granted') {
          throw new Error('Permiso de ubicación denegado');
        }

        const pos = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 10000
        });

        const loc = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp
        };

        setLocation(loc);
        return loc;
      } else {
        // En web
        return new Promise((resolve, reject) => {
          if (!navigator.geolocation) {
            reject(new Error('Geolocalización no disponible'));
            return;
          }

          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const loc = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
                timestamp: pos.timestamp
              };
              setLocation(loc);
              setLoading(false);
              resolve(loc);
            },
            (err) => {
              setError(err.message);
              setLoading(false);
              reject(err);
            }
          );
        });
      }
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Formatear ubicación para mensaje
  const formatLocationMessage = (loc) => {
    if (!loc) return null;
    return {
      type: 'location',
      lat: loc.lat,
      lng: loc.lng,
      url: `https://maps.google.com/?q=${loc.lat},${loc.lng}`,
      text: `📍 Mi ubicación\n${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}`
    };
  };

  return { location, loading, error, getCurrentPosition, formatLocationMessage };
}
