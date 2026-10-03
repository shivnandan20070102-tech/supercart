import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Briefcase, Crosshair, Home, Loader2, MapPin, Search, X } from 'lucide-react';
import useCurrentLocation from '../../hooks/useCurrentLocation';
import { STORE_LOCATION } from '../../config/store';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || '';
const INIT_ZOOM = 16;
const MAX_ZOOM = 19;

const LABELS = [
  { id: 'Home', icon: Home },
  { id: 'Work', icon: Briefcase },
  { id: 'Other', icon: MapPin },
];

// Mapbox Geocoding v5 reverse result se address parts nikalo.
// NOTE: reverse me limit=1 hi use karo — Mapbox limit>1 ko bina `types` ke reject
// karta hai ("limit must be combined with a single type parameter").
// Single feature ke context me hi city/area/pincode sab milta hai.
// Returns { formattedAddress, city, area, pincode, street } — missing fields '' hote hain.
const parseReverse = (data) => {
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

  // Har feature se jo mile bhar lo (reverse me limit=1 se ek hi aata hai;
  // loop isliye taaki aage limit/types badle to bhi kaam kare)
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
        // district aksar city hi hota hai (jaise Ludhiana/Hisar)
        if (district) city = district;
      }
      if (!city && (types.includes('place') || types.includes('district'))) city = f.text || '';
    }
    if (!area) {
      area = getCtx(f, ['neighborhood', 'locality']);
      if (!area && (types.includes('neighborhood') || types.includes('locality'))) area = f.text || '';
      // POI (dukaan/landmark) area nahi — use street/landmark ke liye rakho, area me nahi
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

  // Pincode fallback: place_name me 6-digit Indian PIN (jaise "... Ludhiana 141001, India")
  if (!pincode) {
    for (const f of features) {
      const m = String(f.place_name || f.text || '').match(/\b\d{6}\b/);
      if (m) {
        pincode = m[0];
        break;
      }
    }
  }
  // Area fallback: POI text ko area na banao; balki primary ka text agar
  // neighborhood/locality/poi ho aur area abhi khali ho to wahi area hai
  if (!area) {
    const types = primary.place_type || [];
    if (types.includes('poi') && primary.text) area = primary.text;
  }
  // City aakhri fallback: primary text agar place/district ho
  if (!city) {
    const types = primary.place_type || [];
    if (types.includes('place') || types.includes('district')) city = primary.text || '';
  }

  return { formattedAddress: primary.place_name || '', city, area, pincode, street };
};

const inputCls =
  'min-h-[48px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[var(--brand)] focus:bg-white focus:ring-2 focus:ring-emerald-100';

// Accuracy (meters) -> halo diameter (px) at current zoom. Clamped taaki
// street aur city dono zoom levels par circle useful dikhe.
const accuracyToPx = (accuracy, lat, zoom) => {
  if (accuracy == null || !Number.isFinite(accuracy)) return 44;
  const metersPerPixel = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
  if (!metersPerPixel || metersPerPixel <= 0) return 44;
  const px = (accuracy * 2) / metersPerPixel;
  return Math.min(160, Math.max(28, px));
};

// Google Maps/Mapbox style live-location dot: blue dot + white ring over a
// soft accuracy halo. Single Mapbox marker hai — pointer-events none taaki
// map taps/drag block na hon. holder = { marker, halo } (liveRef me rakha hai).
const upsertLiveDot = (map, holder, { lat, lng, accuracy }) => {
  if (!map || lat == null || lng == null) return;
  if (!holder.marker) {
    const wrap = document.createElement('div');
    wrap.className = 'sc-live-wrap';
    const halo = document.createElement('div');
    halo.className = 'sc-live-halo';
    const dot = document.createElement('div');
    dot.className = 'sc-live-dot';
    wrap.appendChild(halo);
    wrap.appendChild(dot);
    holder.marker = new mapboxgl.Marker({ element: wrap }).setLngLat([lng, lat]).addTo(map);
    holder.halo = halo;
  } else {
    holder.marker.setLngLat([lng, lat]);
  }
  if (holder.halo) {
    const size = accuracyToPx(accuracy, lat, map.getZoom());
    holder.halo.style.width = `${size}px`;
    holder.halo.style.height = `${size}px`;
  }
};

