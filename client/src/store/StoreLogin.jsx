import React, { useEffect, useState } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, Store } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../config/supabase';

// Store Panel Login — SIRF login, signup NAHI.
// Store Manager ka account Admin banata hai (Admin Dashboard -> Users -> role).
const StoreLogin = () => {
  const navigate = useNavigate();
  const { signInWithEmail } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Pehle se logged-in store_manager ho to seedha dashboard
  useEffect(() => {
    let active = true;
    const redirectIfManager = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !active) return;
      const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle();
      if (active && String(profile?.role || '').toLowerCase() === 'store_manager') {
        navigate('/store/dashboard', { replace: true });
      }
    };
    redirectIfManager();
    return () => {
      active = false;
    };
  }, [navigate]);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    const result = await signInWithEmail(form.email.trim(), form.password);
    if (!result.success) {
      setError(result.message || 'Login failed.');
      setLoading(false);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle();
    if (String(profile?.role || '').toLowerCase() === 'store_manager') {
      navigate('/store/dashboard');
    } else {
      await supabase.auth.signOut();
      setError('This account is not a store manager. Ask the admin to assign the store_manager role.');
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 text-white">
        <div className="mb-7 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500 text-slate-950"><Store /></div>
          <h1 className="mt-4 text-2xl font-black">Store Panel Login</h1>
          <p className="mt-1 text-sm text-slate-500">Pack and manage your store orders.</p>
        </div>

        {error && <p className="mb-4 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-600">{error}</p>}

        <label className="mt-4 block text-xs font-bold text-slate-600">Email
          <span className="relative mt-1.5 block"><Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="w-full rounded-xl border border-slate-200 bg-white p-3 pl-10 text-sm text-slate-800 outline-none focus:border-emerald-500" /></span>
        </label>
        <label className="mt-4 block text-xs font-bold text-slate-600">Password
          <span className="relative mt-1.5 block"><LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type={showPassword ? 'text' : 'password'} required value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className="w-full rounded-xl border border-slate-200 bg-white p-3 pl-10 pr-11 text-sm text-slate-800 outline-none focus:border-emerald-500" /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span>
        </label>
        <button type="submit" disabled={loading} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3.5 text-sm font-black text-slate-950 disabled:cursor-wait disabled:opacity-60">{loading ? 'Please wait...' : 'Login'} <ArrowRight className="h-4 w-4" /></button>

        <p className="mt-5 text-center text-[11px] font-semibold text-slate-500">
          No account? Only an admin can create a Store Manager account —<br />please contact your admin.
        </p>
      </form>
    </div>
  );
};

export default StoreLogin;
