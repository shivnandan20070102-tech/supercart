import { MOCK_PRODUCTS } from '../data/mockGroceryData';
import { supabase } from '../config/supabase';
import { findNearestStore } from './nearestStore';
import { decrementStockDirect } from './stock';
import { calculateDeliveryCharge, isFreeDelivery } from '../config/store';
import { barcodesMatch } from '../utils/barcodeVerify';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'https://supercart-kloc.onrender.com').replace(/\/+$/, '');

// ---- Render free-tier "cold start" hardening ----
// Render ka free backend kuch der idle rehne par SO jata hai; agle request
// par wake-up me 30-60s lagte hain. Isliye products fetch par:
//  - kam se kam 60s ka AbortController timeout (pehle KOI timeout nahi tha —
//    request athe hi atki rehti thi),
//  - pehle 8s warm backend ko mauka, phir Supabase-direct parallel fallback
//    (Supabase hamesha-on hai, to sote backend me bhi products 8-10s me),
//  - dono fail + timeout ho to THROW (taaki Home page "Dubara try karein"
//    button dikha sake), warna mock-catalog fallback (purana behaviour).
export const PRODUCT_FETCH_TIMEOUT_MS = 60_000;
export const BACKEND_WAKE_HINT_MS = 8_000;
const SUPABASE_FALLBACK_TIMEOUT_MS = 20_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchWithTimeout = async (url, options = {}, timeoutMs = PRODUCT_FETCH_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    // AbortError = hamara timeout (Render sleep case). Alag flag taaki UI
    // "server so raha hai" vs "server down" me farak dikha sake.
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(
        `Backend timeout (${Math.round(timeoutMs / 1000)}s) — server sleep mode me ho sakta hai, thoda wait karke dubara try karein.`,
      );
      timeoutError.isTimeout = true;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

// Supabase query ko bhi time-bound rakho — atak/fail ho to null (caller aage badhe).
// Ye helper kabhi throw NAHI karta, taaki fallback chain na toote.
const querySupabaseProducts = async () => {
  try {
    const raced = await Promise.race([
      supabase.from('products').select('*').order('id', { ascending: true }),
      sleep(SUPABASE_FALLBACK_TIMEOUT_MS).then(() => ({ __timedOut: true })),
    ]);
    if (!raced || raced.__timedOut || raced.error) return null;
    return raced.data ?? null;
  } catch {
    return null;
  }
};

const mockCatalogFallback = (category = '', search = '') => {
  const normalizedCategory = String(category || '').toLowerCase();
  const normalizedSearch = String(search || '').toLowerCase();
  return MOCK_PRODUCTS.filter((product) => {
    const matchesCategory = !normalizedCategory || product.category.toLowerCase().includes(normalizedCategory) || product.categoryName.toLowerCase().includes(normalizedCategory);
    const matchesSearch = !normalizedSearch || product.name.toLowerCase().includes(normalizedSearch) || product.categoryName.toLowerCase().includes(normalizedSearch) || product.description.toLowerCase().includes(normalizedSearch);
    return matchesCategory && matchesSearch;
  });
};

export const fetchProducts = async (category = '', search = '', options = {}) => {
  const timeoutMs = Number(options?.timeoutMs) > 0 ? Number(options.timeoutMs) : PRODUCT_FETCH_TIMEOUT_MS;
  const graceMs = Number(options?.wakeGraceMs) > 0 ? Number(options.wakeGraceMs) : BACKEND_WAKE_HINT_MS;

  const params = new URLSearchParams();
  if (category && category !== 'all') params.append('category', category);
  if (search) params.append('search', search);

  const url = `${API_BASE_URL}/products?${params.toString()}`;

  // Backend request TURANT shuru — ye Render ko wake-up signal bhi deta hai.
  // (Internal try/catch hai, isliye ye promise kabhi reject nahi karta.)
  const backendPromise = (async () => {
    try {
      const res = await fetchWithTimeout(url, {}, timeoutMs);
      if (!res.ok) throw new Error(`Server error (${res.status})`);
      const json = await res.json();
      return { ok: true, data: json.data || [] };
    } catch (error) {
      console.error('Failed to fetch products from API:', error);
      return { ok: false, error };
    }
  })();

  // Grace period: warm backend (1-2s normal case) ko pehle jawab dene do.
  const quick = await Promise.race([backendPromise, sleep(graceMs).then(() => null)]);
  if (quick) {
    if (quick.ok) return quick.data;
    // Backend TURANT fail (down/galati) — Supabase direct try karo.
    const sb = await querySupabaseProducts();
    if (sb?.length) return sb;
    // Dono fail + timeout tha to throw (UI retry button dikhayega),
    // warna purana mock-catalog behaviour.
    if (quick.error?.isTimeout) throw quick.error;
    return mockCatalogFallback(category, search);
  }

  // Backend grace se zyada le raha = Render sleep sambhav.
  // Supabase (hamesha-on) se poochho; rows milen to TURANT wapas —
  // backend request background me poori hokar Render ko warm kar degi,
  // uske baad ki requests normal speed (1-2s) par aayengi.
  const sb = await querySupabaseProducts();
  if (sb?.length) return sb;

  // Supabase khaali/fail — backend ke wake-up wale jawab ka wait karo.
  const late = await backendPromise;
  if (late.ok) return late.data;
  if (late.error?.isTimeout) throw late.error;
  return mockCatalogFallback(category, search);
};

// 429 (RATE_LIMITED) ko friendly Hindi Error me badlo — caller seedha
// error.message UI me dikhata hai (generic "Error" kabhi nahi).
const throwIfRateLimited = (res, json) => {
  if (res?.status !== 429 && json?.code !== 'RATE_LIMITED') return;
  const retryAfterSeconds =
    Number(json?.retryAfterSeconds) || Number(res?.headers?.get?.('Retry-After')) || 0;
  const message =
    String(json?.message || '').trim() ||
    'Bahut zyada attempts ho gaye, kuch der baad try karein';
  const err = new Error(message);
  err.isRateLimited = true;
  err.status = 429;
  err.retryAfterSeconds = retryAfterSeconds;
  throw err;
};

const readJsonSafe = async (res) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

export const loginApi = async (email, password) => {
  const res = await fetch(`${API_BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await readJsonSafe(res);
  throwIfRateLimited(res, json);
  return json;
};

export const signupApi = async (userData) => {
  const res = await fetch(`${API_BASE_URL}/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userData),
  });
  const json = await readJsonSafe(res);
  throwIfRateLimited(res, json);
  return json;
};

