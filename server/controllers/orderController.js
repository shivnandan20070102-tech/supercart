import { supabase } from '../config/supabase.js';
import { getShippingCoords, resolveOrderStore, calculateDeliveryCharge, calculateDeliveryFee } from '../utils/storeAssign.js';
import { releaseStockReservation, reserveStockForOrder, normalizeStockItems } from '../utils/stock.js';
import { barcodesMatch, itemProductId } from '../utils/barcodeMatch.js';
import crypto from 'node:crypto';
import { ONLINE_PAYMENTS_ENABLED } from '../services/paymentService.js';

const isValidUUID = (val) => {
  if (!val || typeof val !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
};

const normalizeDeliveryStatus = (value) => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const DELIVERY_STATUS_FLOW = ['accepted', 'reached_store', 'picked_up', 'reached_customer', 'delivered'];

// Ensure public.users row exists so orders FK never fails for real users
const ensureUserRow = async (userId, extra = {}) => {
  if (!isValidUUID(userId)) return false;
  try {
    const { data: existing } = await supabase.from('users').select('id').eq('id', userId).maybeSingle();
    if (existing) return true;
    // Try to create minimal user row (auth.users row should already exist via Supabase Auth)
    const { error } = await supabase.from('users').insert({
      id: userId,
      name: extra.name || 'Customer',
      email: extra.email || `user_${String(userId).slice(0, 8)}@supercart.local`,
      phone: extra.phone || '',
      role: 'customer',
    });
    if (error) {
      console.warn('⚠️ Could not auto-create user row:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('⚠️ ensureUserRow failed:', e.message);
    return false;
  }
};

// PACK-FIRST FLOW (single source of truth):
// Jo bhi order aaye, kisi bhi store se — pehle To-Pack (store queue) me aayega,
// pack hone ke BAAD hi aage badhega (delivery assign / out-for-delivery / delivered).
// - STORE_QUEUE (unpacked) = placed, pending, pending_assignment, processing,
//   confirmed, created — sab To-Pack me dikhenge, delivery ke liye NOT ready.
// - 'packed' (unassigned) = delivery queue (assign ke liye ready).
// - Assign sirf 2 jagah se: store markOrderPacked (PACKED moment) aur
//   30s worker / retry (sirf 'packed' queue).
const normalizeStatusKey = (s) =>
  String(s || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
// Koi bhi unpacked variant — ye sab To-Pack queue hai (pack hona baaki).
const STORE_QUEUE_SET = new Set([
  'placed',
  'pending',
  'pending_assignment',
  'processing',
  'confirmed',
  'created',
  '',
]);
const isStoreQueueStatus = (s) => STORE_QUEUE_SET.has(normalizeStatusKey(s));

// =====================================================================
// Cancel / Refund / Review helpers (Step 2 — service-role, server-side checks)
// =====================================================================
const DELIVERY_ISSUE_REASONS = new Set([
  'customer_refused',
  'damaged',
  'wrong_address',
  'customer_unreachable',
]);
const REVIEW_TAGS = new Set([
  'good_behavior',
  'bad_behavior',
  'polite',
  'rude',
  'late_to_open_door',
  'payment_issue',
  'wrong_address',
  'other',
]);

const normalizePaymentMethod = (val) => String(val || '').trim().toLowerCase();
const isCashOnDelivery = (method) =>
  ['cod', 'cash', 'cash_on_delivery'].includes(normalizePaymentMethod(method));

// Canonical payment_method value map (Part B)
const PAYMENT_METHOD_ALIASES = {
  cod: 'cash_on_delivery',
  cash: 'cash_on_delivery',
  cash_on_delivery: 'cash_on_delivery',
  upi: 'upi',
  phonepe: 'phonepe',
  gpay: 'google_pay',
  google_pay: 'google_pay',
  card: 'card',
  debit_credit_card: 'card',
  debit_card: 'card',
  credit_card: 'card',
};
const canonicalPaymentMethod = (val) =>
  PAYMENT_METHOD_ALIASES[normalizePaymentMethod(val)] || 'cash_on_delivery';

// Refund rule: COD -> hamesha 'none'. Non-COD -> koi real gateway nahi hai,
// isliye 'pending' + amount (kabhi auto-refund nahi / kabhi paisa wapas nahi).
const buildRefundFields = (order) => {
  if (isCashOnDelivery(order.payment_method)) {
    return { refund_status: 'none', refund_amount: 0 };
  }
  return { refund_status: 'pending', refund_amount: Number(order.total_price ?? 0) || 0 };
};

// Idempotent stock restore: sirf tab chalta hai jab transition actually hua
// ho (.eq('status', ...) guard). Non-DB products skip ho jate hain (koi
// double-add nahi). Over-and-over call safe hai — release is additive by id.
const restoreStockForCancelledOrder = async (items) => {
  try {
    const normalized = normalizeStockItems(items).filter((e) => e.dbId != null);
    if (normalized.length === 0) return;
    await releaseStockReservation(
      supabase,
      normalized.map((e) => ({ dbId: e.dbId, qty: e.qty }))
    );
  } catch { /* best-effort — order state pahle hi set ho chuka */ }
};

const getDbUserRole = async (uid) => {
  if (!uid) return '';
  try {
    const { data } = await supabase.from('users').select('role').eq('id', uid).maybeSingle();
    return String(data?.role || '').toLowerCase();
  } catch { return ''; }
};

// Server-side admin check — mirrors the auth flow (users.role, metadata, or legacy user_roles).
const isAdminUser = async (req) => {
  const uid = req.user?.id ? String(req.user.id) : '';
  if (!uid) return false;
  if (String(req.user?.user_metadata?.role || '').toLowerCase() === 'admin') return true;
  const role = await getDbUserRole(uid);
  if (role === 'admin') return true;
  try {
    const { data: ur } = await supabase.from('user_roles').select('role').eq('user_id', uid).maybeSingle();
    return String(ur?.role || '').toLowerCase() === 'admin';
  } catch { return false; }
};

// Order insert ke turant baad assignment state resolve karo:
// FINAL FLOW: Customer -> nearest store -> store PACKED kare TABHI delivery assign.
// Isliye yahan kabhi delivery assign MAT karo — sirf status normalize karo.
// - 'pending_assignment' = store queue (pack hona baaki, delivery ke liye NOT ready).
// - 'packed' (unassigned, delivery_boy_id null) = delivery queue (assign ke liye ready).
// - Assign sirf 2 jagah se hota hai: store markOrderPacked (PACKED moment par)
//   aur 30s worker / retry (sirf 'packed' queue uthata hai).
// - DB trigger (trg_auto_assign_delivery_partner) bhi sirf 'packed' INSERT par
//   assign karta hai, taaki checkout ke waqt rider na mile.
const resolveInitialAssignment = async (inserted) => {
  if (!inserted?.id) return inserted;
  let finalOrder = inserted;
  try {
    const { data: fresh } = await supabase
      .from('orders')
      .select('*')
      .eq('id', inserted.id)
      .maybeSingle();
    if (fresh) finalOrder = fresh;

    const unassigned =
      !finalOrder.delivery_boy_id || String(finalOrder.delivery_boy_id).trim() === '';
    // PACKED se pehle delivery assign NAHI — chahe free riders hon tab bhi nahi.
    // Store markOrderPacked karega tab assign hoga. Yahan sirf normalize karo.
    if (!unassigned) return finalOrder;

    // Koi partner available nahi — requirement: pending_assignment rahe
    if (finalOrder.status !== 'pending_assignment') {
      const { data: normalized } = await supabase
        .from('orders')
        .update({ status: 'pending_assignment' })
        .eq('id', inserted.id)
        .select()
        .maybeSingle();
      if (normalized) return normalized;
      finalOrder = { ...finalOrder, status: 'pending_assignment' };
    }
    return finalOrder;
  } catch (e) {
    console.warn('⚠️ resolveInitialAssignment skip:', e.message);
    return finalOrder;
  }
};

// Bump coupon used_count by 1 after a successful order (best-effort, never fails the order)
const bumpCouponUsage = async (code) => {
  const clean = String(code || '').trim().toUpperCase();
  if (!clean) return;
  try {
    const { data: coupon } = await supabase
      .from('coupons')
      .select('id, used_count')
      .eq('code', clean)
      .maybeSingle();
    if (!coupon) return;
    await supabase
      .from('coupons')
      .update({ used_count: Number(coupon.used_count || 0) + 1 })
      .eq('id', coupon.id);
  } catch (e) {
    console.warn('⚠️ bumpCouponUsage failed:', e.message);
  }
};

// @desc    Create new order in Supabase
// @route   POST /orders or POST /api/orders
// @access  Private / Public (supports guest fallback)
export const createOrder = async (req, res) => {
  // Unexpected throw ke baad reserved stock wapas karne ke liye function-scope.
  let reservation = null;
  try {
    const {
      orderItems,
      order_items,
      items,
      shippingAddress,
      shipping_address,
      shippingaddress,
      paymentMethod,
      payment_method,
      itemsPrice,
      items_price,
      deliveryFee,
      delivery_fee,
      couponDiscount,
      coupon_discount,
      couponCode,
      coupon_code,
      deliveryInstructions,
      delivery_instructions,
      tipAmount,
      tip_amount,
      totalPrice,
      total_price,
      userId,
      user_id,
      userEmail,
      user_email,
      userName,
      user_name,
      storeId,
      store_id,
    } = req.body || {};

    let finalItems = orderItems || order_items || items || [];
    if (!finalItems || finalItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No order items provided',
      });
    }

    const finalShipping = shippingAddress || shipping_address || shippingaddress || {};
    const finalPaymentMethod = paymentMethod || payment_method || 'Cash On Delivery';
    // CLIENT values — sirf fallback, trust nahi (price-tamper fix, genuine total same rahega)
    const clientItemsPrice = Number(itemsPrice ?? items_price ?? 0) || 0;
    const clientDeliveryFee = Number(deliveryFee ?? delivery_fee ?? 0) || 0;
    const clientCouponDiscount = Number(couponDiscount ?? coupon_discount ?? 0) || 0;
    const clientCouponCode = String(couponCode || coupon_code || '').trim().toUpperCase() || null;
    const clientTotalPrice = Number(totalPrice ?? total_price ?? 0) || 0;
    const clientTip = Math.max(0, Number(tipAmount ?? tip_amount ?? 0) || 0);

    // ---- Payment method validation (Part B) ----
    // ONLINE_PAYMENTS_ENABLED=false hone par online methods reject (sirf cod).
    // Canonical value store hota hai (cash_on_delivery/upi/phonepe/...).
    const canonicalPay = canonicalPaymentMethod(finalPaymentMethod);
    const isCashPay = canonicalPay === 'cash_on_delivery';
    if (!isCashPay && !ONLINE_PAYMENTS_ENABLED) {
      return res.status(400).json({
        success: false,
        message: 'Online payment is not available yet. Please use Cash on Delivery.',
        code: 'ONLINE_PAYMENTS_DISABLED',
      });
    }

    // Multi-store: order ka store_id WAHI jo nearest ACTIVE store hai.
    // Client fresh-resolve karke bhejta hai, authoritative check yahan hota hai —
    // stale/tampered id ya missing id server theek kar deta hai.
    // NOTE: pricing block se PEHLE chalta hai taaki verified distance
    // (serverDistanceKm) se distance-based delivery fee nikal sake.
    const rawStoreId = storeId ?? store_id ?? null;
    const shipCoords = getShippingCoords(finalShipping);
    const storeResolution = await resolveOrderStore(supabase, {
      claimedStoreId: rawStoreId,
      lat: shipCoords?.lat ?? null,
      lng: shipCoords?.lng ?? null,
    });
    if (storeResolution.error === 'OUT_OF_SERVICE') {
      return res.status(400).json({
        success: false,
        message: 'Sorry, we do not deliver to your area yet',
      });
    }
    if (storeResolution.error === 'INVALID_STORE') {
      return res.status(400).json({
        success: false,
        message: 'Selected store is not available. Please refresh and try again.',
      });
    }
    let finalStoreId = storeResolution.storeId;
    // TO-PACK FIX: legacy/infra case me store_id null na rakho — warna StoreDashboard
    // (.in('store_id', ids)) me order kabhi dikhega hi nahi. Pehle claimed id (agar
    // active hai) rakho, warna first ACTIVE store pakdo taaki har naya order kisi
    // na kisi store ke To-Pack me jaye. OUT_OF_SERVICE/INVALID_STORE upar reject ho chuke.
    if (finalStoreId == null) {
      try {
        const claimed = Number(rawStoreId);
        if (Number.isFinite(claimed) && claimed > 0) {
          const { data: claimedRow } = await supabase
            .from('stores')
            .select('id,is_active')
            .eq('id', claimed)
            .maybeSingle();
          if (claimedRow && claimedRow.is_active !== false) finalStoreId = Number(claimedRow.id);
        }
      } catch { /* fallback neeche */ }
    }
    if (finalStoreId == null) {
      try {
        const { data: firstStore } = await supabase
          .from('stores')
          .select('id')
          .eq('is_active', true)
          .order('id', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (firstStore && firstStore.id != null) {
          finalStoreId = Number(firstStore.id);
          console.log(`📌 [store] legacy/null order -> fallback store #${finalStoreId} (To-Pack guarantee)`);
        }
      } catch { /* koi store na mile to null hi rahega, StoreDashboard null-pool dikhayega */ }
    }

    // Server-authoritative delivery distance & charge (₹10/KM, min ₹10, max 5 KM).
    // Client's deliveryFee is NEVER trusted — recalculated here from trusted store +
    // delivery address coords. Beyond 5 KM = unavailable (rejected); distance
    // verify na ho paye (legacy bina coords) to minimum charge fallback.
    const serverDistanceKm = storeResolution?.distanceKm ?? null;
    const serverDeliveryFee = serverDistanceKm != null ? calculateDeliveryCharge(serverDistanceKm) : null;

    // 5 KM hard limit — enforce in backend even if the browser hides/tampers it.
    if (serverDistanceKm != null && serverDeliveryFee === null) {
      return res.status(400).json({
        success: false,
        message: 'Sorry, we do not deliver to your area yet (beyond 5 KM service radius).',
      });
    }

    // SERVER-AUTHORITATIVE PRICING: DB se real price, coupon DB se verify,
    // delivery rule (₹399+ ya ₹0 par FREE, warna distance-based ₹10/KM min ₹10),
    // total server banayega.
    let finalItemsPrice = Math.max(0, clientItemsPrice);
    let finalDeliveryFee = Math.max(0, clientDeliveryFee);
    let finalCouponDiscount = Math.max(0, clientCouponDiscount);
    let finalCouponCode = clientCouponCode;
    let finalTotalPrice = Math.max(0, clientTotalPrice);
    let finalTipAmount = Math.min(500, clientTip);
    try {
      // 1. DB se real prices — kam-se-kam 1 match mila to server sum authoritative
      const toQty = (v) => {
        const n = Number(v);
        return Number.isInteger(n) && n > 0 ? n : 0;
      };
      const toDbId = (v) => {
        const n = Number(v);
        return Number.isInteger(n) && n > 0 ? n : null;
      };
      const ids = [
        ...new Set(
          (Array.isArray(finalItems) ? finalItems : [])
            .map((it) => toDbId(it?.productId ?? it?.product_id ?? it?.id))
            .filter((n) => n != null)
        ),
      ];
      const priceById = new Map();
      if (ids.length > 0) {
        const { data: rows } = await supabase.from('products').select('id,price').in('id', ids);
        for (const r of rows || []) {
          const p = Number(r?.price);
          if (Number.isFinite(p) && p >= 0) priceById.set(Number(r.id), p);
        }
      }
      if (priceById.size > 0) {
        let sum = 0;
        let covered = 0;
        finalItems = (Array.isArray(finalItems) ? finalItems : []).map((it) => {
          const qty = toQty(it?.quantity ?? it?.qty ?? 1) || 1;
          const dbId = toDbId(it?.productId ?? it?.product_id ?? it?.id);
          const dbPrice = dbId != null ? priceById.get(dbId) : undefined;
          if (dbPrice != null) {
            covered += 1;
            sum += dbPrice * qty;
            return { ...it, price: dbPrice };
          }
          sum += (Number(it?.price) || 0) * qty;
          return it;
        });
        if (covered > 0) {
          finalItemsPrice = Math.round(sum * 100) / 100;
        }
      }
      // 1b. Distance-based delivery fee (server-authoritative): ₹10/KM, min ₹10,
      // ₹399+ order par FREE. Client's fee kabhi trust nahi hoti.
      finalDeliveryFee = calculateDeliveryFee(finalItemsPrice, serverDistanceKm);
      // 2. Coupon DB se verify — invalid ho to discount 0 (paisa nahi dubega)
      if (finalCouponCode) {
        try {
          const { data: c } = await supabase
            .from('coupons')
            .select('code,discount_type,discount_value,min_order_amount,expiry_date,is_active,usage_limit,used_count')
            .eq('code', finalCouponCode)
            .maybeSingle();
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const invalid =
            !c ||
            c.is_active === false ||
            (c.expiry_date && new Date(c.expiry_date) < today) ||
            Number(c.min_order_amount || 0) > finalItemsPrice ||
            (c.usage_limit != null && Number(c.used_count || 0) >= Number(c.usage_limit));
          if (invalid) {
            finalCouponDiscount = 0;
            finalCouponCode = null;
          } else {
            let allowed = 0;
            if (String(c.discount_type || '').toLowerCase() === 'flat') {
              allowed = Number(c.discount_value || 0);
            } else {
              allowed = (finalItemsPrice * Number(c.discount_value || 0)) / 100;
            }
            allowed = Math.round(Math.max(0, allowed) * 100) / 100;
            finalCouponDiscount = Math.min(allowed, finalItemsPrice);
          }
        } catch {
          // coupons table missing ho to order na toote — client discount cap karke
          finalCouponDiscount = Math.min(Math.max(0, clientCouponDiscount), finalItemsPrice);
        }
      } else {
        finalCouponDiscount = 0;
      }
      // 3. Total authoritative — client total overwrite
      finalTotalPrice =
        Math.round((finalItemsPrice + finalDeliveryFee - finalCouponDiscount + finalTipAmount) * 100) / 100;
      finalTotalPrice = Math.max(0, finalTotalPrice);
    } catch {
      // Pricing me kuch fail ho to safe capped fallback — order kabhi na toote
      finalItemsPrice = Math.max(0, clientItemsPrice);
      finalDeliveryFee = calculateDeliveryFee(finalItemsPrice, serverDistanceKm);
      finalCouponDiscount = Math.min(Math.max(0, clientCouponDiscount), finalItemsPrice);
      finalCouponCode = clientCouponCode;
      finalTipAmount = Math.min(500, clientTip);
      finalTotalPrice =
        Math.max(
          0,
          Math.round((finalItemsPrice + finalDeliveryFee - finalCouponDiscount + finalTipAmount) * 100) / 100
        );
    }

    // delivery_instructions: array, JSON string ya single string — sabko TEXT[] me normalize karo
    const rawInstructions = deliveryInstructions ?? delivery_instructions ?? [];
    let finalInstructions = [];
    if (Array.isArray(rawInstructions)) {
      finalInstructions = rawInstructions.map((v) => String(v).trim()).filter(Boolean);
    } else if (typeof rawInstructions === 'string' && rawInstructions.trim()) {
      try {
        const parsed = JSON.parse(rawInstructions);
        finalInstructions = Array.isArray(parsed)
          ? parsed.map((v) => String(v).trim()).filter(Boolean)
          : [rawInstructions.trim()];
      } catch {
        finalInstructions = [rawInstructions.trim()];
      }
    }
    // req.user.id (from token) has highest priority -> per-user isolation for ALL users
    let ownerId = req.user?.id || userId || user_id || null;
    // 'guest' or non-UUID strings violate UUID FK -> store as null (guest order still saves)
    if (ownerId && !isValidUUID(ownerId)) {
      console.warn(`⚠️ Non-UUID ownerId "${ownerId}" converted to null for Supabase FK`);
      ownerId = null;
    }

    // If real UUID but public.users row missing, create it so FK passes for EVERY user
    if (ownerId) {
      await ensureUserRow(ownerId, {
        name: userName || user_name || req.user?.name,
        email: userEmail || user_email || req.user?.email,
        phone: req.user?.phone,
      });
    }

    // Real-time stock: order save se PEHLE atomic reserve (race-safe).
    // Koi line short ho to order banta hi nahi — 409 me exact available batao.
    // Non-DB products (seed 'p1' etc.) skip hote hain, order na toote.
    reservation = await reserveStockForOrder(supabase, finalItems);
    if (!reservation.ok) {
      const short = reservation.insufficient?.[0];
      return res.status(409).json({
        success: false,
        message: short
          ? `Only ${short.available} left for "${short.name}" — please reduce quantity.`
          : 'Some items in your cart are out of stock. Please refresh and try again.',
        insufficient: reservation.insufficient || [],
        code: 'INSUFFICIENT_STOCK',
      });
    }

    const payload = {
      user_id: ownerId,
      ...(finalStoreId != null ? { store_id: finalStoreId } : {}),
      order_items: finalItems,
      shipping_address: finalShipping,
      payment_method: canonicalPay,
      payment_status: isCashPay ? 'pending' : 'paid',
      items_price: finalItemsPrice,
      delivery_fee: finalDeliveryFee,
      coupon_discount: finalCouponDiscount,
      coupon_code: finalCouponCode,
      delivery_instructions: finalInstructions,
      tip_amount: finalTipAmount,
      total_price: finalTotalPrice,
      delivery_distance_km: serverDistanceKm ?? 0,
      // Koi partner available na ho to yehi status rehta hai —
      // 30s worker / Realtime listener baad me auto-assign karega.
      // Partner milte hi DB trigger ya resolveInitialAssignment ise 'assigned' karta hai.
      status: 'pending_assignment',
    };

    let { data, error } = await supabase
      .from('orders')
      .insert(payload)
      .select()
      .single();

    // Back-compat: migration file abhi tak run nahi hui ho to missing
    // columns hatakar retry karo taaki order kabhi fail na ho
    let insertPayload = payload;
    if (error && /coupon_code|delivery_instructions|tip_amount|store_id|delivery_distance_km|delivery_otp/i.test(error.message || '')) {
      const msg = error.message || '';
      console.warn('⚠️ orders table me column missing, retrying without it (run supabase_orders_*.sql migrations)');
      insertPayload = { ...payload };
      if (/coupon_code/i.test(msg)) delete insertPayload.coupon_code;
      if (/delivery_instructions/i.test(msg)) delete insertPayload.delivery_instructions;
      if (/tip_amount/i.test(msg)) delete insertPayload.tip_amount;
      if (/store_id/i.test(msg)) delete insertPayload.store_id;
      if (/delivery_distance_km/i.test(msg)) delete insertPayload.delivery_distance_km;
      if (/delivery_otp/i.test(msg)) {
        delete insertPayload.delivery_otp;
        delete insertPayload.delivery_otp_attempts;
      }
      const retry = await supabase.from('orders').insert(insertPayload).select().single();
      data = retry.data;
      error = retry.error;
    }

    // Last-resort: if FK still fails (e.g. auth.users row deleted), save as guest order so data never lost
    if (error && error.message && error.message.includes('violates foreign key')) {
      console.warn('⚠️ FK retry with null user_id so order still saves');
      const { data: retryData, error: retryError } = await supabase
        .from('orders')
        .insert({ ...insertPayload, user_id: null })
        .select()
        .single();
      if (!retryError) {
        await bumpCouponUsage(finalCouponCode);
        const finalGuestOrder = await resolveInitialAssignment(retryData);
        return res.status(201).json({
          success: true,
          message: 'Order placed successfully! 🎉',
          data: { ...finalGuestOrder, _original_user_id: ownerId },
          source: 'supabase_cloud_database',
          note: 'Saved as guest order due to missing user profile, but order is safe.',
        });
      }
      error = retryError;
    }

    if (error) {
      console.warn('⚠️ Supabase Order Insert Warning:', error.message);
      // Order bani hi nahi — reserved stock wapas karo (oversell nahi, phantom cut nahi).
      await releaseStockReservation(supabase, reservation.reserved);
      return res.status(500).json({
        success: false,
        message: 'Order could not be placed in database',
        error: error.message,
      });
    }

    await bumpCouponUsage(finalCouponCode);
    const finalOrder = await resolveInitialAssignment(data);
    return res.status(201).json({
      success: true,
      message: 'Order placed successfully! 🎉',
      data: finalOrder,
      source: 'supabase_cloud_database',
    });
  } catch (error) {
    // Order confirm hui hi nahi — reserved stock (agar kuch hua ho) wapas.
    try {
      if (reservation?.reserved?.length) await releaseStockReservation(supabase, reservation.reserved);
    } catch { /* best-effort */ }
    res.status(500).json({
      success: false,
      message: 'Server error while creating order',
      error: error.message,
    });
  }
};

// Delivery-only status transition. The service-role server validates ownership,
// forward-only order, OTP attempts, and records the earning atomically enough
// for the existing Supabase schema.
export const deliverOrderWithOtp = async (req, res) => {
  try {
    const { id } = req.params;
    const partnerId = String(req.user?.id || '');
    const otp = String(req.body?.otp || '').replace(/\D/g, '');
    const { data: order, error } = await supabase.from('orders').select('*').eq('id', id).maybeSingle();
    if (error || !order) return res.status(404).json({ success: false, message: 'Order not found.' });
    if (String(order.delivery_boy_id || '') !== partnerId) return res.status(403).json({ success: false, message: 'This order is not assigned to you.' });

    const current = normalizeDeliveryStatus(order.status) === 'out_for_delivery'
      ? 'reached_customer'
      : normalizeDeliveryStatus(order.status);
    if (current !== 'reached_customer') return res.status(400).json({ success: false, message: 'Reach the customer before completing delivery.' });
    if (order.delivery_otp_locked_until && new Date(order.delivery_otp_locked_until) > new Date()) {
      return res.status(423).json({ success: false, message: 'Delivery OTP is locked after 5 failed attempts.' });
    }
    if (!/^\d{4}$/.test(otp)) return res.status(400).json({ success: false, message: 'Enter the customer 4-digit OTP.' });

    const expected = String(order.delivery_otp || '').padStart(4, '0');
    const matches = expected.length === otp.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(otp));
    if (!matches) {
      const attempts = Number(order.delivery_otp_attempts || 0) + 1;
      await supabase.from('orders').update({
        delivery_otp_attempts: attempts,
        ...(attempts >= 5 ? { delivery_otp_locked_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() } : {}),
      }).eq('id', id).eq('delivery_boy_id', partnerId);
      return res.status(400).json({ success: false, message: attempts >= 5 ? 'Delivery OTP locked after 5 failed attempts.' : `Incorrect OTP. ${5 - attempts} attempts left.` });
    }

    const { data: updated, error: updateError } = await supabase.from('orders').update({
      status: 'delivered',
      delivery_otp_verified_at: new Date().toISOString(),
    }).eq('id', id).eq('delivery_boy_id', partnerId).eq('status', order.status).select().single();
    if (updateError || !updated) return res.status(409).json({ success: false, message: 'Order changed. Refresh and try again.' });

    const { error: earningError } = await supabase.from('delivery_earnings').upsert({
      order_id: order.id,
      partner_id: partnerId,
      fee: Number(order.delivery_fee || 0),
      tip: Number(order.tip_amount || 0),
    }, { onConflict: 'order_id' });
    if (earningError) console.error('[delivery] earning record failed:', earningError.message);
    return res.status(200).json({ success: true, data: updated });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Delivery could not be completed.' });
  }
};

export const transitionDeliveryStatus = async (req, res) => {
  try {
    const partnerId = String(req.user?.id || '');
    const requested = normalizeDeliveryStatus(req.body?.status);
    const { data: order, error } = await supabase.from('orders').select('*').eq('id', req.params.id).maybeSingle();
    if (error || !order) return res.status(404).json({ success: false, message: 'Order not found.' });
    if (String(order.delivery_boy_id || '') !== partnerId) return res.status(403).json({ success: false, message: 'This order is not assigned to you.' });
    const current = normalizeDeliveryStatus(order.status) === 'out_for_delivery'
      ? 'reached_customer'
      : normalizeDeliveryStatus(order.status);
    const currentIndex = DELIVERY_STATUS_FLOW.indexOf(current);
    const nextIndex = DELIVERY_STATUS_FLOW.indexOf(requested);
    const acceptingAssigned = current === 'assigned' && requested === 'accepted';
    if ((!acceptingAssigned && nextIndex !== currentIndex + 1) || requested === 'delivered') {
      return res.status(400).json({ success: false, message: 'Only the next delivery step is allowed.' });
    }
    const { data: updated, error: updateError } = await supabase.from('orders')
      .update({ status: requested })
      .eq('id', order.id)
      .eq('delivery_boy_id', partnerId)
      .eq('status', order.status)
      .select()
      .single();
    if (updateError || !updated) return res.status(409).json({ success: false, message: 'Order changed. Refresh and try again.' });
    return res.status(200).json({ success: true, data: updated });
  } catch {
    return res.status(500).json({ success: false, message: 'Status could not be updated.' });
  }
};

// @desc    Partner accepts an assigned order (server-side RPC, SECURITY DEFINER)
// @route   POST /api/orders/:id/accept
// @access  Private (assigned partner only)
export const acceptOrderDelivery = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.rpc('accept_order', {
      p_order_id: Number(id),
      p_partner_id: req.user?.id,
    });

    if (error) {
      const { status, json } = rpcError(error, 'Could not accept the order.');
      return res.status(status).json(json);
    }
    if (!data?.success) {
      return res.status(400).json({ success: false, message: data?.message || 'Order could not be accepted.' });
    }
    return res.status(200).json({ success: true, message: 'Order accepted.', data: data.data });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Error accepting order', error: e.message });
  }
};

