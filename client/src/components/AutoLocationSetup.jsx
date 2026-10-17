import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, MapPinCheck, MapPinOff, Navigation } from 'lucide-react';
import useDeliveryAddress, { readStoredAddress } from '../hooks/useDeliveryAddress';
import { readGpsCoords } from '../services/nearestStore';
import {
  GEO_UNSUPPORTED,
  buildAutoAddress,
  getCurrentFix,
  reverseGeocode,
} from '../services/autoLocation';

// Dismiss sirf session ke liye — nayi session me notification dobara aayega.
const DISMISS_KEY = 'supercart_location_notice_dismissed';

const readDismissed = () => {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
};

const NOTICES = {
  denied: {
    title: 'Turn on location',
    body: 'We auto-set your delivery address from GPS, but location is blocked. Open the browser lock icon (🔒) → Location → Allow, then tap Try Again. Orders cannot be placed without a delivery location.',
  },
  unavailable: {
    title: 'Location is unavailable',
    body: 'Please turn ON device location / GPS, then tap Try Again. Orders cannot be placed without a delivery location.',
  },
  unsupported: {
    title: 'Location not supported',
    body: 'This browser cannot share your location. Please set your address manually from the header (Select delivery location).',
  },
  error: {
    title: "Couldn't get your location",
    body: 'Please check that location is ON and tap Try Again. You can also set the address manually from the header.',
  },
};

/**
 * AutoLocationSetup — naya user (bina saved delivery address) aate hi:
 * 1. GPS fix (app-open par StoreContext ka cached fix ho to wahi) le kar
 *    Mapbox reverse geocode karta hai aur delivery address auto-save karta hai.
 * 2. Location off/denied/unsupported ho to notification (toast) dikhata hai —
 *    Try Again ke saath. Orders location ke bina checkout par blocked rehte hain.
 * Customer pages (ShopLayout) ke andar mount hota hai — admin/delivery panels par nahi.
 */
const AutoLocationSetup = () => {
  const { hasCoords, saveAddress } = useDeliveryAddress();
  const [status, setStatus] = useState('idle'); // idle | locating | success | notice
  const [notice, setNotice] = useState(NOTICES.error);
  const [successMsg, setSuccessMsg] = useState('');
  const [dismissed, setDismissed] = useState(readDismissed);
  const runningRef = useRef(false);
  const autoStartedRef = useRef(false);

  const applyFix = useCallback(
    async (fix) => {
      // User ne beech me manually address save kar diya ho to auto GPS
      // usse overwrite na kare (geocode await ke pehle + baad dono check).
      if (readStoredAddress()) {
        setStatus('idle');
        return;
      }
      const parsed = await reverseGeocode(fix.lat, fix.lng);
      if (readStoredAddress()) {
        setStatus('idle');
        return;
      }
      saveAddress(buildAutoAddress(fix, parsed));
      const place = [parsed?.area, parsed?.city].filter(Boolean).join(', ');
      setSuccessMsg(place ? `Delivery address set: ${place}` : 'Delivery address set automatically');
      setStatus('success');
    },
    [saveAddress],
  );

  const run = useCallback(async () => {
    if (runningRef.current || hasCoords) return;
    runningRef.current = true;
    setStatus('locating');
    try {
      // App-open silent GPS fix (StoreContext) already mila ho to wahi reuse —
      // warna browser ka native permission prompt + ek fresh fix.
      const cached = readGpsCoords();
      const fix = cached?.lat != null && cached?.lng != null ? cached : await getCurrentFix();
      await applyFix(fix);
    } catch (err) {
      const code = err?.code;
      if (code === 1) setNotice(NOTICES.denied);
      else if (code === 2) setNotice(NOTICES.unavailable);
      else if (code === GEO_UNSUPPORTED) setNotice(NOTICES.unsupported);
      else setNotice(NOTICES.error);
      setStatus('notice');
    } finally {
      runningRef.current = false;
    }
  }, [applyFix, hasCoords]);

  // Naya user (no saved address) -> ek baar auto attempt. Dismiss kiya ho to
  // session me dobara auto nahi (pill se manually retry ho sakta hai).
  useEffect(() => {
    if (hasCoords || autoStartedRef.current || dismissed) return;
    autoStartedRef.current = true;
    run();
  }, [hasCoords, dismissed, run]);

  // User browser settings me location ON karke tab par wapas aaye to khud retry
  useEffect(() => {
    if (hasCoords || dismissed) return undefined;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!navigator.permissions?.query) return;
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((p) => {
          if (p.state === 'granted') run();
        })
        .catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [hasCoords, dismissed, run]);

  // Success toast auto-hide
  useEffect(() => {
    if (status !== 'success') return undefined;
    const timer = window.setTimeout(() => setStatus('idle'), 4500);
    return () => window.clearTimeout(timer);
  }, [status]);

  const retry = () => {
    try {
      sessionStorage.removeItem(DISMISS_KEY);
    } catch {
      /* ignore */
    }
    setDismissed(false);
    run();
  };

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  // Address set ho gaya (auto ya manual) — kuch bhi mat dikhao. Exception:
  // success toast abhi dikhna baaki ho sakta hai (save ke baad hasCoords true ho jata hai).
  if (hasCoords && status !== 'success') return null;

  return (
    <>
      {status === 'locating' && (
        <div
          role="status"
          aria-live="polite"
          className="fixed left-1/2 top-4 z-[80] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-white px-4 py-3 shadow-xl"
        >
          <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
          <p className="text-xs font-bold text-slate-700">Locating your delivery address…</p>
        </div>
      )}

      {status === 'success' && successMsg && (
        <div
          role="status"
          aria-live="polite"
          className="fixed left-1/2 top-4 z-[80] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-center shadow-xl"
        >
          <p className="flex items-center justify-center gap-1.5 text-xs font-black text-white">
            <MapPinCheck className="h-4 w-4 shrink-0" />
            {successMsg}
          </p>
          <p className="mt-0.5 text-[11px] font-semibold text-emerald-50">
            You can change it anytime from the header.
          </p>
        </div>
      )}

      {status === 'notice' && !dismissed && (
        <div
          role="alert"
          className="fixed left-1/2 top-4 z-[80] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-xl"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <MapPinOff className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-amber-900">{notice.title}</p>
              <p className="mt-1 text-xs font-semibold leading-relaxed text-amber-800">{notice.body}</p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={retry}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-amber-600 px-4 text-xs font-black text-white transition hover:bg-amber-700 active:scale-95"
                >
                  <Navigation className="h-3.5 w-3.5" />
                  Try Again
                </button>
                <button
                  type="button"
                  onClick={dismiss}
                  className="min-h-[40px] rounded-xl border border-amber-300 bg-white px-4 text-xs font-bold text-amber-800 transition hover:bg-amber-100 active:scale-95"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dismiss ke baad chhota persistent pill — location abhi bhi off hai.
          Reload ke baad bhi (session me dismissed) sirf pill dikhti hai.
          bottom-right rakhi hai taaki FloatingCart (bottom-center) se na takraye. */}
      {dismissed && !hasCoords && (
        <button
          type="button"
          onClick={retry}
          aria-label="Location is off — tap to enable"
          title="Location is off — tap to enable"
          className="fixed bottom-4 right-4 z-[60] inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3.5 text-[11px] font-black text-amber-800 shadow-lg transition hover:bg-amber-100 active:scale-95"
        >
          <MapPinOff className="h-3.5 w-3.5" />
          Location off
        </button>
      )}
    </>
  );
};

export default AutoLocationSetup;
