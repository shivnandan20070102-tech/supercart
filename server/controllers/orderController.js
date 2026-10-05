import { supabase } from '../config/supabase.js';
import { getShippingCoords, resolveOrderStore } from '../utils/storeAssign.js';
import { releaseStockReservation, reserveStockForOrder } from '../utils/stock.js';

const isValidUUID = (val) => {
  if (!val || typeof val !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
};

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

    const finalItems = orderItems || order_items || items || [];
    if (!finalItems || finalItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No order items provided',
      });
    }

    const finalShipping = shippingAddress || shipping_address || shippingaddress || {};
    const finalPaymentMethod = paymentMethod || payment_method || 'Cash On Delivery';
    const finalItemsPrice = itemsPrice ?? items_price ?? 0;
    const finalDeliveryFee = deliveryFee ?? delivery_fee ?? 0;
    const finalCouponDiscount = couponDiscount ?? coupon_discount ?? 0;
    const finalCouponCode = String(couponCode || coupon_code || '').trim().toUpperCase() || null;
    const finalTotalPrice = totalPrice ?? total_price ?? 0;

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
    const finalTipAmount = Math.max(0, Number(tipAmount ?? tip_amount ?? 0) || 0);
    // Multi-store: order ka store_id WAHI jo nearest ACTIVE store hai.
    // Client fresh-resolve karke bhejta hai, authoritative check yahan hota hai —
    // stale/tampered id ya missing id server theek kar deta hai.
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
    const finalStoreId = storeResolution.storeId;

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
      payment_method: finalPaymentMethod,
      items_price: finalItemsPrice,
      delivery_fee: finalDeliveryFee,
      coupon_discount: finalCouponDiscount,
      coupon_code: finalCouponCode,
      delivery_instructions: finalInstructions,
      tip_amount: finalTipAmount,
      total_price: finalTotalPrice,
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
    if (error && /coupon_code|delivery_instructions|tip_amount|store_id/i.test(error.message || '')) {
      const msg = error.message || '';
      console.warn('⚠️ orders table me column missing, retrying without it (run supabase_orders_*.sql migrations)');
      insertPayload = { ...payload };
      if (/coupon_code/i.test(msg)) delete insertPayload.coupon_code;
      if (/delivery_instructions/i.test(msg)) delete insertPayload.delivery_instructions;
      if (/tip_amount/i.test(msg)) delete insertPayload.tip_amount;
      if (/store_id/i.test(msg)) delete insertPayload.store_id;
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

// @desc    Get single order by ID
// @route   GET /api/orders/:id
// @access  Private
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
// @access  Private
export const getMyOrders = async (req, res) => {
  try {
    const userId = req.user?.id || req.query.userId;

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

    // ---- UNASSIGN: partner hatao, order wapas delivery queue me ----
    // FINAL FLOW: order pehle hi PACKED tha, isliye 'packed' (unassigned) rakho
    // taaki worker agle FREE partner ko de sake. 'pending_assignment' store
    // queue hai — wahan bhejne par store ko dobara pack karna padta (galat).
    if (!newBoyId) {
      if (String(order.status || '').toLowerCase() === 'delivered') {
        return res.status(400).json({
          success: false,
          message: 'Delivered orders cannot be unassigned',
        });
      }
      const { data: updated, error: updateError } = await supabase
        .from('orders')
        .update({ delivery_boy_id: null, status: 'packed' })
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
        message: 'Partner removed — order is back in the packed queue for auto-assign',
        data: updated,
      });
    }

    // ---- ASSIGN / CHANGE ----
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
    if (order.store_id == null || !myStoreIds.includes(Number(order.store_id))) {
      return res.status(403).json({ success: false, message: 'This order does not belong to your store' });
    }

    const statusLower = String(order.status || '').toLowerCase();
    if (['delivered', 'cancelled'].includes(statusLower)) {
      return res.status(400).json({
        success: false,
        message: `${order.status} order cannot be marked as packed`,
      });
    }

    // 4. status='packed' (already packed ho to bhi aage assign attempt karo)
    let packed = order;
    if (statusLower !== 'packed') {
      const { data: updated, error: updateError } = await supabase
        .from('orders')
        .update({ status: 'packed' })
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