// @desc    Partner rejects an assigned order (returns to pending_assignment, status)
// @route   POST /api/orders/:id/reject
// @access  Private (assigned partner only)
export const rejectOrderDelivery = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.rpc('reject_order', {
      p_order_id: Number(id),
      p_partner_id: req.user?.id,
    });

    if (error) {
      const { status, json } = rpcError(error, 'Could not reject the order.');
      return res.status(status).json(json);
    }
    if (!data?.success) {
      return res.status(400).json({ success: false, message: data?.message || 'Could not reject the order.' });
    }
    return res.status(200).json({ success: true, message: 'Order returned to queue.', data: data.data });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Error rejecting order', error: e.message });
  }
};

// @desc    Get single order by ID
// @route   GET /api/orders/:id
// @access  Private (SECURITY FIX: owner / admin / store_manager / assigned partner only)
export const getOrderById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: order, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    // Per-order access check — bina haq ke koi dusre ka order na dekhe (data leak fix).
    // Genuine flows nahi rukenge: owner / admin / assigned partner / apne store ka manager pass.
    const uid = req.user?.id ? String(req.user.id) : '';
    let role = '';
    try {
      if (uid) {
        const { data: me } = await supabase.from('users').select('role').eq('id', uid).maybeSingle();
        role = String(me?.role || '').toLowerCase();
      }
    } catch { /* role unknown — owner/partner check neeche */ }
    if (role !== 'admin') {
      const isOwner = order.user_id && uid && String(order.user_id) === uid;
      const isPartner =
        order.delivery_boy_id && uid && String(order.delivery_boy_id) === uid;
      let isStoreManager = false;
      if (!isOwner && !isPartner && role === 'store_manager' && order.store_id != null && uid) {
        try {
          const { data: links } = await supabase
            .from('store_staff')
            .select('store_id')
            .eq('user_id', uid);
          const ids = (links || []).map((r) => Number(r.store_id));
          if (ids.includes(Number(order.store_id))) isStoreManager = true;
        } catch { /* deny */ }
      }
      if (!isOwner && !isPartner && !isStoreManager) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to view this order',
        });
      }
    }

    res.status(200).json({
      success: true,
      data: order,
      source: 'supabase_cloud_database',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching order',
      error: error.message,
    });
  }
};

