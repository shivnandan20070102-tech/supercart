import React, { createContext, useCallback, useContext, useState, useEffect } from 'react';
import { supabase } from '../config/supabase';

const AuthContext = createContext();

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

  useEffect(() => {
    // 1. Check active session on initial load
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const googleUser = {
            id: session.user.id,
            name: session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Google User',
            email: session.user.email,
            phone: session.user.user_metadata?.phone || '',
            location: session.user.user_metadata?.location || '',
            avatar: session.user.user_metadata?.avatar_url || '',
            provider: 'google',
            token: session.access_token,
          };
          setUser(googleUser);
          localStorage.setItem('supercart_user', JSON.stringify(googleUser));
          localStorage.setItem('supercart_token', session.access_token);
        }
      } catch (err) {
        console.error('Error fetching Supabase session:', err);
      } finally {
        setLoading(false);
      }
    };

    checkSession();

    // 2. Listen to auth state changes (e.g. Google OAuth redirect callback)
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          const googleUser = {
            id: session.user.id,
            name: session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Google User',
            email: session.user.email,
            phone: session.user.user_metadata?.phone || '',
            location: session.user.user_metadata?.location || '',
            avatar: session.user.user_metadata?.avatar_url || '',
            provider: 'google',
            token: session.access_token,
          };
          setUser(googleUser);
          localStorage.setItem('supercart_user', JSON.stringify(googleUser));
          localStorage.setItem('supercart_token', session.access_token);
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          localStorage.removeItem('supercart_user');
          localStorage.removeItem('supercart_token');
        }
      }
    );

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, []);

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

  const signInWithEmail = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { success: false, message: error.message };

    const activeUser = saveSupabaseUser(data.user, 'email');
    if (data.session?.access_token) localStorage.setItem('supercart_token', data.session.access_token);
    return { success: true, user: activeUser };
  };

  const signUpWithEmail = async ({ name, email, password, phone, role = 'customer' }) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name, phone, role },
        emailRedirectTo: window.location.origin,
      },
    });
    if (error) return { success: false, message: error.message };

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
      console.error(e);
    }
    setUser(null);
    localStorage.removeItem('supercart_user');
    localStorage.removeItem('supercart_token');
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

  const signInWithGoogle = async () => {
    try {
      // Localhost setup: Supabase exchanges code at its own callback, then
      // redirects back here. redirectTo MUST be whitelisted in Supabase Dashboard
      // -> Authentication -> URL Configuration -> Redirect URLs.
      // Google Console must whitelist Supabase callback (NOT localhost):
      // https://eagwchutdhtgioujetag.supabase.co/auth/v1/callback
      const redirectTo = `${window.location.origin}/`;
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
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
      return { success: true, data };
    } catch (error) {
      return { success: false, message: error.message };
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, updateProfile, updateLocation, logout, signInWithEmail, signUpWithEmail, signInWithGoogle }}>
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
