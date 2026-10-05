import { useCallback, useEffect, useRef, useState } from 'react';
import { LOCATION_STALL_MESSAGE, startRequestWatchdog } from './locationWatchdog';

const FIRST_FIX_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 12000,
  maximumAge: 0,
};

// Laptop (bina GPS) par high-accuracy aksar timeout/unavailable deta hai —
// isliye fallback: WiFi/IP based low-accuracy fix, lamba timeout.
const FALLBACK_FIX_OPTIONS = {
  enableHighAccuracy: false,
  timeout: 20000,
  maximumAge: 60000,
};

const WATCH_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 5000,
  timeout: 15000,
};

const BLOCKED_HELP_SHORT =
  'Location permission is blocked. In Chrome, click the 🔒/📍 icon left of the address bar → Location → Allow, then press the button again.';

// Permission API ka cached state — taaki "pehli baar popup aayega" vs
// "pehle se Blocked hai" me farq karke sahi message dikha sakein.
const getPermissionState = async () => {
  try {
    if (!('permissions' in navigator) || !navigator.permissions?.query) return 'unknown';
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return status?.state || 'unknown'; // 'granted' | 'prompt' | 'denied'
  } catch {
    return 'unknown';
  }
};

const toMessage = (err, permissionState) => {
  if (!err) return 'Location not found. Please try again.';
  // GeolocationPositionError codes: 1 = denied, 2 = unavailable, 3 = timeout
  if (err.code === 1) {
    // 'denied' = user ne pehle Block kiya tha (ab popup NAHI aayega) —
    // isliye exact unblock steps dikhao. 'prompt' = popup dismiss hua.
    if (permissionState === 'denied') return BLOCKED_HELP_SHORT;
    return 'Location permission denied. Please allow location. If you saw a popup, press Allow — otherwise allow it via the 🔒 icon.';
  }
  if (err.code === 2) return 'Location is unavailable. Keep WiFi ON on laptop + turn Windows Location Service ON, then retry.';
  if (err.code === 3) return 'Location request timed out. Please try again (low-accuracy retry is automatic).';
  return err.message || 'Location not found. Please try again.';
};

/**
 * useLiveLocation — delivery partner ki live GPS position ke liye reusable hook.
 *
 * - requestLocation(): getCurrentPosition (high accuracy) + pehli success ke baad watchPosition start
 * - watch unmount par auto clear hota hai
 * - position: { lng, lat, accuracy } | null
 */
