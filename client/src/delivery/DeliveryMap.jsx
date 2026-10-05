import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Info, Loader2, LocateFixed, MapPinOff, RotateCcw } from 'lucide-react';
import useLiveLocation from './useLiveLocation';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || '';
// GPS off/deny + koi Home Store na ho tab ka LAST-RESORT default view.
// Pehle Home Store (fallbackCenter prop) try hota hai — Delhi sirf tab jab
// partner ka home store pata hi na ho.
const DEFAULT_CENTER = [77.209, 28.6139];
const DEFAULT_ZOOM = 15;
const FOCUS_ZOOM = 16;

// Home Store coords valid hain to [lng, lat] do, warna null (Delhi default).
const toLngLat = (center) => {
  const lat = Number(center?.lat);
  const lng = Number(center?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lng, lat];
};

const makeGreenDot = () => {
  const el = document.createElement('div');
  el.className = 'relative h-6 w-6';
  el.innerHTML =
    '<span class="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-60"></span>' +
    '<span class="absolute inset-1 rounded-full border-[3px] border-white bg-emerald-500 shadow-lg shadow-emerald-500/40"></span>';
  return el;
};

// accuracy (meters) ko map par circle polygon me badlo
const accuracyCircle = (lng, lat, radiusMeters, points = 64) => {
  const safeRadius = Math.min(Math.max(Number(radiusMeters) || 0, 0), 5000);
  if (safeRadius <= 0) return null;
  const earthRadius = 6371000;
  const latRad = (lat * Math.PI) / 180;
  const ring = [];
  for (let i = 0; i <= points; i += 1) {
    const theta = (i / points) * 2 * Math.PI;
    const dx = safeRadius * Math.cos(theta);
    const dy = safeRadius * Math.sin(theta);
    const dLat = dy / earthRadius;
    const dLng = dx / (earthRadius * Math.cos(latRad));
    ring.push([lng + (dLng * 180) / Math.PI, lat + (dLat * 180) / Math.PI]);
  }
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: {},
  };
};

