import crypto from 'node:crypto';
import Razorpay from 'razorpay';

// ============================================================================
// SUPERCART — PAYMENT SERVICE (Razorpay)
// ============================================================================
// Real Razorpay integration. Fail-closed: if RAZORPAY_KEY_ID /
// RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET are missing, we ALWAYS throw /
// reject — we never return `ok: true` for an unverified payment.
//
// Secrets only come from server/.env — they are never logged and never appear
// in any response.
//
// Config flag — env se (default false).
// True hone par online methods enable hote hain (gateway required).
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

const RAZORPAY_KEY_ID = String(process.env.RAZORPAY_KEY_ID || '').trim();
const RAZORPAY_KEY_SECRET = String(process.env.RAZORPAY_KEY_SECRET || '').trim();
const RAZORPAY_WEBHOOK_SECRET = String(process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();

let _razorpay = null;

// Fail-closed client factory. Throws if keys are missing so callers can never
// accidentally "succeed" without a real gateway.
function getRazorpay() {
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    throw new Error(
      'Razorpay is not configured: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are missing.'
    );
  }
  if (!_razorpay) {
    _razorpay = new Razorpay({
      key_id: RAZORPAY_KEY_ID,
      key_secret: RAZORPAY_KEY_SECRET,
    });
  }
  return _razorpay;
}

const rupeesToPaise = (rupees) => Math.round((Number(rupees) || 0) * 100);

// Constant-time HMAC (SHA-256) comparison. `message` may be a string or Buffer.
function safeHmacCompare(message, providedHex, secret) {
  const provided = Buffer.from(String(providedHex || ''), 'hex');
  const expected = crypto.createHmac('sha256', secret).update(message).digest();
  return provided.length === expected.length && crypto.timingSafeEqual(expected, provided);
}

// ============================================================================
// createPaymentOrder — razorpay.orders.create
// ============================================================================
// @param {object} order - the Supabase order row (already inserted)
// @returns {Promise<{ok:boolean, gateway:string, orderId:string|null,
//           keyId:string, amount:number, currency:string}>}
export async function createPaymentOrder(order) {
  // Fail closed if keys are not configured.
  const razorpay = getRazorpay();

  const amountPaise = rupeesToPaise(order?.total_price);
  const rzpOrder = await razorpay.orders.create({
    amount: amountPaise,
    currency: 'INR',
    receipt: String(order?.id), // order id = receipt
  });

  return {
    ok: true,
    gateway: 'razorpay',
    orderId: rzpOrder?.id ?? null,
    keyId: RAZORPAY_KEY_ID,
    amount: rzpOrder?.amount ?? amountPaise, // in paise
    currency: rzpOrder?.currency ?? 'INR',
  };
}

// ============================================================================
// verifyRazorpayPayment — verify payment on success redirect
// ============================================================================
// (a) HMAC SHA-256 of `${razorpay_order_id}|${razorpay_payment_id}` with
//      RAZORPAY_KEY_SECRET, compared constant-time with razorpay_signature.
// (b) razorpay.payments.fetch(payment_id): must be status 'captured',
//      order_id must match, amount must equal the server total.
// Anything that does not match => { ok: false, reason } (never marks paid).
export async function verifyRazorpayPayment({ orderId, paymentId, signature, expectedAmountRs }) {
  const razorpay = getRazorpay(); // fail closed

  const payment = await razorpay.payments.fetch(String(paymentId));

  // (a) Signature check.
  const message = `${orderId}|${paymentId}`;
  if (!safeHmacCompare(message, signature, RAZORPAY_KEY_SECRET)) {
    return { ok: false, reason: 'signature_mismatch' };
  }

  // (b) Status + order_id + amount checks (amount in paise).
  if (payment?.status !== 'captured') {
    return { ok: false, reason: 'not_captured' };
  }
  if (String(payment?.order_id) !== String(orderId)) {
    return { ok: false, reason: 'order_id_mismatch' };
  }
  if (Number(payment?.amount) !== rupeesToPaise(expectedAmountRs)) {
    return { ok: false, reason: 'amount_mismatch' };
  }

  return { ok: true, payment };
}

// ============================================================================
// verifyPaymentWebhook — Razorpay server-to-server webhook
// ============================================================================
// Verifies X-Razorpay-Signature (HMAC SHA-256 of the RAW body with
// RAZORPAY_WEBHOOK_SECRET). Maps:
//   payment.captured / order.paid -> status 'paid'
//   payment.failed                -> status 'failed'
// Returns { ok:false } for any verification failure — callers must reject.
// @param {string|Buffer} rawBody - the raw JSON request body
// @param {string} signature - value of the X-Razorpay-Signature header
export async function verifyPaymentWebhook(rawBody, signature) {
  if (!RAZORPAY_WEBHOOK_SECRET) {
    throw new Error(
      'Razorpay webhook is not configured: RAZORPAY_WEBHOOK_SECRET is missing.'
    );
  }

  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''), 'utf8');

  if (!safeHmacCompare(bodyBuffer, signature, RAZORPAY_WEBHOOK_SECRET)) {
    return { ok: false, reason: 'signature_mismatch' };
  }

  let payload;
  try {
    payload = JSON.parse(bodyBuffer.toString('utf8'));
  } catch {
    return { ok: false, reason: 'bad_json' };
  }

  const event = payload?.event;
  const entity = payload?.payload?.payment?.entity ?? payload?.payload?.order?.entity ?? {};
  const paymentId = entity?.id ?? null;
  const orderId = entity?.order_id ?? entity?.receipt ?? null;
  const amountPaise = Number(entity?.amount) || 0;

  let status;
  if (event === 'payment.captured' || event === 'order.paid') {
    status = 'paid';
  } else if (event === 'payment.failed') {
    status = 'failed';
  } else {
    return { ok: false, reason: 'unhandled_event', event };
  }

  return { ok: true, status, event, orderId, paymentId, amountPaise };
}

export default {
  ONLINE_PAYMENTS_ENABLED,
  PAYMENT_METHOD_LABELS,
  ONLINE_PAYMENT_METHODS,
  createPaymentOrder,
  verifyRazorpayPayment,
  verifyPaymentWebhook,
};