const useLiveLocation = () => {
  const [position, setPosition] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [permissionState, setPermissionState] = useState('unknown'); // granted|prompt|denied|unknown
  const watchIdRef = useRef(null);
  const mountedRef = useRef(true);
  // Latest fix ka mirror — watchdog/timeout handlers ke liye (stale closure se
  // bachne ke liye; setPosition ke saath-saat update hota hai).
  const positionRef = useRef(null);
  // Request budget watchdog ka cancel fn — success/error/retry/unmount par clear.
  const watchdogCancelRef = useRef(null);
  const clearWatchdog = () => {
    try {
      watchdogCancelRef.current?.();
    } catch {
      /* ignore */
    }
    watchdogCancelRef.current = null;
  };

  useEffect(() => {
    mountedRef.current = true;
    // Mount par permission state lao + live suno (user settings me Allow
    // karte hi UI khud update ho jaye — bina page reload).
    let permStatus = null;
    const onPermChange = () => {
      if (!mountedRef.current) return;
      try { setPermissionState(permStatus?.state || 'unknown'); } catch { /* ignore */ }
    };
    (async () => {
      try {
        if ('permissions' in navigator && navigator.permissions?.query) {
          permStatus = await navigator.permissions.query({ name: 'geolocation' });
          if (mountedRef.current) setPermissionState(permStatus?.state || 'unknown');
          try { permStatus.addEventListener('change', onPermChange); } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    })();
    return () => {
      mountedRef.current = false;
      clearWatchdog();
      try { permStatus?.removeEventListener?.('change', onPermChange); } catch { /* ignore */ }
      if (watchIdRef.current !== null && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  const startWatch = useCallback(() => {
    if (!('geolocation' in navigator)) return;
    if (watchIdRef.current !== null) return;
    try {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          if (!mountedRef.current) return;
          if (pos?.coords?.latitude === 0 && pos?.coords?.longitude === 0) return;
          const fix = {
            lng: pos.coords.longitude,
            lat: pos.coords.latitude,
            accuracy: pos.coords.accuracy ?? null,
          };
          positionRef.current = fix;
          setPosition(fix);
        },
        async (err) => {
          if (!mountedRef.current) return;
          // Pehle se live fix hai to watch glitch ko error mat banao —
          // dot already dikh raha hai, toast noise hoga.
          if (positionRef.current) return;
          // watch ka denied = pehle se Blocked — short help dikhao
          const state = await getPermissionState();
          if (mountedRef.current) {
            setPermissionState(state);
            setError(toMessage(err, state));
          }
        },
        WATCH_OPTIONS,
      );
    } catch (e) {
      if (mountedRef.current) setError(toMessage(e, permissionState));
    }
  }, [permissionState]);

  const requestLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setError('This device does not support location.');
      return;
    }
    // file:// ya insecure http (non-localhost) par Geolocation block hota hai
    try {
      const insecure =
        typeof window !== 'undefined' &&
        window.isSecureContext === false;
      if (insecure) {
        setError('Insecure origin — open over https or localhost for location.');
        return;
      }
    } catch { /* ignore */ }
    setLoading(true);
    setError('');
    // Watchdog (ROOT-CAUSE FIX): browser kabhi callback na kare (mobile GPS
    // stall) to loading hamesha true atak jata tha → "Locating…" + spinner
    // button permanently stuck. Budget khatam, fix na aaya to loading false +
    // Retry-able message; baad me aane wala natural fix phir bhi apply hoga.
    clearWatchdog();
    watchdogCancelRef.current = startRequestWatchdog({
      hasFix: () => positionRef.current != null,
      onTimeout: () => {
        if (!mountedRef.current || positionRef.current) return;
        // eslint-disable-next-line no-console
        console.warn('[useLiveLocation] request budget exceeded — unstalling UI');
        setLoading(false);
        setError((prev) => prev || LOCATION_STALL_MESSAGE);
      },
    });

    const onSuccess = (pos) => {
      if (!mountedRef.current) return;
      // Laptop WiFi fix kabhi (0,0) ya absurd accuracy deta hai — filter karo
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      if (typeof lat !== 'number' || typeof lng !== 'number' || (lat === 0 && lng === 0)) {
        clearWatchdog();
        setLoading(false);
        setError('Location is unavailable. Keep WiFi ON on laptop + turn Windows Location Service ON, then retry.');
        return;
      }
      // eslint-disable-next-line no-console
      console.info('[useLiveLocation] fix mila:', lat, lng, '±', pos.coords.accuracy, 'm');
      const fix = {
        lng,
        lat,
        accuracy: pos.coords.accuracy ?? null,
      };
      positionRef.current = fix;
      setPosition(fix);
      clearWatchdog();
      setLoading(false);
      setError('');
      startWatch();
    };

    const onFatalError = async (err) => {
      if (!mountedRef.current) return;
      const state = await getPermissionState();
      if (!mountedRef.current) return;
      clearWatchdog();
      setPermissionState(state);
      // eslint-disable-next-line no-console
      console.warn('[useLiveLocation] geolocation error:', err?.code, err?.message, 'perm=', state);
      setLoading(false);
      setError(toMessage(err, state));
    };

    // Laptop fallback: high-accuracy timeout/unavailable → low-accuracy retry
    const onFirstError = (err) => {
      if (!mountedRef.current) return;
      if (err?.code === 2 || err?.code === 3) {
        // eslint-disable-next-line no-console
        console.info('[useLiveLocation] high-accuracy fail, low-accuracy retry…');
        try {
          navigator.geolocation.getCurrentPosition(onSuccess, onFatalError, FALLBACK_FIX_OPTIONS);
          return; // loading true rakho — retry chal raha hai
        } catch (e) {
          onFatalError(e);
          return;
        }
      }
      onFatalError(err);
    };

    // eslint-disable-next-line no-console
    console.info('[useLiveLocation] requesting GPS fix… perm=', permissionState);
    try {
      // NOTE: ye call locate button + page-load auto-recenter se hoti hai,
      // isliye pehli baar browser ka Allow/Block popup YAHIN trigger hota hai.
      navigator.geolocation.getCurrentPosition(onSuccess, onFirstError, FIRST_FIX_OPTIONS);
    } catch (e) {
      if (mountedRef.current) {
        clearWatchdog();
        setLoading(false);
        setError(toMessage(e, permissionState));
      }
    }
  }, [startWatch, permissionState]);

  const clearError = useCallback(() => setError(''), []);

  const isBlocked = permissionState === 'denied' || /blocked/i.test(error || '');

  return { position, loading, error, requestLocation, clearError, permissionState, isBlocked };
};

export default useLiveLocation;
