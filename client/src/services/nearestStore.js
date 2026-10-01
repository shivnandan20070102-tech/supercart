import { SERVICE_RADIUS_KM, haversineKm } from '../config/store';

export const NEAREST_STORAGE_KEY = 'supercart_nearest_store';
const ADDRESS_STORAGE_KEY = 'supercart_delivery_address';
const GPS_STORAGE_KEY = 'supercart_gps_coords';

const numOrNull = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : null);

export const normalizeStoreRow = (s, distanceKm) => ({
  id: s.id,
  store_name: s.store_name,
  address: s.address || '',
  latitude: Number(s.latitude),
  longitude: Number(s.longitude),
  contact_number: s.contact_number || '',
  distanceKm,
});

// --- Session-persisted nearest store (Prompt 2 ka "session/state") ---
export const readStoredNearest = () => {
  try {
    const raw = localStorage.getItem(NEAREST_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || numOrNull(parsed.id) == null) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const saveNearestStore = (store) => {
  try {
    if (store) localStorage.setItem(NEAREST_STORAGE_KEY, JSON.stringify(store));
    else localStorage.removeItem(NEAREST_STORAGE_KEY);
  } catch {
    /* ignore */
  }
};

// --- Coords readers ---
// Saved delivery address (AddressPicker) se coords
export const readDeliveryCoords = () => {
  try {
    const raw = localStorage.getItem(ADDRESS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const lat = numOrNull(parsed.lat) ?? numOrNull(parsed.latitude);
    const lng = numOrNull(parsed.lng) ?? numOrNull(parsed.longitude);
    return lat != null && lng != null ? { lat, lng } : null;
  } catch {
    return null;
  }
};

// App-open GPS fix (session-only)
export const readGpsCoords = () => {
  try {
    const raw = sessionStorage.getItem(GPS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const lat = numOrNull(parsed.lat);
    const lng = numOrNull(parsed.lng);
    return lat != null && lng != null ? { lat, lng } : null;
  } catch {
    return null;
  }
};

const isInfraMissingError = (err) =>
  /not found|does not exist|schema cache|function|relation|table/i.test(err?.message || '');

/**
 * findNearestStore — user coords se nearest ACTIVE store (radius rule ke saath).
 * Prompt 1 ke SQL function ko prefer karta hai (server-side Haversine),
 * missing ho to client-side Haversine fallback.
 *
 * @returns { store, serviceable, storesAvailable }
 *  - store mila (radius ke andar): { store, serviceable: true, storesAvailable: true }
 *  - koi store radius me nahi: { store: null, serviceable: false, storesAvailable: true }
 *  - tables/RPC bane hi nahi (migration pending): { store: null, serviceable: null, storesAvailable: false }
 */
export const findNearestStore = async (supabaseClient, lat, lng, radiusKm = SERVICE_RADIUS_KM) => {
  // 1. Server-side RPC (get_nearest_active_stores) — Prompt 1 ka function
  try {
    const { data, error } = await supabaseClient.rpc('get_nearest_active_stores', {
      customer_lat: lat,
      customer_lon: lng,
      limit_count: 1,
    });
    if (!error && Array.isArray(data) && data.length > 0) {
      const distanceKm = Number(data[0].distance_km);
      if (!Number.isNaN(distanceKm) && distanceKm <= radiusKm) {
        return {
          store: normalizeStoreRow(data[0], distanceKm),
          serviceable: true,
          storesAvailable: true,
        };
      }
      return { store: null, serviceable: false, storesAvailable: true };
    }
    if (error && !isInfraMissingError(error)) throw error;
    // RPC missing ho to fallback par jao
  } catch (rpcErr) {
    if (!isInfraMissingError(rpcErr)) throw rpcErr;
    // infra missing — neeche table fallback try hoga, wahi decide karega
  }

  // 2. Fallback: active stores lao, client-side Haversine
  try {
    const { data: stores, error: storesError } = await supabaseClient
      .from('stores')
      .select('id, store_name, address, latitude, longitude, contact_number')
      .eq('is_active', true);
    if (storesError) throw storesError;

    let best = null;
    let bestKm = Infinity;
    for (const s of stores || []) {
      // Bina valid coords wala store eligible nahi — min-selection me skip.
      const sLat = Number(s.latitude);
      const sLng = Number(s.longitude);
      if (!Number.isFinite(sLat) || !Number.isFinite(sLng)) continue;
      const km = haversineKm({ lat, lng }, { lat: sLat, lng: sLng });
      if (km != null && km < bestKm) {
        bestKm = km;
        best = s;
      }
    }
    if (best && bestKm <= radiusKm) {
      return { store: normalizeStoreRow(best, bestKm), serviceable: true, storesAvailable: true };
    }
    return { store: null, serviceable: false, storesAvailable: true };
  } catch (err) {
    if (isInfraMissingError(err)) {
      // tables bane hi nahi — purana behaviour (bina multi-store ke)
      return { store: null, serviceable: null, storesAvailable: false };
    }
    throw err;
  }
};

export default {
  NEAREST_STORAGE_KEY,
  findNearestStore,
  readStoredNearest,
  saveNearestStore,
  readDeliveryCoords,
  readGpsCoords,
};
