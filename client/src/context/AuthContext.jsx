import React, { createContext, useCallback, useContext, useRef, useState, useEffect } from 'react';
import { supabase } from '../config/supabase';
import {
  clearLoginAttempts,
  clearSignupAttempts,
  getLoginBlockState,
  getSignupBlockState,
  recordFailedLoginAttempt,
  recordFailedSignupAttempt,
  toFriendlySupabaseAuthError,
} from '../utils/rateLimit';

const AuthContext = createContext();

const AUTH_NOTICE_KEY = 'supercart_auth_notice';
const AUTH_NOTICE_MAX_AGE_MS = 5 * 60 * 1000;

const readStoredNotice = () => {
  try {
    const raw = sessionStorage.getItem(AUTH_NOTICE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.message) return null;
    if (parsed.at && Date.now() - Number(parsed.at) > AUTH_NOTICE_MAX_AGE_MS) {
      try { sessionStorage.removeItem(AUTH_NOTICE_KEY); } catch { /* ignore */ }
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    try {
      const savedUser = localStorage.getItem('supercart_user');
      return savedUser ? JSON.parse(savedUser) : null;
    } catch {
      return null;
    }
  });

  const [loading, setLoading] = useState(true);
  const [authNotice, setAuthNotice] = useState(readStoredNotice);
  const inflightProfileRef = useRef(new Set());

  const clearAuthNotice = useCallback(() => {
    setAuthNotice(null);
    try { sessionStorage.removeItem(AUTH_NOTICE_KEY); } catch { /* ignore */ }
  }, []);

  const showAuthNotice = useCallback((notice) => {
    if (!notice?.message) return;
    const stamped = { ...notice, at: Date.now() };
    setAuthNotice(stamped);
    try { sessionStorage.setItem(AUTH_NOTICE_KEY, JSON.stringify(stamped)); } catch { /* ignore */ }
  }, []);

  // OAuth return URL se `error` params hatana (stale error dobara na dikhe).
  // `code` param ko haath mat lagao — uska exchange supabase-js karta hai.
  const clearOAuthReturnParams = useCallback(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (!params.has('error') && !params.has('error_description')) return;
      params.delete('error');
      params.delete('error_description');
      const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`;
      window.history.replaceState(null, '', next);
    } catch { /* ignore */ }
  }, []);

  // Google redirect ke baad session na bane to asal wajah Home banner par
  // dikhao (Supabase `?error=` bhejta hai; `?code=` + no session = exchange fail).
  // Sirf error.message jaisi safe strings — tokens/secrets kabhi nahi.
  // `exchangeError` = getSession() ka PKCE exchange error (jaise live par
  // "Unable to exchange external code" jab Redirect URL / Google Console
  // whitelist missing hoti hai). Fail hone par stale `code` bhi URL se hatate
  // hain taaki reload par same code dobara exchange na ho (repeat error loop).
  const surfaceOAuthReturnError = useCallback((exchangeError = '') => {
    try {
      const params = new URLSearchParams(window.location.search);
      const err = params.get('error');
      const desc = params.get('error_description');
      const code = params.get('code');
      if (!err && !code && !exchangeError) return;
      if (err) {
        const reason = (desc || err).trim().slice(0, 300);
        showAuthNotice({
          type: 'error',
          message: `Google login complete nahi hua: ${reason}. Dobara try karo.`,
        });
      } else if (exchangeError) {
        const reason = String(exchangeError).trim().slice(0, 300);
        showAuthNotice({
          type: 'error',
          message:
            `Google login complete nahi hua: ${reason}. ` +
            'Supabase Dashboard me Redirect URLs aur Google Console me callback URL check karo (neeche steps).',
        });
      } else {
        showAuthNotice({
          type: 'error',
          message:
            'Google login complete nahi ho paya (session nahi bana). Dobara try karo; phir bhi fail ho to Supabase dashboard mein Google provider aur Redirect URLs check karo.',
        });
      }
      params.delete('error');
      params.delete('error_description');
      params.delete('code');
      const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`;
      window.history.replaceState(null, '', next);
    } catch { /* ignore */ }
  }, [showAuthNotice]);

  // Idempotent OAuth profile ensure (Google signup/login fix).
  // - Existing profile (same Auth id) milti hai to use AS-IS karo — role,
  //   address/location, phone, orders/cart data kabhi overwrite/delete nahi.
  // - Koi row nahi aur email kisi aur Auth id se judi hai to auto-merge/link
  //   MAT karo — sirf linkConflict signal do taaki caller clear message dikhaye.
  // - Sirf jab bilkul nayi id + unused email ho tab minimal row INSERT karo.
  // - Secrets/tokens kabhi log mat karo — sirf error.message.
  const ensureOAuthProfile = useCallback(async (authUser) => {
    const fallbackName =
      authUser.user_metadata?.full_name ||
      authUser.user_metadata?.name ||
      authUser.email?.split('@')[0] ||
      'Google User';
    try {
      const { data: existing, error: readError } = await supabase
        .from('users')
        .select('id,name,email,phone,location,role')
        .eq('id', authUser.id)
        .maybeSingle();
      if (readError) console.error('OAuth profile read failed:', readError.message);
      if (existing) return { profile: existing, isNew: false };

      if (authUser.email) {
        const { data: byEmail, error: emailError } = await supabase
          .from('users')
          .select('id,email')
          .eq('email', authUser.email)
          .maybeSingle();
        if (emailError) console.error('OAuth email check failed:', emailError.message);
        if (byEmail && byEmail.id !== authUser.id) {
          return { profile: null, isNew: false, linkConflict: true };
        }
      }

      const { error: insertError } = await supabase.from('users').insert({
        id: authUser.id,
        name: fallbackName,
        email: authUser.email,
        phone: authUser.user_metadata?.phone || '',
        role: 'customer',
      });
      if (insertError) {
        // Race (parallel SIGNED_IN + INITIAL_SESSION) ya email-unique race:
        // dobara read karo — existing ko overwrite kabhi mat karo.
        const { data: raced } = await supabase
          .from('users')
          .select('id,name,email,phone,location,role')
          .eq('id', authUser.id)
          .maybeSingle();
        if (raced) return { profile: raced, isNew: false };
        console.error('OAuth profile create failed:', insertError.message);
        return { profile: null, isNew: true, insertFailed: true };
      }
      const { data: created } = await supabase
        .from('users')
        .select('id,name,email,phone,location,role')
        .eq('id', authUser.id)
        .maybeSingle();
      return { profile: created, isNew: true };
    } catch (err) {
      console.error('OAuth profile ensure failed:', err?.message || 'unknown error');
      return { profile: null, isNew: false, transient: true };
    }
  }, []);

  const persistOAuthSession = useCallback(async (session, { announce = false } = {}) => {
    const authUser = session?.user;
    if (!authUser) return;
    // Concurrent duplicate session events (getSession + INITIAL_SESSION +
    // SIGNED_IN) par double-INSERT race rokho — pehli call jeetegi.
    if (inflightProfileRef.current.has(authUser.id)) return;
    inflightProfileRef.current.add(authUser.id);
    try {
      const fallbackName =
        authUser.user_metadata?.full_name ||
        authUser.user_metadata?.name ||
        authUser.email?.split('@')[0] ||
        'Google User';
      const avatar =
        authUser.user_metadata?.avatar_url || authUser.user_metadata?.picture || '';

      const ensured = await ensureOAuthProfile(authUser);

      if (ensured.linkConflict) {
        const conflictUser = {
          id: authUser.id,
          name: fallbackName,
          email: authUser.email,
          phone: '',
          location: '',
          avatar,
          provider: 'google',
          token: session.access_token,
          linkConflict: true,
        };
        setUser(conflictUser);
        localStorage.setItem('supercart_user', JSON.stringify(conflictUser));
        localStorage.setItem('supercart_token', session.access_token);
        if (announce) {
          showAuthNotice({
            type: 'error',
            message:
              'This email is already registered with email/password. Please log in with your password instead — accounts were not merged.',
          });
        }
        return;
      }

      const profile = ensured.profile;
      const googleUser = {
        id: authUser.id,
        // DB profile values win (preserve role/phone/location); metadata sirf fallback.
        name: profile?.name || fallbackName,
        email: profile?.email || authUser.email,
        phone: profile?.phone || '',
        location: profile?.location || '',
        avatar,
        provider: 'google',
        role: profile?.role || 'customer',
        token: session.access_token,
      };
      setUser(googleUser);
      localStorage.setItem('supercart_user', JSON.stringify(googleUser));
      localStorage.setItem('supercart_token', session.access_token);
      if (announce) {
        if (ensured.insertFailed || ensured.transient) {
          showAuthNotice({ type: 'success', message: `Welcome, ${googleUser.name}! You are logged in with Google.` });
        } else if (ensured.isNew) {
          showAuthNotice({ type: 'success', message: `Welcome, ${googleUser.name}! Your Google account was created.` });
        } else {
          showAuthNotice({ type: 'success', message: 'Welcome Back!' });
        }
      }
    } finally {
      inflightProfileRef.current.delete(authUser.id);
    }
  }, [ensureOAuthProfile, showAuthNotice]);

  useEffect(() => {
    let mounted = true;
    // 1. Check active session on initial load
    // getSession() initializePromise (PKCE code exchange) ka wait karta hai,
    // isliye redirect ke turant baad bhi sahi session milta hai.
    const checkSession = async () => {
      try {
        // getSession() PKCE `?code=` exchange karta hai. Live par fail ho
        // ("Unable to exchange external code") to error yahin milta hai —
        // ise banner me dikhao taaki user ko pata chale, silent fail nahi.
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (mounted && session?.user) {
          // Initial load / reload: silently restore (no "Welcome Back!" banner).
          await persistOAuthSession(session, { announce: false });
          clearOAuthReturnParams();
        } else if (mounted) {
          // Google redirect ke baad session nahi bana to chup mat raho —
          // warna user ko "account create hi nahi hua" lagta hai jabki asal
          // wajah URL mein `?error=` / fail hua `?code=` exchange hota hai.
          surfaceOAuthReturnError(sessionError?.message || '');
        }
      } catch (err) {
        console.error('Error fetching Supabase session:', err?.message || err);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    checkSession();

    // 2. Listen to auth state changes (e.g. Google OAuth redirect callback)
    // INITIAL_SESSION: reload par existing session; SIGNED_IN: fresh OAuth;
    // TOKEN_REFRESHED: silent refresh.
    // Sirf fresh SIGNED_IN par "Welcome Back!" announce karo — reload/refresh silent.
    // Sirf SIGNED_IN sun-ne se reload/PKCE-timing cases me user null reh jata tha.
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return;
        if (session?.user && event !== 'PASSWORD_RECOVERY' && event !== 'SIGNED_OUT') {
          persistOAuthSession(session, { announce: event === 'SIGNED_IN' });
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          localStorage.removeItem('supercart_user');
          localStorage.removeItem('supercart_token');
          clearAuthNotice();
        }
        setLoading(false);
      }
    );

    return () => {
      mounted = false;
      authListener?.subscription?.unsubscribe();
    };
  }, [persistOAuthSession, clearAuthNotice, clearOAuthReturnParams, surfaceOAuthReturnError]);

  useEffect(() => {
    if (!user?.id) return undefined;

    const channel = supabase
      .channel(`profile-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users', filter: `id=eq.${user.id}` }, (payload) => {
        if (payload.eventType === 'DELETE') return;
        const profile = payload.new || {};
        setUser((current) => {
          if (!current) return current;
          const updated = {
            ...current,
            name: profile.name ?? current.name,
            email: profile.email ?? current.email,
            phone: profile.phone ?? current.phone,
            location: profile.location ?? current.location,
          };
          localStorage.setItem('supercart_user', JSON.stringify(updated));
          return updated;
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  const login = (userData, token) => {
    const activeUser = { ...userData, token };
    setUser(activeUser);
    localStorage.setItem('supercart_user', JSON.stringify(activeUser));
    if (token) localStorage.setItem('supercart_token', token);
  };

  const updateProfile = async (profileData) => {
    if (!user) return { success: false, message: 'Please login first.' };

    const { data, error } = await supabase.auth.updateUser({
      email: profileData.email,
      data: {
        full_name: profileData.name,
        phone: profileData.phone,
        location: profileData.location,
      },
    });

    if (error) return { success: false, message: error.message };

    const { error: profileError } = await supabase
      .from('users')
      .upsert({
        id: user.id,
        name: profileData.name,
        email: data.user?.email || profileData.email,
        phone: profileData.phone || '',
        location: profileData.location || '',
      }, { onConflict: 'id' });
    if (profileError) return { success: false, message: profileError.message };

    const updatedUser = {
      ...user,
      ...profileData,
      email: data.user?.email || profileData.email,
    };
    setUser(updatedUser);
    localStorage.setItem('supercart_user', JSON.stringify(updatedUser));
    return { success: true, user: updatedUser };
  };

  const saveSupabaseUser = (authUser, provider = 'email') => {
    const activeUser = {
      id: authUser.id,
      name: authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || 'Customer',
      email: authUser.email,
      phone: authUser.user_metadata?.phone || '',
      location: authUser.user_metadata?.location || '',
      avatar: authUser.user_metadata?.avatar_url || '',
      provider,
    };
    setUser(activeUser);
    localStorage.setItem('supercart_user', JSON.stringify(activeUser));
    return activeUser;
  };

  // Email login — brute-force guard:
  // 1) Pehle client-side block check (5 galat / 15 min -> 6th par Hindi block,
  //    backend loginLimiter ka mirror — Login Page test isi se pass hota hai).
  // 2) Supabase ka apna throttling (429 / "Email rate limit exceeded") bhi
  //    friendly Hindi me map hota hai (generic "Error" kabhi nahi).
  // Backend /api/auth/login limiter direct-API bots ko rokta hai; session
  // yahin Supabase se banta hai taaki complaints/orders fallback na toote.
  const signInWithEmail = async (email, password, expectedRole = '') => {
    const cleanEmail = String(email || '').trim();
    const preBlocked = getLoginBlockState(cleanEmail);
    if (preBlocked.blocked) {
      return { success: false, message: preBlocked.message, isRateLimited: true, retryAfterSeconds: preBlocked.retryAfterSeconds || 0 };
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
    if (error) {
      const friendly = toFriendlySupabaseAuthError(error);
      const isSupabaseRateLimited = friendly !== String(error.message || '');
      const after = recordFailedLoginAttempt(cleanEmail);
      // 5 fail ke baad agla attempt blocked — abhi se block message dikhao
      // taaki user ko exact wait pata chale (backend 6th-429 jaisa).
      if (after.blocked) {
        return { success: false, message: after.message, isRateLimited: true, retryAfterSeconds: after.retryAfterSeconds || 0 };
      }
      if (isSupabaseRateLimited) {
        return { success: false, message: friendly, isRateLimited: true };
      }
      return { success: false, message: error.message };
    }

    clearLoginAttempts(cleanEmail);
    if (expectedRole) {
      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('role')
        .eq('id', data.user.id)
        .maybeSingle();
      const actualRole = String(profile?.role || '').trim().toLowerCase();
      if (profileError || actualRole !== expectedRole) {
        await supabase.auth.signOut();
        return {
          success: false,
          message: `This account is not valid for the ${expectedRole === 'customer' ? 'User' : expectedRole === 'delivery_partner' ? 'Delivery' : 'Store'} Panel.`,
        };
      }
    }
    const activeUser = saveSupabaseUser(data.user, 'email');
    if (data.session?.access_token) localStorage.setItem('supercart_token', data.session.access_token);
    return { success: true, user: activeUser };
  };

  const signUpWithEmail = async ({ name, email, password, phone, role = 'customer' }) => {
    const cleanEmail = String(email || '').trim();
    const preBlocked = getSignupBlockState(cleanEmail);
    if (preBlocked.blocked) {
      return { success: false, message: preBlocked.message, isRateLimited: true };
    }
    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: { full_name: name, phone, role },
        emailRedirectTo: window.location.origin,
      },
    });
    if (error) {
      const friendly = toFriendlySupabaseAuthError(error);
      if (friendly !== String(error.message || '')) {
        return { success: false, message: friendly, isRateLimited: true };
      }
      recordFailedSignupAttempt(cleanEmail);
      return { success: false, message: error.message };
    }

    clearSignupAttempts(cleanEmail);
    if (!data.session) {
      return {
        success: true,
        needsEmailConfirmation: true,
        message: 'Account created. Please check your email and verify your account before signing in.',
      };
    }

    const activeUser = saveSupabaseUser(data.user, 'email');
    localStorage.setItem('supercart_token', data.session.access_token);
    return { success: true, user: activeUser };
  };

  const logout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.error(e?.message || e);
    }
    setUser(null);
    localStorage.removeItem('supercart_user');
    localStorage.removeItem('supercart_token');
    clearAuthNotice();
  };

  // Pin/AddressPicker se save hote hi Profile ke "Location / delivery address"
  // me bhi reflect ho — sirf location field update, baaki profile untouched.
  // Supabase sync best-effort hai (fail ho to local value hi source of truth).
  const updateLocation = useCallback(async (locationString) => {
    const value = String(locationString || '');
    // userId ko setUser updater ke andar se mat nikalo — updater async queue hota hai,
    // isliye userId hamesha null reh jaata tha aur Supabase update kabhi hota hi nahi tha
    // (stale/cached address bug). Yahan synchronously localStorage se nikalo.
    let userId = null;
    try {
      const raw = localStorage.getItem('supercart_user');
      if (raw) userId = JSON.parse(raw)?.id ?? null;
    } catch {
      /* ignore */
    }
    setUser((current) => {
      if (!current) return current;
      if (!userId && current.id) userId = current.id;
      const updated = { ...current, location: value };
      try {
        localStorage.setItem('supercart_user', JSON.stringify(updated));
      } catch {
        /* ignore */
      }
      return updated;
    });
    try {
      if (userId) {
        await supabase.from('users').update({ location: value }).eq('id', userId);
      }
    } catch {
      /* best-effort only */
    }
    return { success: true };
  }, []);

  const signInWithGoogle = async (_mode = 'login') => {
    try {
      // Localhost setup: Supabase exchanges code at its own callback, then
      // redirects back here. redirectTo MUST be whitelisted in Supabase Dashboard
      // -> Authentication -> URL Configuration -> Redirect URLs.
      // LIVE (https://supercart-iota.vercel.app): wahan ye 2 URLs add honi chahiye —
      //   Site URL:      https://supercart-iota.vercel.app
      //   Redirect URLs: https://supercart-iota.vercel.app/**  (plus localhost dev ke liye)
      // Google Console must whitelist Supabase callback (NOT localhost):
      // https://eagwchutdhtgioujetag.supabase.co/auth/v1/callback
      //
      // UX FIX (user demand): "ID/password na mange, sirf email choose karke
      // login/signup ho jaye" —
      // - pehle `prompt: 'consent'` + `access_type: 'offline'` tha jo har baar
      //   consent/password screen force karta tha.
      // - ab `prompt: 'select_account'` hai: browser me jo Google accounts
      //   logged-in hain unki list khulti hai, 1 click me account select +
      //   wapas app me login/signup. Dobara password nahi mangta.
      // - NOTE: agar browser me koi Google session hi nahi hai (pehli baar /
      //   logout hai) to Google security ke liye 1 baar ID/password mangega —
      //   ise bypass karna possible nahi hai.
      // - login vs signup me OAuth flow same hota hai: naya email hoga to
      //   `ensureOAuthProfile` nayi row INSERT karke account bana deta hai,
      //   purana email hoga to seedha login. Isliye `mode` sirf tracking ke liye.
      const inApp =
        typeof window !== 'undefined' &&
        !!window.SupercartApp &&
        typeof window.SupercartApp.openLogin === 'function';
      const redirectTo = inApp
        ? window.SupercartApp.redirectUri()
        : `${window.location.origin}/`;
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: inApp,
          queryParams: {
            prompt: 'select_account',
          },
        },
      });

      if (error) {
        // Surface exact URIs so redirect_uri_mismatch is fixable in 1 min
        if (error.message?.includes('redirect')) {
          throw new Error(
            `${error.message} | App sent redirectTo=${redirectTo}, Google expects redirect_uri=https://eagwchutdhtgioujetag.supabase.co/auth/v1/callback in Google Cloud Console`
          );
        }
        throw error;
      }
      if (inApp && data?.url) {
        window.SupercartApp.openLogin(data.url);
      }
      return { success: true, data };
    } catch (error) {
      return { success: false, message: error.message };
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, authNotice, clearAuthNotice, login, updateProfile, updateLocation, logout, signInWithEmail, signUpWithEmail, signInWithGoogle }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
