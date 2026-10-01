import { createClient } from '@supabase/supabase-js';

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://eagwchutdhtgioujetag.supabase.co';
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVhZ3djaHV0ZGh0Z2lvdWpldGFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyNzcwMTcsImV4cCI6MjEwMzg1MzAxN30.GEpY5zfQl8gPzwXPEAEeifaiTAmBxQEvvOIT4cKF5gI';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
	auth: {
		autoRefreshToken: true,
		persistSession: true,
		detectSessionInUrl: true,
	},
});

export default supabase;