// @desc    Accept order (delivery partner)
// @route   POST /api/orders/:id/accept
// @access  Private
export const acceptOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const deliveryBoyId = req.body?.deliveryBoyId || req.body?.delivery_boy_id || req.user?.id;

    if (!deliveryBoyId) {
      return res.status(400).json({
        success: false,
        message: 'Delivery partner id is required',
      });
    }

    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    if (order.delivery_boy_id) {
      return res.status(400).json({
        success: false,
        message: 'Order already accepted by another partner',
      });
    }

    // PACK-FIRST GATE: bina pack hue order accept nahi ho sakta.
    // Jo bhi order aaye, pehle To-Pack me aayega, pack hoke hi aage badhega.
    if (isStoreQueueStatus(order.status)) {
      return res.status(400).json({
        success: false,
        message: 'Order not packed yet — store needs to pack first',
        code: 'NOT_PACKED_YET',
      });
    }

    const { data: updated, error: updateError } = await supabase
      .from('orders')
      .update({
        delivery_boy_id: String(deliveryBoyId),
        status: 'Out for Delivery',
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({
        success: false,
        message: 'Could not accept order',
        error: updateError.message,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Order accepted successfully',
      data: updated,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error accepting order',
      error: error.message,
    });
  }
};

// @desc    Reject order (delivery partner)
// @route   POST /api/orders/:id/reject
// @access  Private
export const rejectOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const deliveryBoyId = req.body?.deliveryBoyId || req.body?.delivery_boy_id || req.user?.id;

    if (!deliveryBoyId) {
      return res.status(400).json({
        success: false,
        message: 'Delivery partner id is required',
      });
    }

    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    const currentRejected = Array.isArray(order.rejected_by) ? order.rejected_by : [];
    const rejectedSet = [...new Set([...currentRejected, String(deliveryBoyId)])];

    const { data: updated, error: updateError } = await supabase
      .from('orders')
      .update({ rejected_by: rejectedSet })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({
        success: false,
        message: 'Could not reject order',
        error: updateError.message,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Order rejected',
      data: updated,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error rejecting order',
      error: error.message,
    });
  }
};

