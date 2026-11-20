// ============================================================================
// SUPERCART — PAYMENT CONTROLLER (create-order / verify / webhook)
// ============================================================================
// Online payment flow ka server-side entry point. Payment state orders table
// (payment_status) par rehta hai. Abhi Real gateway placeholders hain
// (paymentService.js) — ye controller unhe real route handler ke andar wrap
// karta hai: generate gateway intent, order paid mark karna, webhook parse.
//
// Flow:
//   1. POST /api/payments/create-order  -> createPaymentOrder() stub, gateway
//      intent/ref return (abhi ok:true, gateway:null).
//   2. POST /api/payments/verify        -> client ke success redirect ke baad
//      payment confirm karo (order.payment_status='paid').
//   3. POST /api/payments/webhook       -> gateway webhook, signature verify +
//      amount check + paid mark (placeholder stub).
// ============================================================================

import { supabase } from '../config/supabase.js';
import {
  ONLINE_PAYMENTS_ENABLED,
  createPaymentOrder,
  verifyRazorpayPayment,
  verifyPaymentWebhook,
} from '../services/paymentService.js';

const normalizePayMethod = (val) => String(val || '').trim().toLowerCase();

const isCashOnDelivery = (method) =>
  ['cod', 'cash', 'cash_on_delivery'].includes(normalizePayMethod(method));

const isAlreadyPaid = (order) =>
  normalizePayMethod(order?.payment_status) === 'paid';

const toNumber = (val) => {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
};

// orders.id BIGINT hai — numeric string bhi accept karo, invalid par null.
const loadOrder = async (id) => {
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return null;
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', n)
      .maybeSingle();
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
};

// Payment de se sirf order ka owner (ya admin) hi jud sakta hai — koi aur
// user kisi aur ke order ka payment create/verify na kar sake.
const isOrderOwnerOrAdmin = async (req, order) => {
  const uid = req.user?.id ? String(req.user.id) : '';
  if (!uid) return false;
  let role = '';
  try {
    if (uid) {
      const { data: me } = await supabase.from('users').select('role').eq('id', uid).maybeSingle();
      role = String(me?.role || '').toLowerCase();
    }
  } catch { /* role unknown — owner check neeche */ }
  if (role === 'admin') return true;
  return !!(order.user_id && String(order.user_id) === uid);
};

// Online order ka payment_status='paid' mark karo (paid_at + gateway ref bhi).
// Razorpay columns (razorpay_order_id / razorpay_payment_id / gateway_ref /
// paid_at) migration pending ho to graceful fallback — order kabhi stale
// 'pending' par nahi rukta.
const markOrderPaid = async (order, { paymentId, rzpOrderId } = {}) => {
  const now = new Date().toISOString();
  const attempts = [
    {
      payment_status: 'paid',
      paid_at: now,
      ...(paymentId
        ? { gateway_ref: String(paymentId), razorpay_payment_id: String(paymentId) }
        : {}),
      ...(rzpOrderId ? { razorpay_order_id: String(rzpOrderId) } : {}),
    },
    {
      payment_status: 'paid',
      paid_at: now,
      ...(paymentId ? { gateway_ref: String(paymentId) } : {}),
    },
    { payment_status: 'paid' },
  ];
  let lastErr = null;
  for (const payload of attempts) {
    try {
      const { data, error } = await supabase
        .from('orders')
        .update(payload)
        .eq('id', order.id)
        .select()
        .maybeSingle();
      if (!error && data) return data;
      lastErr = error;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
};

// Online payment disabled ho to sirf ek generic reject (config single source).
const rejectIfDisabled = (res) =>
  res.status(400).json({
    success: false,
    message: 'Online payment is not available yet. Please use Cash on Delivery.',
    code: 'ONLINE_PAYMENTS_DISABLED',
  });

// ============================================================================
// create-order — gateway payment intent banao (order ke liye)
// ============================================================================
// @route   POST /api/payments/create-order
// @access  Private (authenticated user)
// @body    { order_id | orderId, amount? }
export const createOrder = async (req, res) => {
  try {
    if (!ONLINE_PAYMENTS_ENABLED) return rejectIfDisabled(res);

    const orderId = req.body?.order_id ?? req.body?.orderId ?? req.body?.id;
    if (orderId == null) {
      return res.status(400).json({ success: false, message: 'order_id is required' });
    }

    const order = await loadOrder(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    if (!(await isOrderOwnerOrAdmin(req, order))) {
      return res.status(403).json({ success: false, message: 'Not authorized for this order' });
    }
    if (isCashOnDelivery(order.payment_method)) {
      return res.status(400).json({
        success: false,
        message: 'COD order does not need an online payment.',
      });
    }
    if (isAlreadyPaid(order)) {
      return res.status(400).json({ success: false, message: 'Order is already paid.' });
    }

    // SECURITY: client-supplied amount hamesha ignore hota hai. Rakam sirf
    // order.total_price se aati hai (paise me) — tamper-proof.
    const amountPaise = Math.round(toNumber(order.total_price) * 100);
    const result = await createPaymentOrder({ ...order, amount: amountPaise });
    if (!result?.ok) {
      return res.status(502).json({ success: false, message: 'Payment gateway could not create order.' });
    }

    return res.status(200).json({
      success: true,
      message: 'Payment order created.',
      data: {
        order_id: order.id,
        gateway: result.gateway ?? 'razorpay',
        razorpay_order_id: result.orderId ?? null,
        key_id: result.keyId ?? null,
        amount: amountPaise / 100,
        currency: result.currency ?? 'INR',
        method: order.payment_method,
        is_online: true,
      },
    });
  } catch (error) {
    console.error('❌ [pay] create-order error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error creating payment order',
    });
  }
};

// ============================================================================
// verify — client ke payment success redirect ki confirmation
// ============================================================================
// @route   POST /api/payments/verify
// @access  Private (authenticated user)
// @body    { order_id | orderId, amount?, payment_ref? }
export const verifyPayment = async (req, res) => {
  try {
    if (!ONLINE_PAYMENTS_ENABLED) return rejectIfDisabled(res);

    const orderId = req.body?.order_id ?? req.body?.orderId ?? req.body?.id;
    if (orderId == null) {
      return res.status(400).json({ success: false, message: 'order_id is required' });
    }

    const order = await loadOrder(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    if (!(await isOrderOwnerOrAdmin(req, order))) {
      return res.status(403).json({ success: false, message: 'Not authorized for this order' });
    }
    if (isCashOnDelivery(order.payment_method)) {
      return res.status(400).json({
        success: false,
        message: 'COD order does not need online payment verification.',
      });
    }
    if (isAlreadyPaid(order)) {
      return res.status(200).json({ success: true, message: 'Order already paid.', data: order });
    }

    const { razorpay_payment_id, razorpay_signature } = req.body || {};
    if (!razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'razorpay_payment_id and razorpay_signature are required.',
      });
    }

    // SECURITY: razorpay_order_id client se kabhi mat lo — sirf DB me save hua
    // razorpay_order_id valid hai. Client bheje to ignore hota hai.
    const dbRzpOrderId = order.razorpay_order_id?.toString();
    if (!dbRzpOrderId) {
      return res.status(400).json({ success: false, message: 'No Razorpay order on record for this order' });
    }

    // SECURITY: ek hi razorpay_payment_id alag orders par reuse na ho sake.
    try {
      const { data: reused } = await supabase
        .from('orders')
        .select('id')
        .eq('razorpay_payment_id', String(razorpay_payment_id))
        .neq('id', order.id)
        .maybeSingle();
      if (reused) {
        return res.status(400).json({ success: false, message: 'Payment reference already used on another order' });
      }
    } catch { /* ignore lookup err — verify neeche decide karta hai */ }

    // Verify with Razorpay: HMAC signature + fetched payment (captured,
    // matching order_id, matching amount). Any mismatch => 400, never paid.
    let vResult;
    try {
      vResult = await verifyRazorpayPayment({
        orderId: dbRzpOrderId,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
        expectedAmountRs: order.total_price,
      });
    } catch (error) {
      console.error('❌ [pay] verify exception:', error.message);
      return res.status(400).json({ success: false, message: 'Payment verification failed.' });
    }
    if (!vResult?.ok) {
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed.',
        reason: vResult?.reason,
      });
    }

    const updated = await markOrderPaid(order, {
      paymentId: razorpay_payment_id,
      rzpOrderId: dbRzpOrderId,
    });

    return res.status(200).json({
      success: true,
      message: 'Payment verified.',
      data: updated,
    });
  } catch (error) {
    console.error('❌ [pay] verify error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error verifying payment',
    });
  }
};

