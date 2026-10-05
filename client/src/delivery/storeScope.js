// Home/assigned-store scope — delivery-boy location visibility guard.
//
// Rule: rider ki live location SIRF tab share/dikhao jab uske paas kam se
// kam ek ACTIVE assigned order ho (assigned/accepted/picked_up/out_for_delivery).
// - Idle (koi active order nahi) -> locationAllowed = false (no broadcast, no dot).
// - Active order(s) hain -> locationAllowed = true, scope = un orders ke store_id(s).
// - Home store set ho to map ka fallback wahi hai; fallback assignment
//   (order.store_id != home_store_id) bhi allowed hai kyunki wo assigned context hai.
// - Doosre store / unrelated order ka map/navigate access nahi.
//
// Pure functions hain taaki Node se unit-test ho sakein. UI/tracking logic untouched.

export const ACTIVE_SCOPE_STATUSES = new Set([
  'assigned',
  'accepted',
  'picked_up',
  'out_for_delivery',
]);

const normStatus = (s) => String(s || '').trim().toLowerCase();
const normId = (v) => (v == null || v === '' ? null : String(v));
const normStoreId = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

export const isActiveScopeOrder = (order) =>
  order != null && ACTIVE_SCOPE_STATUSES.has(normStatus(order?.status));

// Rider ke ACTIVE assigned orders (delivered/history bahar).
export const getActiveOrders = (orders) =>
  Array.isArray(orders) ? orders.filter(isActiveScopeOrder) : [];

// Active orders ke unique store_id(s) — yehi "assigned store context" hai.
export const getAssignedStoreIds = (orders) => {
  const ids = [];
  const seen = new Set();
  for (const o of getActiveOrders(orders)) {
    const sid = normStoreId(o?.store_id);
    if (sid != null && !seen.has(sid)) {
      seen.add(sid);
      ids.push(sid);
    }
  }
  return ids;
};

// Live location share/dikhao ya nahi — idle me bilkul nahi.
// NOTE: Dashboard ka Blue Dot ab is par depend NAHI karta (Online status par
// hai) — ye sirf historical/scope checks ke liye rakha hai taaki purane
// callers na tootein. OrderDetail ka isOrderInScope guard pehle jaisa sakht hai.
export const shouldShareLiveLocation = ({ homeStoreId, orders } = {}) => {
  const active = getActiveOrders(orders);
  if (active.length === 0) return false;
  // Home store na pata ho to bhi assigned order hi scope hai (allow).
  if (homeStoreId == null || homeStoreId === '') return true;
  const home = normStoreId(homeStoreId);
  // Home invalid ho to assigned orders ke basis par allow (fail-open nahi,
  // fail-scoped: active orders hain tabhi true).
  if (home == null) return true;
  return true;
};

// Koi specific order is rider ke scope me hai ya nahi.
// - delivery_boy_id rider se match hona LAZMI hai (assigned context).
// - store check: home pata ho to home ya assigned list me hona chahiye;
//   fallback assignment (assigned list me hai, home se alag) allowed hai.
export const isOrderInScope = (order, { userId, homeStoreId, assignedStoreIds } = {}) => {
  if (!order) return false;
  const owner = normId(order?.delivery_boy_id);
  const me = normId(userId);
  if (!owner || !me || owner !== me) return false;
  if (!isActiveScopeOrder(order)) return false;
  const sid = normStoreId(order?.store_id);
  // store_id na ho (purana data) to assigned hone par allow — scope active order hai.
  if (sid == null) return true;
  const home = normStoreId(homeStoreId);
  if (home != null && sid === home) return true;
  if (Array.isArray(assignedStoreIds) && assignedStoreIds.map(Number).includes(Number(sid))) return true;
  // assignedStoreIds na di ho to owner+active hi kaafi (caller ke paas poori list nahi).
  if (!Array.isArray(assignedStoreIds)) return true;
  return false;
};

// Active orders ke delivery points — map par customer address pins ke liye.
// Sirf valid coords wale orders aate hain: {id, lat, lng, label}.
// Pure hai taaki Node se unit-test ho sake.
export const getDeliveryPoints = (orders) => {
  const points = [];
  for (const o of getActiveOrders(orders)) {
    const addr = o?.shipping_address || {};
    const lat = Number(addr.latitude ?? addr.lat);
    const lng = Number(addr.longitude ?? addr.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    const parts = [addr.label, addr.address || addr.formattedAddress, addr.city, addr.pincode || addr.postalCode].filter(Boolean);
    points.push({
      id: String(o.id),
      lat,
      lng,
      label: parts.length > 0 ? `Order #${o.id} — ${parts.join(', ')}` : `Order #${o.id}`,
    });
  }
  return points;
};