// Forgot password — backend rate-limited (3/hour/IP), down ho to direct Supabase.
// 429 par fallback NAHI (block ka faisla final — friendly Hindi throw).
export const forgotPasswordApi = async (email, redirectTo) => {
  const clean = String(email || '').trim();
  if (!clean) throw new Error('Please provide a valid email address');
  const urlsToTry = [`${API_BASE_URL}/api/auth/forgot-password`, `${API_BASE_URL}/forgot-password`];
  let lastNetworkError = null;
  for (const url of urlsToTry) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: clean, ...(redirectTo ? { redirectTo } : {}) }),
      });
      const json = await readJsonSafe(res);
      throwIfRateLimited(res, json);
      if (res.ok && json?.success !== false) return json;
      // Backend tak baat pahunchi (validation error etc.) — uska message final.
      if (res.status !== 404) {
        throw new Error(json?.message || 'Could not send reset link. Please try again.');
      }
    } catch (error) {
      if (error?.isRateLimited) throw error;
      const isNetworkFailure =
        error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(error?.message || '');
      if (!isNetworkFailure && !/404|not found/i.test(error?.message || '')) throw error;
      lastNetworkError = error;
    }
  }
  // Backend unreachable — direct Supabase (same UX message).
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(clean, {
      ...(redirectTo ? { redirectTo } : {}),
    });
    if (error) {
      if (/rate.?limit|too many/i.test(error.message || '')) {
        const err = new Error('Bahut zyada password-reset attempts ho gaye, 1 ghante baad try karein');
        err.isRateLimited = true;
        throw err;
      }
      console.error('Password reset request failed:', error);
    }
  } catch (error) {
    if (error?.isRateLimited) throw error;
    console.error('Password reset fallback failed:', error?.message || error);
  }
  if (lastNetworkError && !/404|not found/i.test(lastNetworkError?.message || '')) {
    // Network tha par Supabase fallback chal gaya — generic success neeche.
  }
  return { success: true, message: 'If this email is registered, you will receive a reset link' };
};

