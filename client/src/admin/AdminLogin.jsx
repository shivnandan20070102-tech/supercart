import React, { useState, useEffect } from 'react';
import { ArrowRight, LockKeyhole, Mail, ShieldCheck, Clock, AlertTriangle, ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../config/supabase';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 2 * 60 * 1000; // 2 minutes
const ATTEMPTS_STORAGE_KEY = 'supercart_admin_failed_attempts';
const LOCKOUT_STORAGE_KEY = 'supercart_admin_lockout_until';

const AdminLogin = () => {
  const navigate = useNavigate();
  const { signInWithEmail } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);

  useEffect(() => {
    const storedLockout = localStorage.getItem(LOCKOUT_STORAGE_KEY);
    const storedAttempts = parseInt(localStorage.getItem(ATTEMPTS_STORAGE_KEY) || '0', 10);
    
    if (storedLockout) {
      const lockoutUntil = parseInt(storedLockout, 10);
      const remainingMs = lockoutUntil - Date.now();
      if (remainingMs > 0) {
        setLockoutSeconds(Math.ceil(remainingMs / 1000));
        setFailedAttempts(MAX_FAILED_ATTEMPTS);
      } else {
        localStorage.removeItem(LOCKOUT_STORAGE_KEY);
        localStorage.removeItem(ATTEMPTS_STORAGE_KEY);
        setFailedAttempts(0);
        setLockoutSeconds(0);
      }
    } else {
      setFailedAttempts(Number.isNaN(storedAttempts) ? 0 : storedAttempts);
    }
  }, []);

  useEffect(() => {
    if (lockoutSeconds <= 0) return undefined;

    const interval = setInterval(() => {
      const storedLockout = localStorage.getItem(LOCKOUT_STORAGE_KEY);
      if (!storedLockout) {
        setLockoutSeconds(0);
        setFailedAttempts(0);
        return;
      }
      const lockoutUntil = parseInt(storedLockout, 10);
      const remainingMs = lockoutUntil - Date.now();
      
      if (remainingMs <= 0) {
        localStorage.removeItem(LOCKOUT_STORAGE_KEY);
        localStorage.removeItem(ATTEMPTS_STORAGE_KEY);
        setLockoutSeconds(0);
        setFailedAttempts(0);
        setError('');
      } else {
        setLockoutSeconds(Math.ceil(remainingMs / 1000));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [lockoutSeconds]);

  const formatTime = (totalSeconds) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const handleLockoutTrigger = () => {
    const lockoutUntil = Date.now() + LOCKOUT_DURATION_MS;
    localStorage.setItem(LOCKOUT_STORAGE_KEY, lockoutUntil.toString());
    localStorage.setItem(ATTEMPTS_STORAGE_KEY, MAX_FAILED_ATTEMPTS.toString());
    setFailedAttempts(MAX_FAILED_ATTEMPTS);
    setLockoutSeconds(Math.ceil(LOCKOUT_DURATION_MS / 1000));
    setError('5 baar galat password enter karne ke karan 2 minute ke liye login lock ho gaya hai.');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    const result = await signInWithEmail(form.email.trim(), form.password);
    if (result.success) {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        await supabase.auth.signOut();
        setError('Supabase session is invalid. Please refresh and login again.');
        setLoading(false);
        return;
      }
      const authRole = String(user?.user_metadata?.role || '').trim().toLowerCase();
      let databaseRole = '';
      if (user?.email) {
        const { data: profile } = await supabase.from('users').select('role').eq('email', user.email).maybeSingle();
        databaseRole = String(profile?.role || '').trim().toLowerCase();
      }
      if (!userError && (authRole === 'admin' || databaseRole === 'admin')) {
        navigate('/admin');
      } else {
        await supabase.auth.signOut();
        setError('Login successful, but this account is not marked as admin. Set role = admin in Supabase and try again.');
      }
    } else {
      setError(result.message || 'Admin login failed.');
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-7 text-white shadow-2xl sm:p-9">
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500 text-slate-950"><ShieldCheck className="h-7 w-7" /></div>
          <h1 className="mt-4 text-2xl font-black">Admin Login</h1>
          <p className="mt-1 text-sm text-slate-400">Sign in with your Supabase admin account.</p>
        </div>
        {error && <p className="mb-4 rounded-xl bg-rose-950/50 p-3 text-xs font-bold text-rose-300">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-xs font-bold text-slate-300">Admin email
            <span className="relative mt-1.5 block"><Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-800 py-3 pl-10 pr-3 text-sm text-white outline-none focus:border-emerald-500" placeholder="admin@example.com" /></span>
          </label>
          <label className="block text-xs font-bold text-slate-300">Password
            <span className="relative mt-1.5 block">
              <LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                type={showPassword ? "text" : "password"}
                required
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                className="w-full rounded-xl border border-slate-700 bg-slate-800 py-3 pl-10 pr-3 text-sm text-white outline-none focus:border-emerald-500" placeholder="Your Supabase password"
              />
              <span
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 cursor-pointer text-sm hover:text-emerald-400 transition"
              >
                {showPassword ? "Hide" : "Show"}
              </span>
            </span>
          </label>
          <button disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3.5 text-sm font-black text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60">{loading ? 'Checking...' : 'Login to Admin Panel'}<ArrowRight className="h-4 w-4" /></button>
        </form>
        <button type="button" onClick={() => navigate('/login')} className="mt-5 w-full text-xs font-bold text-slate-500 hover:text-white">Back to customer login</button>
      </div>
    </div>
  );
};

export default AdminLogin;