// ============================================================================
// webhook — gateway server-to-server callback
// ============================================================================
// @route   POST /api/payments/webhook
// @access  Public (gateway) — real gateway me yahan signature verify hota hai.
// @body    raw gateway payload (order_id / payment_id / amount ...)
export const paymentWebhook = async (req, res) => {
  try {
    if (!ONLINE_PAYMENTS_ENABLED) return rejectIfDisabled(res);

    // Raw JSON body (Buffer) — required for HMAC signature verification.
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : null;
    if (!rawBody) {
      return res.status(400).json({ success: false, message: 'Raw JSON body required.' });
    }
    const signature = String(req.headers['x-razorpay-signature'] || '');

    const verified = await verifyPaymentWebhook(rawBody, signature);
    if (!verified?.ok) {
      return res.status(400).json({
        success: false,
        message: 'Webhook verification failed.',
        reason: verified?.reason,
      });
    }

    const orderId = verified.orderId;
    if (orderId == null) {
      return res.status(400).json({ success: false, message: 'order_id missing in webhook payload.' });
    }

    const order = await loadOrder(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    if (isCashOnDelivery(order.payment_method)) {
      return res.status(400).json({ success: false, message: 'COD order cannot be paid via webhook.' });
    }

    // Failed payment -> record failed (best-effort), ack webhook.
    if (verified.status === 'failed') {
      try {
        await supabase.from('orders').update({ payment_status: 'failed' }).eq('id', order.id);
      } catch {
        // ignore — state is best-effort
      }
      return res.status(200).json({ success: true, message: 'Payment failure recorded.' });
    }

    // Paid: amount must match server total (webhook amount is in paise).
    const hookAmount = verified.amountPaise > 0 ? verified.amountPaise / 100 : 0;
    if (hookAmount > 0 && Math.abs(hookAmount - toNumber(order.total_price)) > 0.01) {
      return res.status(400).json({ success: false, message: 'Webhook amount does not match order total.' });
    }

    if (isAlreadyPaid(order)) {
      return res.status(200).json({ success: true, message: 'Order already paid.', data: order });
    }

    const updated = await markOrderPaid(order, {
      paymentId: verified.paymentId,
      rzpOrderId: verified.orderId,
    });

    return res.status(200).json({
      success: true,
      message: 'Payment confirmed via webhook.',
      data: updated,
    });
  } catch (error) {
    console.error('❌ [pay] webhook error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Webhook processing error',
    });
  }
};

export default { createOrder, verifyPayment, paymentWebhook };