// @desc    Get logged in user orders
// @route   GET /api/orders/myorders
// @access  Private (SECURITY FIX: ?userId spoof block — sirf apna data)
export const getMyOrders = async (req, res) => {
  try {
    // Logged-in user ka id hi truth hai. ?userId sirf admin ke liye allow.
    let userId = req.user?.id || null;
    const requested = req.query.userId || req.query.user_id;
    if (requested && String(requested).trim() !== '' && req.user?.id) {
      try {
        const { data: me } = await supabase
          .from('users')
          .select('role')
          .eq('id', req.user.id)
          .maybeSingle();
        if (String(me?.role || '').toLowerCase() === 'admin') {
          userId = String(requested).trim();
        }
        // non-admin ka requested ignore — khud ka hi milega, data leak nahi
      } catch { /* ignore — khud ka id rahega */ }
    }

    let query = supabase.from('orders').select('*').order('created_at', { ascending: false });

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data: orders, error } = await query;

    if (error) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch orders',
        error: error.message,
      });
    }

    res.status(200).json({
      success: true,
      count: orders.length,
      data: orders,
      source: 'supabase_cloud_database',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching my orders',
      error: error.message,
    });
  }
};

// @desc    Get orders (alias for compatibility with server.js)
// @route   GET /orders
// @access  Private
export const getOrders = getMyOrders;

