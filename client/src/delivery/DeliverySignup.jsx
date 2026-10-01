import React, { useState } from 'react';
import { ArrowRight, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail, Phone, Truck, UserRound } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../config/supabase';

const inputClass = 'mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-800 p-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20';

const DeliverySignup = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirmPassword: '', referralCode: new URLSearchParams(window.location.search).get('ref')?.trim().toUpperCase() || '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const updateField = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: name === 'email' ? value.trim() : value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);

    const { data, error: signupError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        data: { full_name: form.name, phone: form.phone, role: 'delivery', referral_code: form.referralCode.trim().toUpperCase() || null },
        emailRedirectTo: window.location.origin,
      },
    });

    if (signupError) {
      setError(signupError.message);
      setLoading(false);
      return;
    }

    if (!data.session) {
      setMessage('Account created. Please verify your email, then login as a delivery partner.');
      setLoading(false);
      return;
    }

    const { error: profileError } = await supabase.from('delivery_profiles').upsert({
      user_id: data.user.id,
      name: form.name,
      email: form.email,
      phone: form.phone,
      approval_status: 'pending',
      profile_completed: false,
    }, { onConflict: 'user_id' });
    if (profileError) {
      setError(profileError.message);
      setLoading(false);
      return;
    }

    const referralCode = form.referralCode.trim().toUpperCase();
    if (referralCode && data.user) {
      const { data: referrer } = await supabase
        .from('delivery_profiles')
        .select('user_id')
        .eq('referral_code', referralCode)
        .maybeSingle();
      if (referrer?.user_id && referrer.user_id !== data.user.id) {
        const { error: referralError } = await supabase.from('referrals').upsert({
          referrer_id: referrer.user_id,
          referred_user_id: data.user.id,
          referral_code: referralCode,
          bonus_amount: 0,
        });
        if (referralError && !/duplicate|unique/i.test(referralError.message || '')) {
          setError(referralError.message);
          setLoading(false);
          return;
        }
      }
    }

    setMessage('Delivery account created. Redirecting...');
    window.setTimeout(() => navigate('/delivery/profile'), 700);
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-8">
      <form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-7 text-white shadow-2xl sm:p-8">
        <div className="mb-7 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500 text-slate-950"><Truck /></div>
          <h1 className="mt-4 text-2xl font-black">Delivery Partner Signup</h1>
          <p className="mt-1 text-sm text-slate-400">Create your account to start delivering with SuperCart.</p>
        </div>

        {message && <div className="mb-4 flex items-start gap-2 rounded-xl bg-emerald-950 p-3 text-xs font-bold text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" />{message}</div>}
        {error && <p className="mb-4 rounded-xl bg-rose-950 p-3 text-xs font-bold text-rose-300">{error}</p>}

        <label className="block text-xs font-bold text-slate-300">Name
          <span className="relative block"><UserRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input name="name" required value={form.name} onChange={updateField} className={`${inputClass} pl-10`} placeholder="Full name" /></span>
        </label>
        <label className="mt-4 block text-xs font-bold text-slate-300">Email
          <span className="relative block"><Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input type="email" name="email" required value={form.email} onChange={updateField} className={`${inputClass} pl-10`} placeholder="you@example.com" /></span>
        </label>
        <label className="mt-4 block text-xs font-bold text-slate-300">Phone Number
          <span className="relative block"><Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input type="tel" name="phone" required value={form.phone} onChange={updateField} className={`${inputClass} pl-10`} placeholder="9876543210" /></span>
        </label>
        <label className="mt-4 block text-xs font-bold text-slate-300">Password
          <span className="relative block"><LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input type={showPassword ? 'text' : 'password'} name="password" required minLength={6} value={form.password} onChange={updateField} className={`${inputClass} pl-10 pr-11`} placeholder="At least 6 characters" /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span>
        </label>
        <label className="mt-4 block text-xs font-bold text-slate-300">Confirm Password
          <span className="relative block"><LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input type={showPassword ? 'text' : 'password'} name="confirmPassword" required minLength={6} value={form.confirmPassword} onChange={updateField} className={`${inputClass} pl-10 pr-11`} placeholder="Re-enter your password" /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide passwords' : 'Show passwords'} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span>
        </label>
        <label className="mt-4 block text-xs font-bold text-slate-300">Referral Code (optional)
          <input name="referralCode" value={form.referralCode} onChange={updateField} className={inputClass} placeholder="e.g. SC1234ABCD" autoCapitalize="characters" />
        </label>

        <button type="submit" disabled={loading} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3.5 text-sm font-black text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60">
          {loading ? 'Creating account...' : 'Create delivery account'} <ArrowRight className="h-4 w-4" />
        </button>
        <p className="mt-5 text-center text-xs text-slate-400">Already registered? <Link to="/delivery/login" className="font-bold text-emerald-400 hover:text-emerald-300">Login here</Link></p>
      </form>
    </div>
  );
};

export default DeliverySignup;
