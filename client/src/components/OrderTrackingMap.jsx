import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from '../config/supabase';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || '';
const DEFAULT_CENTER = [77.209, 28.6139];
const DEFAULT_ZOOM = 14;

// Rider ka Blue Dot — inline styles taaki kabhi invisible na ho.
const makeBlueDot = () => {
  const el = document.createElement('div');
  el.style.cssText = 'position:relative;width:22px;height:22px;pointer-events:none;z-index:10;';
  el.setAttribute('data-tracking-dot', 'rider');
  el.innerHTML =
    '<span style="position:absolute;inset:0;border-radius:9999px;background:#3b82f6;opacity:0.5;animation:tracking-ping 1.6s cubic-bezier(0,0,0.2,1) infinite;"></span>' +
    '<span style="position:absolute;inset:4px;border-radius:9999px;background:#2563eb;border:3px solid #ffffff;box-shadow:0 8px 20px rgba(37,99,235,0.45);"></span>';
  return el;
};

const ensurePingKeyframes = () => {
  try {
    if (typeof document === 'undefined' || document.getElementById('tracking-dot-ping')) return;
    const style = document.createElement('style');
    style.id = 'tracking-dot-ping';
    style.textContent = '@keyframes tracking-ping{0%{transform:scale(1);opacity:0.5}80%,100%{transform:scale(2);opacity:0}}';
    document.head.appendChild(style);
  } catch { /* ignore */ }
};

const validLngLat = (lat, lng) => {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  if (la === 0 && ln === 0) return null;
  return { lat: la, lng: ln };
};

/**
 * OrderTrackingMap — customer ke Order Detail me chhota live map.
 * - Blue Dot = delivery partner ki current location (users.current_lat/lng),
 *   Realtime subscription + 15s poll fallback se update hota hai.
 * - Red pin = customer ka delivery address.
 * - Ye component SIRF trackable orders par render hota hai (OrderDetail guard
 *   karta hai: pending/packed-bina-partner par ye section dikhta hi nahi).
 */
const OrderTrackingMap = ({ riderId, dropLat, dropLng, dropLabel }) => {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const riderMarkerRef = useRef(null);
  const fittedRef = useRef(false);
  const [riderPos, setRiderPos] = useState(null);
  const [tokenMissing] = useState(() => !MAPBOX_TOKEN);

  const drop = validLngLat(dropLat, dropLng);

  // Rider location: pehle ek fetch, phir Realtime + 15s poll fallback.
  // Realtime miss ho (RLS/publication/network) to poll se ~15s me dot aa jayega.
  useEffect(() => {
    if (!riderId) return undefined;
    let cancelled = false;

    const fetchRider = async () => {
      try {
        const { data } = await supabase
          .from('users')
          .select('current_lat, current_lng')
          .eq('id', riderId)
          .maybeSingle();
        if (cancelled) return;
        const pos = validLngLat(data?.current_lat, data?.current_lng);
        if (pos) setRiderPos(pos);
      } catch { /* best-effort — agla poll retry karega */ }
    };

    fetchRider();
    const pollId = window.setInterval(fetchRider, 15000);

    const channel = supabase
      .channel(`order-tracking-rider-${riderId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${riderId}` },
        (payload) => {
          const pos = validLngLat(payload.new?.current_lat, payload.new?.current_lng);
          if (pos) setRiderPos(pos);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      try {
        supabase.removeChannel(channel);
      } catch { /* ignore */ }
    };
  }, [riderId]);

  // Map init — sirf ek baar.
  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return undefined;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: drop ? [drop.lng, drop.lat] : DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
    });
    mapRef.current = map;
    try {
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    } catch { /* optional */ }

    if (drop) {
      try {
        const pin = new mapboxgl.Marker({ color: '#f43f5e' }).setLngLat([drop.lng, drop.lat]);
        if (dropLabel) {
          pin.setPopup(new mapboxgl.Popup({ offset: 25, closeButton: false }).setText(String(dropLabel)));
        }
        pin.addTo(map);
      } catch { /* ignore */ }
    }

    return () => {
      riderMarkerRef.current = null;
      fittedRef.current = false;
      if (mapRef.current) {
        try {
          mapRef.current.remove();
        } catch { /* ignore */ }
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rider dot: pehli fix par dono points fit, uske baad sirf dot move.
  useEffect(() => {
    if (!riderPos || !mapRef.current) return;
    const map = mapRef.current;
    ensurePingKeyframes();
    if (!riderMarkerRef.current) {
      try {
        riderMarkerRef.current = new mapboxgl.Marker({ element: makeBlueDot() })
          .setLngLat([riderPos.lng, riderPos.lat])
          .addTo(map);
      } catch { /* ignore */ }
    } else {
      try {
        riderMarkerRef.current.setLngLat([riderPos.lng, riderPos.lat]);
      } catch { /* ignore */ }
    }
    if (!fittedRef.current) {
      fittedRef.current = true;
      try {
        if (drop) {
          const bounds = new mapboxgl.LngLatBounds();
          bounds.extend([drop.lng, drop.lat]);
          bounds.extend([riderPos.lng, riderPos.lat]);
          map.fitBounds(bounds, { padding: 50, maxZoom: 15 });
        } else {
          map.flyTo({ center: [riderPos.lng, riderPos.lat], zoom: DEFAULT_ZOOM, essential: true });
        }
      } catch { /* ignore */ }
    }
  }, [riderPos, drop]);

  if (tokenMissing) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl bg-slate-100 p-4 text-center">
        <p className="text-xs font-bold text-slate-500">
          Live map ke liye Mapbox token chahiye (client/.env me VITE_MAPBOX_TOKEN).
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div ref={containerRef} className="h-56 w-full sm:h-64" aria-label="Live delivery tracking map" />
      <div className="flex items-center justify-between gap-2 bg-slate-50 px-3 py-2">
        <span className="flex items-center gap-1.5 text-[11px] font-black text-slate-700">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-600" />
          Delivery partner
        </span>
        <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
          Your address
        </span>
        <span className={`text-[11px] font-black ${riderPos ? 'text-emerald-600' : 'text-amber-600'}`}>
          {riderPos ? '● Live' : '○ Locating…'}
        </span>
      </div>
    </div>
  );
};

export default OrderTrackingMap;