// Poori screen ka live map — Dashboard ke background me fixed rehta hai.
// Partner ki current location green pulsing dot se dikhti hai + accuracy circle.
// fallbackCenter: partner ke Home Store ke coords {lat, lng} — GPS fix na ho to
// map Delhi ke bajaye Home Store par khulta hai (Dashboard se aata hai).
// locationAllowed: SIRF assigned/home-store context me true (koi ACTIVE order ho
// tab). False = idle/unrelated — live dot/accuracy/flyTo bilkul nahi, map sirf
// Home Store fallback par rehta hai. Auto GPS prompt bhi sirf scope me hota hai.
// assignedStoreIds/homeStoreId: scope debug ke liye (map bounds logic future me).
const DeliveryMap = ({ fallbackCenter = null, locationAllowed = true } = {}) => {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const followRef = useRef(true);
  // Page-load auto-recenter sirf EK baar ho — StrictMode double-effect se
  // bachne ke liye ref guard (re-render par reset nahi hota).
  const autoLocateDoneRef = useRef(false);
  const [tokenMissing] = useState(() => !MAPBOX_TOKEN);
  const [toast, setToast] = useState('');

  // Reusable hook: getCurrentPosition (high accuracy) + watchPosition live updates.
  // Watch unmount par auto clear hota hai. Request budget watchdog andar hai —
  // GPS stall ho to loading kabhi stuck nahi rehta (Retry-able error aata hai).
  // NOTE: requestLocation() locate button (handleLocate) se call hota hai —
  // scope milne par EK BAAR auto bhi trigger hota hai (neeche auto-effect),
  // isliye pehli baar browser ka Allow/Block popup turant aata hai.
  const {
    position,
    loading: locating,
    error: locError,
    requestLocation,
    clearError,
    permissionState,
    isBlocked,
  } = useLiveLocation();
  const [showHelp, setShowHelp] = useState(false);

  // Scope guard: idle/unrelated context me live pill kabhi "Live" na dikhaye.
  const gps = !locationAllowed ? 'off' : position ? 'live' : locating ? 'searching' : locError ? 'off' : 'idle';

  // Map init — sirf ek baar (geolocation hook se aata hai, auto-start nahi)
  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return undefined;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      // Mount ke waqt Home Store pata ho to wahin kholo, warna Delhi default
      // (GPS fix / fallback effect baad me sahi jagah flyTo kar dega).
      center: toLngLat(fallbackCenter) || DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM, // 15
      minZoom: 3,
      maxZoom: 19,
      antialias: true,
      pitchWithRotate: false,
      attributionControl: false,
    });
    mapRef.current = map;
    // User khud map ghumaye to follow roko (wapas locate button se)
    map.on('dragstart', () => { followRef.current = false; });

    // Window resize par map resize — blur/crop fix
    const onResize = () => { try { map.resize(); } catch (e) { /* ignore */ } };
    window.addEventListener('resize', onResize);

    // High-detail setup: hidden label layers wapas visible + roads clearer + local names
    const enhanceDetail = () => {
      let styleLayers = [];
      try {
        styleLayers = map.getStyle()?.layers || [];
      } catch (e) { styleLayers = []; }

      const labelLayers = styleLayers.filter(
        (l) => l.type === 'symbol' && /road|place|settlement|poi|label/i.test(l.id),
      );

      labelLayers.forEach((l) => {
        // Koi label layer hidden ho to visible karo
        try {
          if (map.getLayoutProperty(l.id, 'visibility') === 'none') {
            map.setLayoutProperty(l.id, 'visibility', 'visible');
          }
        } catch (e) { /* ignore */ }
        // Local names first, English fallback — sirf name wali labels par,
        // taaki road shields (ref) na tootein
        try {
          const current = map.getLayoutProperty(l.id, 'text-field');
          if (/name/.test(JSON.stringify(current || ''))) {
            map.setLayoutProperty(l.id, 'text-field', [
              'coalesce',
              ['get', 'name'],
              ['get', 'name_en'],
            ]);
          }
        } catch (e) { /* kuch layers me text-field set nahi hota */ }
      });

      // eslint-disable-next-line no-console
      console.log('[DeliveryMap] label layers:', labelLayers.map((l) => l.id));

      // Roads clearer: zoom 14+ par line-width thoda badhao.
      // Sirf numeric width wali layers — expression wali ko chhedo nahi (style safe).
      styleLayers
        .filter((l) => l.id.startsWith('road-') && l.type === 'line')
        .forEach((l) => {
          try {
            const w = map.getPaintProperty(l.id, 'line-width');
            if (typeof w === 'number' && w > 0) {
              map.setPaintProperty(l.id, 'line-width', [
                'interpolate',
                ['linear'],
                ['zoom'],
                14, w,
                16, w * 1.6,
                19, w * 2.2,
              ]);
            }
          } catch (e) { /* style break nahi karni */ }
        });
    };

    map.on('load', enhanceDetail);

    return () => {
      window.removeEventListener('resize', onResize);
      map.off('load', enhanceDetail);
      markerRef.current = null;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // fallbackCenter mount ke baad async aata hai — uske liye alag effect hai
    // (upar), isliye init sirf ek baar chalta hai.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Error aaye to toast dikhao. Blocked-permission wala message lamba
  // (10s) taaki unblock steps padhe ja sakein; normal error 4s.
  // SCOPE: idle (locationAllowed false) me location chahiye hi nahi — hook ke
  // stale error toast yahan mat dikhao (noise + confusion).
  useEffect(() => {
    if (!locationAllowed) {
      setShowHelp(false);
      return undefined;
    }
    if (!locError) {
      setShowHelp(false);
      return undefined;
    }
    setToast(locError);
    // Blocked ho to help card khud kholo
    if (isBlocked) setShowHelp(true);
    // eslint-disable-next-line no-console
    console.warn('[DeliveryMap] location error:', locError, 'perm=', permissionState);
    const timer = window.setTimeout(() => {
      setToast('');
      clearError();
    }, isBlocked ? 10000 : 4000);
    return () => window.clearTimeout(timer);
  }, [locError, clearError, isBlocked, permissionState, locationAllowed]);

  // Live position aate hi: green marker + accuracy circle + follow ho to flyTo.
  // SCOPE GUARD: locationAllowed false (idle / unrelated store) ho to live dot
  // bilkul mat dikhao — map Home Store fallback par hi rahega.
  // Yehi #4 hai — fix milte hi map TURANT us par center hota hai (sirf scope me).
  useEffect(() => {
    if (!locationAllowed || !position || !mapRef.current) return;
    const map = mapRef.current;
    const { lng, lat, accuracy } = position;
    if (typeof lng !== 'number' || typeof lat !== 'number') return;

    // eslint-disable-next-line no-console
    console.info('[DeliveryMap] centering on:', lat, lng);

    if (!markerRef.current) {
      markerRef.current = new mapboxgl.Marker({ element: makeGreenDot() })
        .setLngLat([lng, lat])
        .addTo(map);
    } else {
      markerRef.current.setLngLat([lng, lat]);
    }

    // Accuracy circle (agar GPS ne accuracy di ho)
    try {
      const feature = accuracyCircle(lng, lat, accuracy);
      if (feature) {
        const applyCircle = () => {
          if (!map.getSource('live-accuracy')) {
            map.addSource('live-accuracy', { type: 'geojson', data: feature });
            map.addLayer({
              id: 'live-accuracy-fill',
              type: 'fill',
              source: 'live-accuracy',
              paint: { 'fill-color': '#10b981', 'fill-opacity': 0.15 },
            });
            map.addLayer({
              id: 'live-accuracy-line',
              type: 'line',
              source: 'live-accuracy',
              paint: { 'line-color': '#10b981', 'line-opacity': 0.45, 'line-width': 1.5 },
            });
          } else {
            map.getSource('live-accuracy').setData(feature);
          }
        };
        if (map.isStyleLoaded()) applyCircle();
        else map.once('load', applyCircle);
      }
    } catch (e) { /* accuracy circle optional hai */ }

    if (followRef.current) {
      map.flyTo({ center: [lng, lat], zoom: FOCUS_ZOOM, essential: true });
    }
  }, [position, locationAllowed]);

  // Scope off hote hi (idle/unrelated) purana live dot + accuracy circle hatao
  // taaki doosre store ke context me pichli location chipki na rahe. Map ko
  // Home Store fallback par wapas lao (follow on ho tabhi).
  useEffect(() => {
    if (locationAllowed || !mapRef.current) return;
    try {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      const map = mapRef.current;
      if (map.getLayer('live-accuracy-fill')) map.removeLayer('live-accuracy-fill');
      if (map.getLayer('live-accuracy-line')) map.removeLayer('live-accuracy-line');
      if (map.getSource('live-accuracy')) map.removeSource('live-accuracy');
    } catch { /* ignore */ }
    const lngLat = toLngLat(fallbackCenter);
    if (lngLat && followRef.current) {
      try {
        mapRef.current.flyTo({ center: lngLat, zoom: DEFAULT_ZOOM, essential: true });
      } catch { /* ignore */ }
    }
  }, [locationAllowed, fallbackCenter]);

  // Home Store fallback: GPS fix abhi tak na ho aur Home Store coords mil jayein
  // to map Delhi ke bajaye Home Store par flyTo kare. GPS fix aate hi upar wala
  // effect live position par le jata hai (GPS hamesha jeetega). User ne khud map
  // ghumaya ho (follow off) to zabardasti wapas mat kheecho.
  useEffect(() => {
    if (position || !mapRef.current) return;
    if (!followRef.current) return;
    const lngLat = toLngLat(fallbackCenter);
    if (!lngLat) return;
    try {
      // eslint-disable-next-line no-console
      console.info('[DeliveryMap] centering on home store:', lngLat[1], lngLat[0]);
      mapRef.current.flyTo({ center: lngLat, zoom: DEFAULT_ZOOM, essential: true });
    } catch { /* ignore */ }
  }, [fallbackCenter, position]);

  const handleLocate = () => {
    followRef.current = true;
    setShowHelp(false);
    // eslint-disable-next-line no-console
    console.info('[DeliveryMap] locate tapped, perm=', permissionState, 'allowed=', locationAllowed);
    // SCOPE GUARD: idle/unrelated me live position par MAT kudo — sirf Home
    // Store fallback par raho. Scope me ho tabhi purana live-center behavior.
    if (!locationAllowed) {
      const lngLat = toLngLat(fallbackCenter);
      if (lngLat && mapRef.current) {
        try {
          mapRef.current.flyTo({ center: lngLat, zoom: DEFAULT_ZOOM, essential: true });
        } catch { /* ignore */ }
      }
      return;
    }
    // Position pehle se hai to TURANT re-center karo (GPS wait mat karo),
    // phir fresh fix mango taaki blue/green dot live jagah par aaye.
    if (position && mapRef.current) {
      try {
        mapRef.current.flyTo({ center: [position.lng, position.lat], zoom: FOCUS_ZOOM, essential: true });
      } catch { /* ignore */ }
    }
    // Nayi position nahi hai to Delhi me MAT kudo — wahi rukkar fresh fix
    // ka wait karo; fix aate hi upar wala effect flyTo karega.
    // Pehli baar browser permission popup dikhayega. Agar pehle se Blocked
    // hai to popup NAHI aayega — hook turant unblock-steps wala error dega
    // (wahi existing error message, koi naya handling nahi).
    requestLocation();
  };

  // Page load par auto-recenter — SIRF scope me (koi ACTIVE order ho tab),
  // bilkul aise jaise user ne khud locate button dabaya ho. Idle me browser
  // permission prompt + spinner bekaar me nahi (dot waise bhi hidden rehta).
  // Scope baad me mile (naya assignment aaye) to tab ek baar auto fire hota
  // hai taaki marker bina tap ke aa jaye. Uske baad manual button same rehta
  // hai. Permission pehle se Blocked hai to wahi existing error message aayega.
  useEffect(() => {
    if (!locationAllowed || autoLocateDoneRef.current) return;
    autoLocateDoneRef.current = true;
    handleLocate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationAllowed]);

  // Token set nahi hai to dark fallback (app kabhi blank/crash nahi hogi)
  if (tokenMissing) {
    return (
      <div className="fixed inset-0 z-0 flex items-center justify-center bg-slate-950" aria-hidden={false}>
        <div className="mx-6 max-w-sm rounded-2xl border border-amber-400/40 bg-slate-900/90 p-5 text-center">
          <p className="text-sm font-black text-amber-300">Map token required</p>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            Get a free Mapbox access token and add this line to <b className="text-slate-200">client/.env</b>,
            then restart the client:
          </p>
          <code className="mt-3 block rounded-lg bg-slate-800 p-2 text-[11px] font-bold text-emerald-300">
            VITE_MAPBOX_TOKEN=pk.your_token_here
          </code>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-0" aria-label="Live delivery map">
      <div ref={containerRef} className="h-full w-full" />
      {/* GPS status pill */}
      <div className="pointer-events-none absolute left-1/2 top-20 -translate-x-1/2">
        <span className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-wide shadow-lg backdrop-blur ${gps === 'live' ? 'bg-slate-950/70 text-emerald-300' : gps === 'off' ? 'bg-slate-950/70 text-amber-300' : 'bg-slate-950/70 text-slate-300'}`}>
          {gps === 'live' ? (
            <><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> Live location</>
          ) : gps === 'off' ? (
            <><MapPinOff className="h-3.5 w-3.5" /> Location off</>
          ) : gps === 'searching' ? (
            <><span className="h-2 w-2 animate-pulse rounded-full bg-slate-400" /> Locating…</>
          ) : (
            <><MapPinOff className="h-3.5 w-3.5" /> Tap locate</>
          )}
        </span>
      </div>
      {/* Error toast + Blocked ho to exact unblock steps */}
      {toast && (
        <div className="absolute bottom-40 left-1/2 w-max max-w-[85vw] -translate-x-1/2">
          <p className="rounded-2xl border border-rose-500/40 bg-slate-950/90 px-4 py-2 text-center text-xs font-bold text-rose-300 shadow-xl backdrop-blur">
            {toast}
          </p>
          {isBlocked && (
            <div className="mt-2 rounded-2xl border border-amber-400/40 bg-slate-950/95 p-3 text-left shadow-xl backdrop-blur">
              <button
                type="button"
                onClick={() => setShowHelp((v) => !v)}
                className="flex w-full items-center gap-1.5 text-xs font-black text-amber-300"
              >
                <Info className="h-4 w-4" />
                {showHelp ? 'Hide steps ▲' : 'How to allow location? ▼'}
              </button>
              {showHelp && (
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-[11px] leading-5 text-slate-200">
                  <li>In Chrome, click the <b>🔒 View site information</b> icon on the left of the address bar.</li>
                  <li>Open <b>Site settings</b> → <b>Location</b> → select <b>Allow</b>.</li>
                  <li>Or: <b>⋮ → Settings → Privacy and security → Site Settings → Location</b> → add this site (localhost) to the Allow list.</li>
                  <li>Come back and press <b>Retry</b> below — if a popup appears, press <b>Allow</b>.</li>
                  <li>On laptop: turn <b>WiFi ON</b> + Windows: <b>Settings → Privacy &amp; security → Location → Location services ON</b> + “Let desktop apps access” ON.</li>
                </ol>
              )}
              <button
                type="button"
                onClick={() => { setShowHelp(false); handleLocate(); }}
                className="mt-2 flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-500 text-xs font-black text-slate-950 transition hover:bg-emerald-400 active:scale-[0.99]"
              >
                <RotateCcw className="h-4 w-4" /> Retry — request location again
              </button>
            </div>
          )}
          {/* Blocked nahi (timeout/stall/unavailable) to sirf Retry — taaki UI
              kabhi stuck na lage; floating locate button bhi Retry hi hai. */}
          {!isBlocked && (
            <button
              type="button"
              onClick={() => { handleLocate(); }}
              className="mx-auto mt-2 flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-500 text-xs font-black text-slate-950 shadow-xl transition hover:bg-emerald-400 active:scale-[0.99]"
            >
              <RotateCcw className="h-4 w-4" /> Retry — request location again
            </button>
          )}
        </div>
      )}
      {/* My Location floating button — bottom nav ke just upar */}
      <button
        type="button"
        onClick={handleLocate}
        disabled={locating}
        title="Go to my location"
        aria-label="Go to my location"
        className={`absolute bottom-24 right-4 z-10 flex h-12 w-12 items-center justify-center rounded-full border shadow-xl backdrop-blur transition active:scale-95 ${gps === 'live' ? 'border-emerald-500/60 bg-slate-950/85 text-emerald-400' : 'border-slate-700 bg-slate-950/85 text-white hover:bg-slate-800'} ${locating ? 'cursor-wait opacity-80' : ''}`}
      >
        {locating ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <LocateFixed className="h-5 w-5" />
        )}
      </button>
    </div>
  );
};

export default DeliveryMap;
