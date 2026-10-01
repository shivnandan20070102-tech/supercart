import React, { useEffect, useState } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, Truck } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../config/supabase';

const deliveryRoles = ['delivery_partner', 'delivery'];

const DeliveryLogin = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { signInWithEmail, signUpWithEmail } = useAuth();
  const [isSignup, setIsSignup] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(location.state?.message || '');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!location.state?.message) return undefined;
    navigate(location.pathname, { replace: true, state: null });
    return undefined;
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    let active = true;

    const handleApprovalStatus = (profile) => {
      const status = String(profile?.approval_status || 'pending').toLowerCase();
      if (status === 'approved') {
        navigate('/delivery/dashboard', {
          replace: true,
          state: { approvalMessage: 'Your application has been approved!' },
        });
      } else if (status === 'rejected') navigate('/delivery/profile', { replace: true });
      else if (profile?.profile_completed) navigate('/delivery/approval-pending', { replace: true });
      else navigate('/delivery/profile', { replace: true });
    };

    const redirectIfAuthenticated = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !active) return;
      const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle();
      if (!active || !deliveryRoles.includes(String(profile?.role || '').toLowerCase())) return;
      const { data: deliveryProfile } = await supabase.from('delivery_profiles').select('approval_status, profile_completed').eq('user_id', user.id).maybeSingle();
      if (!active) return;
      if (!deliveryProfile) return navigate('/delivery/profile', { replace: true });

      handleApprovalStatus(deliveryProfile);
      const channel = supabase
        .channel(`delivery-approval-${user.id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'delivery_profiles', filter: `user_id=eq.${user.id}` },
          ({ new: updatedProfile }) => {
            if (active) handleApprovalStatus(updatedProfile);
          },
        )
        .subscribe();
      return () => supabase.removeChannel(channel);
    };

    let removeChannel;
    redirectIfAuthenticated().then((cleanup) => { removeChannel = cleanup; });
    return () => {
      active = false;
      if (removeChannel) removeChannel();
    };
  }, [navigate]);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    if (isSignup && form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      setLoading(false);
      return;
    }

    const result = isSignup
      ? await signUpWithEmail({ ...form, role: 'delivery_partner' })
      : await signInWithEmail(form.email.trim(), form.password);
    if (!result.success) {
      setError(result.message || 'Login failed.');
      setLoading(false);
      return;
    }
    if (isSignup && result.needsEmailConfirmation) {
      setError(result.message);
      setLoading(false);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle();
    if (deliveryRoles.includes(String(profile?.role || '').toLowerCase())) {
      const { data: deliveryProfile } = await supabase.from('delivery_profiles').select('approval_status, profile_completed').eq('user_id', user.id).maybeSingle();
      const status = String(deliveryProfile?.approval_status || 'pending').toLowerCase();
      if (status === 'approved') navigate('/delivery/dashboard');
      else if (status === 'rejected') navigate('/delivery/profile');
      else if (deliveryProfile?.profile_completed) navigate('/delivery/approval-pending');
      else navigate('/delivery/profile');
    } else {
      await supabase.auth.signOut();
      setError('This account is not a delivery partner.');
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 text-white">
        <div className="mb-7 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500 text-slate-950"><Truck /></div>
          <h1 className="mt-4 text-2xl font-black">{isSignup ? 'Join as Delivery Partner' : 'Delivery Partner Login'}</h1>
          <p className="mt-1 text-sm text-slate-500">{isSignup ? 'Create your delivery partner account.' : 'Login to view and deliver assigned orders.'}</p>
        </div>

        <div className="mb-5 grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-xs font-bold">
          <button type="button" onClick={() => { setIsSignup(false); setError(''); }} className={`rounded-lg py-2 ${!isSignup ? 'bg-emerald-500 text-slate-950' : 'text-slate-500'}`}>Login</button>
          <button type="button" onClick={() => { setIsSignup(true); setError(''); }} className={`rounded-lg py-2 ${isSignup ? 'bg-emerald-500 text-slate-950' : 'text-slate-500'}`}>Sign up</button>
        </div>

        {success && <p className="mb-4 rounded-xl bg-emerald-950 p-3 text-xs font-bold text-emerald-300">{success}</p>}
        {error && <p className="mb-4 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-600">{error}</p>}
        {isSignup && <>
          <label className="block text-xs font-bold text-slate-600">Full name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-emerald-500" /></label>
          <label className="mt-4 block text-xs font-bold text-slate-600">Phone<input required value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-emerald-500" /></label>
        </>}
        <label className="mt-4 block text-xs font-bold text-slate-600">Email
          <span className="relative mt-1.5 block"><Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="w-full rounded-xl border border-slate-200 bg-white p-3 pl-10 text-sm outline-none focus:border-emerald-500" /></span>
        </label>
        <label className="mt-4 block text-xs font-bold text-slate-600">Password
          <span className="relative mt-1.5 block"><LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type={showPassword ? 'text' : 'password'} required value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className="w-full rounded-xl border border-slate-200 bg-white p-3 pl-10 pr-11 text-sm outline-none focus:border-emerald-500" /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span>
        </label>
        {isSignup && <label className="mt-4 block text-xs font-bold text-slate-600">Confirm password<input type={showPassword ? 'text' : 'password'} required value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-emerald-500" /></label>}
        {!isSignup && <div className="mt-3 text-right"><Link to="/delivery/forgot-password" className="text-xs font-bold text-emerald-400 hover:text-emerald-300">Forgot Password?</Link></div>}
        <button type="submit" disabled={loading} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3.5 text-sm font-black text-slate-950 disabled:cursor-wait disabled:opacity-60">{loading ? 'Please wait...' : isSignup ? 'Create account' : 'Login'} <ArrowRight className="h-4 w-4" /></button>
      </form>
    </div>
  );
};

export default DeliveryLogin;
