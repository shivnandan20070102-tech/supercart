import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { supabase } from '../config/supabase.js';
import generateToken from '../utils/generateToken.js';

const normalizePanelEmail = (email) => String(email || '').trim().toLowerCase();

// In-memory fallback if table is not created yet
let localUsers = [];

// @desc    Register new user in Supabase (Signup)
// @route   POST /signup or POST /api/auth/signup
// @access  Public
export const signupUser = async (req, res) => {
  try {
    const signupInput = req.body || {};
    const panel = signupInput.panel === 'delivery' ? 'delivery' : 'customer';
    const plainEmail = normalizePanelEmail(signupInput.email);
    const name = typeof signupInput.name === 'string' ? signupInput.name.trim() : '';
    const password = typeof signupInput.password === 'string' ? signupInput.password : '';
    const phone = typeof signupInput.phone === 'string' ? signupInput.phone.trim() : '';
    if (!name || !plainEmail || !password) {
      return res.status(400).json({ success: false, message: 'Please provide name, email, and password.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(plainEmail)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
    }
    if (panel === 'delivery' && !/^[6-9]\d{9}$/.test(phone)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid 10-digit Indian phone number.' });
    }
    const requestedRole = panel === 'delivery' ? 'delivery' : 'customer';
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: plainEmail,
      password,
      options: {
        data: { full_name: name, phone, role: requestedRole },
        emailRedirectTo: process.env.EMAIL_CONFIRM_REDIRECT_URL || undefined,
      },
    });
    if (authError || !authData?.user) {
      const alreadyExists = /already|exists|duplicate/i.test(authError?.message || '');
      const message = authError?.message || 'Supabase did not return a user.';
      console.error('Signup failed:', { panel, email: plainEmail, message });
      return res.status(alreadyExists ? 409 : 400).json({
        success: false,
        message,
      });
    }
    return res.status(201).json({
      success: true,
      message: 'Account created. Please verify your email before logging in.',
      needsEmailConfirmation: true,
      data: {
        id: authData.user.id,
        name,
        email: plainEmail,
        phone,
        role: requestedRole,
        token: null,
      },
    });
  } catch (error) {
    console.error('Signup server error:', error?.message || 'unknown error');
    res.status(500).json({
      success: false,
      message: error?.message || 'Account could not be created.',
    });
  }
};

// Admin-created store manager. This must use Supabase Auth admin APIs so the
// account is confirmed immediately and the password entered by Admin is valid.
export const createStoreManager = async (req, res) => {
  let step = 'validation';
  try {
    const { name, email, phone, password, storeId } = req.body || {};
    const cleanEmail = normalizePanelEmail(email);
    const authEmail = cleanEmail;
    const parsedStoreId = Number(storeId);
    const managerPassword = typeof password === 'string' ? password.trim() : '';

    if (!name?.trim() || !cleanEmail || !Number.isInteger(parsedStoreId)) {
      return res.status(400).json({ success: false, message: 'Name, email, and store are required.' });
    }
    if (managerPassword && managerPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
    }
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(503).json({
        success: false,
        message: 'Manager creation is not configured on the backend. Add SUPABASE_SERVICE_ROLE_KEY to the server environment.',
      });
    }

    step = 'checking admin access';
    const { data: adminProfileById, error: adminProfileByIdError } = await supabase
      .from('users')
      .select('role')
      .eq('id', req.user.id)
      .maybeSingle();
    if (adminProfileByIdError) throw adminProfileByIdError;

    // Older admin accounts can have a profile row keyed by email rather than
    // the Supabase Auth user id. Keep the authorization check strict, but
    // support that existing data shape as the admin panel does.
    let adminProfile = adminProfileById;
    if (!adminProfile && req.user.email) {
      const { data: adminProfileByEmail, error: adminProfileByEmailError } = await supabase
        .from('users')
        .select('role')
        .eq('email', String(req.user.email).trim().toLowerCase())
        .maybeSingle();
      if (adminProfileByEmailError) throw adminProfileByEmailError;
      adminProfile = adminProfileByEmail;
    }

    const databaseRole = String(adminProfile?.role || '').trim().toLowerCase();
    if (databaseRole !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only an admin can create store managers.' });
    }

    step = 'checking store';
    const { data: store, error: storeError } = await supabase
      .from('stores')
      .select('id,store_name,is_active')
      .eq('id', parsedStoreId)
      .maybeSingle();
    if (storeError) throw storeError;
    if (!store) return res.status(404).json({ success: false, message: 'Store not found.' });
    if (store.is_active === false) return res.status(400).json({ success: false, message: 'Cannot create a manager for an inactive store.' });

    const userMetadata = {
      full_name: name.trim(),
      phone: String(phone || '').trim(),
    };
    step = 'checking existing auth account';
    const { data: authUsers, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listError) throw listError;
    const existingAuthUser = (authUsers?.users || []).find(
      (authUser) => String(authUser.email || '').toLowerCase() === authEmail,
    );

    let userId;
    if (existingAuthUser) {
      step = 'updating existing auth account';
      if (managerPassword) {
        const { error: passwordError } = await supabase.auth.admin.updateUserById(existingAuthUser.id, {
          password: managerPassword,
          email_confirm: true,
          user_metadata: userMetadata,
        });
        if (passwordError) {
          return res.status(400).json({ success: false, message: passwordError.message || 'Manager password could not be updated.' });
        }
      }
      userId = existingAuthUser.id;
    } else {
      step = 'creating auth account';
      const { data: created, error: createError } = await supabase.auth.admin.createUser({
        email: authEmail,
        password: managerPassword || crypto.randomBytes(24).toString('base64url'),
        email_confirm: Boolean(managerPassword),
        user_metadata: userMetadata,
      });
      if (createError || !created?.user) {
        const dbHint = /database error|new user/i.test(createError?.message || '')
          ? ' (Supabase trigger/constraint issue)'
          : '';
        return res.status(400).json({ success: false, message: `${createError?.message || 'Manager account could not be created.'}${dbHint}` });
      }
      userId = created.user.id;
    }

    const profilePayload = {
      id: userId,
      name: name.trim(),
      email: cleanEmail,
      phone: String(phone || '').trim(),
      role: 'store_manager',
    };
    step = 'saving manager profile';
    const { data: existingProfile, error: profileReadError } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .maybeSingle();
    if (profileReadError) throw profileReadError;
    const profileQuery = existingProfile
      ? supabase.from('users').update(profilePayload).eq('id', userId)
      : supabase.from('users').insert(profilePayload);
    const { error: profileError } = await profileQuery;
    if (profileError) throw profileError;

    step = 'linking manager to store';
    const { error: linkError } = await supabase
      .from('store_staff')
      .upsert({ store_id: parsedStoreId, user_id: userId }, { onConflict: 'store_id,user_id' });
    if (linkError) throw linkError;
    if (!managerPassword) {
      step = 'sending password setup email';
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(authEmail, {
        redirectTo: process.env.STORE_PASSWORD_RESET_REDIRECT_URL || process.env.PASSWORD_RESET_REDIRECT_URL,
      });
      if (resetError) console.warn('Store manager reset email warning:', resetError.message);
    }

    return res.status(201).json({
      success: true,
      message: managerPassword
        ? `Manager "${name.trim()}" created and linked to "${store.store_name}". They can log in with the password you set.`
        : `Manager "${name.trim()}" created and linked to "${store.store_name}". A password setup email was sent.`,
      data: { id: userId, name: name.trim(), email: cleanEmail, storeId: parsedStoreId, existingAccount: Boolean(existingAuthUser) },
    });
  } catch (error) {
    const detail = error?.message || 'Unknown error';
    console.error(`Store manager creation failed during ${step}:`, detail);
    return res.status(500).json({
      success: false,
      message: `Manager account could not be created while ${step}: ${detail}`,
    });
  }
};

