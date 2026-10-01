import { useCallback, useEffect, useRef, useState } from 'react';

const toMessage = (err) => {
  if (!err) return "Couldn't get your location. Please try again.";
  // GeolocationPositionError codes: 1 = denied, 2 = unavailable, 3 = timeout
  if (err.code === 1) return 'Location permission denied. Please allow location access.';
  if (err.code === 2) return 'Location is unavailable. Please check GPS.';
  if (err.code === 3) return 'Location request timed out. Please try again.';
  return err.message || "Couldn't get your location. Please try again.";
};

/**
 * useCurrentLocation — single-shot GPS fix ke liye reusable hook.
 * Returns { coords: { lat, lng, accuracy } | null, loading, error, requestLocation, clearError }.
 */
const useCurrentLocation = () => {
  const [coords, setCoords] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const requestLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setError('Location is not supported on this device.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (!mountedRef.current) return;
          setCoords({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? null,
          });
          setLoading(false);
          setError('');
        },
        (err) => {
          if (!mountedRef.current) return;
          setLoading(false);
          setError(toMessage(err));
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      );
    } catch (e) {
      if (mountedRef.current) {
        setLoading(false);
        setError(toMessage(e));
      }
    }
  }, []);

  const clearError = useCallback(() => setError(''), []);

  return { coords, loading, error, requestLocation, clearError };
};

export default useCurrentLocation;
