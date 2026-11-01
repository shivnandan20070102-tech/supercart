import { createClient } from '@supabase/supabase-js';

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://eagwchutdhtgioujetag.supabase.co';
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVhZ3djaHV0ZGh0Z2lvdWpldGFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyNzcwMTcsImV4cCI6MjEwMzg1MzAxN30.GEpY5zfQl8gPzwXPEAEeifaiTAmBxQEvvOIT4cKF5gI';

const authOptions = (storageKey) => ({
	auth: {
		autoRefreshToken: true,
		persistSession: true,
		detectSessionInUrl: true,
		storageKey,
		// Supabase Auth server PKCE `?code=` bhejta hai (naye projects ka default).
		// Default `implicit` rehne par verifier store hi nahi hota aur code
		// exchange kabhi hota nahi — redirect ke baad session null rehta hai.
		flowType: 'pkce',
	},
});

const panelFromPath = () => {
	if (typeof window === 'undefined') return 'customer';
	if (window.location.pathname.startsWith('/delivery')) return 'delivery';
	if (window.location.pathname.startsWith('/store')) return 'store_manager';
	return 'customer';
};

export const panelSupabase = {
	customer: createClient(supabaseUrl, supabaseAnonKey, authOptions('supercart-auth-customer')),
	delivery: createClient(supabaseUrl, supabaseAnonKey, authOptions('supercart-auth-delivery')),
	store_manager: createClient(supabaseUrl, supabaseAnonKey, authOptions('supercart-auth-store')),
};

export const getPanelSupabase = (panel) => panelSupabase[panel] || panelSupabase.customer;
export const supabase = getPanelSupabase(panelFromPath());

export default supabase;
