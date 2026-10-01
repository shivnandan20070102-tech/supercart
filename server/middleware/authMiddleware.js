import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { supabase } from '../config/supabase.js';

export const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      token = req.headers.authorization.split(' ')[1];

      // Supabase is the primary auth provider used by the client. Validate its
      // access token first so it never goes through the legacy JWT verifier.
      const { data: { user: supabaseUser }, error: supabaseError } = await supabase.auth.getUser(token);
      if (!supabaseError && supabaseUser) {
        req.user = {
          id: supabaseUser.id,
          email: supabaseUser.email,
          name: supabaseUser.user_metadata?.full_name || supabaseUser.email,
        };
        return next();
      }

      // Keep compatibility with older server-issued tokens.
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'supersecret_jwt_key_grocery_app_12345');

      req.user = await User.findById(decoded.id).select('-password');
      return next();
    } catch (error) {
      return res.status(401).json({ success: false, message: 'Supabase session expired. Please login again.' });
    }
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized, no token provided' });
  }
};
