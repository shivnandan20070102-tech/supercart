// ===================================================
// SuperCart — PACKED-to-Delivery Auto-Assign (core logic)
// ---------------------------------------------------
// FINAL FLOW: Customer -> nearest store -> store PACKED kare TABHI assign.
// - 'pending_assignment' / 'Placed' / 'pending' (unassigned) = STORE queue.
//   Store ne pack nahi kiya -> delivery assign NAHI hota (chahe riders free hon).
// - 'packed' (unassigned, delivery_boy_id null/'') = DELIVERY queue.
//   Sirf YEHI queue assign hoti hai: store markOrderPacked moment par,
//   30s worker retry par, aur partner-available realtime trigger par.
// - Reject/Timeout ke baad order wapas 'packed' (unassigned) jata hai taaki
//   agle FREE partner ko mile — store ko dobara pack nahi karna padta.
// FREE = (verified YA delivery_profiles.approval_status='approved') + is_available(true)
//        + koi active order nahi (BUSY excluded).
// NEAREST = eligible FREE riders me se ORDER WALE STORE ke sabse nazdeek
// rider (users.current_lat/current_lng vs stores.latitude/longitude,
// Haversine). Busy rider chahe paas ho tab bhi excluded — sirf FREE me se.
// Location/store-coords na hon to existing random rule fallback hai.
// 30s worker + Realtime listener + markOrderPacked sab isi ko call karte hain
// taaki logic single-source rahe.
// ===================================================

import { haversineKm } from './storeAssign.js';

// NOTE: PENDING/LEGACY yahan se jaan-boojhkar bahar hain — PACKED se pehle
// assign karna spec violation hai. Store pack karega tab order 'packed'
// bankar is queue me aayega.
const PACKED_WAITING_STATUSES = ['packed'];

const DELIVERY_ROLES = ['delivery', 'delivery_partner'];

const isUnassigned = (order) => {
  if (!order) return false;
  const boy = order.delivery_boy_id;
  return boy === null || boy === undefined || String(boy).trim() === '';
};

const getRejectedIds = (order) => {
  if (Array.isArray(order?.rejected_by)) return order.rejected_by.map(String);
  return [];
};

const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

const numOrNull = (v) => {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return null;
};

// "Nearly same location" tie window — sabse nazdeek rider se isse kam door
// wale riders me se existing random rule se ek chuno.
const NEAR_TIE_M = 50;

/**
 * Order wale STORE ke coords (stores.latitude/longitude).
 * Table/row/coords missing ho to null (caller random fallback lega).
 */
export const fetchStoreCoords = async (supabase, storeId) => {
  const id = Number(storeId);
  if (!Number.isFinite(id)) return null;
  try {
    const { data, error } = await supabase
      .from('stores')
      .select('id, latitude, longitude')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    const lat = numOrNull(data.latitude);
    const lng = numOrNull(data.longitude);
    return lat != null && lng != null ? { lat, lng } : null;
  } catch {
    return null;
  }
};

/**
 * Partner rows (fetchAvailablePartners wali) se rider-location map banao.
 * Location columns migration se pehle ke rows me undefined honge — wo riders
 * simply "bina location" maane jate hain (sabse peeche, lekin eligible).
 */
export const locationsFromPartners = (partners) => {
  const map = new Map();
  for (const p of partners || []) {
    if (!p?.id) continue;
    const lat = numOrNull(p.current_lat);
    const lng = numOrNull(p.current_lng);
    if (lat != null && lng != null) map.set(String(p.id), { lat, lng });
  }
  return map;
};

/**
 * Eligible FREE riders me se STORE ke sabse nazdeek rider chuno.
 * - Bina valid location wala rider sabse peeche (Infinity), lekin eligible
 *   rehta hai — sabke paas location na ho to existing random rule.
 * - Nearly-same-location tie (50m) me existing random rule.
 * - storeCoords null ho ya kisi ke paas location na ho → pickRandom (fallback).
 */
