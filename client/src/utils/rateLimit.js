// Rate-limit helpers — backend 429 (express-rate-limit) + Supabase 429 +
// client-side login/signup brute-force guard, sab ek hi friendly Hindi me.
//
// Backend 429 shape: { success:false, message:"<Hindi + retry>", code:"RATE_LIMITED",
//   retryAfterSeconds:<n> }. Ye helpers kabhi generic "Error" nahi dikhate —
// hamesha "Bahut zyada attempts ho gaye, kuch der baad try karein" jaisa
// clear message dete hain.

// ---- 429 detection ----
export const isRateLimitPayload = (json) =>
  Boolean(json) && (json.code === 'RATE_LIMITED' || json.error === 'RATE_LIMITED');

export const isRateLimitMessage = (msg) =>
  /too many|rate limit|bahut zyada|15 minute|ghante baad|kuch der baad|429/i.test(String(msg || ''));

// Backend/Supabase ka raw message -> friendly Hindi (retry time ke saath).
export const toFriendlyRateLimitMessage = (rawMessage, retryAfterSeconds = 0, fallback) => {
  const fallbackMsg = fallback || 'Bahut zyada attempts ho gaye, kuch der baad try karein';
  const base = String(rawMessage || '').trim() || fallbackMsg;
  // Backend message pehle se Hindi + retry time ke saath aata hai — as-is.
  if (isRateLimitMessage(base)) return base;
  if (retryAfterSeconds > 0) {
    if (retryAfterSeconds >= 60) {
      return `${fallbackMsg} (${Math.ceil(retryAfterSeconds / 60)} minute baad try karein)`;
    }
    return `${fallbackMsg} (${retryAfterSeconds} second baad try karein)`;
  }
  return base;
};

// fetch Response + parsed JSON se rate-limit info nikalo.
export const parseRateLimitResponse = async (res) => {
  let json = null;
  try {
    json = await res.clone().json();
  } catch {
    try {
      json = await res.json();
    } catch {
      json = null;
    }
  }
  const retryAfterSeconds =
    Number(json?.retryAfterSeconds) ||
    Number(res.headers?.get?.('Retry-After')) ||
    0;
  const message = toFriendlyRateLimitMessage(json?.message, retryAfterSeconds);
  return { json, retryAfterSeconds, message };
};

// Supabase Auth ke khud ke throttling messages (server-side) -> friendly Hindi.
export const toFriendlySupabaseAuthError = (error) => {
  const raw = String(error?.message || '');
  if (/email rate limit exceeded|too many requests|over_email_send_rate_limit|over_sms_send_rate_limit/i.test(raw)) {
    return 'Bahut zyada attempts ho gaye, kuch der baad try karein';
  }
  if (/rate.?limit/i.test(raw)) {
    return toFriendlyRateLimitMessage(raw);
  }
  return raw;
};

// ---- Client-side brute-force guard (Login Page mirror: 5 / 15 min) ----
// Backend limiter direct-API hits rokta hai; Supabase-direct login (client)
// ke liye ye local guard 6th attempt par WAHI Hindi block dikhata hai —
// isliye Login Page par 5 galat passwords ke baad 6th Block hota hai,
// chahe backend tak request jaye ya na jaye.
const LOGIN_MAX = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const SIGNUP_MAX = 3;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;

const LOGIN_BLOCK_MESSAGE = 'Too many login attempts, 15 minute baad try karein';
const SIGNUP_BLOCK_MESSAGE = 'Bahut zyada signup attempts ho gaye, 1 ghante baad try karein';

const storageKey = (kind, email) =>
  `supercart_rl_${kind}_${String(email || '').trim().toLowerCase() || 'unknown'}`;

const readAttempts = (key) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(Number).filter((t) => Number.isFinite(t)) : [];
  } catch {
    return [];
  }
};

const prune = (stamps, windowMs) => {
  const cutoff = Date.now() - windowMs;
  return stamps.filter((t) => t > cutoff);
};

const minutesLeft = (stamps) => {
  if (!stamps.length) return 0;
  const oldest = Math.min(...stamps);
  const waitMs = oldest + LOGIN_WINDOW_MS - Date.now();
  return waitMs > 0 ? Math.ceil(waitMs / 60000) : 0;
};

// Blocked hai? { blocked, message, retryAfterMinutes }
export const getLoginBlockState = (email) => {
  try {
    const key = storageKey('login', email);
    const stamps = prune(readAttempts(key), LOGIN_WINDOW_MS);
    if (stamps.length >= LOGIN_MAX) {
      const mins = Math.max(
        1,
        Math.ceil((Math.min(...stamps) + LOGIN_WINDOW_MS - Date.now()) / 60000),
      );
      return {
        blocked: true,
        // mins=15 par exact spec message; baad me bachi time ke hisaab se.
        message: `Too many login attempts, ${mins} minute baad try karein`,
        retryAfterMinutes: mins,
        retryAfterSeconds: mins * 60,
      };
    }
    return { blocked: false };
  } catch {
    return { blocked: false };
  }
};

// Galat-password attempt record karo. 5th fail ke BAAD 6th blocked milega.
// Returns block-state (agla attempt blocked hai ya nahi).
export const recordFailedLoginAttempt = (email) => {
  try {
    const key = storageKey('login', email);
    const stamps = prune(readAttempts(key), LOGIN_WINDOW_MS);
    stamps.push(Date.now());
    try {
      localStorage.setItem(key, JSON.stringify(stamps.slice(-LOGIN_MAX)));
    } catch { /* ignore */ }
    return getLoginBlockState(email);
  } catch {
    return { blocked: false };
  }
};

export const clearLoginAttempts = (email) => {
  try {
    localStorage.removeItem(storageKey('login', email));
  } catch { /* ignore */ }
};

// Signup mirror (3/hour) — backend limiter ka client reflection.
export const getSignupBlockState = (email) => {
  try {
    const key = storageKey('signup', email);
    const cutoff = Date.now() - SIGNUP_WINDOW_MS;
    const stamps = readAttempts(key).filter((t) => t > cutoff);
    if (stamps.length >= SIGNUP_MAX) {
      return { blocked: true, message: SIGNUP_BLOCK_MESSAGE };
    }
    return { blocked: false };
  } catch {
    return { blocked: false };
  }
};

export const recordFailedSignupAttempt = (email) => {
  try {
    const key = storageKey('signup', email);
    const cutoff = Date.now() - SIGNUP_WINDOW_MS;
    const stamps = readAttempts(key).filter((t) => t > cutoff);
    stamps.push(Date.now());
    try {
      localStorage.setItem(key, JSON.stringify(stamps.slice(-SIGNUP_MAX)));
    } catch { /* ignore */ }
  } catch { /* ignore */ }
};

export const clearSignupAttempts = (email) => {
  try {
    localStorage.removeItem(storageKey('signup', email));
  } catch { /* ignore */ }
};

export { LOGIN_BLOCK_MESSAGE, SIGNUP_BLOCK_MESSAGE, minutesLeft as loginMinutesLeft };
export default {
  isRateLimitPayload,
  isRateLimitMessage,
  toFriendlyRateLimitMessage,
  parseRateLimitResponse,
  toFriendlySupabaseAuthError,
  getLoginBlockState,
  recordFailedLoginAttempt,
  clearLoginAttempts,
  getSignupBlockState,
  recordFailedSignupAttempt,
  clearSignupAttempts,
};
