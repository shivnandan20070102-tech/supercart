import bcrypt from 'bcryptjs';
import { supabase } from '../config/supabase.js';
import generateToken from '../utils/generateToken.js';

// In-memory fallback if table is not created yet
let localUsers = [];

// @desc    Register new user in Supabase (Signup)
// @route   POST /signup or POST /api/auth/signup
// @access  Public
export const signupUser = async (req, res) => {
  try {
    const signupInput = req.body;
    if (!signupInput.name || !signupInput.email || !signupInput.password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, email, and password',
      });
    }

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: signupInput.email.toLowerCase().trim(),
      password: signupInput.password,
      options: {
        data: {
          full_name: signupInput.name.trim(),
          phone: signupInput.phone?.trim() || '',
        },
      },
    });

    if (authError || !authData.user) {
      return res.status(400).json({
        success: false,
        message: authError?.message || 'Account could not be created. Please try again.',
      });
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
        email: authData.user.email,
        phone: authData.user.user_metadata?.phone || '',
        role: 'customer',
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
