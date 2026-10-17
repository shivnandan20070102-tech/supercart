import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';

const STORAGE_KEY = 'supercart_delivery_address';
// Same-tab sync: 'storage' event sirf dusre tabs me fire hota hai, isliye
// auto-location jaise writers save hote hi ye custom event dispatch karte hain
// taaki isi tab ke saare useDeliveryAddress instances turant update ho jayein.
export const ADDRESS_CHANGED_EVENT = 'supercart-address-changed';

// Confirm wale naye fields bhi preserve rahen (purana data bhi chalta rahe)
const EXTRA_KEYS = ['houseNo', 'street', 'landmark', 'area', 'city', 'pincode', 'formattedAddress'];

const numOrNull = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : null);

// Saved delivery address (localStorage) — auto-location setup bhi yahi padhta hai.
export const readStoredAddress = () => {
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

// Normalize + persist (localStorage). Returns the normalized object.
// NOTE: profile (Supabase user.location) update yahan nahi hota — wo hook ke
// saveAddress karta hai (AuthContext chahiye).
export const writeStoredAddress = (value) => {
  const extras = {};
  for (const k of EXTRA_KEYS) {
    if (typeof value?.[k] === 'string') extras[k] = value[k];
  }
  const lat = numOrNull(value?.lat) ?? numOrNull(value?.latitude);
  const lng = numOrNull(value?.lng) ?? numOrNull(value?.longitude);
  const next = {
    label: value?.label || 'Home',
    address: value?.address || '',
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
  return next;
};

/**
 * Saved delivery address.
 * - Primary: structured address from the AddressPicker bottom sheet (localStorage).
 * - Fallback: Profile me saved `user.location` string (coords nahi hote).
 */
const useDeliveryAddress = () => {
  const { user, updateLocation } = useAuth();
  const [savedAddress, setSavedAddress] = useState(() => readStoredAddress());

  // Dusre tab ('storage') ya isi tab ke kisi writer (auto-location) se sync
  useEffect(() => {
    const refresh = () => setSavedAddress(readStoredAddress());
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY) refresh();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(ADDRESS_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(ADDRESS_CHANGED_EVENT, refresh);
    };
  }, []);

  const saveAddress = useCallback((value) => {
    const next = writeStoredAddress(value);
    setSavedAddress(next);
    // Pin save hote hi Personal details ka "Location / delivery address" bhi update ho
    if (next.address && typeof updateLocation === 'function') {
      updateLocation(next.address);
    }
    try {
      window.dispatchEvent(new Event(ADDRESS_CHANGED_EVENT));
    } catch {
      /* ignore */
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
    try {
      window.dispatchEvent(new Event(ADDRESS_CHANGED_EVENT));
    } catch {
      /* ignore */
    }
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
