// SuperCart store constants + helpers (tweak freely — theme brand colors live in index.css)

export const DELIVERY_ETA_MINUTES = 10;

// Multi-store service radius — user ke is distance (km) ke andar koi active
// store na ho to area unserviceable mana jata hai (sirf browsing, no ordering)
export const SERVICE_RADIUS_KM = 10;

// Store / dark-store coordinates (Sector 62, Noida)
export const STORE_LOCATION = {
  lat: 28.6279,
  lng: 77.3732,
};

// Rotating search suggestions (changes every 2.5s in the header search bar)
export const SEARCH_SUGGESTIONS = ['milk', 'bread', 'eggs', 'atta', 'bananas', 'chips'];

// Haversine distance in kilometres between two { lat, lng } points
export const haversineKm = (a, b) => {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h =
    s1 * s1 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * s2 * s2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// "340 m away" / "1.2 km away"
export const formatDistance = (km) => {
  if (km == null || Number.isNaN(km)) return '';
  if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 10) * 10)} m away`;
  return `${km.toFixed(1)} km away`;
};
