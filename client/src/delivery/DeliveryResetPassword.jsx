import React, { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, LockKeyhole, Truck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../config/supabase';

const DeliveryResetPassword = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    const checkRecoverySession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!active) return;
      setReady(Boolean(session));
      if (!session) setError('Reset link is invalid or has expired.');
    };
    checkRecoverySession();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (active && (event === 'PASSWORD_RECOVERY' || session)) setReady(Boolean(session));
    });
    return () => {
      active = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message || 'Could not update password.');
      setLoading(false);
      return;
    }
    await supabase.auth.signOut();
    navigate('/delivery/login', {
      replace: true,
      state: { message: 'Password changed successfully, please log in' },
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 text-white">
        <div className="mb-7 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500 text-slate-950"><Truck /></div>
          <h1 className="mt-4 text-2xl font-black">Reset Password</h1>
          <p className="mt-1 text-sm text-slate-400">Set your new password.</p>
        </div>
        {error && <p className="mb-4 rounded-xl bg-rose-950 p-3 text-xs font-bold text-rose-300">{error}</p>}
        {!ready && !error && <p className="mb-4 rounded-xl bg-slate-800 p-3 text-xs text-slate-300">Verifying reset session...</p>}
        <label className="block text-xs font-bold text-slate-300">New Password
          <span className="relative mt-1.5 block"><LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input type="password" required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-800 p-3 pl-10 text-sm text-white outline-none focus:border-emerald-500" /></span>
        </label>
        <label className="mt-4 block text-xs font-bold text-slate-300">Confirm Password
          <span className="relative mt-1.5 block"><CheckCircle2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input type="password" required minLength={6} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-800 p-3 pl-10 text-sm text-white outline-none focus:border-emerald-500" /></span>
        </label>
        <button type="submit" disabled={loading || !ready} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3.5 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-60">{loading ? 'Updating...' : 'Set new password'} <ArrowRight className="h-4 w-4" /></button>
      </form>
    </div>
  );
};

export default DeliveryResetPassword;
