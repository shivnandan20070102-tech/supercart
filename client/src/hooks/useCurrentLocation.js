import { useCallback, useEffect, useRef, useState } from 'react';

const toMessage = (err) => {
  if (!err) return "Couldn't get your location. Please search your location manually.";
  // GeolocationPositionError codes: 1 = denied, 2 = unavailable, 3 = timeout
  if (err.code === 1) return 'Location permission denied. Please allow location access or search your location manually.';
  if (err.code === 2) return 'Location is unavailable. Please check GPS or search your location manually.';
  if (err.code === 3) return 'Location request timed out. Please try again or search manually.';
  return err.message || "Couldn't get your location. Please try again.";
};

const FIX_OPTS = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };
const WATCH_OPTS = { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 };

const hasGeo = () => typeof navigator !== 'undefined' && 'geolocation' in navigator;

/**
 * useCurrentLocation — GPS fix ke liye reusable hook.
 * - requestLocation(): single-shot getCurrentPosition fix (manual recenter button ke liye).
 * - startWatch()/stopWatch(): live watchPosition updates (auto location + live dot ke liye).
 * - reset(): coords/error/loading clear (picker dobara khulne par stale fix na rahe).
 * Unmount par watcher hamesha clear hota hai (memory leak nahi).
 * Returns { coords: { lat, lng, accuracy } | null, loading, error,
 *           requestLocation, startWatch, stopWatch, reset, clearError }.
 */
const useCurrentLocation = () => {
  const [coords, setCoords] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const mountedRef = useRef(true);
  const watchIdRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (watchIdRef.current != null && hasGeo()) {
        try {
          navigator.geolocation.clearWatch(watchIdRef.current);
        } catch {
          /* ignore */
        }
        watchIdRef.current = null;
      }
    };
  }, []);

  const applyFix = useCallback((pos) => {
    if (!mountedRef.current) return;
    setCoords({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? null,
    });
    setLoading(false);
    setError('');
  }, []);

  const applyError = useCallback((err) => {
    if (!mountedRef.current) return;
    setLoading(false);
    setError(toMessage(err));
  }, []);

  const requestLocation = useCallback(() => {
    if (!hasGeo()) {
      setError('Location is not supported on this device. Please search manually.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      navigator.geolocation.getCurrentPosition(applyFix, applyError, FIX_OPTS);
    } catch (e) {
      if (mountedRef.current) {
        setLoading(false);
        setError(toMessage(e));
      }
    }
  }, [applyFix, applyError]);

  const startWatch = useCallback(() => {
    if (!hasGeo()) {
      setError('Location is not supported on this device. Please search manually.');
      return;
    }
    // Duplicate watcher mat banao — pehle wala hi live updates dega.
    if (watchIdRef.current != null) return;
    setLoading(true);
    setError('');
    try {
      watchIdRef.current = navigator.geolocation.watchPosition(applyFix, applyError, WATCH_OPTS);
    } catch (e) {
      watchIdRef.current = null;
      if (mountedRef.current) {
        setLoading(false);
        setError(toMessage(e));
      }
    }
  }, [applyFix, applyError]);

  const stopWatch = useCallback(() => {
    if (watchIdRef.current != null && hasGeo()) {
      try {
        navigator.geolocation.clearWatch(watchIdRef.current);
      } catch {
        /* ignore */
      }
    }
    watchIdRef.current = null;
    if (mountedRef.current) setLoading(false);
  }, []);

  const reset = useCallback(() => {
    if (!mountedRef.current) return;
    setCoords(null);
    setError('');
    setLoading(false);
  }, []);

  const clearError = useCallback(() => setError(''), []);

  return { coords, loading, error, requestLocation, startWatch, stopWatch, reset, clearError };
};

export default useCurrentLocation;
