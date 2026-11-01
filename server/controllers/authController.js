import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { supabase } from '../config/supabase.js';
import generateToken from '../utils/generateToken.js';
import { getPanelAuthEmail, isReservedPanelEmail, normalizePanelEmail } from '../utils/panelEmail.js';

// In-memory fallback if table is not created yet
let localUsers = [];

// @desc    Register new user in Supabase (Signup)
// @route   POST /signup or POST /api/auth/signup
// @access  Public
export const signupUser = async (req, res) => {
  try {
    const signupInput = req.body;
    const panel = signupInput.panel === 'delivery' ? 'delivery' : signupInput.panel === 'store_manager' ? 'store_manager' : 'customer';
    const plainEmail = normalizePanelEmail(signupInput.email);
    if (!signupInput.name || !plainEmail || !signupInput.password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, email, and password',
      });
    }

    if (panel === 'customer' && isReservedPanelEmail(plainEmail)) {
      return res.status(400).json({ success: false, message: 'Reserved panel email tags are not allowed.' });
    }
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(503).json({ success: false, message: 'Signup is not configured on the backend.' });
    }
    const authEmail = getPanelAuthEmail(plainEmail, panel);
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: authEmail,
      password: signupInput.password,
      options: {
        data: {
          full_name: signupInput.name.trim(),
          phone: signupInput.phone?.trim() || '',
          role: panel,
        },
        emailRedirectTo: process.env.AUTH_EMAIL_REDIRECT_URL || undefined,
      },
    });

    if (authError || !authData.user) {
      return res.status(400).json({
        success: false,
        message: authError?.message || 'Account could not be created. Please try again.',
      });
    }
    if (panel === 'delivery' && authData.user.identities && authData.user.identities.length === 0) {
      return res.status(409).json({
        success: false,
        message: 'Delivery identity already exists. Login karo.',
      });
    }

    const { error: roleError } = await supabase
      .from('user_roles')
      .insert({ user_id: authData.user.id, role: panel });
    if (roleError) {
      await supabase.auth.admin.deleteUser(authData.user.id);
      return res.status(500).json({ success: false, message: 'Account role could not be assigned.' });
    }
    const { error: profileError } = await supabase
      .from('users')
      .upsert({
        id: authData.user.id,
        name: signupInput.name.trim(),
        email: plainEmail,
        phone: signupInput.phone?.trim() || '',
        role: panel,
      }, { onConflict: 'id' });
    if (profileError) {
      await supabase.from('user_roles').delete().eq('user_id', authData.user.id);
      await supabase.auth.admin.deleteUser(authData.user.id);
      return res.status(500).json({ success: false, message: 'Account profile could not be created.' });
    }
    return res.status(201).json({
      success: true,
      message: authData.session
        ? 'Account created successfully!'
        : 'Account created. Please verify your email before logging in.',
      needsEmailConfirmation: !authData.session,
      data: {
        id: authData.user.id,
        name: authData.user.user_metadata?.full_name || signupInput.name,
        email: plainEmail,
        phone: authData.user.user_metadata?.phone || '',
        role: panel,
        token: authData.session?.access_token,
      },
    });

    const { name, email, password, phone } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, email, and password',
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Check if user already exists in Supabase
    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('email', cleanEmail)
      .maybeSingle();

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email address',
      });
    }

    // Hash password with bcrypt
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Insert user into Supabase
    const { data: newUser, error } = await supabase
      .from('users')
      .insert([
        {
          name,
          email: cleanEmail,
          password: hashedPassword,
          phone: phone || '',
          role: 'customer',
        },
      ])
      .select()
      .single();

    if (error) {
      console.warn('⚠️ Supabase User Insert Warning (Falling back to local cache):', error.message);
      const fallbackUser = {
        id: `u_${Date.now()}`,
        name,
        email: cleanEmail,
        password: hashedPassword,
        phone: phone || '',
        role: 'customer',
      };

      localUsers.push(fallbackUser);

      return res.status(201).json({
        success: true,
        message: 'Account registered successfully! 🎉',
        data: {
          id: fallbackUser.id,
          name: fallbackUser.name,
          email: fallbackUser.email,
          phone: fallbackUser.phone,
          role: fallbackUser.role,
          token: generateToken(fallbackUser.id),
        },
        source: 'local_fallback',
      });
    }

    res.status(201).json({
      success: true,
      message: 'Account created successfully in Supabase Cloud DB! 🎉',
      data: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        phone: newUser.phone,
        role: newUser.role,
        token: generateToken(newUser.id),
      },
      source: 'supabase_cloud_database',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error during signup',
      error: error.message,
    });
  }
};

