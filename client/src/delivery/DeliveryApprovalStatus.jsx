import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock3, LogOut, ShieldAlert, Truck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../config/supabase';

const statusContent = {
  pending: {
    icon: Clock3,
    title: 'Approval Pending',
    message: 'Your application has been sent to the admin for review. You cannot log in until approval.',
    tone: 'text-amber-300',
  },
  rejected: {
    icon: ShieldAlert,
    title: 'Application Rejected',
    message: 'Your application has been rejected. Please contact admin support.',
    tone: 'text-rose-300',
  },
};

const DeliveryApprovalStatus = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState('pending');

  useEffect(() => {
    let active = true;
    const loadStatus = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/delivery/login', { replace: true });
        return;
      }
      const { data: profile } = await supabase.from('delivery_profiles').select('approval_status').eq('user_id', user.id).maybeSingle();
      if (!active) return;
      if (String(profile?.approval_status || 'pending').toLowerCase() === 'approved') {
        navigate('/delivery/dashboard', { replace: true });
        return;
      }
      setStatus(String(profile?.approval_status || 'pending').toLowerCase());
    };
    loadStatus();
    return () => { active = false; };
  }, [navigate]);

  const content = statusContent[status] || statusContent.pending;
  const Icon = content.icon;

  const logout = async () => {
    await supabase.auth.signOut();
    navigate('/delivery/login', { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center text-white shadow-2xl">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500 text-slate-950"><Truck /></div>
        <Icon className={`mx-auto mt-6 h-10 w-10 ${content.tone}`} />
        <h1 className="mt-4 text-2xl font-black">{content.title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">{content.message}</p>
        {status === 'pending' && <div className="mt-5 flex items-center justify-center gap-2 text-xs font-bold text-emerald-300"><CheckCircle2 className="h-4 w-4" /> After admin approval, log in to access the dashboard.</div>}
        <div className="mt-7 flex flex-col gap-3">
          <button type="button" onClick={logout} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-3 text-sm font-bold text-white hover:bg-slate-700"><LogOut className="h-4 w-4" /> Logout</button>
          <Link to="/delivery/login" className="text-xs font-bold text-emerald-400 hover:text-emerald-300">Back to login</Link>
        </div>
      </div>
    </div>
  );
};

export default DeliveryApprovalStatus;