export const pickNearestPartner = (eligible, locationsById, storeCoords) => {
  if (!Array.isArray(eligible) || eligible.length === 0) return null;
  if (!storeCoords || !(locationsById instanceof Map) || locationsById.size === 0) {
    return pickRandom(eligible);
  }
  const withDist = eligible.map((p) => {
    const loc = locationsById.get(String(p.id));
    const km = loc ? haversineKm(storeCoords.lat, storeCoords.lng, loc.lat, loc.lng) : null;
    return { p, km: km == null ? Infinity : km };
  });
  const finite = withDist.filter((w) => Number.isFinite(w.km));
  if (finite.length === 0) return pickRandom(eligible);
  const minKm = Math.min(...finite.map((w) => w.km));
  const tied = finite.filter((w) => (w.km - minKm) * 1000 <= NEAR_TIE_M).map((w) => w.p);
  return pickRandom(tied.length > 0 ? tied : finite.map((w) => w.p));
};

// Terminal states — inke baad rider dobara FREE hai, baaki sab (assigned,
// accepted, picked_up, out_for_delivery, packed, ...) me wo BUSY hai.
const TERMINAL_STATUSES = ['delivered', 'completed', 'cancelled', 'failed'];
// PostgREST `in` filter case-sensitive hai — DB me 'Delivered' jaise variants
// bhi hain, isliye dono cases bhejo (JS me final lowercase check bhi hai).
const TERMINAL_VARIANTS = [
  ...TERMINAL_STATUSES,
  ...TERMINAL_STATUSES.map((s) => s.charAt(0).toUpperCase() + s.slice(1)),
];

const isTerminalStatus = (s) => TERMINAL_STATUSES.includes(String(s || '').toLowerCase());

/**
 * BUSY riders ke ids — jinke paas abhi koi active (non-terminal) order hai.
 * PACKED/READY assign flow (aur worker/retry) inhe kabhi nahi chunta.
 * Query fail ho to empty set (warn ke saath) taaki checkout flow kabhi na ruke.
 */
export const fetchBusyPartnerIds = async (supabase) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('delivery_boy_id, status')
      .not('delivery_boy_id', 'is', null)
      .neq('delivery_boy_id', '')
      .not('status', 'in', `(${TERMINAL_VARIANTS.join(',')})`)
      .limit(2000);
    if (error) {
      console.warn(`⚠️ [assign] busy check warning: ${error.message}`);
      return new Set();
    }
    const busy = new Set();
    for (const row of data || []) {
      const boy = row?.delivery_boy_id;
      if (!boy || String(boy).trim() === '') continue;
      if (isTerminalStatus(row?.status)) continue; // case-variant safety
      busy.add(String(boy));
    }
    return busy;
  } catch (e) {
    console.warn(`⚠️ [assign] busy check failed: ${e.message}`);
    return new Set();
  }
};

/**
 * Available + verified/approved + FREE delivery partners lao.
 * - users table canonical hai (role, verified, is_available).
 * - approval_status SIRF delivery_profiles me rehta hai (Admin wahi set karta
 *   hai) — isliye eligible = users.verified=true YA delivery_profiles me
 *   approval_status='approved'. (Pehle sirf verified check hota tha, aur
 *   approval flow verified kabhi set nahi karta tha — isliye approved +
 *   Online partners bhi eligible nahi bante the aur packed orders
 *   "Waiting for Delivery Boy" par atak jate the.)
 * - Rider live location (current_lat/current_lng) saath lao taaki nearest
 *   selection ho sake — columns na bane hon to graceful fallback (neche).
 * - BUSY riders (active order wale) hamesha excluded — chahe Online hi kyun na hon.
 * - Agar verified/is_available columns abhi Supabase me bane hi
 *   nahi hain (migration pending), to gracefully sirf role par
 *   fallback karo taaki worker kabhi crash na kare.
 */
/**
 * delivery_profiles se approval + home-store maps lao.
 * - approvedIds: approval_status='approved' wale user_ids (verified ka alternative).
 * - homeById: user_id -> home_store_id (Number), HOME-FIRST assign ke liye.
 * Table/column missing ho (migration pending) to { approvedIds: null, homeById: empty }
 * taaki caller verified-only safe default par rahe — crash kabhi nahi.
 */
