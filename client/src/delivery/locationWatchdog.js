// Location request watchdog — pure helpers (Node-testable).
//
// Problem: kuch mobile browsers me navigator.geolocation kabhi callback hi
// nahi karta (GPS stall / background tab). Tab hook ka `loading` hamesha
// true rehta → pill "Locating…" + locate button ka spinner permanently stuck.
// Ye watchdog overall budget lagata hai: fix na aaye to onTimeout fire karo
// taaki UI wapas Retry-able state me aaye. Natural success/error aate hi
// caller cancelWatchdog() karta hai.

export const LOCATION_REQUEST_BUDGET_MS = 30000;

export const LOCATION_STALL_MESSAGE =
  'Location is taking too long. Showing your Home Store map — tap Retry to try GPS again.';

// Ek watchdog start karo; cancel fn wapas milta hai.
export const startRequestWatchdog = ({ timeoutMs = LOCATION_REQUEST_BUDGET_MS, hasFix, onTimeout } = {}) => {
  const ms = Number(timeoutMs);
  const budget = Number.isFinite(ms) && ms > 0 ? ms : LOCATION_REQUEST_BUDGET_MS;
  const timer = setTimeout(() => {
    let fixed = false;
    try {
      fixed = typeof hasFix === 'function' ? !!hasFix() : false;
    } catch {
      fixed = false;
    }
    if (fixed) return;
    try {
      if (typeof onTimeout === 'function') onTimeout();
    } catch {
      /* best-effort */
    }
  }, budget);
  // Unref where supported (Node tests) taaki process latke nahi.
  try {
    if (timer && typeof timer.unref === 'function') timer.unref();
  } catch {
    /* browsers me unref nahi hota */
  }
  return () => {
    try {
      clearTimeout(timer);
    } catch {
      /* ignore */
    }
  };
};
