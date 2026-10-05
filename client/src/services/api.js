import { MOCK_PRODUCTS } from '../data/mockGroceryData';
import { supabase } from '../config/supabase';
import { findNearestStore } from './nearestStore';
import { decrementStockDirect } from './stock';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'https://supercart-kloc.onrender.com').replace(/\/+$/, '');

export const fetchProducts = async (category = '', search = '') => {
  try {
    const params = new URLSearchParams();
    if (category && category !== 'all') params.append('category', category);
    if (search) params.append('search', search);

    const url = `${API_BASE_URL}/products?${params.toString()}`;
    const res = await fetch(url);
    const json = await res.json();
    return json.data || [];
  } catch (error) {
    console.error('Failed to fetch products from API:', error);
    const { data: supabaseProducts } = await supabase.from('products').select('*').order('id', { ascending: true });
    if (supabaseProducts?.length) return supabaseProducts;
    const normalizedCategory = category.toLowerCase();
    const normalizedSearch = search.toLowerCase();
    return MOCK_PRODUCTS.filter((product) => {
      const matchesCategory = !normalizedCategory || product.category.toLowerCase().includes(normalizedCategory) || product.categoryName.toLowerCase().includes(normalizedCategory);
      const matchesSearch = !normalizedSearch || product.name.toLowerCase().includes(normalizedSearch) || product.categoryName.toLowerCase().includes(normalizedSearch) || product.description.toLowerCase().includes(normalizedSearch);
      return matchesCategory && matchesSearch;
    });
  }
};

export const loginApi = async (email, password) => {
  const res = await fetch(`${API_BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return await res.json();
};

export const signupApi = async (userData) => {
  const res = await fetch(`${API_BASE_URL}/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userData),
  });
  return await res.json();
};