// Admin-created store manager. This must use Supabase Auth admin APIs so the
// account is confirmed immediately and the password entered by Admin is valid.
export const createStoreManager = async (req, res) => {
  try {
    const { name, email, phone, storeId } = req.body || {};
    const cleanEmail = normalizePanelEmail(email);
    const authEmail = getPanelAuthEmail(cleanEmail, 'store_manager');
    const parsedStoreId = Number(storeId);

    if (!name?.trim() || !cleanEmail || !Number.isInteger(parsedStoreId)) {
      return res.status(400).json({ success: false, message: 'Name, email, and store are required.' });
    }
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(503).json({
        success: false,
        message: 'Manager creation is not configured on the backend. Add SUPABASE_SERVICE_ROLE_KEY to the server environment.',
      });
    }

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
      role: 'store_manager',
    };
    const { data: authUsers, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listError) throw listError;
    const existingAuthUser = (authUsers?.users || []).find(
      (authUser) => String(authUser.email || '').toLowerCase() === authEmail,
    );

    let userId;
    if (existingAuthUser) {
      const { data: existingRole, error: existingRoleError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', existingAuthUser.id)
        .maybeSingle();
      if (existingRoleError) throw existingRoleError;
      if (existingRole && existingRole.role !== 'store_manager') {
        return res.status(409).json({
          success: false,
          message: 'A different panel identity already uses this tagged email.',
        });
      }
      userId = existingAuthUser.id;
    } else {
      const { data: created, error: createError } = await supabase.auth.admin.createUser({
        email: authEmail,
        password: crypto.randomBytes(24).toString('base64url'),
        email_confirm: false,
        user_metadata: userMetadata,
      });
      if (createError || !created?.user) {
        return res.status(400).json({ success: false, message: createError?.message || 'Manager account could not be created.' });
      }
      userId = created.user.id;
    }

    const profilePayload = {
      id: userId,
      name: name.trim(),
      email: cleanEmail,
      phone: String(phone || '').trim(),
    };
    if (!existingAuthUser) profilePayload.role = 'store_manager';
    const { error: profileError } = await supabase.from('users').upsert(profilePayload, { onConflict: 'id' });
    if (profileError) throw profileError;

    const { error: roleError } = await supabase
      .from('user_roles')
      .upsert({ user_id: userId, role: 'store_manager' }, { onConflict: 'user_id' });
    if (roleError) throw roleError;

    const { error: linkError } = await supabase
      .from('store_staff')
      .upsert({ store_id: parsedStoreId, user_id: userId }, { onConflict: 'store_id,user_id' });
    if (linkError) throw linkError;
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(authEmail, {
      redirectTo: process.env.STORE_PASSWORD_RESET_REDIRECT_URL || process.env.PASSWORD_RESET_REDIRECT_URL,
    });
    if (resetError) console.warn('Store manager reset email warning:', resetError.message);

    return res.status(201).json({
      success: true,
      message: `Manager "${name.trim()}" created and linked to "${store.store_name}".`,
      data: { id: userId, name: name.trim(), email: cleanEmail, storeId: parsedStoreId, existingAccount: Boolean(existingAuthUser) },
    });
  } catch (error) {
    console.error('Store manager creation failed:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Manager account could not be created.' });
  }
};

// @desc    Authenticate user in Supabase (Login)
// @route   POST /login or POST /api/auth/login
// @access  Public
export const loginUser = async (req, res) => {
  try {
    const loginInput = req.body;
    if (!loginInput.email || !loginInput.password) {
      return res.status(400).json({ success: false, message: 'Please provide both email and password' });
    }

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: loginInput.email.toLowerCase().trim(),
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

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both email and password',
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Query user from Supabase
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', cleanEmail)
      .maybeSingle();

    if (error || !user) {
      // Check fallback
      const fallback = localUsers.find((u) => u.email === cleanEmail);
      if (fallback) {
        const isMatch = await bcrypt.compare(password, fallback.password);
        if (isMatch) {
          return res.status(200).json({
            success: true,
            message: 'Login successful! Welcome back 👋',
            data: {
              id: fallback.id,
              name: fallback.name,
              email: fallback.email,
              phone: fallback.phone,
              role: fallback.role,
              token: generateToken(fallback.id),
            },
            source: 'local_fallback',
          });
        }
      }

      return res.status(401).json({
        success: false,
        message: 'Invalid email or password. Please check your credentials.',
      });
    }

    // Verify bcrypt password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password. Please check your credentials.',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Login successful! Welcome back 👋',
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        token: generateToken(user.id),
      },
      source: 'supabase_cloud_database',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error during login',
      error: error.message,
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
    const panel = req.body?.panel === 'delivery' ? 'delivery' : req.body?.panel === 'store_manager' ? 'store_manager' : 'customer';
    if (panel === 'customer' && isReservedPanelEmail(plainEmail)) {
      return res.status(400).json({ success: false, message: 'Please use your original email address.' });
    }
    const email = getPanelAuthEmail(plainEmail, panel);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address',
      });
    }

    const redirectTo =
      String(req.body?.redirectTo || '').trim() ||
      process.env.PASSWORD_RESET_REDIRECT_URL ||
      undefined;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
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