export const fetchProfileMaps = async (supabase) => {
  const empty = { approvedIds: null, homeById: new Map() };
  try {
    const { data, error } = await supabase
      .from('delivery_profiles')
      .select('user_id, approval_status, home_store_id');
    if (error || !Array.isArray(data)) return empty;
    const approvedIds = new Set();
    const homeById = new Map();
    for (const r of data) {
      const uid = r?.user_id ? String(r.user_id) : '';
      if (!uid) continue;
      if (String(r?.approval_status || '').toLowerCase() === 'approved') approvedIds.add(uid);
      const home = Number(r?.home_store_id);
      if (Number.isFinite(home)) homeById.set(uid, home);
    }
    return { approvedIds, homeById };
  } catch {
    return empty;
  }
};

export const fetchAvailablePartners = async (supabase) => {
  // Attempt 1: online partners + (verified YA approved) + location
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, role, verified, is_available, current_lat, current_lng')
      .in('role', DELIVERY_ROLES)
      .eq('is_available', true);

    if (!error && Array.isArray(data)) {
      // Approved IDs + Home Store map (delivery_profiles) — lookup fail ho to
      // null/empty, tab verified-only behaviour (purana safe default, crash nahi).
      // home_store_id har partner row par attach hota hai taaki tryAssignSingleOrder
      // HOME-FIRST preference laga sake (us store ke apne partners pehle).
      const { approvedIds, homeById } = await fetchProfileMaps(supabase);
      const busy = await fetchBusyPartnerIds(supabase);
      return (data || []).filter((p) => {
        if (!p?.id || busy.has(String(p.id))) return false;
        const ok = p.verified === true || (approvedIds && approvedIds.has(String(p.id)));
        if (!ok) return false;
        const home = homeById.get(String(p.id));
        if (home != null) p.home_store_id = home;
        return true;
      });
    }

    // Column missing ho to PostgREST "column does not exist / schema cache"
    // error deta hai — us case me fallback par jao, baaki errors bhi safe.
    if (error) {
      const msg = String(error.message || '');
      const isMissingColumn =
        /verified|is_available|current_lat|current_lng|schema cache|column/i.test(msg);
      if (!isMissingColumn) {
        console.warn(`⚠️ [assign] partner fetch warning: ${msg}`);
        return [];
      }
      console.warn(
        '⚠️ [assign] users.verified/is_available column missing — role-only fallback (run supabase_auto_assign_delivery.sql)'
      );
    }
  } catch (e) {
    console.warn(`⚠️ [assign] partner fetch failed: ${e.message}`);
  }

  // Attempt 2 (fallback): sirf role filter (busy-exclusion phir bhi lagu)
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, role')
      .in('role', DELIVERY_ROLES);
    if (error) {
      console.warn(`⚠️ [assign] fallback partner fetch failed: ${error.message}`);
      return [];
    }
    const busy = await fetchBusyPartnerIds(supabase);
    const { homeById } = await fetchProfileMaps(supabase);
    return (data || []).filter((p) => {
      if (!p?.id || busy.has(String(p.id))) return false;
      const home = homeById.get(String(p.id));
      if (home != null) p.home_store_id = home;
      return true;
    });
  } catch (e) {
    console.warn(`⚠️ [assign] fallback partner fetch failed: ${e.message}`);
    return [];
  }
};

/**
 * Sirf delivery-ready queue lao: unassigned 'packed' orders, sabse purana pehle (FIFO).
 * 'pending_assignment' / 'Placed' / 'pending' store queue hai — pack se pehle
 * inhe kabhi assign mat karo (FINAL FLOW rule).
 */
export const fetchPendingOrders = async (supabase, limit = 50) => {
  const statuses = [...PACKED_WAITING_STATUSES];
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .in('status', statuses)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) {
      console.warn(`⚠️ [assign] pending orders fetch failed: ${error.message}`);
      return [];
    }
    // delivery_boy_id null/'' wale hi sach me unassigned hain.
    // (Admin ne manual assign kiya ho to use dobara touch mat karo.)
    return (data || []).filter(isUnassigned);
  } catch (e) {
    console.warn(`⚠️ [assign] pending orders fetch failed: ${e.message}`);
    return [];
  }
};