/**
 * AddressPicker — live map location picker (bottom sheet).
 * Fixed center pin (Swiggy/Zomato style): map neeche move hota hai,
 * moveend par center coords select hote hain. Tap se bhi pin move hota hai.
 * onSave({ label, address, lat, lng, latitude, longitude, formattedAddress,
 *          houseNo, street, landmark, area, city, pincode })
 */
const AddressPicker = ({ open, initial, onClose, onSave }) => {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const touchedRef = useRef(new Set());
  const geoSeqRef = useRef(0);
  const autoCenterRef = useRef(false); // agla GPS fix map ko center kare? (open par auto / button par manual)
  const lastGpsRef = useRef(null); // aakhri GPS fix — halo resize ke liye
  const liveRef = useRef({ marker: null, halo: null }); // live-location dot holder
  const initialRef = useRef(initial);
  initialRef.current = initial;

  const [tokenMissing] = useState(() => !MAPBOX_TOKEN);
  const [label, setLabel] = useState('Home');
  const [houseNo, setHouseNo] = useState('');
  const [street, setStreet] = useState('');
  const [landmark, setLandmark] = useState('');
  const [area, setArea] = useState('');
  const [city, setCity] = useState('');
  const [pincode, setPincode] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [selected, setSelected] = useState(null); // { lat, lng }
  const [formatted, setFormatted] = useState('');
  const [geoLoading, setGeoLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // gps callbacks stable hain (useCallback) — effects me deps ke roop me safe.
  const {
    coords: gpsCoords,
    loading: gpsLoading,
    error: gpsError,
    requestLocation: requestGpsFix,
    startWatch: startGpsWatch,
    stopWatch: stopGpsWatch,
    reset: resetGps,
  } = useCurrentLocation();

  // Sheet khule to state reset (saved coords ho to wahin kholo)
  useEffect(() => {
    if (!open) return;
    const init = initialRef.current || {};
    setLabel(init.label || 'Home');
    setHouseNo(init.houseNo || '');
    // Purana free-text address street me lao taaki data na khoye
    setStreet(init.street || (!init.houseNo && init.address ? init.address : ''));
    setLandmark(init.landmark || '');
    setArea(init.area || '');
    setCity(init.city || '');
    setPincode(init.pincode || '');
    setFormatted(init.formattedAddress || '');
    setFieldErrors({});
    setSearchText('');
    setSuggestions([]);
    // NOTE: yahan touched ko pre-fill NA karo. Pehle init values se pre-fill hota tha
    // (jaise City=Hisar), jisse pin Ludhiana le jaane par bhi reverse result ignore ho
    // jaata tha aur stale Hisar atka rehta tha. Ab empty rakho taaki har pin-move
    // par City/Area/Pincode/Street fresh reverse se overwrite ho. HouseNo/Landmark
    // kabhi autofill nahi hote — wo hamesha user ke hain.
    touchedRef.current = new Set();
    if (init.lat != null && init.lng != null) {
      setSelected({ lat: init.lat, lng: init.lng });
    } else {
      setSelected(null);
    }
  }, [open ]);

  // Sheet khuli ho to background scroll lock + Escape close
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  // Map init (sirf jab sheet khuli ho)
  useEffect(() => {
    if (!open || tokenMissing || !containerRef.current || mapRef.current) return undefined;
    const init = initialRef.current || {};
    const startLng = init.lng ?? init.longitude ?? STORE_LOCATION.lng;
    const startLat = init.lat ?? init.latitude ?? STORE_LOCATION.lat;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [startLng, startLat],
      zoom: INIT_ZOOM,
      minZoom: 3,
      maxZoom: MAX_ZOOM,
      // Mapbox attribution legally required hai — compact "i" mode me rakho
      // taaki UI obstruct na ho aur Mapbox terms bhi violate na hon.
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    const onMoveEnd = () => {
      const c = map.getCenter();
      setSelected({ lat: c.lat, lng: c.lng });
    };
    const onTap = (e) => {
      map.easeTo({ center: e.lngLat, duration: 500 });
    };
    map.on('moveend', onMoveEnd);
    map.on('click', onTap);
    // Zoom badalne par accuracy halo ka size dobara compute karo
    const onZoomHalo = () => {
      const fix = lastGpsRef.current;
      if (fix) upsertLiveDot(map, liveRef.current, fix);
    };
    map.on('zoom', onZoomHalo);
    map.on('load', () => {
      const c = map.getCenter();
      setSelected({ lat: c.lat, lng: c.lng });
      try { map.resize(); } catch { /* ignore */ }
    });

    return () => {
      map.off('moveend', onMoveEnd);
      map.off('click', onTap);
      map.off('zoom', onZoomHalo);
      // Live-dot marker holder reset (marker map.remove ke saath hata hai)
      liveRef.current = { marker: null, halo: null };
      lastGpsRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [open, tokenMissing]);

  // AUTO LOCATION ON OPEN — browser Geolocation automatically request karo.
  // Manual current-location button dabane ki zarurat nahi: permission allow hote
  // hi pehla GPS fix map ko current location par center karega + live dot dikhega.
  // Sirf location state/map update hota hai — poora page reload nahi hota.
  // Close/unmount par watcher stop ho jata hai. (gps methods stable hain,
  // isliye effect sirf open/tokenMissing par chalta hai — duplicate calls nahi.)
  useEffect(() => {
    if (!open || tokenMissing) return undefined;
    autoCenterRef.current = true;
    resetGps();
    startGpsWatch();
    return () => {
      autoCenterRef.current = false;
      stopGpsWatch();
    };
  }, [open, tokenMissing, resetGps, startGpsWatch, stopGpsWatch]);

  // GPS fix -> live-location dot hamesha update karo; map recenter SIRF tab jab
  // pending ho (picker open hone par auto, ya manual recenter button par). Isse
  // watch updates user ke pan/drag se fight nahi karte. Pehla fix moveend ke
  // through selected + reverse-geocoded address bhi auto-update kar deta hai.
  useEffect(() => {
    const fix = gpsCoords;
    if (!open || !fix) return;
    lastGpsRef.current = fix;
    if (mapRef.current) upsertLiveDot(mapRef.current, liveRef.current, fix);
    if (autoCenterRef.current && mapRef.current) {
      autoCenterRef.current = false;
      mapRef.current.flyTo({ center: [fix.lng, fix.lat], zoom: INIT_ZOOM, essential: true });
    }
  }, [open, gpsCoords]);

  // Reverse geocode (debounced) — live readable address + REAL-TIME autofill.
  // Pin move (drag/click/recenter/search) -> turant (1-2s) City/Area/Pincode/Street
  // fresh values se overwrite hote hain taaki stale (jaise Hisar) kabhi atka na rahe.
  // HouseNo/Landmark kabhi autofill nahi hote — khali rehte hain, user khud bhare.
  useEffect(() => {
    if (!open || tokenMissing || !selected) return undefined;
    // Naya pin = nayi location: auto fields ko unlock karo taaki fresh reverse
    // purani values (jaise Hisar) ko overwrite kar sake. User agar isi debounce/
    // network window me khud type karega to touch() dobara lock kar dega aur
    // uski typing safe rahegi.
    touchedRef.current.delete('city');
    touchedRef.current.delete('area');
    touchedRef.current.delete('pincode');
    touchedRef.current.delete('street');
    setGeoLoading(true);
    const seq = (geoSeqRef.current += 1);
    const lat = selected.lat;
    const lng = selected.lng;
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1&country=IN&language=en`,
        );
        const data = await res.json();
        // Purana request baad me aaye to ignore (race: Hisar response Ludhiana ko overwrite na kare)
        if (seq !== geoSeqRef.current) return;
        const parsed = parseReverse(data);
        if (parsed) {
          setFormatted(parsed.formattedAddress);
          // Auto fields: fresh value (na mile to '' karke stale clear) —
          // sirf tab skip karo jab user ne isi pin ke baad khud type kiya ho
          if (!touchedRef.current.has('city')) setCity(parsed.city || '');
          if (!touchedRef.current.has('area')) setArea(parsed.area || '');
          if (!touchedRef.current.has('pincode')) setPincode(parsed.pincode || '');
          // Street: mile to bhardo, na mile to user ki typed value rehne do
          if (parsed.street && !touchedRef.current.has('street')) setStreet(parsed.street);
        }
      } catch {
        /* network fail to purana text rehne do */
      } finally {
        if (seq === geoSeqRef.current) setGeoLoading(false);
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [open, tokenMissing, selected?.lat, selected?.lng]);

  // Address search / autocomplete (debounced)
  useEffect(() => {
    const q = searchText.trim();
    if (!open || tokenMissing || q.length < 3) {
      setSuggestions([]);
      setSearchLoading(false);
      return undefined;
    }
    setSearchLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&autocomplete=true&limit=5&country=IN&language=en`,
        );
        const data = await res.json();
        setSuggestions(
          (data?.features || []).map((f) => ({
            id: f.id,
            name: f.place_name,
            lng: f.center?.[0],
            lat: f.center?.[1],
          })),
        );
      } catch {
        setSuggestions([]);
      } finally {
        setSearchLoading(false);
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [open, tokenMissing, searchText]);

  if (!open) return null;

  const touch = (key, setter) => (e) => {
    touchedRef.current.add(key);
    setter(e.target.value);
    setFieldErrors((prev) => ({ ...prev, [key]: '' }));
  };

  const pickSuggestion = (s) => {
    setSuggestions([]);
    setSearchText(s.name.split(',').slice(0, 2).join(','));
    if (mapRef.current && s.lng != null && s.lat != null) {
      mapRef.current.flyTo({ center: [s.lng, s.lat], zoom: INIT_ZOOM, essential: true });
    }
  };

  const handleConfirm = () => {
    const errs = {};
    if (!houseNo.trim()) errs.houseNo = 'House / Flat no. is required';
    if (!area.trim()) errs.area = 'Area is required';
    if (!city.trim()) errs.city = 'City is required';
    if (!/^\d{6}$/.test(pincode.trim())) errs.pincode = 'Enter a 6-digit pincode';
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const composed = [houseNo.trim(), street.trim(), landmark.trim(), area.trim(), city.trim(), pincode.trim()]
      .filter(Boolean)
      .join(', ');
    onSave?.({
      label,
      address: composed || formatted,
      lat: selected?.lat ?? null,
      lng: selected?.lng ?? null,
      latitude: selected?.lat ?? null,
      longitude: selected?.lng ?? null,
      formattedAddress: formatted || composed,
      houseNo: houseNo.trim(),
      street: street.trim(),
      landmark: landmark.trim(),
      area: area.trim(),
      city: city.trim(),
      pincode: pincode.trim(),
    });
    onClose?.();
  };

  const errText = (key) =>
    fieldErrors[key] ? <p className="mt-1 text-xs font-bold text-red-600">{fieldErrors[key]}</p> : null;

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Pick delivery location">
      <button
        type="button"
        aria-label="Close address picker"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/60 backdrop-blur-[2px]"
      />
      <div className="qc-sheet-up absolute inset-x-0 bottom-0 mx-auto flex max-h-[94vh] w-full max-w-lg flex-col rounded-t-3xl bg-white shadow-2xl">
        <div className="mx-auto mb-2 mt-3 h-1.5 w-12 shrink-0 rounded-full bg-slate-200" />
        <div className="flex shrink-0 items-center justify-between px-5 pb-2">
          <h2 className="text-lg font-black text-slate-900">Pin your location</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {/* Search box */}
          {!tokenMissing && (
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search area, landmark..."
                aria-label="Search area"
                className={`${inputCls} pl-11`}
              />
              {searchLoading && <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />}
              {suggestions.length > 0 && (
                <ul className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                  {suggestions.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => pickSuggestion(s)}
                        className="flex min-h-[48px] w-full items-center gap-2 px-4 py-2 text-left text-xs font-semibold text-slate-700 transition hover:bg-emerald-50"
                      >
                        <MapPin className="h-4 w-4 shrink-0 text-[var(--brand)]" />
                        <span className="line-clamp-2">{s.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Map + fixed center pin */}
          {tokenMissing ? (
            <p className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-900">
              Map needs <b>VITE_MAPBOX_TOKEN</b> — please enter your address manually below.
            </p>
          ) : (
            <div className="relative mb-3 overflow-hidden rounded-2xl border border-slate-200">
              <div ref={containerRef} className="h-[55vh] min-h-[300px] w-full" aria-label="Location map" />
              {/* Fixed center pin — map iske neeche move hota hai */}
              <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full">
                <div className="flex flex-col items-center">
                  <MapPin className="h-10 w-10 text-[var(--brand-dark)] drop-shadow-lg" fill="#d1fae5" />
                  <div className="mt-0.5 h-1.5 w-6 rounded-full bg-slate-950/25 blur-[1px]" />
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  // Manual recenter fallback: agla single-shot fix map ko center karega.
                  autoCenterRef.current = true;
                  requestGpsFix();
                }}
                disabled={gpsLoading}
                aria-label="Use my current location"
                title="My current location"
                className="absolute bottom-3 right-3 flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white text-[var(--brand-dark)] shadow-xl transition active:scale-95 disabled:opacity-70"
              >
                {gpsLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Crosshair className="h-5 w-5" />}
              </button>
            </div>
          )}
          {gpsLoading && (
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-emerald-700">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Getting your current location…
            </p>
          )}
          {gpsError && <p className="mb-2 text-xs font-bold text-red-600">{gpsError}</p>}

          {/* Live readable address */}
          <div className="mb-4 rounded-2xl bg-slate-50 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Selected location</p>
            <p className="mt-0.5 text-sm font-bold text-slate-800">
              {geoLoading && !formatted ? 'Finding address...' : formatted || 'Place a pin on the map'}
            </p>
          </div>

          {/* Editable fields */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-1">
              <label htmlFor="qc-house" className="mb-1 block text-xs font-bold text-slate-600">House / Flat no. *</label>
              <input id="qc-house" value={houseNo} onChange={touch('houseNo', setHouseNo)} placeholder="B-42" className={inputCls} />
              {errText('houseNo')}
            </div>
            <div className="col-span-1">
              <label htmlFor="qc-street" className="mb-1 block text-xs font-bold text-slate-600">Street</label>
              <input id="qc-street" value={street} onChange={touch('street', setStreet)} placeholder="Lane / Road" className={inputCls} />
            </div>
            <div className="col-span-1">
              <label htmlFor="qc-landmark" className="mb-1 block text-xs font-bold text-slate-600">Landmark</label>
              <input id="qc-landmark" value={landmark} onChange={touch('landmark', setLandmark)} placeholder="Near park..." className={inputCls} />
            </div>
            <div className="col-span-1">
              <label htmlFor="qc-area" className="mb-1 block text-xs font-bold text-slate-600">Area *</label>
              <input id="qc-area" value={area} onChange={touch('area', setArea)} placeholder="Sector 62" className={inputCls} />
              {errText('area')}
            </div>
            <div className="col-span-1">
              <label htmlFor="qc-city" className="mb-1 block text-xs font-bold text-slate-600">City *</label>
              <input id="qc-city" value={city} onChange={touch('city', setCity)} placeholder="Noida" className={inputCls} />
              {errText('city')}
            </div>
            <div className="col-span-1">
              <label htmlFor="qc-pincode" className="mb-1 block text-xs font-bold text-slate-600">Pincode *</label>
              <input id="qc-pincode" value={pincode} onChange={touch('pincode', setPincode)} placeholder="201301" inputMode="numeric" maxLength={6} className={inputCls} />
              {errText('pincode')}
            </div>
          </div>

          {/* Save-as label */}
          <p className="mb-2 mt-4 text-xs font-bold uppercase tracking-wider text-slate-500">Save as</p>
          <div className="mb-4 flex gap-2">
            {LABELS.map(({ id, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setLabel(id)}
                className={`flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border text-xs font-bold transition ${
                  label === id
                    ? 'border-[var(--brand)] bg-emerald-50 text-[var(--brand-dark)]'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                <Icon className="h-4 w-4" />
                {id}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleConfirm}
            className="min-h-[52px] w-full rounded-2xl bg-[var(--brand)] text-sm font-black text-white shadow-lg transition hover:bg-[var(--brand-dark)] active:scale-[0.99]"
          >
            Confirm location
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddressPicker;
