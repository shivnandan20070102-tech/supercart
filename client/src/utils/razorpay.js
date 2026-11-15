// ============================================================================
// SUPERCART — RAZORPAY CHECKOUT HELPER (client)
// ============================================================================
// Loads the Razorpay checkout SDK once and opens the checkout modal. Only
// NON-secret values (key_id, order_id, amount, prefill) are passed here — the
// key_secret never leaves the server. amount is in PAISE.
// ============================================================================

export const RAZORPAY_CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

let _scriptPromise = null;

export const loadRazorpayScript = () => {
  if (typeof window !== 'undefined' && window.Razorpay) return Promise.resolve();
  if (_scriptPromise) return _scriptPromise;
  _scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = RAZORPAY_CHECKOUT_SRC;
    s.async = true;
    s.onload = () => {
      if (window.Razorpay) resolve();
      else reject(new Error('Razorpay SDK failed to load.'));
    };
    s.onerror = () => reject(new Error('Could not load Razorpay SDK. Please check your connection.'));
    document.body.appendChild(s);
  });
  return _scriptPromise;
};

export const openRazorpayCheckout = ({ key, amountPaise, orderId, name, prefill, handler, onDismiss }) => {
  const rzp = new window.Razorpay({
    key,
    amount: Math.round(Number(amountPaise) || 0),
    currency: 'INR',
    name: name || 'SuperCart',
    description: 'Grocery Order',
    order_id: orderId,
    prefill: prefill || {},
    theme: { color: '#059669' },
    handler,
    modal: { ondismiss: onDismiss },
  });
  rzp.open();
  return rzp;
};