// NOTE: is_available ko yahan HAATH NAHI lagate — Online/Offline SIRF partner
// ke apne toggle ya Admin toggle se badalta hai. Auto-assign sirf
// is_available=true wale online partners me se chunta hai, status nahi badalta.

/**
 * Ek single order ko assign karne ki koshish.
 * FINAL FLOW gate: sirf 'packed' (unassigned) orders assign hote hain.
 * 'pending_assignment' / 'Placed' / 'pending' store queue hai — PACKED se
 * pehle inhe chhoona spec violation hai, isliye turant null.
 *
 * HOME-FIRST preference:
 *  - PEHLE: order wale store ke home_store_id wale Online+Approved+FREE
 *    partners me se sabse nazdeek (Haversine) → source 'home'.
 *  - TABHI fallback: aise koi home partner free na ho to BAAKI sabhi eligible
 *    partners me se store ke sabse nazdeek → source 'fallback' (purana rule).
 * @returns { partner, source: 'home'|'fallback' } | null
 *   (koi eligible partner nahi / already assigned / not packed)
 */
export const tryAssignSingleOrder = async (supabase, order, partnerPool = null) => {
  if (!order || !isUnassigned(order)) return null;
  // PACKED gate: store ne pack nahi kiya -> assign NAHI.
  if (String(order.status || '').toLowerCase() !== 'packed') return null;

  const rejected = new Set(getRejectedIds(order));
  let partners = partnerPool;
  if (!partners) {
    partners = await fetchAvailablePartners(supabase);
  }
  const eligible = (partners || []).filter((p) => p?.id && !rejected.has(String(p.id)));
  if (eligible.length === 0) return null;

  // HOME-FIRST partition: is order ke store ko apna home_store mane wale
  // partners alag karo (busy/rejected pehle hi excluded).
  const orderStoreId = order.store_id != null ? Number(order.store_id) : null;
  const homePool =
    orderStoreId != null && !Number.isNaN(orderStoreId)
      ? eligible.filter((p) => p?.home_store_id != null && Number(p.home_store_id) === orderStoreId)
      : [];
  const source = homePool.length > 0 ? 'home' : 'fallback';
  const selectionPool = homePool.length > 0 ? homePool : eligible;

  // NEAREST-TO-STORE: selection pool me se ORDER WALE STORE ke sabse nazdeek
  // rider chuno. Store-coords ya rider-locations na hon to existing random
  // rule (rollout-safe fallback — order kabhi stuck nahi).
  let chosen = null;
  let storeCoords = null;
  let locationsById = new Map();
  try {
    storeCoords = await fetchStoreCoords(supabase, order.store_id);
    locationsById = locationsFromPartners(partners);
    chosen = pickNearestPartner(selectionPool, locationsById, storeCoords);
  } catch {
    chosen = null;
  }
  if (!chosen) chosen = pickRandom(selectionPool);

  // Guard: assign se pehle fresh row check (race-safe — kisi aur ne
  // turant pehle assign kar diya ho to double-assign mat karo).
  try {
    const { data: fresh } = await supabase
      .from('orders')
      .select('id, delivery_boy_id, status, rejected_by')
      .eq('id', order.id)
      .maybeSingle();
    if (fresh && !isUnassigned(fresh)) return null;
    // Reject list badal gayi ho to re-validate
    const freshRejected = new Set(getRejectedIds(fresh || order));
    if (freshRejected.has(String(chosen.id))) return null;
  } catch (e) {
    /* fresh-check fail ho to bhi assign attempt karo */
  }

  // Order par assign + status 'assigned' (partner ka Online/Offline status
  // touch nahi hota — wahi rahega jo partner/Admin ne set kiya hai).
  // Sirf abhi-bhi-unassigned row ko touch karo.
  try {
    const { data, error } = await supabase
      .from('orders')
      .update({ delivery_boy_id: String(chosen.id), status: 'assigned' })
      .eq('id', order.id)
      .is('delivery_boy_id', null)
      .select()
      .maybeSingle();

    if (!error && data && !isUnassigned(data)) {
      const loc = locationsById.get(String(chosen.id));
      const km = loc && storeCoords ? haversineKm(storeCoords.lat, storeCoords.lng, loc.lat, loc.lng) : null;
      const tag = source === 'home' ? '🏠 home-store' : '↩ fallback';
      console.log(`✅ [assign] Order #${order.id} → partner ${String(chosen.id).slice(0, 8)} (${tag}, status: assigned${km != null ? `, store se ${km.toFixed(2)} km` : ''})`);
      return { partner: chosen, source };
    }

    // delivery_boy_id '' (empty string) wale legacy rows ke liye retry:
    // .is(null) unhe match nahi karta. Pehle re-validate karo taaki race me
    // kisi aur worker/trigger ke assign ko overwrite na karo (duplicate assign ban).
    if (error || !data) {
      try {
        const { data: refetch } = await supabase
          .from('orders')
          .select('id, delivery_boy_id, status')
          .eq('id', order.id)
          .maybeSingle();
        if (refetch && !isUnassigned(refetch)) return null;
      } catch {
        /* refetch fail ho to bhi guarded attempt karo */
      }
      const retry = await supabase
        .from('orders')
        .update({ delivery_boy_id: String(chosen.id), status: 'assigned' })
        .eq('id', order.id)
        .eq('delivery_boy_id', '')
        .select()
        .maybeSingle();
      if (!retry.error && retry.data && !isUnassigned(retry.data)) {
        const tag = source === 'home' ? '🏠 home-store' : '↩ fallback';
        console.log(`✅ [assign] Order #${order.id} → partner ${String(chosen.id).slice(0, 8)} (${tag}, status: assigned) [empty-id retry]`);
        return { partner: chosen, source };
      }
      console.warn(`⚠️ [assign] Order #${order.id} assign fail: ${retry.error?.message || error?.message || 'unknown'}`);
      return null;
    }
    return { partner: chosen, source };
  } catch (e) {
    console.warn(`⚠️ [assign] Order #${order.id} assign error: ${e.message}`);
    return null;
  }
};

