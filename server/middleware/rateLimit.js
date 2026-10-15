// Rate limiting — brute-force + spam protection (express-rate-limit, in-memory).
//
// Har limiter 429 par SAME shape deta hai taaki frontend friendly Hindi
// message dikha sake (generic "Error" nahi):
//   { success:false, message:"<Hindi friendly>", code:"RATE_LIMITED",
//     retryAfterSeconds:<n>, limit:<max>, window:"<human>" }
//
// - IP-based limiters (login/signup/forgot/general): key = client IP
//   (Render proxy ke peeche sahi IP ke liye server.js me `trust proxy` set hai,
//   aur IPv6-safe ipKeyGenerator use hota hai).
// - User-based limiters (order/complaint): login user ki id (Authorization
//   token se `protect` ke baad), warna IP fallback (guest/bot case).
// - Admin/Store-Manager APIs: trusted users -> loose limit (normal kaam na ruke).

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// ---- shared 429 responder ----
const rateLimitHandler = (friendlyMessage, windowLabel) => (req, res /* , next, options */) => {
  // express-rate-limit standard headers (RateLimit-Reset) se exact wait nikalo.
  // Na mile to window default (frontend "kuch der baad" dikhayega).
  let retryAfterSeconds = 0;
  try {
    const reset = Number(res.getHeader('RateLimit-Reset'));
    if (Number.isFinite(reset) && reset > 0) {
      retryAfterSeconds = Math.min(reset, 24 * 3600);
    }
  } catch { /* ignore */ }

  const retryBits =
    retryAfterSeconds > 0
      ? retryAfterSeconds >= 60
        ? ` (${Math.ceil(retryAfterSeconds / 60)} minute baad try karein)`
        : ` (${retryAfterSeconds} second baad try karein)`
      : '';

  // Retry-After header: browsers/devtools + automated clients ke liye standard.
  if (retryAfterSeconds > 0) res.setHeader('Retry-After', String(retryAfterSeconds));

  return res.status(429).json({
    success: false,
    message: `${friendlyMessage}${retryBits}`,
    code: 'RATE_LIMITED',
    retryAfterSeconds,
    window: windowLabel,
  });
};

const makeLimiter = ({ windowMs, max, message, windowLabel, keyGenerator, skip }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true, // RateLimit-* headers bhejo (Reset se retry time nikalte hain)
    legacyHeaders: false,
    handler: rateLimitHandler(message, windowLabel),
    ...(keyGenerator ? { keyGenerator } : {}),
    ...(skip ? { skip } : {}),
  });

// IP key — IPv6 subnet-safe helper (express-rate-limit ka official helper).
const ipKey = (req) => ipKeyGenerator(req.ip);

// User key — pehle logged-in user id, warna IP (guest/bot spam bhi ruke).
// `protect` middleware limiter se PEHLE chalta hai taaki req.user mile;
// token na ho to IP fallback (kabhi crash nahi).
const userOrIpKey = (req) => {
  const uid = req?.user?.id;
  if (uid && String(uid).trim() !== '') return `user:${String(uid).trim()}`;
  return `ip:${ipKey(req)}`;
};

// Login API: 5 attempts / 15 min / IP — 6th par Hindi block message.
export const loginLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  windowLabel: '15 minutes',
  keyGenerator: ipKey,
  message: 'Too many login attempts, 15 minute baad try karein',
});

// Signup API: 3 attempts / hour / IP (fake-account spam roko).
export const signupLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  max: 3,
  windowLabel: '1 hour',
  keyGenerator: ipKey,
  message: 'Bahut zyada signup attempts ho gaye, 1 ghante baad try karein',
});

// Forgot Password API: 3 attempts / hour / IP (email-bombing roko).
export const forgotPasswordLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  max: 3,
  windowLabel: '1 hour',
  keyGenerator: ipKey,
  message: 'Bahut zyada password-reset attempts ho gaye, 1 ghante baad try karein',
});

// Order Placing API: 10 orders / hour / User (bot spam roko, genuine user safe).
// Guest (bina login) ho to IP se gin — taaki anonymous bot bhi na bhar sake.
export const orderLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  windowLabel: '1 hour',
  keyGenerator: userOrIpKey,
  message: 'Bahut zyada orders ho gaye, 1 ghante baad try karein',
});

// Complaint Submit API: 5 complaints / hour / User (spam roko).
export const complaintLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  windowLabel: '1 hour',
  keyGenerator: userOrIpKey,
  message: 'Bahut zyada complaints ho gayi, 1 ghante baad try karein',
});

// General APIs (products fetch etc.): 100 requests / minute / IP — loose,
// taaki normal browsing/search/scroll kabhi affect na ho.
export const generalLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 100,
  windowLabel: '1 minute',
  keyGenerator: ipKey,
  message: 'Bahut zyada requests ho gayi, kuch der baad try karein',
});

// Admin / Store-Manager APIs: trusted users -> loose limit.
// General (100/min) se ~3x loose (300/min) taaki bulk admin kaam (order list,
// assign, pack, complaints review) me dikkat na ho. Sirf flood/abuse rukega.
export const adminLooseLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 300,
  windowLabel: '1 minute',
  keyGenerator: ipKey,
  message: 'Bahut zyada requests ho gayi, kuch der baad try karein',
});

export default {
  loginLimiter,
  signupLimiter,
  forgotPasswordLimiter,
  orderLimiter,
  complaintLimiter,
  generalLimiter,
  adminLooseLimiter,
};