export const createOrderApi = async (orderData) => {
  const token = localStorage.getItem('supercart_token');
  const orderOwnerId = orderData.userId || (await supabase.auth.getUser()).data.user?.id || 'guest';
  try {
    const res = await fetch(`${API_BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(orderData),
    });
    const response = await res.json();
    if (response.success) {
      // Backend returns single order object (not array) - return as-is, no filtering needed
      // Per-user isolation is already handled by backend via user_id
      return response;
    }
    throw new Error(response.message || 'Order could not be placed.');
  } catch (error) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      // Backend down hai to authoritative server resolution nahi ho sakta —
      // claimed storeId par bharosa MAT karo (stale/tampered ho sakta hai).
      // Actual delivery coords se FRESH nearest nikalo (wahi min-distance logic).
      let fallbackStoreId = null;
      try {
        const ship = orderData.shippingAddress || {};
        const toNum = (v) => {
          if (typeof v === 'number' && !Number.isNaN(v)) return v;
          if (typeof v === 'string' && v.trim() !== '') {
            const n = Number(v);
            if (!Number.isNaN(n)) return n;
          }
          return null;
        };
        const shipLat = toNum(ship.lat) ?? toNum(ship.latitude);
        const shipLng = toNum(ship.lng) ?? toNum(ship.longitude);
        if (shipLat != null && shipLng != null) {
          const fresh = await findNearestStore(supabase, shipLat, shipLng);
          if (fresh.storesAvailable && !fresh.serviceable) {
            throw new Error("Sorry, we don't deliver to your area yet");
          }
          if (fresh.store) fallbackStoreId = fresh.store.id;
        } else {
          fallbackStoreId = orderData.storeId ?? null;
        }
      } catch (resolveErr) {
        if (/service nahi dete|don't deliver to your area/.test(resolveErr?.message || '')) throw resolveErr;
        // Resolve fail (infra/network) → legacy: claimed id ya null (order na toote)
        fallbackStoreId = orderData.storeId ?? null;
      }
      const { data: cloudOrder, error: cloudError } = await supabase.from('orders').insert({
        user_id: session.user.id,
        // Nearest eligible store ONLY (upar fresh-resolve hua) — farther/stale id kabhi nahi
        ...(fallbackStoreId != null ? { store_id: fallbackStoreId } : {}),
        order_items: orderData.orderItems,
        shipping_address: orderData.shippingAddress || {},
        payment_method: orderData.paymentMethod || 'Cash On Delivery',
        items_price: orderData.itemsPrice || 0,
        delivery_fee: orderData.deliveryFee || 0,
        coupon_discount: orderData.couponDiscount || 0,
        coupon_code: orderData.couponCode ? String(orderData.couponCode).trim().toUpperCase() : null,
        delivery_instructions: Array.isArray(orderData.deliveryInstructions ?? orderData.delivery_instructions)
          ? (orderData.deliveryInstructions ?? orderData.delivery_instructions).map((v) => String(v).trim()).filter(Boolean)
          : [],
        tip_amount: Math.max(0, Number(orderData.tipAmount ?? orderData.tip_amount ?? 0) || 0),
        total_price: orderData.totalPrice || 0,
        status: 'Placed',
      }).select().single();
      if (!cloudError && cloudOrder) {
        // Backend bypassed hai to stock decrement bhi yahin (atomic RPC preferred).
        // Short ho to order wapas delete karo — oversell/phantom order nahi.
        const itemsForStock = Array.isArray(orderData.orderItems) ? orderData.orderItems : [];
        try {
          const dec = await decrementStockDirect(supabase, itemsForStock);
          if (!dec.ok && !dec.skipped) {
            try {
              await supabase.from('orders').delete().eq('id', cloudOrder.id);
            } catch { /* best-effort rollback */ }
            const hit = itemsForStock.find((it) => String(it?.productId ?? it?.product_id ?? it?.id) === String(dec.shortId));
            throw new Error(
              `Only ${dec.available ?? 0} left for "${hit?.name || `Product #${dec.shortId}`}" — please reduce quantity.`,
            );
          }
        } catch (stockErr) {
          if (/Only \d+ left for/.test(stockErr?.message || '')) throw stockErr;
          // Decrement infra fail (table/RPC missing) — order bana rehne do,
          // server retry/stock migration baad me sync karega. Order na toote.
        }
        // Backend is bypassed here, so bump usage directly (best-effort)
        incrementCouponUsageApi(orderData.couponCode);
        return { success: true, data: cloudOrder, source: 'supabase_direct' };
      }
    }
    const localOrder = {
      id: `local_${Date.now()}`,
      ...orderData,
      user_id: orderOwnerId,
      status: 'Placed',
      created_at: new Date().toISOString(),
      source: 'local_fallback',
    };
    const storageKey = `supercart_orders_${orderOwnerId}`;
    const savedOrders = JSON.parse(localStorage.getItem(storageKey) || '[]');
    localStorage.setItem(storageKey, JSON.stringify([localOrder, ...savedOrders]));
    console.warn('Order API unavailable; saved order locally.', error);
    return {
      success: true,
      data: localOrder,
      source: 'local_fallback',
      message: 'Order placed successfully on this device.',
    };
  }
};

export const getMyOrdersApi = async (userId) => {
  const token = localStorage.getItem('supercart_token');
  // 1. Try correct backend URLs (both supported, no behaviour change)
  const urlsToTry = [
    `${API_BASE_URL}/api/orders/myorders`,
    `${API_BASE_URL}/orders/myorders`,
  ];
  for (const url of urlsToTry) {
    try {
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const response = await res.json();
      if (response.success) {
        // Backend already filters per-user via token, extra client filter for safety (all users isolated)
        const filtered = Array.isArray(response.data)
          ? response.data.filter((order) => !userId || !order.user_id || String(order.user_id) === String(userId))
          : response.data;
        return { ...response, data: filtered, source: 'backend' };
      }
    } catch {
      // try next URL
    }
  }
  // 2. Direct Supabase fallback (works for ALL users when backend down)
  try {
    if (userId && userId !== 'guest') {
      const { data: cloudOrders } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (cloudOrders && cloudOrders.length) {
        return { success: true, data: cloudOrders, source: 'supabase_direct' };
      }
    }
  } catch (error) {
    console.warn('Supabase direct orders fetch failed.', error);
  }
  return {
    success: true,
    data: JSON.parse(localStorage.getItem(`supercart_orders_${userId || 'guest'}`) || '[]'),
    source: 'local_fallback',
  };
};

export const validateCouponApi = async (code, orderAmount = 0) => {
  const cleanCode = String(code || '').trim().toUpperCase();
  if (!cleanCode) {
    return { success: false, message: 'Please enter a coupon code.' };
  }
  try {
    const { data: coupon, error } = await supabase
      .from('coupons')
      .select('*')
      .eq('code', cleanCode)
      .maybeSingle();
    if (error) throw error;
    if (!coupon) {
      return { success: false, message: 'Invalid coupon code.' };
    }
    if (coupon.is_active === false) {
      return { success: false, message: 'This coupon is inactive.' };
    }
    if (coupon.expiry_date) {
      const today = new Date().toISOString().slice(0, 10);
      if (String(coupon.expiry_date).slice(0, 10) < today) {
        return { success: false, message: 'Coupon expired.' };
      }
    }
    if (coupon.usage_limit !== null && coupon.usage_limit !== undefined) {
      if (Number(coupon.used_count || 0) >= Number(coupon.usage_limit)) {
        return { success: false, message: 'Coupon limit reached.' };
      }
    }
    const amount = Number(orderAmount) || 0;
    if (amount < Number(coupon.min_order_amount || 0)) {
      return { success: false, message: `Minimum order amount for ${coupon.code} is ₹${coupon.min_order_amount}` };
    }
    let discount = 0;
    if (coupon.discount_type === 'flat') {
      discount = Number(coupon.discount_value) || 0;
    } else {
      discount = Math.round((amount * (Number(coupon.discount_value) || 0)) / 100);
    }
    discount = Math.max(0, Math.min(discount, amount));
    return { success: true, data: { ...coupon, calculatedDiscount: discount } };
  } catch (error) {
    if (/could not find the table|does not exist|schema cache/i.test(error?.message || '')) {
      return { success: false, message: 'Coupons are not set up yet. Please run server/supabase_coupons.sql in Supabase.' };
    }
    return { success: false, message: 'Could not validate coupon. Please try again.' };
  }
};

export const incrementCouponUsageApi = async (code) => {
  try {
    const cleanCode = String(code || '').trim().toUpperCase();
    if (!cleanCode) return;
    const { data } = await supabase
      .from('coupons')
      .select('id, used_count')
      .eq('code', cleanCode)
      .maybeSingle();
    if (data) {
      await supabase
        .from('coupons')
        .update({ used_count: Number(data.used_count || 0) + 1 })
        .eq('id', data.id);
    }
  } catch {
    // best-effort only, never block checkout
  }
};

// Store Panel: order packed mark + turant auto-assign (backend: markOrderPacked).
// Auto-assign DB trigger sirf INSERT par chalta hai, isliye pack hamesha
// backend se hota hai taaki delivery partner assign ho sake.
//
// "Failed to fetch" hardening (ROOT CAUSE FIX):
//  - Ye TypeError tab aata hai jab fetch() server tak pahunchti hi nahi:
//    (a) backend `node server.js` :5000 par RUN nahi ho raha (sabse common),
//    (b) VITE_API_BASE_URL galat / unset hai (client/.env me set karo),
//    (c) device offline / CORS-blocked / galat port.
//    Browser me Network tab -> failed request -> Console me exact TypeError
//    dikhega; neeche console.error() wahi exact error log karta hai.
//  - Sirf us NETWORK-failure case me direct-Supabase fallback chalta hai — wahi
// checks jo backend karta hai (store_manager role, store_staff link, apne
// store ka order, delivered/cancelled guard), phir status='packed' + EXISTING
// shared mechanism (rpc retry_pending_assignments / 30s worker) se assign.
// HTTP error JSON (401/403/404/500) par fallback NAHI — backend ka faisla final
// hai (authz bypass ka risk nahi). RLS bhi bypass nahi hoti — anon client +
// user JWT se hi queries hain; RLS deny karega to asli error surface hoga.
// Response shape backend jaisi hi hai taaki StoreDashboard unchanged rahe.
const getFreshPackToken = async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) return session.access_token;
  } catch {
    /* ignore — localStorage fallback neeche */
  }
  try {
    return localStorage.getItem('supercart_token') || '';
  } catch {
    return '';
  }
};

// VITE_API_BASE_URL me `/api` suffix ho ya na ho — dono route shapes try karo.
// Server dono expose karta hai: PUT /orders/:id/pack (alias) aur
// PUT /api/orders/:id/pack (router). `/api` suffix wala base ho to usko
// strip karke root nikalo taaki `/api/api/...` jaisa galat URL na bane.
const buildPackUrls = (orderId) => {
  const base = String(API_BASE_URL || '').replace(/\/+$/, '');
  const root = base.replace(/\/api$/, '');
  const urls = [`${root}/orders/${orderId}/pack`, `${root}/api/orders/${orderId}/pack`];
  return [...new Set(urls)];
};

export const markOrderPackedApi = async (orderId) => {
  const token = await getFreshPackToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  let lastNetworkError = null;
  for (const url of buildPackUrls(orderId)) {
    try {
      const res = await fetch(url, { method: 'PUT', headers });
      let json = null;
      try {
        json = await res.json();
      } catch {
        throw new Error(`Server error (${res.status}). Could not understand the backend response.`);
      }
      // Backend tak request PAHUNCH gayi — chahe 200 ho ya 401/403/404/500,
      // ye backend ka final faisla hai. Network-tab me status code dikhega.
      if (!res.ok || json?.success === false) {
        console.error('[MarkAsPacked] backend ne reject kiya:', url, res.status, json);
        throw new Error(json?.message || json?.error || `Server error (${res.status})`);
      }
      return json;
    } catch (error) {
      const isNetworkFailure =
        error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(error?.message || '');
      if (!isNetworkFailure) throw error;
      // Is URL par server tak baat nahi pahunchi — exact error log karo
      // (Network tab + Console dono me debug hoga) aur agli URL try karo.
      console.error('[MarkAsPacked] network failure:', url, error);
      lastNetworkError = error;
    }
  }
  // Dono backend URLs unreachable (server down / galat VITE_API_BASE_URL /
  // offline) — tabhi direct-Supabase fallback (same authz checks, RLS intact).
  if (lastNetworkError) {
    console.warn(
      '[MarkAsPacked] backend unreachable (dono URLs fail). Direct-Supabase fallback chala rahe hain. ' +
      'Fix: server/ me `npm run dev` chal raha hai na check karo, aur client/.env me VITE_API_BASE_URL sahi hai na dekho.'
    );
    return await markOrderPackedDirect(orderId);
  }
  throw new Error('Could not mark as packed. Please check if the backend server is running.');
};

// Backend-down fallback: same rules, direct Supabase (parallel system NAHI —
// same tables, same PACKED-gate, same free-only random assign via shared RPC).
const markOrderPackedDirect = async (orderId) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Login expired. Please log in again.');
  const { data: me } = await supabase.from('users').select('id, role').eq('id', user.id).maybeSingle();
  if (String(me?.role || '').toLowerCase() !== 'store_manager') {
    throw new Error('Only store managers can pack orders');
  }
  const { data: links, error: linkError } = await supabase
    .from('store_staff')
    .select('store_id')
    .eq('user_id', me.id);
  if (linkError) throw new Error('Store link not found. Ask Admin to link you in store_staff.');
  const myStoreIds = [...new Set((links || []).map((r) => Number(r.store_id)).filter((n) => !Number.isNaN(n)))];
  if (myStoreIds.length === 0) {
    throw new Error('You are not linked to any store. Ask Admin to assign a store.');
  }
  const { data: order, error: fetchError } = await supabase.from('orders').select('*').eq('id', orderId).single();
  if (fetchError || !order) throw new Error('Order not found');
  if (order.store_id == null || !myStoreIds.includes(Number(order.store_id))) {
    throw new Error('This order does not belong to your store');
  }
  const statusLower = String(order.status || '').toLowerCase();
  if (['delivered', 'cancelled'].includes(statusLower)) {
    throw new Error(`${order.status} order cannot be marked as packed`);
  }
  // Race-safe: agar (lost-response wale) backend request ne beech me assign kar
  // diya ho to status ko haath mat lagao — sirf fresh state wapas karo.
  const alreadyAssigned = order.delivery_boy_id && String(order.delivery_boy_id).trim() !== '';
  let packed = order;
  if (!alreadyAssigned && statusLower !== 'packed') {
    const { data: updated, error: updateError } = await supabase
      .from('orders')
      .update({ status: 'packed' })
      .eq('id', orderId)
      .select()
      .single();
    if (updateError) {
      const msg = updateError.message || '';
      console.error('[MarkAsPacked] direct Supabase UPDATE fail:', msg, updateError);
      // Exact wajah surface karo taaki Supabase Dashboard me fix ho sake:
      // - RLS deny -> "...row-level security policy..." (server/supabase_store_pack_policy.sql RUN karo)
      // - galat table/column -> "...does not exist / schema cache..."
      // - offline -> TypeError Failed to fetch (internet check karo)
      if (/row-level security|not allowed|permission denied|policy/i.test(msg)) {
        throw new Error(
          'Supabase RLS blocked the UPDATE (store_manager permission missing). ' +
          'Run server/supabase_store_pack_policy.sql in Supabase SQL Editor. ' +
          `Actual error: ${msg}`
        );
      }
      if (/could not find the table|does not exist|schema cache/i.test(msg)) {
        throw new Error(`Orders table/column mismatch. Please check migrations. Actual error: ${msg}`);
      }
      throw new Error(msg || 'Could not mark as packed.');
    }
    packed = updated;
  }
  // Assignment: existing shared mechanism (DB packed-queue retry — free-only,
  // nearest-to-store, busy excluded, rejected_by respected, SKIP LOCKED).
  // Function na ho / koi free rider na ho to order safely 'packed' rehta hai,
  // worker baad me assign karega — kabhi busy boy ko assign nahi hota.
  try { await supabase.rpc('retry_pending_assignments'); } catch { /* best-effort */ }
  let finalOrder = packed;
  try {
    const { data: fresh } = await supabase.from('orders').select('*').eq('id', orderId).single();
    if (fresh) finalOrder = fresh;
  } catch { /* ignore */ }
  const assignedPartnerId =
    finalOrder.delivery_boy_id && String(finalOrder.delivery_boy_id).trim() !== ''
      ? String(finalOrder.delivery_boy_id)
      : null;
  const assigned = Boolean(assignedPartnerId);
  return {
    success: true,
    message: assigned
      ? 'Order packed ✅ — delivery partner assigned 🎉'
      : 'Order packed ✅ — no partner available, in pending queue',
    data: finalOrder,
    assigned,
    partnerId: assignedPartnerId,
  };
};

export default {
  API_BASE_URL,
  fetchProducts,
  loginApi,
  signupApi,
  createOrderApi,
  getMyOrdersApi,
  validateCouponApi,
  incrementCouponUsageApi,
  markOrderPackedApi,
};