/**
 * Saare pending orders ko ek-ek karke assign karo (FIFO).
 * Same run me ek partner ko dobara mat do (in-memory exclusion).
 * Har order HOME-FIRST (us store ke home partners) phir fallback hota hai.
 * @returns { assigned, pending, checked, home, fallback } (home/fallback = source-wise split)
 */
export const tryAssignPendingOrders = async (supabase, { limit = 50 } = {}) => {
  const pending = await fetchPendingOrders(supabase, limit);
  if (pending.length === 0) return { assigned: 0, pending: 0, checked: 0, home: 0, fallback: 0 };

  let partners = await fetchAvailablePartners(supabase);
  if (partners.length === 0) {
    console.log(`⏳ [assign] ${pending.length} packed order, koi partner available nahi — next 30s check me retry`);
    return { assigned: 0, pending: pending.length, checked: pending.length, home: 0, fallback: 0 };
  }

  let assigned = 0;
  let home = 0;
  let fallback = 0;
  const usedThisRun = new Set();

  for (const order of pending) {
    const pool = partners.filter((p) => !usedThisRun.has(String(p.id)));
    if (pool.length === 0) break; // is run me saare partners exhaust
    const result = await tryAssignSingleOrder(supabase, order, pool);
    if (result?.partner) {
      assigned += 1;
      if (result.source === 'home') home += 1;
      else fallback += 1;
      usedThisRun.add(String(result.partner.id));
    }
  }

  const remaining = pending.length - assigned;
  if (assigned > 0) {
    console.log(`🔄 [assign] ${assigned} order(s) assigned (🏠 home: ${home}, ↩ fallback: ${fallback}), ${remaining} abhi bhi packed queue me`);
  }
  return { assigned, pending: remaining, checked: pending.length, home, fallback };
};

export const ASSIGN_INTERVAL_MS = 30_000;

export default {
  fetchProfileMaps,
  fetchAvailablePartners,
  fetchBusyPartnerIds,
  fetchPendingOrders,
  fetchStoreCoords,
  locationsFromPartners,
  pickNearestPartner,
  tryAssignSingleOrder,
  tryAssignPendingOrders,
  ASSIGN_INTERVAL_MS,
};
