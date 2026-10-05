import React, { useEffect, useState } from 'react';
import { ArrowLeft, Flag, LoaderCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../config/supabase';
import ComplaintForm from '../components/ComplaintForm';

const DeliveryComplaints = () => {
  const [user, setUser] = useState(null);
  const [userName, setUserName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { user: current } } = await supabase.auth.getUser();
      if (!mounted) return;
      if (!current) {
        setLoading(false);
        return;
      }
      setUser(current);
      try {
        const { data } = await supabase.from('users').select('name').eq('id', current.id).maybeSingle();
        if (mounted && data?.name) setUserName(data.name);
      } catch {
        /* naam na mile to blank — form kaam karega */
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white sm:px-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-400"><Flag className="h-4 w-4" /> Support</p>
            <h1 className="mt-2 text-3xl font-black">Raise a Complaint</h1>
            <p className="mt-1 text-sm text-slate-400">Issue batao — Admin jald jawab dega.</p>
          </div>
          <Link to="/delivery/profile" className="flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-slate-300 hover:border-emerald-500 hover:text-white"><ArrowLeft className="h-4 w-4" /> Profile</Link>
        </header>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-slate-400"><LoaderCircle className="h-4 w-4 animate-spin" /> Loading…</p>
        ) : (
          <ComplaintForm dark complainantType="delivery_partner" userId={user?.id} userName={userName || user?.email || ''} />
        )}
      </div>
    </main>
  );
};

export default DeliveryComplaints;
