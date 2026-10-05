// ===================================================
// SuperCart — Order → Store assignment (core logic)
// ---------------------------------------------------
// Order create hote waqt store_id WAHI hona chahiye jo user
// ke nearest ACTIVE store ka hai (5km radius, Prompt 2).
// Client fresh-resolve karke bhejta hai, lekin authoritative
// faisla YAHAN hota hai taaki stale/tampered id save na ho:
//
//  - delivery coords milein -> server-side nearest nikalo
//    (Prompt 1 ka RPC, fallback: active stores + Haversine).
//    Claimed id authoritative se alag ho to authoritative jeetega.
//  - 5km me koi store na ho -> OUT_OF_SERVICE (order reject).
//  - coords na hon + claimed id ho -> store exists & active?
//    verify karo, invalid ho to INVALID_STORE (order reject).
//  - multi-store migration abhi run hi nahi hui (tables/RPC
//    missing) -> legacy mode: store_id null, order phir bhi save.
// ===================================================

export const SERVICE_RADIUS_KM = 5;

// Haversine distance (km) — client config/store.js wala formula, backend copy
export const haversineKm = (lat1, lon1, lat2, lon2) => {
  if ([lat1, lon1, lat2, lon2].some((v) => typeof v !== 'number' || Number.isNaN(v))) return null;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);
  const h =
    s1 * s1 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * s2 * s2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

export const normalizeStoreId = (raw) => {
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
};

const numOrNull = (v) => {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  // Numeric strings (e.g. "28.61") bhi accept karo taaki coords-based
  // nearest resolution trigger ho — baaki values null.
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return null;
};

// shipping_address ke alag-alag key variants (lat/lng/latitude/longitude) se coords
export const getShippingCoords = (shipping) => {
  if (!shipping || typeof shipping !== 'object') return null;
  const lat = numOrNull(shipping.lat) ?? numOrNull(shipping.latitude);
  const lng = numOrNull(shipping.lng) ?? numOrNull(shipping.longitude);
  return lat != null && lng != null ? { lat, lng } : null;
};

const isInfraMissingError = (err) =>
  /not found|does not exist|schema cache|function|relation|table/i.test(
    String(err?.message || err || '')
  );

// Nearest ACTIVE store (radius ke andar) — RPC prefer, fallback table+Haversine.
// @returns { store: {id,...}|null, storesAvailable: boolean }
export const findNearestActiveStore = async (supabase, lat, lng, radiusKm = SERVICE_RADIUS_KM) => {
  // 1. Prompt 1 ka server-side function
  try {
    const { data, error } = await supabase.rpc('get_nearest_active_stores', {
      customer_lat: lat,
      customer_lon: lng,
      limit_count: 1,
    });
    if (!error && Array.isArray(data) && data.length > 0) {
      const distanceKm = Number(data[0].distance_km);
      if (!Number.isNaN(distanceKm) && distanceKm <= radiusKm) {
        return { store: { ...data[0], distanceKm }, storesAvailable: true };
      }
      return { store: null, storesAvailable: true };
    }
    if (error && !isInfraMissingError(error)) throw error;
  } catch (rpcErr) {
    if (!isInfraMissingError(rpcErr)) throw rpcErr;
  }

  // 2. Fallback: active stores + JS Haversine
  const { data: stores, error: storesError } = await supabase
    .from('stores')
    .select('id, store_name, latitude, longitude')
    .eq('is_active', true);
  if (storesError) {
    if (isInfraMissingError(storesError)) return { store: null, storesAvailable: false };
    throw storesError;
  }
  let best = null;
  let bestKm = Infinity;
  for (const s of stores || []) {
    // Bina valid coords wala store eligible nahi — min-selection me skip
    // (warna Number(null) = 0 (0,0) par phantom distance jud jayegi).
    const sLat = Number(s.latitude);
    const sLng = Number(s.longitude);
    if (!Number.isFinite(sLat) || !Number.isFinite(sLng)) continue;
    const km = haversineKm(lat, lng, sLat, sLng);
    if (km != null && km < bestKm) {
      bestKm = km;
      best = s;
    }
  }
  if (best && bestKm <= radiusKm) {
    return { store: { ...best, distanceKm: bestKm }, storesAvailable: true };
  }
  return { store: null, storesAvailable: true };
};