// @desc    Admin manual override: kisi bhi order ka delivery partner
//          dropdown se change karo — auto-assign ke bawajood.
//          Emergency me admin khud control le sake.
// @route   PUT /api/orders/:id/assign (alias: PUT /orders/:id/assign)
// @access  Private (admin only)
// @body    { deliveryBoyId | delivery_boy_id: string | null }
//          null/'' = unassign -> order wapas "pending_assignment",
//          worker agli available partner par auto-assign karega.
export const assignDeliveryPartner = async (req, res) => {
  try {
    const { id } = req.params;
    const raw =
      req.body?.deliveryBoyId ?? req.body?.delivery_boy_id ?? null;
    const newBoyId =
      raw === null || raw === undefined || String(raw).trim() === ''
        ? null
        : String(raw).trim();

    // Admin check (users table hi source of truth hai — AdminDashboard jaisa)
    try {
      const { data: me } = await supabase
        .from('users')
        .select('role')
        .eq('id', req.user?.id)
        .maybeSingle();
      if (String(me?.role || '').toLowerCase() !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Only admin can manually assign delivery partner',
        });
      }
    } catch (e) {
      return res.status(403).json({
        success: false,
        message: 'Admin verification failed',
      });
    }

    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    const prevBoyId =
      order.delivery_boy_id && String(order.delivery_boy_id).trim() !== ''
        ? String(order.delivery_boy_id)
        : null;

    // NOTE: is_available ko HAATH NAHI lagate — Online/Offline SIRF partner
    // ke apne toggle ya Admin toggle se badalta hai, assign/unassign se nahi.

    // ---- UNASSIGN: partner hatao, order wapas store queue me ----
    // NO AUTO-PACKED: bina store Pack kiye 'packed' mat banao.
    // Isliye unassign par 'pending_assignment' rakho taaki store dobara
    // Mark as Packed kare TABHI delivery assign ho.
    if (!newBoyId) {
      if (String(order.status || '').toLowerCase() === 'delivered') {
        return res.status(400).json({
          success: false,
          message: 'Delivered orders cannot be unassigned',
        });
      }
      const { data: updated, error: updateError } = await supabase
        .from('orders')
        .update({ delivery_boy_id: null, status: 'pending_assignment' })
        .eq('id', id)
        .select()
        .single();
      if (updateError) {
        return res.status(500).json({
          success: false,
          message: 'Could not unassign delivery partner',
          error: updateError.message,
        });
      }
      // Partner ka Online/Offline status touch nahi hota — wahi rahega jo
      // partner/Admin ne set kiya hai.
      return res.status(200).json({
        success: true,
        message: 'Partner removed — order is back in To-Pack queue, store needs to pack again',
        data: updated,
      });
    }

    // ---- ASSIGN / CHANGE ----
    // PACK-FIRST GATE: jo bhi order aaye, pehle To-Pack me aayega.
    // Bina pack hue admin bhi delivery assign nahi kar sakta — pehle store
    // Mark as Packed kare, TABHI aage badhega.
    if (isStoreQueueStatus(order.status)) {
      return res.status(400).json({
        success: false,
        message: 'Order not packed yet — store needs to pack first (To-Pack queue)',
        code: 'NOT_PACKED_YET',
      });
    }
    if (newBoyId === prevBoyId) {
      return res.status(200).json({
        success: true,
        message: 'This partner is already assigned',
        data: order,
      });
    }

    // Partner exist + delivery role? (Emergency override: verified/available
    // false ho tab bhi allow — admin ka faisla sabse upar.)
    const { data: partner } = await supabase
      .from('users')
      .select('id, role')
      .eq('id', newBoyId)
      .maybeSingle();
    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Delivery partner not found',
      });
    }
    if (!['delivery', 'delivery_partner'].includes(String(partner.role || '').toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: 'Selected user is not a delivery partner',
      });
    }

    // Delivered/cancelled order ka status mat bigado — sirf partner sudharo
    const keepStatus = ['delivered', 'cancelled'].includes(
      String(order.status || '').toLowerCase()
    );
    // Admin override: is partner ka purana rejection (agar tha) saaf karo
    const cleanedRejected = Array.isArray(order.rejected_by)
      ? order.rejected_by.filter((r) => String(r) !== String(newBoyId))
      : order.rejected_by;

    const { data: updated, error: updateError } = await supabase
      .from('orders')
      .update({
        delivery_boy_id: String(newBoyId),
        ...(keepStatus ? {} : { status: 'assigned' }),
        ...(Array.isArray(order.rejected_by) ? { rejected_by: cleanedRejected } : {}),
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({
        success: false,
        message: 'Could not assign delivery partner',
        error: updateError.message,
      });
    }

    // NOTE: naye/purane partner ka Online/Offline status touch nahi hota.
    return res.status(200).json({
      success: true,
      message: prevBoyId
        ? 'Delivery partner changed (manual override) ✅'
        : 'Delivery partner assigned (manual override) ✅',
      data: updated,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error assigning delivery partner',
      error: error.message,
    });
  }
};

