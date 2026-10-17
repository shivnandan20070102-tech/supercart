// Auto-location setup helpers (naye user ke liye):
// GPS fix lo -> Mapbox se reverse geocode -> delivery address object banao
// -> useDeliveryAddress ke writer se save (yahi format AddressPicker save karta hai).
//
// Pure functions (parseMapboxReverse, buildAutoAddress) alag rakhe hain taaki
// unit-test ho sakein; network/geolocation sirf wrappers me hai.

// Vite dev/build me import.meta.env object hota hai; plain Node (tests) me
// undefined — optional chaining se safely '' milta hai.
const getMapboxToken = () => {
  try {
    return import.meta.env?.VITE_MAPBOX_TOKEN || '';
  } catch {
    return '';
  }
};

export const GEO_UNSUPPORTED = 'unsupported';

/**
 * Ek single GPS fix (Promise). Resolve: { lat, lng, accuracy }.
 * Reject: GeolocationPositionError (code 1/2/3) ya { code: 'unsupported' }.
 */
export const getCurrentFix = (timeoutMs = 12000) =>
  new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      reject({ code: GEO_UNSUPPORTED });
      return;
    }
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? null,
          }),
        (err) => reject(err),
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 300000 },
      );
    } catch (err) {
      reject(err);
    }
  });

// AddressPicker wale reverse parser ka compact version (same Mapbox v5 API,
// same context-prefix logic taaki dono jagah same address bane).
export const parseMapboxReverse = (data) => {
  const features = data?.features || [];
  if (features.length === 0) return null;
  const primary = features[0];

  const getCtx = (feature, prefixes) => {
    for (const c of feature.context || []) {
      const id = String(c.id || '');
      for (const p of prefixes) {
        if (id.startsWith(p) && c.text) return c.text;
      }
    }
    return '';
  };

  let city = '';
  let area = '';
  let pincode = '';
  let street = '';

  for (const f of features) {
    const types = f.place_type || [];
    if (!pincode) {
      pincode = getCtx(f, ['postcode']);
      if (!pincode && types.includes('postcode')) pincode = f.text || '';
    }
    if (!city) {
      city = getCtx(f, ['place']);
      if (!city) {
        const district = getCtx(f, ['district']);
        if (district) city = district;
      }
      if (!city && (types.includes('place') || types.includes('district'))) city = f.text || '';
    }
    if (!area) {
      area = getCtx(f, ['neighborhood', 'locality']);
      if (!area && (types.includes('neighborhood') || types.includes('locality'))) area = f.text || '';
    }
    if (!street) {
      if (types.includes('address')) {
        const num = f.address ? `${f.address} ` : '';
        street = `${num}${f.text || ''}`.trim();
      } else if (f.properties?.address) {
        street = String(f.properties.address);
      }
    }
  }

  // Pincode fallback: place_name me 6-digit Indian PIN
  if (!pincode) {
    for (const f of features) {
      const m = String(f.place_name || f.text || '').match(/\b\d{6}\b/);
      if (m) {
        pincode = m[0];
        break;
      }
    }
  }
  if (!area) {
    const types = primary.place_type || [];
    if (types.includes('poi') && primary.text) area = primary.text;
  }
  if (!city) {
    const types = primary.place_type || [];
    if (types.includes('place') || types.includes('district')) city = primary.text || '';
  }

  return { formattedAddress: primary.place_name || '', city, area, pincode, street };
};

// Mapbox reverse geocode (skip silently on failure — coords phir bhi save hote hain).
export const reverseGeocode = async (lat, lng) => {
  const token = getMapboxToken();
  if (!token || lat == null || lng == null) return null;
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${token}&limit=1&country=IN&language=en`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    return parseMapboxReverse(data);
  } catch {
    return null;
  }
};

/**
 * GPS fix + reverse parse -> AddressPicker-compatible address object.
 * (houseNo/landmark khali — user baad me picker se add kar sakta hai.)
 */
export const buildAutoAddress = (fix, parsed) => {
  const lat = fix?.lat ?? null;
  const lng = fix?.lng ?? null;
  const street = parsed?.street || '';
  const area = parsed?.area || '';
  const city = parsed?.city || '';
  const pincode = parsed?.pincode || '';
  const parts = [street, area, city, pincode].filter(Boolean);
  const address = parts.join(', ') || parsed?.formattedAddress || 'Current location';
  return {
    label: 'Home',
    address,
    lat,
    lng,
    latitude: lat,
    longitude: lng,
    formattedAddress: parsed?.formattedAddress || address,
    houseNo: '',
    street,
    landmark: '',
    area,
    city,
    pincode,
  };
};

export default { getCurrentFix, reverseGeocode, buildAutoAddress, parseMapboxReverse };
