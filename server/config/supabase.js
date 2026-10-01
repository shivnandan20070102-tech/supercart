import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://eagwchutdhtgioujetag.supabase.co';
// Backend authoritative hai (role check + store ownership khud verify karta
// hai), isliye RLS se independent SERVICE_ROLE key prefer karo. Na ho to
// anon key fallback (existing public RLS policies ke saath kaam karta hai).
// SERVICE_ROLE key kabhi frontend me MAT dalo — sirf server/.env me.
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVhZ3djaHV0ZGh0Z2lvdWpldGFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyNzcwMTcsImV4cCI6MjEwMzg1MzAxN30.GEpY5zfQl8gPzwXPEAEeifaiTAmBxQEvvOIT4cKF5gI';

export const supabase = createClient(
  supabaseUrl,
  supabaseServiceKey || supabaseAnonKey,
  { auth: { persistSession: false } }
);

if (supabaseServiceKey) {
  console.log('🔑 [supabase] backend SERVICE_ROLE mode (RLS bypass, authz code me hota hai)');
} else {
  console.log('🔑 [supabase] backend ANON mode — RLS policies (supabase_*.sql) RUN honi chahiye');
}

export default supabase;