// @desc    Store Manager: order ko "packed" mark karo + turant auto-assign chalao
// @route   PUT /orders/:id/pack or PUT /api/orders/:id/pack
// @access  Private (store_manager — sirf apne store ke orders)
// Flow: role check -> store_staff se manager ke store_ids -> order.store_id
// match -> status='packed' -> WAHI tryAssignSingleOrder logic (INSERT trigger
// sirf naye orders par chalta hai, isliye pack par yahan se explicitly assign).
export const markOrderPacked = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Role check — users table source of truth
    let me = null;
    try {
      const { data } = await supabase
        .from('users')
        .select('id, role')
        .eq('id', req.user?.id)
        .maybeSingle();
      me = data;
    } catch (e) {
      return res.status(403).json({ success: false, message: 'Store verification failed' });
    }
    if (String(me?.role || '').toLowerCase() !== 'store_manager') {
      return res.status(403).json({ success: false, message: 'Only store managers can pack orders' });
    }

    // 2. Manager ke stores (store_staff link) — legacy table missing ho to empty
    let myStoreIds = [];
    try {
      const { data: links, error: linkError } = await supabase
        .from('store_staff')
        .select('store_id')
        .eq('user_id', me.id);
      if (linkError) throw linkError;
      myStoreIds = (links || []).map((r) => Number(r.store_id)).filter((n) => !Number.isNaN(n));
    } catch (e) {
      return res.status(500).json({
        success: false,
        message: 'Store link not found. Ask an admin to link you in store_staff.',
      });
    }
    if (myStoreIds.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'You are not linked to any store. Ask an admin to assign a store.',
      });
    }

    // 3. Order lao + ownership check (sirf apne store ka order)
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();
    if (fetchError || !order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    // TO-PACK FIX: store_id NULL (legacy/direct-insert) order kisi bhi linked store
    // par claim ho sakta hai — taaki koi naya order To-Pack me atke nahi.
    // Normal orders (store_id set) pehle jaisa strict check rahega.
    let claimedStoreId = null;
    if (order.store_id == null) {
      claimedStoreId = myStoreIds[0];
      if (claimedStoreId == null) {
        return res.status(403).json({ success: false, message: 'This order does not belong to your store' });
      }
    } else if (!myStoreIds.includes(Number(order.store_id))) {
      return res.status(403).json({ success: false, message: 'This order does not belong to your store' });
    }

    const statusLower = normalizeStatusKey(order.status);
    if (['delivered', 'cancelled'].includes(statusLower)) {
      return res.status(400).json({
        success: false,
        message: `${order.status} order cannot be marked as packed`,
      });
    }

    // 4. status='packed' — SIRF store-queue (koi bhi unpacked variant:
    // placed/pending/pending_assignment/processing/confirmed/created)
    // se packed banao. Jo bhi order aaye, pehle To-Pack me aayega, pack hoke
    // hi aage badhega. Already packed/assigned/accepted/... ko HAATH MAT
    // lagao (warna assigned -> packed regress ho jayega aur delivery state
    // bigad jayegi). Already-assigned par niche assign attempt safe no-op hai.
    const alreadyAssigned =
      order.delivery_boy_id != null && String(order.delivery_boy_id).trim() !== '';
    let packed = order;

    // 4.5 BARCODE VERIFICATION GATE (strict, server-side):
    // Store panel pack se PEHLE har item verify karta hai —
    //  - jis product ka barcode_number set hai: scan kiya hua barcode match
    //    karna ZAROORI hai (GTIN leading-zero normalize ke saath),
    //  - jiska barcode nahi hai: store ne explicitly "Confirm" kiya ho
    //    (manual: true).
    // Bina poora verify hue pack request 400 reject — koi bhi purana client /
    // direct API call / cache pack nahi kar sakta. (DB hard guard + ye gate
    // dono milkar bypass-proof rakhte hain.)
    if (!alreadyAssigned && isStoreQueueStatus(order.status)) {
      const verifiedItems = Array.isArray(req.body?.verified_items) ? req.body.verified_items : [];
      const items = Array.isArray(order.order_items) ? order.order_items : [];
      const productIds = [...new Set(items.map(itemProductId).filter((n) => n != null))];
      const barcodeByProductId = new Map();
      if (productIds.length > 0) {
        let prodRes = await supabase.from('products').select('id,barcode_number').in('id', productIds);
        if (prodRes.error && /barcode_number|column|schema cache/i.test(prodRes.error.message || '')) {
          // Migration pending: barcode column nahi hai — sab items manual-confirm lane me.
          prodRes = await supabase.from('products').select('id').in('id', productIds);
        }
        if (prodRes.error) {
          console.error(`❌ [pack] order #${id} barcode fetch fail:`, prodRes.error.message);
          return res.status(500).json({
            success: false,
            message: 'Barcode verification check failed. Please try again.',
          });
        }
        for (const p of prodRes.data || []) {
          const bc = String(p?.barcode_number || '').trim();
          if (bc) barcodeByProductId.set(Number(p.id), bc);
        }
      }
      const unverified = [];
      for (let idx = 0; idx < items.length; idx++) {
        const expected = barcodeByProductId.get(itemProductId(items[idx]));
        const entry = verifiedItems.find((e) => Number(e?.index) === idx);
        const ok = expected
          ? barcodesMatch(entry?.barcode, expected)
          : Boolean(entry && entry.manual === true);
        if (!ok) unverified.push(String(items[idx]?.name || `Item ${idx + 1}`));
      }
      if (unverified.length > 0) {
        return res.status(400).json({
          success: false,
          code: 'BARCODE_NOT_VERIFIED',
          message: `Sabhi items verify nahi hue: ${unverified.slice(0, 3).join(', ')}${unverified.length > 3 ? ` +${unverified.length - 3} more` : ''}. Har item ka barcode scan karo (ya barcode na ho to Confirm karo), phir Mark as Packed dabao.`,
          unverified,
        });
      }
    }

    if (!alreadyAssigned && isStoreQueueStatus(order.status)) {
      // Claim case me store_id bhi set karo taaki order is store ka ho jaye
      const packUpdate = claimedStoreId != null ? { status: 'packed', store_id: claimedStoreId } : { status: 'packed' };
      const { data: updated, error: updateError } = await supabase
        .from('orders')
        .update(packUpdate)
        .eq('id', id)
        .select()
        .single();
      if (updateError) {
        // Network tab me 500 dikhega — terminal me EXACT wajah log karo
        // (RLS deny? galat column? FK?). RLS deny ho to
        // server/supabase_store_pack_policy.sql RUN karo; service_role
        // key (server/.env SUPABASE_SERVICE_ROLE_KEY) ye class fix karta hai.
        console.error(`❌ [pack] order #${id} UPDATE fail:`, updateError.message);
        return res.status(500).json({
          success: false,
          message: 'Could not mark order as packed',
          error: updateError.message,
        });
      }
      packed = updated;
    }

    // 5. Turant WAHI auto-assign logic (deliveryAssign.js — 30s worker wala).
    // Pehle se assigned ho to ye kuch nahi karta (safe no-op).
    // HOME-FIRST: order wale store ke home partners pehle, phir fallback.
    let assignedPartner = null;
    let assignSource = null;
    try {
      const { tryAssignSingleOrder } = await import('../utils/deliveryAssign.js');
      const assignResult = await tryAssignSingleOrder(supabase, packed);
      assignedPartner = assignResult?.partner ?? null;
      assignSource = assignResult?.source ?? null;
    } catch (e) {
      console.warn(`⚠️ [pack] auto-assign attempt failed: ${e.message}`);
    }

    // Fresh row (trigger/worker ne status 'assigned' kiya ho to reflect ho)
    let finalOrder = packed;
    try {
      const { data: fresh } = await supabase.from('orders').select('*').eq('id', id).single();
      if (fresh) finalOrder = fresh;
    } catch {
      /* ignore */
    }

    return res.status(200).json({
      success: true,
      message: assignedPartner
        ? 'Order packed ✅ — delivery partner assigned 🎉'
        : 'Order packed ✅ — no partner available, in pending queue',
      data: finalOrder,
      assigned: Boolean(assignedPartner),
      partnerId: assignedPartner ? String(assignedPartner.id) : null,
      // Admin/Store ko pattern samajhne ke liye: 'home' = us store ke home
      // partner ko gaya, 'fallback' = baaki nearby partners me se gaya.
      assignSource,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error marking order as packed',
      error: error.message,
    });
  }
};
// @desc    List packed (delivery-ready, unassigned) orders (worker queue visibility)
// @route   GET /api/orders/pending/list
// @access  Private (admin / monitoring)
export const getPendingAssignments = async (req, res) => {
  try {
    const { fetchPendingOrders } = await import('../utils/deliveryAssign.js');
    const pending = await fetchPendingOrders(supabase, 100);
    res.status(200).json({
      success: true,
      count: pending.length,
      data: pending,
      source: 'supabase_cloud_database',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching pending assignments',
      error: error.message,
    });
  }
};

