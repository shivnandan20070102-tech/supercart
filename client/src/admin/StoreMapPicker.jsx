import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Crosshair, Loader2, MapPin, Search } from 'lucide-react';
import { STORE_LOCATION } from '../config/store';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || '';

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * StoreMapPicker — Admin "Add/Edit Store" ke liye Mapbox interactive picker.
 * User wale "Pin your location" (AddressPicker) jaisa UX:
 * - Search box se area/landmark dhoondo (Mapbox autocomplete, India)
 * - Map par tap/click karo ya green marker drag karo → onPick(lat, lng)
 * - Pin move par reverse-geocode se readable address neeche dikhta hai
 *   + "Ye address use karo" se form ka address auto-bhar jata hai
 * - GPS button se current location par fly
 * - GPS / manual lat-long se coords badle to marker auto-sync hota hai
 * - Token missing ho to null return (caller OSM fallback dikhata hai)
 *
 * ADMIN-ONLY: ye component sirf StoresSection (Admin Panel) me use hota hai.
 * Store Manager ke paas iska koi access nahi hai.
 */
const StoreMapPicker = ({ latitude, longitude, onPick, onAddressChange }) => {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const onAddressChangeRef = useRef(onAddressChange);
  onAddressChangeRef.current = onAddressChange;
  const geoSeqRef = useRef(0);
  const tokenMissing = !MAPBOX_TOKEN;

  const [searchText, setSearchText] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [formatted, setFormatted] = useState('');
  const [geoLoading, setGeoLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);

  // Map init — sirf ek baar (token na ho to skip)
  useEffect(() => {
    if (tokenMissing || !containerRef.current || mapRef.current) return undefined;
    const lat = toNum(latitude) ?? STORE_LOCATION.lat;
    const lng = toNum(longitude) ?? STORE_LOCATION.lng;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [lng, lat],
      zoom: toNum(latitude) != null ? 15 : 11,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    const marker = new mapboxgl.Marker({ draggable: true, color: '#10b981' })
      .setLngLat([lng, lat])
      .addTo(map);
    markerRef.current = marker;

    const emit = (ll) => {
      onPickRef.current?.(Number(ll.lat.toFixed(6)), Number(ll.lng.toFixed(6)));
    };

    marker.on('dragend', () => emit(marker.getLngLat()));
    const onClick = (e) => {
      marker.setLngLat(e.lngLat);
      emit(e.lngLat);
    };
    map.on('click', onClick);
    map.on('load', () => {
      try { map.resize(); } catch { /* ignore */ }
    });

    return () => {
      map.off('click', onClick);
      try { map.remove(); } catch { /* ignore */ }
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bahar se coords badle (GPS button / manual input / Edit mode) → marker + center sync
  useEffect(() => {
    const lat = toNum(latitude);
    const lng = toNum(longitude);
    const map = mapRef.current;
    const marker = markerRef.current;
    if (lat == null || lng == null || !map || !marker) return;
    const cur = marker.getLngLat();
    if (Math.abs(cur.lat - lat) < 1e-9 && Math.abs(cur.lng - lng) < 1e-9) return;
    marker.setLngLat([lng, lat]);
    try { map.easeTo({ center: [lng, lat], duration: 500 }); } catch { /* ignore */ }
  }, [latitude, longitude]);

  // Reverse geocode (debounced) — pin ki readable address line
  useEffect(() => {
    if (tokenMissing) return undefined;
    const lat = toNum(latitude);
    const lng = toNum(longitude);
    if (lat == null || lng == null) {
      setFormatted('');
      return undefined;
    }
    setGeoLoading(true);
    const seq = (geoSeqRef.current += 1);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1&country=IN&language=en`,
        );
        const data = await res.json();
        if (seq !== geoSeqRef.current) return;
        const place = data?.features?.[0]?.place_name || '';
        setFormatted(place);
      } catch {
        if (seq === geoSeqRef.current) setFormatted('');
      } finally {
        if (seq === geoSeqRef.current) setGeoLoading(false);
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [latitude, longitude, tokenMissing]);

  // Address search / autocomplete (debounced) — User AddressPicker jaisa
  useEffect(() => {
    const q = searchText.trim();
    if (tokenMissing || q.length < 3) {
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
  }, [searchText, tokenMissing]);

  if (tokenMissing) return null;

  const pickSuggestion = (s) => {
    setSuggestions([]);
    setSearchText(s.name.split(',').slice(0, 2).join(','));
    if (s.lng != null && s.lat != null) {
      if (mapRef.current) {
        try { mapRef.current.flyTo({ center: [s.lng, s.lat], zoom: 15, essential: true }); } catch { /* ignore */ }
      }
      if (markerRef.current) {
        try { markerRef.current.setLngLat([s.lng, s.lat]); } catch { /* ignore */ }
      }
      onPickRef.current?.(Number(Number(s.lat).toFixed(6)), Number(Number(s.lng).toFixed(6)));
    }
  };

  const useGps = () => {
    if (!('geolocation' in navigator)) return;
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        if (mapRef.current) {
          try { mapRef.current.flyTo({ center: [lng, lat], zoom: 15, essential: true }); } catch { /* ignore */ }
        }
        if (markerRef.current) {
          try { markerRef.current.setLngLat([lng, lat]); } catch { /* ignore */ }
        }
        onPickRef.current?.(lat, lng);
        setGpsLoading(false);
      },
      () => setGpsLoading(false),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  const latNum = toNum(latitude);
  const lngNum = toNum(longitude);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-700">
      {/* Search — "Pin your location" wala same pattern */}
      <div className="relative border-b border-slate-700 bg-slate-800 p-2">
        <Search className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Search area, landmark, dukaan ke paas... (jaise Connaught Place)"
          aria-label="Search store location"
          className="min-h-[44px] w-full rounded-xl border border-slate-600 bg-slate-900 pl-10 pr-10 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-500"
        />
        {searchLoading && <Loader2 className="absolute right-5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />}
        {suggestions.length > 0 && (
          <ul className="absolute inset-x-2 top-full z-20 mt-1 overflow-hidden rounded-xl border border-slate-600 bg-slate-900 shadow-xl">
            {suggestions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => pickSuggestion(s)}
                  className="flex min-h-[48px] w-full items-center gap-2 px-4 py-2 text-left text-xs font-semibold text-slate-200 transition hover:bg-emerald-950"
                >
                  <MapPin className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span className="line-clamp-2">{s.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="relative">
        <div ref={containerRef} className="h-64 w-full" aria-label="Store location map" />
        <button
          type="button"
          onClick={useGps}
          disabled={gpsLoading}
          aria-label="Use my current location"
          title="Meri current location"
          className="absolute bottom-3 right-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-emerald-300 shadow-xl transition active:scale-95 disabled:opacity-70"
        >
          {gpsLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Crosshair className="h-5 w-5" />}
        </button>
      </div>

      <div className="space-y-1.5 bg-slate-800 px-3 py-2.5">
        <p className="text-[11px] font-bold text-slate-300">
          Map par tap karo ya green marker drag karo — lat/long auto bhar jayegi
        </p>
        {latNum != null && lngNum != null && (
          <p className="text-[11px] font-black text-emerald-300">
            📍 {latNum}, {lngNum}
          </p>
        )}
        <p className="text-[11px] leading-snug text-slate-400">
          {geoLoading && !formatted ? 'Address dhoondh rahe hain...' : formatted || 'Pin lagate hi yahan address dikhega'}
        </p>
        {formatted && (
          <button
            type="button"
            onClick={() => onAddressChangeRef.current?.(formatted)}
            className="mt-1 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-[11px] font-black text-emerald-300 transition hover:bg-emerald-500/25"
          >
            Ye address form me bharo
          </button>
        )}
      </div>
    </div>
  );
};

export default StoreMapPicker;