// Complaint backend-first submit (rate-limited 5/hour/User).
// Photo pehle Storage me upload hoti hai (client session se) — yahan sirf
// photo_url bhejo. 429 par fallback NAHI. Backend down ho to direct-Supabase
// fallback taaki genuine complaint na ruke.
export const submitComplaintViaBackend = async ({ type, name, subject, description, photoUrl }) => {
  const { data: { session } } = await supabase.auth.getSession().catch(() => ({ data: {} }));
  const token = session?.access_token || localStorage.getItem('supercart_token') || '';
  try {
    const res = await fetch(`${API_BASE_URL}/api/complaints`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ type, name, subject, description, photo_url: photoUrl || '' }),
    });
    const json = await readJsonSafe(res);
    throwIfRateLimited(res, json);
    if (res.ok && json?.success !== false) return json;
    const err = new Error(json?.message || 'Could not submit complaint.');
    err.status = res.status;
    throw err;
  } catch (error) {
    // Mark karo taaki caller decide kare: rate-limit / auth-final vs network-fallback.
    if (error?.isRateLimited) throw error;
    throw error;
  }
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
    const response = await readJsonSafe(res);
    throwIfRateLimited(res, response);
    if (response?.success) {
      // Backend returns single order object (not array) - return as-is, no filtering needed
      // Per-user isolation is already handled by backend via user_id
      return response;
    }
    const orderErr = new Error(response?.message || 'Order could not be placed.');
    orderErr.status = res.status;
    throw orderErr;
  } catch (error) {
    // Rate-limit block FINAL hai — direct-Supabase/local fallback se BYPASS
    // kabhi mat karo (warna spam-guard bekaar). Friendly Hindi seedha UI tak.
    if (error?.isRateLimited || error?.status === 429) throw error;
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      // Backend down hai to authoritative server resolution nahi ho sakta —
      // claimed storeId par bharosa MAT karo (stale/tampered ho sakta hai).
      // Actual delivery coords se FRESH nearest nikalo (wahi min-distance logic).
      let fallbackStoreId = null;
      let fallbackDistanceKm = null;
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
          if (fresh.store) {
            fallbackStoreId = fresh.store.id;
            fallbackDistanceKm = fresh.store.distanceKm ?? null;
          }
        } else {
          fallbackStoreId = orderData.storeId ?? null;
        }
      } catch (resolveErr) {
        if (/service nahi dete|don't deliver to your area/.test(resolveErr?.message || '')) throw resolveErr;
        // Resolve fail (infra/network) → legacy: claimed id ya null (order na toote)
        fallbackStoreId = orderData.storeId ?? null;
      }
      // Server down hai to bhi fee distance-based hi save ho: fresh resolved
      // distance se calculate, warna client ke distance-based fee par fallback.
      const fallbackItemsPrice = Math.max(0, Number(orderData.itemsPrice) || 0);
      const fallbackCharge = calculateDeliveryCharge(fallbackDistanceKm);
      const fallbackDeliveryFee = isFreeDelivery(fallbackItemsPrice) || fallbackItemsPrice === 0
        ? 0
        : fallbackCharge != null
          ? fallbackCharge
          : Math.max(0, Number(orderData.deliveryFee) || 0);
      const directPayload = {
        user_id: session.user.id,
        // Nearest eligible store ONLY (upar fresh-resolve hua) — farther/stale id kabhi nahi
        ...(fallbackStoreId != null ? { store_id: fallbackStoreId } : {}),
        order_items: orderData.orderItems,
        shipping_address: orderData.shippingAddress || {},
        payment_method: orderData.paymentMethod || 'Cash On Delivery',
        items_price: orderData.itemsPrice || 0,
        delivery_fee: fallbackDeliveryFee,
        coupon_discount: orderData.couponDiscount || 0,
        coupon_code: orderData.couponCode ? String(orderData.couponCode).trim().toUpperCase() : null,
        delivery_instructions: Array.isArray(orderData.deliveryInstructions ?? orderData.delivery_instructions)
          ? (orderData.deliveryInstructions ?? orderData.delivery_instructions).map((v) => String(v).trim()).filter(Boolean)
          : [],
        tip_amount: Math.max(0, Number(orderData.tipAmount ?? orderData.tip_amount ?? 0) || 0),
        total_price: orderData.totalPrice || 0,
        delivery_distance_km: fallbackDistanceKm ?? 0,
        // STORE queue (pack hona baaki): delivery popup is par KABHI nahi —
        // assign SIRF store ke "Mark as Packed" (status 'packed') par hota hai.
        status: 'pending_assignment',
      };
      let { data: cloudOrder, error: cloudError } = await supabase
        .from('orders')
        .insert(directPayload)
        .select()
        .single();
      // Migration abhi run nahi hui ho to delivery_distance_km hata kar retry
      if (cloudError && /delivery_distance_km/i.test(cloudError.message || '')) {
        const retryPayload = { ...directPayload };
        delete retryPayload.delivery_distance_km;
        ({ data: cloudOrder, error: cloudError } = await supabase
          .from('orders')
          .insert(retryPayload)
          .select()
          .single());
      }
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
      status: 'pending_assignment',
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

export const markOrderPackedApi = async (orderId, verifiedItems = []) => {
  const token = await getFreshPackToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  // BARCODE GATE: server har item ki verification khud dobara check karta hai
  // (barcode match / manual confirm) — bina verify pack reject (400).
  const body = JSON.stringify({ verified_items: Array.isArray(verifiedItems) ? verifiedItems : [] });
  let lastNetworkError = null;
  for (const url of buildPackUrls(orderId)) {
    try {
      const res = await fetch(url, { method: 'PUT', headers, body });
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
    return await markOrderPackedDirect(orderId, verifiedItems);
  }
  throw new Error('Could not mark as packed. Please check if the backend server is running.');
};

// Order item se productId (multiple legacy shapes) — direct fallback gate ke liye.
const itemProductIdOf = (item) => {
  const raw = item?.productId ?? item?.product_id ?? null;
  if (raw == null || String(raw).trim() === '' || Number.isNaN(Number(raw))) return null;
  return Number(raw);
};

// Backend-down fallback: same rules, direct Supabase (parallel system NAHI —
// same tables, same PACKED-gate, same free-only random assign via shared RPC).
const markOrderPackedDirect = async (orderId, verifiedItems = []) => {
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
  // TO-PACK FIX: store_id NULL order claim ho sakta hai (koi naya order atke nahi)
  let claimedStoreId = null;
  if (order.store_id == null) {
    claimedStoreId = myStoreIds[0];
    if (claimedStoreId == null) throw new Error('This order does not belong to your store');
  } else if (!myStoreIds.includes(Number(order.store_id))) {
    throw new Error('This order does not belong to your store');
  }
  // PACK-FIRST: koi bhi unpacked variant (placed/pending/pending_assignment/
  // processing/confirmed/created) To-Pack se pack ho sakta hai.
  const statusKey = String(order.status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['delivered', 'cancelled'].includes(statusKey)) {
    throw new Error(`${order.status} order cannot be marked as packed`);
  }
  // Race-safe: agar (lost-response wale) backend request ne beech me assign kar
  // diya ho to status ko haath mat lagao — sirf fresh state wapas karo.
  // SIRF store-queue se packed banao; packed-or-beyond ko regress mat karo.
  const alreadyAssigned = order.delivery_boy_id && String(order.delivery_boy_id).trim() !== '';
  let packed = order;
  if (!alreadyAssigned && ['placed', 'pending', 'pending_assignment', 'processing', 'confirmed', 'created', ''].includes(statusKey)) {
    const items = Array.isArray(order.order_items) ? order.order_items : [];
    const productIds = [...new Set(items.map(itemProductIdOf).filter((value) => value != null))];
    let products = [];
    if (productIds.length > 0) {
      let productResult = await supabase.from('products').select('id,barcode_number').in('id', productIds);
      if (productResult.error && /barcode_number|column|schema cache/i.test(productResult.error.message || '')) {
        productResult = await supabase.from('products').select('id').in('id', productIds);
      }
      if (productResult.error) throw new Error(`Barcode verification check failed: ${productResult.error.message}`);
      products = productResult.data || [];
    }
    const barcodeByProductId = new Map(
      products
        .filter((product) => product?.barcode_number)
        .map((product) => [Number(product.id), String(product.barcode_number).trim()]),
    );
    const unverified = items.filter((item, index) => {
      const expected = barcodeByProductId.get(itemProductIdOf(item));
      const entry = verifiedItems.find((candidate) => Number(candidate?.index) === index);
      return expected ? !barcodesMatch(entry?.barcode, expected) : entry?.manual !== true;
    });
    if (unverified.length > 0) {
      throw new Error(`Sabhi products verify nahi hue: ${unverified.slice(0, 3).map((item) => item?.name || 'Item').join(', ')}`);
    }
    const packUpdate = claimedStoreId != null ? { status: 'packed', store_id: claimedStoreId } : { status: 'packed' };
    const { data: updated, error: updateError } = await supabase
      .from('orders')
      .update(packUpdate)
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
  PRODUCT_FETCH_TIMEOUT_MS,
  BACKEND_WAKE_HINT_MS,
  fetchProducts,
  loginApi,
  signupApi,
  forgotPasswordApi,
  submitComplaintViaBackend,
  createOrderApi,
  getMyOrdersApi,
  validateCouponApi,
  incrementCouponUsageApi,
  markOrderPackedApi,
};