// @desc    Manually trigger pending-assignment retry (same logic as 30s worker)
// @route   POST /api/orders/retry-assign
// @access  Private (admin / monitoring)
export const retryPendingAssignments = async (req, res) => {
  try {
    const { tryAssignPendingOrders } = await import('../utils/deliveryAssign.js');
    const result = await tryAssignPendingOrders(supabase, {
      limit: Number(req.body?.limit) || 50,
    });
    res.status(200).json({
      success: true,
      message:
        result.assigned > 0
          ? `${result.assigned} order(s) assigned 🎉`
          : 'No eligible partner available — orders will remain pending',
      ...result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error retrying pending assignments',
      error: error.message,
    });
  }
};

// =====================================================================
// Cancel / Refund / Review endpoints (Step 2)
// =====================================================================

// @desc    Customer cancel (own order, before packed)
// @route   POST /api/orders/:id/cancel
// @access  Private (order owner only)
export const cancelOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const uid = req.user?.id ? String(req.user.id) : '';
    if (!uid) return res.status(401).json({ success: false, message: 'Not authorized.' });

    const reason = String(req.body?.reason || req.body?.cancel_reason || '').trim().slice(0, 300);

    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr || !order) return res.status(404).json({ success: false, message: 'Order not found.' });

    // Ownership: sirf order ka owner hi cancel kar sakta hai.
    if (!order.user_id || String(order.user_id) !== uid) {
      return res.status(403).json({ success: false, message: 'You can only cancel your own order.' });
    }

    // Sirf store-queue (pack se pehle) cancel ho sakta hai. Packed ya aage = 400.
    if (!isStoreQueueStatus(order.status)) {
      return res.status(400).json({
        success: false,
        message: 'Order can only be cancelled before it is packed.',
        code: 'ORDER_NOT_CANCELLABLE',
      });
    }

    const refund = buildRefundFields(order);

    const { data: updated, error: updErr } = await supabase
      .from('orders')
      .update({
        status: 'cancelled',
        cancelled_by: 'customer',
        cancel_reason: reason,
        cancelled_at: new Date().toISOString(),
        ...refund,
      })
      .eq('id', id)
      .eq('status', order.status) // race guard
      .select()
      .maybeSingle();

    if (updErr || !updated) {
      return res.status(409).json({ success: false, message: 'Order changed. Refresh and try again.' });
    }

    // Idempotent stock restore (sirf successful transition par).
    await restoreStockForCancelledOrder(updated.order_items || order.order_items);

    return res.status(200).json({ success: true, message: 'Order cancelled.', data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error cancelling order', error: error.message });
  }
};

// @desc    Delivery partner reports an issue (return/refund)
// @route   POST /api/orders/:id/delivery-issue
// @access  Private (assigned partner only)
export const reportDeliveryIssue = async (req, res) => {
  try {
    const { id } = req.params;
    const pid = req.user?.id ? String(req.user.id) : '';
    if (!pid) return res.status(401).json({ success: false, message: 'Not authorized.' });

    const reason = String(req.body?.reason || '').trim();
    if (!DELIVERY_ISSUE_REASONS.has(reason)) {
      return res.status(400).json({ success: false, message: 'Invalid issue reason.', code: 'INVALID_REASON' });
    }

    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr || !order) return res.status(404).json({ success: false, message: 'Order not found.' });

    // Sirf assigned partner hi issue report kar sakta hai.
    if (!order.delivery_boy_id || String(order.delivery_boy_id) !== pid) {
      return res.status(403).json({ success: false, message: 'This order is not assigned to you.' });
    }

    // picked_up .. reached_customer ke beech.
    const cur = normalizeStatusKey(order.status);
    const allowed = ['picked_up', 'out_for_delivery', 'reached_customer'];
    if (!allowed.includes(cur)) {
      return res.status(400).json({
        success: false,
        message: 'Issue can only be reported after pickup and before/at delivery.',
        code: 'INVALID_DELIVERY_STAGE',
      });
    }

    const refund = buildRefundFields(order);

    const { data: updated, error: updErr } = await supabase
      .from('orders')
      .update({
        status: 'return_refund',
        return_reason: reason,
        cancelled_by: 'delivery',
        cancelled_at: new Date().toISOString(),
        ...refund,
      })
      .eq('id', id)
      .eq('status', order.status) // race guard
      .select()
      .maybeSingle();

    if (updErr || !updated) {
      return res.status(409).json({ success: false, message: 'Order changed. Refresh and try again.' });
    }

    await restoreStockForCancelledOrder(updated.order_items || order.order_items);
    return res.status(200).json({ success: true, message: 'Delivery issue reported. Order marked return/refund.', data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error reporting issue', error: error.message });
  }
};

// @desc    Delivery partner submits a review for a delivered order
// @route   POST /api/orders/:id/review
// @access  Private (assigned partner, delivered order, once)
export const submitOrderReview = async (req, res) => {
  try {
    const { id } = req.params;
    const pid = req.user?.id ? String(req.user.id) : '';
    if (!pid) return res.status(401).json({ success: false, message: 'Not authorized.' });

    const rating = Number(req.body?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be an integer between 1 and 5.' });
    }

    const rawTags = Array.isArray(req.body?.tags) ? req.body.tags : [];
    const tags = [...new Set(rawTags.map((t) => String(t).trim()).filter(Boolean))];
    if (tags.some((t) => !REVIEW_TAGS.has(t))) {
      return res.status(400).json({ success: false, message: 'One or more tags are not allowed.', code: 'INVALID_TAG' });
    }

    const comment = String(req.body?.comment || '').trim();
    if (comment.length > 500) {
      return res.status(400).json({ success: false, message: 'Comment cannot exceed 500 characters.' });
    }

    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr || !order) return res.status(404).json({ success: false, message: 'Order not found.' });

    if (!order.delivery_boy_id || String(order.delivery_boy_id) !== pid) {
      return res.status(403).json({ success: false, message: 'This order is not assigned to you.' });
    }
    if (normalizeStatusKey(order.status) !== 'delivered') {
      return res.status(400).json({ success: false, message: 'You can only review a delivered order.' });
    }

    // exactly-once = UNIQUE(order_id) + DB trigger. Duplicate -> 23505.
    const { data: inserted, error: insErr } = await supabase
      .from('order_reviews')
      .insert({
        order_id: Number(order.id),
        reviewer_id: pid,
        customer_id: order.user_id || null,
        rating,
        tags,
        comment: comment || null,
      })
      .select()
      .single();

    if (insErr) {
      if (/23505|order_reviews_once_per_order/.test(String(insErr.message || ''))) {
        return res.status(409).json({ success: false, message: 'This order has already been reviewed.', code: 'REVIEW_ALREADY_EXISTS' });
      }
      return res.status(500).json({ success: false, message: 'Failed to save review', error: insErr.message });
    }

    return res.status(201).json({ success: true, message: 'Review submitted.', data: inserted });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error submitting review', error: error.message });
  }
};

