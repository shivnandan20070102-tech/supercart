import { useEffect, useRef, useState } from 'react';
import { supabase } from '../config/supabase';

// Rider live location → users.current_lat/current_lng (throttled persist).
//
// Ye hook pehle DeliveryDashboard ke andar inline tha, jo Dashboard unmount
// hote hi band ho jata tha (Order Detail khulne par GPS broadcast ruk jata
// tha). Ab ye shared module-level singleton hai: Dashboard aur DeliveryOrderDetail
// dono ise mount karte hain, lekin sirf EK geolocation watch chalta hai
// (duplicate writers nahi). Jaise hi aakhri owner unmount hota hai, watch band.
//
// Shart (DB trigger validate_delivery_location_write se same): partner Online
// ho YA uske paas active order ho (assigned/accepted/picked_up/out_for_delivery).
// Active order hone par Offline ho tab bhi broadcast chalta hai.

const ACTIVE_STATUSES = ['assigned', 'accepted', 'reached_store', 'picked_up', 'reached_customer', 'out_for_delivery'];

const MIN_GAP_MS = 30000;
const MIN_MOVE_M = 100;
const MAX_CONSECUTIVE_FAILS = 3;

const distM = (a, b) => {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h = s1 * s1 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * s2 * s2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const hasActiveOrder = (orders) =>
  Array.isArray(orders) &&
  orders.some((o) => ACTIVE_STATUSES.includes(String(o?.status || '').toLowerCase()));

const shared = {
  owners: new Set(), // { uid, allowed(), onFail(bool) }
  watchId: null,
  lastSentAt: 0,
  lastSent: null,
  consecFails: 0,
};

const anyOwnerAllowed = () => {
  for (const owner of shared.owners) {
    try {
      if (owner.allowed()) return true;
    } catch {
      /* ignore one bad owner */
    }
  }
  return false;
};

const uidForRun = () => {
  for (const owner of shared.owners) {
    try {
      if (owner.allowed()) return owner.uid;
    } catch {
      /* ignore */
    }
  }
  return null;
};

const notifyFail = (value) => {
  for (const owner of shared.owners) {
    try {
      owner.onFail(value);
    } catch {
      /* ignore */
    }
  }
};

const stopWatch = () => {
  if (shared.watchId !== null) {
    try {
      navigator.geolocation.clearWatch(shared.watchId);
    } catch {
      /* ignore */
    }
    shared.watchId = null;
  }
  shared.lastSentAt = 0;
  shared.lastSent = null;
  shared.consecFails = 0;
};

const startWatch = () => {
  if (!('geolocation' in navigator)) return;
  shared.lastSentAt = 0;
  shared.lastSent = null;
  shared.consecFails = 0;

  const push = async (lat, lng, force) => {
    const uid = uidForRun();
    if (!uid) return;
    try {
      if (typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) return;
      if (lat === 0 && lng === 0) return;
      const now = Date.now();
      if (!force && now - shared.lastSentAt < MIN_GAP_MS) return;
      if (!force && shared.lastSent && distM(shared.lastSent, { lat, lng }) < MIN_MOVE_M) return;
      shared.lastSentAt = now;
      shared.lastSent = { lat, lng };
      await supabase.from('users').update({
        current_lat: lat,
        current_lng: lng,
        location_updated_at: new Date().toISOString(),
      }).eq('id', uid);
      shared.consecFails = 0;
      notifyFail(false);
    } catch (err) {
      // Update ki error ko chupao mat — warn karo aur lagataar fail ho to
      // page par chhota message dikhao (notifyFail(true)).
      console.warn('[useBroadcastLocation] location update failed:', err?.message || err);
      shared.consecFails += 1;
      if (shared.consecFails >= MAX_CONSECUTIVE_FAILS) {
        shared.consecFails = 0;
        notifyFail(true);
      }
    }
  };

  const onPos = (pos) => {
    const first = !shared.lastSent;
    push(pos?.coords?.latitude, pos?.coords?.longitude, first);
  };
  const onErr = (err) => {
    console.warn('[useBroadcastLocation] geolocation error:', err?.code, err?.message);
  };

  try {
    navigator.geolocation.getCurrentPosition(onPos, onErr, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
    shared.watchId = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
  } catch (e) {
    console.warn('[useBroadcastLocation] could not start watch:', e);
    shared.watchId = null;
  }
};

const syncWatch = () => {
  const shouldRun = anyOwnerAllowed();
  const running = shared.watchId !== null;
  if (shouldRun && !running) startWatch();
  else if (!shouldRun && running) stopWatch();
};

/**
 * useBroadcastLocation — delivery partner ka live location users table me
 * broadcast karta hai (Dashboard + DeliveryOrderDetail dono par).
 *
 * @param {object} params
 * @param {object|null} params.user - supabase user (id chahiye)
 * @param {boolean} params.isOnline - partner Online hai ya nahi
 * @param {Array} params.orders - active orders (status check ke liye)
 * @returns {boolean} locationFail - lagataar update fail hone par true (page par chhota message)
 */
const useBroadcastLocation = ({ user, isOnline = false, orders = [] }) => {
  const [fail, setFail] = useState(false);
  const ownerRef = useRef({ uid: null, allowed: () => false, onFail: () => {} });

  useEffect(() => {
    const owner = ownerRef.current;
    owner.uid = user?.id || null;
    owner.allowed = () => isOnline === true || hasActiveOrder(orders);
    owner.onFail = setFail;

    if (!owner.uid) return undefined;

    shared.owners.add(owner);
    syncWatch();
    return () => {
      shared.owners.delete(owner);
      setFail(false);
      syncWatch();
    };
  }, [user?.id, isOnline, orders]);

  return fail;
};

export default useBroadcastLocation;