// @desc    Authenticate user in Supabase (Login)
// @route   POST /login or POST /api/auth/login
// @access  Public
export const loginUser = async (req, res) => {
  try {
    const loginInput = req.body || {};
    const plainEmail = normalizePanelEmail(loginInput.email);
    if (!plainEmail || !loginInput.password) {
      return res.status(400).json({ success: false, message: 'Please provide both email and password' });
    }
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: plainEmail,
      password: loginInput.password,
    });

    if (authError || !authData.user || !authData.session) {
      return res.status(401).json({
        success: false,
        message: authError?.message || 'Invalid email or password.',
      });
    }
    return res.status(200).json({
      success: true,
      message: 'Login successful!',
      data: {
        id: authData.user.id,
        name: authData.user.user_metadata?.full_name || authData.user.email?.split('@')[0],
        email: authData.user.email,
        phone: authData.user.user_metadata?.phone || '',
        role: 'customer',
        token: authData.session.access_token,
      },
    });
  } catch (error) {
    console.error('Panel login server error:', error?.message || 'unknown error');
    res.status(500).json({
      success: false,
      message: error?.message || 'Login failed.',
    });
  }
};

// @desc    Forgot password — reset link email karo (rate-limited: 3/hour/IP)
// @route   POST /api/auth/forgot-password (alias: /forgot-password)
// @access  Public
// Note: hamesha SAME success message (email enumumeration na ho —
// attacker ko pata na chale kaunsi email registered hai).
export const forgotPassword = async (req, res) => {
  try {
    const plainEmail = normalizePanelEmail(req.body?.email);
    if (!plainEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(plainEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address',
      });
    }

    const redirectTo =
      String(req.body?.redirectTo || '').trim() ||
      process.env.PASSWORD_RESET_REDIRECT_URL ||
      undefined;

    const { error } = await supabase.auth.resetPasswordForEmail(plainEmail, {
      ...(redirectTo ? { redirectTo } : {}),
    });

    if (error) {
      console.warn('⚠️ Forgot-password Supabase warning:', error.message);
      // Email-bombing probing roko — phir bhi generic success (enumumeration nahi).
    }

    return res.status(200).json({
      success: true,
      message: 'If this email is registered, you will receive a reset link',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error while requesting password reset',
      error: error.message,
    });
  }
};

// @desc    Get user profile
// @route   GET /api/auth/profile
// @access  Private
export const getUserProfile = async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, email, phone, role, address')
      .eq('id', req.user.id)
      .single();

    if (error || !user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
