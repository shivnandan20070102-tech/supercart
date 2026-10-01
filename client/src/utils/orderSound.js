// Reusable order notification sound — single place for ALL order audio logic.
// Both customer checkout (Cart.jsx) and admin panel (AdminDashboard.jsx)
// import from here (no duplication).
//
// CUSTOM USER SOUND:
// - Source of truth (untouched, project root):
//     "E:\supercart real\WhatsApp Audio 2026-09-29 at 10.12.47 PM.aac"
// - That file is raw ADTS AAC, which browsers play unreliably
//   (Firefox has no ADTS support, Chrome/Safari are inconsistent).
// - So the EXACT SAME audio was converted (no new sound generated) to
//   browser-compatible MP3, served from public/:
//     /assets/audio/custom-order-sound.mp3
// - Browser autoplay restrictions are handled gracefully (never throws,
//   never blocks order creation).
// - A small replay-cooldown guards against React StrictMode double-effects
//   and realtime/polling duplicate events.

const ORDER_SOUND_SRC = '/assets/audio/custom-order-sound.mp3';
// Delivery-boy 10-sec siren — user ki di hui file (project root, untouched):
//     "E:\supercart real\deliveryboy.mp3.aac" (raw ADTS AAC, ~10 sec)
// Browsers ADTS reliably nahi bajate, isliye EXACT SAME audio ko
// browser-compatible MP3 me convert karke public/ me rakha hai:
//     /assets/audio/delivery-siren.mp3  (~10 sec — poora acceptance window
//     ek hi play me cover ho jata hai; loop backup ke liye ON hai)
const DELIVERY_SIREN_SRC = '/assets/audio/delivery-siren.mp3';
// Same-order / double-fire guard (StrictMode, realtime resubscribe, polling).
const MIN_REPLAY_GAP_MS = 1500;

let cachedAudio = null;
let lastPlayAt = 0;
let audioUnlocked = false;

function getAudio() {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return null;
  try {
    if (!cachedAudio) {
      cachedAudio = new Audio(ORDER_SOUND_SRC);
      cachedAudio.preload = 'auto';
      cachedAudio.volume = 0.9;
    }
    return cachedAudio;
  } catch {
    return null;
  }
}

/**
 * File ko pehle se load karke rakho taaki success par turant baje (no lag).
 * Component mount par call karo — user gesture ki zaroorat nahi.
 */