// @desc    Admin: list cancelled / return_refund orders
// @route   GET /api/orders/admin/refunds
// @access  Private (admin only)
export const getRefundOrderList = async (req, res) => {
  try {
    if (!(await isAdminUser(req))) {
      return res.status(403).json({ success: false, message: 'Admin access required.' });
    }
    const { data: orders, error } = await supabase
      .from('orders')
      .select('*')
      .in('status', ['cancelled', 'canceled', 'return_refund'])
      .order('created_at', { ascending: false });
    if (error) {
      return res.status(500).json({ success: false, message: 'Failed to fetch refund orders', error: error.message });
    }
    return res.status(200).json({ success: true, count: orders?.length || 0, data: orders || [] });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching refund orders', error: error.message });
  }
};

// @desc    Admin: mark an order as refunded (only pending)
// @route   PATCH /api/orders/:id/mark-refunded
// @access  Private (admin only)
export const markOrderRefunded = async (req, res) => {
  try {
    if (!(await isAdminUser(req))) {
      return res.status(403).json({ success: false, message: 'Admin access required.' });
    }
    const { id } = req.params;
    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr || !order) return res.status(404).json({ success: false, message: 'Order not found.' });
    if (order.refund_status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Only pending refunds can be marked refunded.', code: 'REFUND_NOT_PENDING' });
    }
    const { data: updated, error: updErr } = await supabase
      .from('orders')
      .update({ refund_status: 'refunded' })
      .eq('id', id)
      .eq('refund_status', 'pending')
      .select()
      .maybeSingle();
    if (updErr || !updated) {
      return res.status(409).json({ success: false, message: 'Refund state changed. Refresh and try again.' });
    }
    return res.status(200).json({ success: true, message: 'Order marked as refunded.', data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error marking refunded', error: error.message });
  }
};

// @desc    Admin: list reviews (with average rating)
// @route   GET /api/orders/admin/reviews
// @access  Private (admin only)
export const getReviewsList = async (req, res) => {
  try {
    if (!(await isAdminUser(req))) {
      return res.status(403).json({ success: false, message: 'Admin access required.' });
    }
    const { data: reviews, error } = await supabase
      .from('order_reviews')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      return res.status(500).json({ success: false, message: 'Failed to fetch reviews', error: error.message });
    }
    const all = reviews || [];
    const avg = all.length ? all.reduce((s, r) => s + Number(r.rating || 0), 0) / all.length : 0;
    return res.status(200).json({ success: true, count: all.length, averageRating: Math.round(avg * 100) / 100, data: all });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching reviews', error: error.message });
  }
};

// =====================================================================
// Part A — Delivery step / COD / OTP (server-side, SECURITY DEFINER RPC)
// =====================================================================
// Ye saare RPC secure functions ko call karte hain (supabase_delivery_cod_
// otp_flow.sql). Server service-role se call karta hai; function khud owner/
// partner checks karta hai. Client se seedha payment/status UPDATE block hai
// (RLS + trigger) — isliye ye hi order aage badhane ke raaste hain.

// RPC ke default error ko friendly message me badlo (migration pending ho to)
const rpcError = (error, fallback) => {
  const msg = String(error?.message || '');
  if (/does not exist|schema cache|function.*not found/i.test(msg)) {
    return {
      status: 500,
      json: {
        success: false,
        message: `${fallback} — Run server/supabase_delivery_cod_otp_flow.sql in Supabase SQL Editor first.`,
      },
    };
  }
  return { status: 500, json: { success: false, message: msg || fallback } };
};

// @desc    Advance delivery step (forward-only + Delivered payment/OTP gate)
// @route   POST /api/orders/:id/advance-step  { step }
// @access  Private (assigned partner)
export const advanceOrderStep = async (req, res) => {
  try {
    const { id } = req.params;
    const step = String(req.body?.step || req.body?.status || '').trim();
    if (!step) return res.status(400).json({ success: false, message: 'Step is required' });

    const { data, error } = await supabase.rpc('advance_order_step', {
      p_order_id: Number(id),
      p_partner_id: req.user?.id,
      p_target: step,
    });

    if (error) {
      const { status, json } = rpcError(error, 'Could not advance the order step.');
      return res.status(status).json(json);
    }
    if (!data?.success) {
      return res.status(400).json({ success: false, message: data?.message || 'Step not allowed.' });
    }
    return res.status(200).json({ success: true, message: 'Step updated.', data: data.data });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Error advancing order step', error: e.message });
  }
};

// @desc    Partner confirms cash collected (collected_amount from total)
// @route   POST /api/orders/:id/collect-payment
// @access  Private (assigned partner)
export const collectCashPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.rpc('collect_order_payment', {
      p_order_id: Number(id),
      p_partner_id: req.user?.id,
    });

    if (error) {
      const { status, json } = rpcError(error, 'Could not collect payment.');
      return res.status(status).json(json);
    }
    if (!data?.success) {
      return res.status(400).json({ success: false, message: data?.message || 'Could not collect payment.' });
    }
    return res.status(200).json({ success: true, message: 'Cash received.', data: data.data });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Error collecting payment', error: e.message });
  }
};

// @desc    Partner verifies customer 4-digit OTP (server-side, lock on 5)
// @route   POST /api/orders/:id/verify-otp  { otp }
// @access  Private (assigned partner)
export const verifyOrderOtp = async (req, res) => {
  try {
    const { id } = req.params;
    const otp = String(req.body?.otp || '').replace(/\D/g, '');
    const { data, error } = await supabase.rpc('verify_order_otp', {
      p_order_id: Number(id),
      p_partner_id: req.user?.id,
      p_otp: otp,
    });

    if (error) {
      const { status, json } = rpcError(error, 'Could not verify OTP.');
      return res.status(status).json(json);
    }
    if (!data?.success) {
      return res.status(400).json({ success: false, message: data?.message || 'OTP verification failed.' });
    }
    return res.status(200).json({ success: true, message: data.message || 'OTP verified.', data: data.data });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Error verifying OTP', error: e.message });
  }
};

// @desc    Customer (owner) ya admin ko OTP dikhao (hash se fresh code)
// @route   GET /api/orders/:id/otp
// @access  Private (order owner / admin)
export const getCustomerOtp = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.rpc('get_customer_otp', {
      p_order_id: Number(id),
      p_user_id: req.user?.id,
    });

    if (error) {
      const { status, json } = rpcError(error, 'Could not fetch OTP.');
      return res.status(status).json(json);
    }
    if (!data?.success) {
      return res.status(403).json({ success: false, message: data?.message || 'Not authorized to view this OTP.' });
    }
    return res.status(200).json({ success: true, otp: data.otp, order_status: data.order_status });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Error fetching OTP', error: e.message });
  }
};

// @desc    Admin override: delivered bina OTP (reason mandatory + audit log)
// @route   POST /api/orders/:id/admin-deliver-override  { reason }
// @access  Private (admin only)
export const adminOverrideDeliver = async (req, res) => {
  try {
    const { id } = req.params;
    const reason = String(req.body?.reason || '').trim();
    const { data, error } = await supabase.rpc('admin_override_deliver', {
      p_order_id: Number(id),
      p_admin_id: req.user?.id,
      p_reason: reason,
    });

    if (error) {
      const { status, json } = rpcError(error, 'Admin override failed.');
      return res.status(status).json(json);
    }
    if (!data?.success) {
      const status = /Admin access/.test(data?.message || '') ? 403 : 400;
      return res.status(status).json({ success: false, message: data?.message || 'Admin override failed.' });
    }
    return res.status(200).json({ success: true, message: 'Order marked delivered (admin override).', data: data.data });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Admin override failed', error: e.message });
  }
};
