import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../config/supabase';
import { SERVICE_RADIUS_KM } from '../config/store';
import {
  findNearestStore,
  readDeliveryCoords,
  readGpsCoords,
  readStoredNearest,
  saveNearestStore,
} from '../services/nearestStore';

const StoreContext = createContext(null);

const GPS_STORAGE_KEY = 'supercart_gps_coords';

/**
 * StoreProvider — do cheezein manage karta hai:
 * 1. Global store on/off status (store_settings, pehle se tha)
 * 2. Multi-store: user location se nearest ACTIVE store (5km radius),
 *    session-persisted taaki Home/Cart/Header sab use kar sakein.
 *
 * serviceable: true (store mila) | false (5km me koi store nahi) | null (location/radius unknown)
 */
export const StoreProvider = ({ children }) => {
  const [isOnline, setIsOnline] = useState(true);
  const [storeLoading, setStoreLoading] = useState(true);

  // --- Multi-store state ---
  const [nearestStore, setNearestStore] = useState(() => readStoredNearest());
  const [serviceable, setServiceable] = useState(null);
  const [locationChecked, setLocationChecked] = useState(false);
  const [nearestLoading, setNearestLoading] = useState(false);
  const [userCoords, setUserCoords] = useState(() => readDeliveryCoords() || readGpsCoords());
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [storesAvailable, setStoresAvailable] = useState(true);
  const resolveRef = useRef(0);

  // Saved address badle (dusre component/tab se) to coords sync karo.
  // IMPORTANT: sirf tab apply karo jab stored address ACTUALLY badla ho.
  // Pehle har 2s poll saved-address coords ko force karta tha, jisse "Try my
  // current location" wala fresh GPS fix 2 second me wapas overwrite ho jata
  // tha aur 5km re-check kabhi stick nahi karta tha. Ab unchanged storage
  // userCoords ko haath nahi lagata — GPS fix bana rehta hai jab tak user
  // picker se naya address save nahi karta.
  const lastAddressKeyRef = useRef(null);
  useEffect(() => {
    const keyOf = (c) => (c ? `${c.lat},${c.lng}` : '');
    // Initial state readDeliveryCoords() se hi aaya tha — use baseline banao
    // taaki pehla poll redundant set na kare.
    lastAddressKeyRef.current = keyOf(readDeliveryCoords());
    const syncFromStorage = () => {
      const coords = readDeliveryCoords();
      const key = keyOf(coords);
      if (!key || key === lastAddressKeyRef.current) return;
      lastAddressKeyRef.current = key;
      setUserCoords((prev) => (prev?.lat === coords.lat && prev?.lng === coords.lng ? prev : coords));
    };
    window.addEventListener('storage', syncFromStorage);
    // Same-tab save par 'storage' event fire nahi hota — chhota poll rakho
    const timer = window.setInterval(syncFromStorage, 2000);
    return () => {
      window.removeEventListener('storage', syncFromStorage);
      window.clearInterval(timer);
    };
  }, []);

  // Prompt-1 wale SQL function se nearest active store (shared service —
  // wahi logic Cart order-time par bhi use karta hai taaki store_id pakka sahi ho).
  const resolveNearestStore = useCallback(async (lat, lng) => {
    const runId = ++resolveRef.current;
    setNearestLoading(true);
    try {
      const result = await findNearestStore(supabase, lat, lng, SERVICE_RADIUS_KM);
      if (runId !== resolveRef.current) return;
      setNearestStore(result.store);
      saveNearestStore(result.store);
      setServiceable(result.serviceable);
      setStoresAvailable(result.storesAvailable);
      setLocationChecked(true);
    } catch (err) {
      if (runId !== resolveRef.current) return;
      console.warn('Nearest store resolve nahi hua:', err?.message || err);
      setLocationChecked(true);
    } finally {
      if (runId === resolveRef.current) setNearestLoading(false);
    }
  }, []);

  // Coords milte hi nearest store auto-resolve karo
  useEffect(() => {
    if (userCoords?.lat != null && userCoords?.lng != null) {
      resolveNearestStore(userCoords.lat, userCoords.lng);
    } else {
      setLocationChecked(false);
      setServiceable(null);
    }
  }, [userCoords?.lat, userCoords?.lng, resolveNearestStore]);

  // App khulne par: saved address nahi hai to ek baar silent GPS try karo
  useEffect(() => {
    if (readDeliveryCoords()) return;
    if (readGpsCoords()) return;
    if (!('geolocation' in navigator)) return;
    let cancelled = false;
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setUserCoords(coords);
          try {
            sessionStorage.setItem(GPS_STORAGE_KEY, JSON.stringify(coords));
          } catch {
            /* ignore */
          }
        },
        () => {
          /* permission denied — user address picker se set karega */
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 },
      );
    } catch {
      /* ignore */
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Manual "meri current location use karo" (banner/retry button ke liye)
  const requestGpsLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setGpsError('Location is not supported on this device.');
      return;
    }
    setGpsLoading(true);
    setGpsError('');
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setUserCoords(coords);
          try {
            sessionStorage.setItem(GPS_STORAGE_KEY, JSON.stringify(coords));
          } catch {
            /* ignore */
          }
          setGpsLoading(false);
        },
        (err) => {
          setGpsLoading(false);
          if (err?.code === 1) setGpsError('Location permission denied. Please allow location access.');
          else setGpsError("Couldn't get your location. Please try again.");
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      );
    } catch {
      setGpsLoading(false);
      setGpsError("Couldn't get your location. Please try again.");
    }
  }, []);

  const refreshNearestStore = useCallback(() => {
    if (userCoords?.lat != null && userCoords?.lng != null) {
      resolveNearestStore(userCoords.lat, userCoords.lng);
    }
  }, [userCoords?.lat, userCoords?.lng, resolveNearestStore]);

  // --- Pehle wala global on/off status logic (unchanged) ---
  useEffect(() => {
    let mounted = true;

    const loadStoreStatus = async () => {
      const { data, error } = await supabase
        .from('store_settings')
        .select('id, is_online')
        .limit(1)
        .maybeSingle();

      if (mounted) {
        if (!error && data) setIsOnline(data.is_online);
        setStoreLoading(false);
      }
    };

    loadStoreStatus();
    const channel = supabase
      .channel('store-settings-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_settings' }, (payload) => {
        if (mounted && typeof payload.new?.is_online === 'boolean') {
          setIsOnline(payload.new.is_online);
        }
      })
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  const setStoreOnline = async (online) => {
    const { data: existing, error: readError } = await supabase
      .from('store_settings')
      .select('id, is_online')
      .limit(1)
      .maybeSingle();
    if (readError) throw readError;

    const result = existing
      ? await supabase.from('store_settings').update({ is_online: online }).eq('id', existing.id)
      : await supabase.from('store_settings').insert({ is_online: online });
    if (result.error) throw result.error;
    setIsOnline(online);
  };

  return (
    <StoreContext.Provider
      value={{
        isOnline,
        storeLoading,
        setStoreOnline,
        // Multi-store
        nearestStore,
        serviceable,
        serviceRadiusKm: SERVICE_RADIUS_KM,
        userCoords,
        hasLocation: Boolean(userCoords?.lat != null && userCoords?.lng != null),
        locationChecked,
        nearestLoading,
        storesAvailable,
        gpsLoading,
        gpsError,
        requestGpsLocation,
        refreshNearestStore,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
};

export const useStore = () => {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore must be used within StoreProvider');
  return context;
};
