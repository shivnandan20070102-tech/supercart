// ============================================================================
// SUPERCART — PAYMENT SERVICE (extension point for a real gateway)
// ============================================================================
// Part B: Online payment pages are DISABLED unless ONLINE_PAYMENTS_ENABLED=true.
// Ye module gateway integration ka clean extension point hai — abhi sirf
// stubs hain (koi real call nahi, koi key/secret code me nahi).
//
// Jab gateway connect karni ho:
//   1. Yeh file edit karo — createPaymentOrder() me apna gateway SDK/HTTP
//      call lagao, verifyPaymentWebhook() me webhook signature verify karo.
//   2. Keys sirf server/.env me rakho (GATEWAY_KEY_ID / GATEWAY_KEY_SECRET),
//      code me kabhi hardcode mat karo.
// ============================================================================

// Config flag — env se (default false).
// True hone par online methods enable hote hain (gateway placeholder).
export const ONLINE_PAYMENTS_ENABLED =
  String(process.env.ONLINE_PAYMENTS_ENABLED || '').trim().toLowerCase() === 'true';

// Canonical payment method values stored on orders.payment_method
export const PAYMENT_METHOD_LABELS = {
  cash_on_delivery: 'Cash on Delivery',
  upi: 'UPI',
  phonepe: 'PhonePe',
  google_pay: 'Google Pay',
  card: 'Debit / Credit Card',
};

// Online methods (non-COD) — ye hi flag false hone par disable rehte hain.
export const ONLINE_PAYMENT_METHODS = ['upi', 'phonepe', 'google_pay', 'card'];

/**
 * createPaymentOrder — gateway "create order" stub.
 * Real gateway: yahan create payment intent/order return karo. Abhi koi
 * call nahi hota — sirf placeholder. Order placement iske bina nahi rukta.
 * @param {object} order - the Supabase order row (already inserted)
 * @returns {Promise<{ok:boolean, gateway?:string, ref?:string}>}
 */
export async function createPaymentOrder(order) {
  // PLACEHOLDER — koi gateway call nahi. Online flow abhi disabled hai.
  return { ok: true, gateway: null, ref: null };
}

/**
 * verifyPaymentWebhook — gateway webhook verify stub.
 * Real gateway: signature check + amount check yahan karo; success par
 * order.payment_status = 'paid' update karo. Abhi placeholder.
 * @param {object} payload - raw webhook body
 * @returns {Promise<{ok:boolean, orderId?:string|number}>}
 */
export async function verifyPaymentWebhook(payload) {
  // PLACEHOLDER — koi webhook verify nahi.
  return { ok: true, orderId: payload?.order_id ?? payload?.orderId ?? null };
}

export default { ONLINE_PAYMENTS_ENABLED, PAYMENT_METHOD_LABELS, createPaymentOrder, verifyPaymentWebhook };