export function preloadOrderSound() {
  try {
    const audio = getAudio();
    if (!audio) return;
    try {
      audio.load();
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }
}

/**
 * Browser autoplay policy unlock — CLICK handler ke andar call karna ZAROORI hai.
 * (Order success countdown + API ke baad hota hai, tab tak gesture expire ho
 * chuka hota hai aur Chrome play() block kar deta hai.) Muted warm-up play se
 * browser domain ko "allowed to play sound" mark kar deta hai.
 */
export function unlockOrderAudio() {
  try {
    const audio = getAudio();
    if (!audio || audioUnlocked) return;
    const prevMuted = audio.muted;
    audio.muted = true;
    const restore = () => {
      try {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = prevMuted;
      } catch {
        /* ignore */
      }
      audioUnlocked = true;
    };
    const result = audio.play();
    if (result && typeof result.then === 'function') {
      result.then(restore).catch(() => {
        audioUnlocked = false;
      });
    } else {
      restore();
    }
  } catch {
    /* ignore */
  }
}

/**
 * Play the order notification sound once. Safe to call from anywhere —
 * never throws, never rejects, never delays the caller.
 */
export function playOrderSound() {
  try {
    const now = Date.now();
    if (now - lastPlayAt < MIN_REPLAY_GAP_MS) return;
    lastPlayAt = now;
    const audio = getAudio();
    if (!audio) return;
    try {
      audio.currentTime = 0;
    } catch {
      /* ignore */
    }
    const result = audio.play();
    if (result && typeof result.catch === 'function') {
      // Autoplay blocked ya file missing — console me reason dikhao taaki
      // diagnose ho sake (flow kabhi break nahi hoga).
      result.catch((err) => {
        try {
          console.warn('[orderSound] play failed:', err?.name || err?.message || err);
        } catch {
          /* ignore */
        }
      });
    }
  } catch {
    /* never break order flow because of sound */
  }
}

/**
 * Best-effort request for browser-notification permission (admin panel only).
 * Optional — core order flow never depends on it.
 */
export function ensureOrderNotificationPermission() {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'default') {
      const request = Notification.requestPermission();
      if (request && typeof request.catch === 'function') request.catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

/**
 * Optional browser notification for new admin orders. No-op unless the user
 * already granted permission — never prompts by itself.
 */
export function showNewOrderBrowserNotification(title, body) {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    const note = new Notification(title, body ? { body } : undefined);
    window.setTimeout(() => {
      try {
        note.close();
      } catch {
        /* ignore */
      }
    }, 6000);
  } catch {
    /* ignore */
  }
}

/**
 * Admin helper: sound + (optional) browser notification for a new order.
 * Toast UI is handled by the caller's existing notice state.
 */
export function notifyAdminNewOrder({ orderId, total } = {}) {
  playOrderSound();
  const idPart = orderId != null ? `Order #${String(orderId).slice(-8)}` : 'A new order';
  const totalPart = total != null && total !== '' ? ` · ₹${total}` : '';
  showNewOrderBrowserNotification('New Order Received!', `${idPart} received${totalPart}.`);
}

// ---------------------------------------------------------------------------
// Delivery acceptance-window SIREN (Delivery Panel only).
// ---------------------------------------------------------------------------
// Naya delivery assignment aate hi 10-sec acceptance window ke liye continuous
// alert — user ki di hui DELIVERY file (DELIVERY_SIREN_SRC) bajti hai.
// Customer/admin wala custom order sound (ORDER_SOUND_SRC) ko haath nahi lagta.
//
// Wiring (DeliveryDashboard.jsx — NewOrderPopup):
//   countdown = 10 (mount, alert=true) -> startDeliverySiren(orderId)
//   countdown running               -> loop continues (audio.loop = true)
//   Accept / Reject / Timeout / invalid / unmount -> stopDeliverySiren()
// Boot backlog (panel khulne par pehle se 'assigned') alert=false ke saath
// khulta hai — siren nahi bajta. Sirf genuinely NAYA assignment bajata hai.
//
// Autoplay policy (FULLY AUTOMATIC — koi sound button nahi):
//   - preloadDeliverySiren() panel mount par file ko pehle se load karta hai.
//   - unlockAllOrderAudio() har user gesture (Online toggle, koi bhi tap) par
//     dono sounds warm-up karta hai.
//   - play() block ho to exact error console me log hota hai (silent nahi),
//     siren 'blocked' mark hota hai aur popup ka 1.2s auto-retry + kisi bhi
//     gesture par global listener KHUD resume karta hai (bina tap ke shuru).
// Duplicate-prevention:
//   - sirenOrderKey: same assignment dobara start = no-op (re-render /
//     realtime / polling / remount safe). Nayi assignment purani ko replace
//     karti hai (pehle stop, phir start — kabhi 2 sirens nahi).
//   - stopDeliverySiren() idempotent hai — kahin se bhi safe call.

let sirenAudio = null;
let sirenOrderKey = null;
let sirenBlocked = false;
let sirenUnlockListeners = null;
let sirenPlaySeq = 0;

function sirenLogInfo(message) {
  try {
    console.info(`[deliverySiren] ${message}`);
  } catch {
    /* ignore */
  }
}

function sirenLogWarn(message, err) {
  try {
    if (err !== undefined) {
      const detail = err?.name || err?.message ? `${err.name || ''} ${err.message || ''}`.trim() : err;
      console.warn(`[deliverySiren] ${message}`, detail);
    } else {
      console.warn(`[deliverySiren] ${message}`);
    }
  } catch {
    /* ignore */
  }
}

function sirenLogError(message, detail) {
  try {
    if (detail !== undefined) console.error(`[deliverySiren] ${message}`, detail);
    else console.error(`[deliverySiren] ${message}`);
  } catch {
    /* ignore */
  }
}

function getSirenAudio() {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return null;
  try {
    if (!sirenAudio) {
      sirenAudio = new Audio(DELIVERY_SIREN_SRC);
      sirenAudio.preload = 'auto';
      sirenAudio.loop = true;
      sirenAudio.volume = 1.0;
      sirenAudio.addEventListener('error', () => {
        try {
          const code = sirenAudio?.error?.code;
          const msg = sirenAudio?.error?.message;
          sirenLogError(`audio file failed to load: ${DELIVERY_SIREN_SRC}`, `code=${code} message=${msg || 'unknown'}`);
        } catch {
          /* ignore */
        }
      });
    }
    return sirenAudio;
  } catch {
    return null;
  }
}

function installSirenUnlock() {
  try {
    if (typeof window === 'undefined' || sirenUnlockListeners) return;
    const handler = () => {
      resumeDeliverySiren();
    };
    sirenUnlockListeners = { handler };
    window.addEventListener('pointerdown', handler);
    window.addEventListener('touchend', handler);
    window.addEventListener('keydown', handler);
  } catch {
    /* ignore */
  }
}

let sirenWarmedUp = false;

function removeSirenUnlock() {
  try {
    if (typeof window === 'undefined' || !sirenUnlockListeners) return;
    const { handler } = sirenUnlockListeners;
    sirenUnlockListeners = null;
    window.removeEventListener('pointerdown', handler);
    window.removeEventListener('touchend', handler);
    window.removeEventListener('keydown', handler);
  } catch {
    /* ignore */
  }
}

/**
 * Siren autoplay unlock — CLICK/TAP handler ke andar call karna ZAROORI hai.
 * Problem: unlockOrderAudio() sirf customer-sound element ko warm-up karta tha,
 * SIREN element (`sirenAudio`) kabhi gesture ke andar play nahi hua tha —
 * isliye mobile Chrome me realtime order aane par pehla play() NotAllowedError
 * se block ho jata tha aur popup silent khulta tha.
 * Ye function siren element ka muted warm-up play karta hai taaki browser is
 * domain ko "allowed to play sound" mark kar de. Online toggle (wo tap jo
 * delivery boy almost hamesha karta hai) aur Test-siren button isko gesture
 * ke andar call karte hain.
 */
export function unlockDeliverySiren() {
  try {
    const audio = getSirenAudio();
    if (!audio || sirenWarmedUp) return;
    // Live siren baj raha ho to use haath mat lagao — warm-up sirf idle me.
    if (sirenOrderKey && !audio.paused) {
      sirenWarmedUp = true;
      return;
    }
    const prevMuted = audio.muted;
    const prevVolume = audio.volume;
    audio.muted = true;
    const restore = () => {
      try {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = prevMuted;
        audio.volume = prevVolume;
      } catch {
        /* ignore */
      }
      sirenWarmedUp = true;
      sirenLogInfo('siren gesture warm-up done — next order will ring');
    };
    const result = audio.play();
    if (result && typeof result.then === 'function') {
      result.then(restore).catch((err) => {
        sirenWarmedUp = false;
        sirenLogWarn('siren warm-up blocked (gesture ke bahar call hua?)', err);
      });
    } else {
      restore();
    }
  } catch {
    /* ignore */
  }
}

/**
 * Dono sounds ek saath unlock — Online toggle jaise guaranteed gesture me
 * call karo. Pehle se warmed-up ho to no-op (sasta hai).
 */
export function unlockAllOrderAudio() {
  try {
    unlockOrderAudio();
  } catch {
    /* ignore */
  }
  try {
    unlockDeliverySiren();
  } catch {
    /* ignore */
  }
}

/**
 * Siren file ka in-browser health check — "file not found" vs OK ka jawab
 * UI me dikhane ke liye (browser console kholne ki zaroorat nahi).
 * @returns {Promise<{ok:boolean,status:number|null,url:string}>}
 */
export async function checkDeliverySirenFile() {
  const url = DELIVERY_SIREN_SRC;
  try {
    const res = await fetch(url, { method: 'GET' });
    try {
      if (res.body && typeof res.body.cancel === 'function') await res.body.cancel();
    } catch {
      /* ignore — status hi chahiye tha */
    }
    return { ok: res.ok, status: res.status, url };
  } catch (err) {
    return { ok: false, status: null, url, error: err?.message || String(err) };
  }
}

/**
 * File ko pehle se load karke rakho taaki naye assignment par turant baje.
 * Delivery panel mount par call karo — user gesture ki zaroorat nahi.
 */
export function preloadDeliverySiren() {
  try {
    const audio = getSirenAudio();
    if (!audio) return;
    try {
      audio.load();
    } catch {
      /* ignore */
    }
    sirenLogInfo(`preloaded ${DELIVERY_SIREN_SRC}`);
  } catch {
    /* ignore */
  }
}

/**
 * Siren audible hai ya autoplay-blocked — popup hint ke liye.
 * @returns 'playing' | 'blocked' | 'stopped' | 'unsupported'
 */
export function getDeliverySirenState() {
  try {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return 'unsupported';
    if (!sirenOrderKey || !sirenAudio) return 'stopped';
    if (!sirenAudio.paused) return 'playing';
    return sirenBlocked ? 'blocked' : 'stopped';
  } catch {
    return 'stopped';
  }
}

/**
 * Blocked siren ko user gesture (tap/click) se resume karo.
 * Click handler ke andar call karo — gesture me play() allow hota hai.
 * @returns 'playing' | 'blocked' | 'stopped'
 */
export function resumeDeliverySiren() {
  try {
    const audio = getSirenAudio();
    if (!sirenOrderKey || !audio) return 'stopped';
    if (!audio.paused) {
      sirenBlocked = false;
      return 'playing';
    }
    const seq = ++sirenPlaySeq;
    let result = null;
    try {
      result = audio.play();
    } catch (err) {
      sirenBlocked = true;
      sirenLogWarn('play() threw — waiting for user gesture.', err);
      installSirenUnlock();
      return 'blocked';
    }
    if (result && typeof result.then === 'function') {
      result.then(() => {
        if (seq !== sirenPlaySeq || !sirenOrderKey) return;
        sirenBlocked = false;
        removeSirenUnlock();
        sirenLogInfo(`resumed (state: playing) for order ${sirenOrderKey}`);
      }).catch((err) => {
        if (seq !== sirenPlaySeq || !sirenOrderKey) return;
        sirenBlocked = true;
        sirenLogWarn('play() blocked by browser autoplay policy — auto-retry chal raha hai, policy allow hote hi khud bajega.', err);
        installSirenUnlock();
      });
      return audio.paused ? 'blocked' : 'playing';
    }
    sirenBlocked = false;
    return 'playing';
  } catch (err) {
    sirenLogWarn('resumeDeliverySiren threw:', err);
    return 'blocked';
  }
}

/**
 * Start the continuous alert siren for a delivery assignment.
 * SAME existing custom sound file ko loop me bajata hai.
 * Same orderId dobara aaye to no-op (multiple sirens impossible).
 */
export function startDeliverySiren(orderId) {
  try {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return;
    const key = String(orderId ?? 'alert');
    // Same assignment: ek hi siren. Already playing -> no-op.
    // Blocked-but-same-key -> retry (still single instance, no double audio).
    if (sirenOrderKey === key && sirenAudio) {
      if (!sirenAudio.paused) return;
      if (sirenBlocked) {
        resumeDeliverySiren();
        return;
      }
    }
    // Nayi assignment purani ko replace karti hai — pehle turant stop.
    stopDeliverySiren();
    const audio = getSirenAudio();
    if (!audio) {
      sirenLogError('Audio unsupported — siren cannot start.');
      return;
    }
    sirenOrderKey = key;
    sirenBlocked = false;
    try {
      audio.loop = true;
      audio.volume = 1.0;
      audio.muted = false;
      try {
        audio.currentTime = 0;
      } catch {
        /* ignore */
      }
    } catch {
      /* ignore */
    }
    const seq = ++sirenPlaySeq;
    let result = null;
    try {
      result = audio.play();
    } catch (err) {
      sirenBlocked = true;
      sirenLogWarn('play() threw on start — waiting for user gesture.', err);
      installSirenUnlock();
      return;
    }
    if (result && typeof result.then === 'function') {
      result.then(() => {
        if (seq !== sirenPlaySeq || sirenOrderKey !== key) return;
        sirenBlocked = false;
        sirenLogInfo(`playing (loop) for order ${key} — file: ${DELIVERY_SIREN_SRC}`);
      }).catch((err) => {
        if (seq !== sirenPlaySeq || sirenOrderKey !== key) return;
        sirenBlocked = true;
        // EXACT browser error log — silent fail nahi. Auto-retry + kisi bhi
        // gesture par global listener khud resume karega (koi button nahi).
        sirenLogWarn(`play() blocked by browser autoplay policy for order ${key}. Auto-retry ON — policy allow hote hi khud bajega.`, err);
        installSirenUnlock();
      });
    } else {
      sirenLogInfo(`playing (loop) for order ${key} — file: ${DELIVERY_SIREN_SRC}`);
    }
  } catch {
    /* never break delivery flow because of sound */
  }
}

/** Stop the siren immediately. Idempotent — safe to call anywhere. */
export function stopDeliverySiren() {
  try {
    sirenPlaySeq += 1;
    removeSirenUnlock();
    if (sirenAudio) {
      try {
        sirenAudio.pause();
      } catch {
        /* ignore */
      }
      try {
        sirenAudio.currentTime = 0;
      } catch {
        /* ignore */
      }
    }
    sirenOrderKey = null;
    sirenBlocked = false;
  } catch {
    /* ignore */
  }
}
