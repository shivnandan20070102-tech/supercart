import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Mail, Truck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../config/supabase';

const DeliveryForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const deliveryResetRedirectUrl = import.meta.env.VITE_DELIVERY_RESET_REDIRECT_URL || 'http://localhost:5173/delivery/reset-password';

  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: deliveryResetRedirectUrl,
    });
    if (error) console.error('Password reset request failed:', error);
    setMessage('If this email is registered, you will receive a reset link');
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 text-white">
        <div className="mb-7 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500 text-slate-950"><Truck /></div>
          <h1 className="mt-4 text-2xl font-black">Forgot Password?</h1>
          <p className="mt-1 text-sm text-slate-400">Enter your registered email.</p>
        </div>
        {message && <p className="mb-4 rounded-xl bg-emerald-950 p-3 text-xs font-bold text-emerald-300">{message}</p>}
        <label className="block text-xs font-bold text-slate-300">Email
          <span className="relative mt-1.5 block"><Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-800 p-3 pl-10 text-sm text-white outline-none focus:border-emerald-500" /></span>
        </label>
        <button type="submit" disabled={loading} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3.5 text-sm font-black text-slate-950 disabled:opacity-60">{loading ? 'Sending...' : 'Send reset link'} <ArrowRight className="h-4 w-4" /></button>
        <Link to="/delivery/login" className="mt-5 flex items-center justify-center gap-2 text-xs font-bold text-slate-400 hover:text-white"><ArrowLeft className="h-4 w-4" /> Back to login</Link>
      </form>
    </div>
  );
};

export default DeliveryForgotPassword;
