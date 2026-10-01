import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';

const STORAGE_KEY = 'supercart_delivery_address';

// Confirm wale naye fields bhi preserve rahen (purana data bhi chalta rahe)
const EXTRA_KEYS = ['houseNo', 'street', 'landmark', 'area', 'city', 'pincode', 'formattedAddress'];

const numOrNull = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : null);

const readStored = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.address !== 'string' || !parsed.address.trim()) return null;
    const extras = {};
    for (const k of EXTRA_KEYS) {
      if (typeof parsed[k] === 'string') extras[k] = parsed[k];
    }
    return {
      label: parsed.label || 'Home',
      address: parsed.address,
      lat: numOrNull(parsed.lat) ?? numOrNull(parsed.latitude),
      lng: numOrNull(parsed.lng) ?? numOrNull(parsed.longitude),
      ...extras,
    };
  } catch {
    return null;
  }
};

/**
 * Saved delivery address.
 * - Primary: structured address from the AddressPicker bottom sheet (localStorage).
 * - Fallback: Profile me saved `user.location` string (coords nahi hote).
 */
const useDeliveryAddress = () => {
  const { user, updateLocation } = useAuth();
  const [savedAddress, setSavedAddress] = useState(() => readStored());

  // Dusre tab/component me save ho to sync rakho
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY) setSavedAddress(readStored());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const saveAddress = useCallback((value) => {
    const extras = {};
    for (const k of EXTRA_KEYS) {
      if (typeof value[k] === 'string') extras[k] = value[k];
    }
    const lat = numOrNull(value.lat) ?? numOrNull(value.latitude);
    const lng = numOrNull(value.lng) ?? numOrNull(value.longitude);
    const next = {
      label: value.label || 'Home',
      address: value.address || '',
      lat,
      lng,
      // dono naming convention rakho taaki order/backend dono padh sakein
      latitude: lat,
      longitude: lng,
      ...extras,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    setSavedAddress(next);
    // Pin save hote hi Personal details ka "Location / delivery address" bhi update ho
    if (next.address && typeof updateLocation === 'function') {
      updateLocation(next.address);
    }
    return next;
  }, [updateLocation]);

  const clearAddress = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setSavedAddress(null);
  }, []);

  // Fallback: Profile ka location string (bina coords — distance pill chhupi rahegi)
  const effective =
    savedAddress ||
    (user?.location && String(user.location).trim()
      ? { label: 'Home', address: String(user.location).trim(), lat: null, lng: null }
      : null);

  return { savedAddress: effective, hasCoords: Boolean(effective?.lat != null && effective?.lng != null), saveAddress, clearAddress };
};

export default useDeliveryAddress;