/**
 * Order ke liye final store_id decide karo.
 * @returns { storeId: number|null, verified: string, error: 'OUT_OF_SERVICE'|'INVALID_STORE'|null, storesAvailable }
 *  verified: 'claimed' (client sahi tha) | 'corrected' (server ne theek kiya)
 *          | 'auto-resolved' (client ne bheja hi nahi) | 'legacy' (verify Boundary nahi)
 *          | 'infra-missing' (migration pending — legacy mode)
 */
export const resolveOrderStore = async (
  supabase,
  { claimedStoreId = null, lat = null, lng = null, radiusKm = SERVICE_RADIUS_KM } = {}
) => {
  const claimed = normalizeStoreId(claimedStoreId);
  // Boundary par coerce karo (numeric strings bhi valid coords hain)
  const latNum = numOrNull(lat);
  const lngNum = numOrNull(lng);
  const hasCoords = typeof latNum === 'number' && typeof lngNum === 'number';

  // Case A: delivery coords hain — authoritative nearest nikalo
  if (hasCoords) {
    let nearest;
    try {
      nearest = await findNearestActiveStore(supabase, latNum, lngNum, radiusKm);
    } catch (e) {
      console.warn(`⚠️ [store] nearest resolve failed: ${e.message} — legacy mode me order save hoga`);
      return { storeId: null, verified: 'infra-missing', error: null, storesAvailable: false };
    }
    if (!nearest.storesAvailable) {
      return { storeId: null, verified: 'infra-missing', error: null, storesAvailable: false };
    }
    if (!nearest.store) {
      return { storeId: null, verified: 'none', error: 'OUT_OF_SERVICE', storesAvailable: true };
    }
    if (claimed != null && Number(claimed) === Number(nearest.store.id)) {
      return { storeId: Number(nearest.store.id), verified: 'claimed', error: null, storesAvailable: true };
    }
    if (claimed != null) {
      console.warn(
        `⚠️ [store] claimed store ${claimed} != nearest ${nearest.store.id} (${nearest.store.distanceKm?.toFixed?.(2)} km) — authoritative store use hoga`
      );
      return { storeId: Number(nearest.store.id), verified: 'corrected', error: null, storesAvailable: true };
    }
    return { storeId: Number(nearest.store.id), verified: 'auto-resolved', error: null, storesAvailable: true };
  }

  // Case B: coords nahi — claimed id ko kam-se-kam exists+active verify karo
  if (claimed != null) {
    try {
      const { data: row, error } = await supabase
        .from('stores')
        .select('id, is_active')
        .eq('id', claimed)
        .maybeSingle();
      if (error) {
        if (isInfraMissingError(error)) {
          return { storeId: null, verified: 'infra-missing', error: null, storesAvailable: false };
        }
        throw error;
      }
      if (row && row.is_active !== false) {
        return { storeId: Number(row.id), verified: 'claimed', error: null, storesAvailable: true };
      }
      return { storeId: null, verified: 'none', error: 'INVALID_STORE', storesAvailable: true };
    } catch (e) {
      console.warn(`⚠️ [store] store verify failed: ${e.message} — legacy mode me order save hoga`);
      return { storeId: null, verified: 'infra-missing', error: null, storesAvailable: false };
    }
  }

  // Case C: na coords na claimed — legacy (purane clients), store_id null
  return { storeId: null, verified: 'legacy', error: null, storesAvailable: true };
};

export default {
  SERVICE_RADIUS_KM,
  haversineKm,
  normalizeStoreId,
  getShippingCoords,
  findNearestActiveStore,
  resolveOrderStore,
};
