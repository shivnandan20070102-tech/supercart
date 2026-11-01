import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, CircleDollarSign, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../config/supabase';

const startOf = (period) => {
  const date = new Date();
  if (period === 'week') date.setDate(date.getDate() - 6);
  if (period === 'month') date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
};

const DeliveryPocket = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [period, setPeriod] = useState('today');
  const [earnings, setEarnings] = useState([]);
  const [cod, setCod] = useState({ collected: 0, deposited: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user: current } } = await supabase.auth.getUser();
      if (!current) {
        navigate('/delivery/login', { replace: true });
        return;
      }
      const { data } = await supabase.from('delivery_earnings').select('order_id,fee,tip,created_at').eq('partner_id', current.id).gte('created_at', startOf(period)).order('created_at', { ascending: false });
      const { data: cashOrders } = await supabase.from('orders').select('total_price,payment_method').eq('delivery_boy_id', current.id).eq('status', 'delivered').gte('created_at', startOf(period));
      if (active) {
        setUser(current);
        setEarnings(data || []);
        setCod({ collected: (cashOrders || []).filter((row) => /cash/i.test(row.payment_method || '')).reduce((sum, row) => sum + Number(row.total_price || 0), 0), deposited: 0 });
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [navigate, period]);

  const totals = useMemo(() => (earnings || []).reduce((result, row) => ({
    fee: result.fee + Number(row.fee || 0),
    tip: result.tip + Number(row.tip || 0),
  }), { fee: 0, tip: 0 }), [earnings]);

  return (
    <main className="min-h-screen bg-slate-950 px-4 pb-24 pt-4 text-white">
      <header className="mx-auto flex max-w-3xl items-center gap-3">
        <button type="button" onClick={() => navigate('/delivery/dashboard')} className="rounded-full p-2 hover:bg-slate-800" aria-label="Back"><ArrowLeft /></button>
        <div><p className="text-xs font-black uppercase tracking-widest text-emerald-400">Pocket</p><h1 className="text-2xl font-black">Your earnings</h1></div>
      </header>
      <div className="mx-auto mt-5 flex max-w-3xl gap-2 rounded-2xl bg-slate-900 p-1">
        {['today', 'week', 'month'].map((value) => <button key={value} type="button" onClick={() => setPeriod(value)} className={`flex-1 rounded-xl py-2 text-xs font-black capitalize ${period === value ? 'bg-emerald-500 text-slate-950' : 'text-slate-400'}`}>{value}</button>)}
      </div>
      <section className="mx-auto mt-4 grid max-w-3xl grid-cols-2 gap-3">
        <div className="rounded-2xl bg-emerald-500 p-4 text-slate-950"><CircleDollarSign /><p className="mt-4 text-3xl font-black">₹{(totals.fee + totals.tip).toFixed(2)}</p><p className="text-xs font-bold">Total earnings</p></div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4"><Wallet className="text-amber-300" /><p className="mt-4 text-2xl font-black">₹{Number(cod.collected || 0).toFixed(2)}</p><p className="text-xs font-bold text-slate-400">COD collected · pending deposit ₹{Number(cod.collected - cod.deposited || 0).toFixed(2)}</p></div>
      </section>
      <section className="mx-auto mt-4 max-w-3xl rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex items-center justify-between"><h2 className="font-black">Breakdown</h2><CalendarDays className="text-emerald-400" /></div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm"><p className="rounded-xl bg-slate-800 p-3 text-slate-300">Delivery fees <b className="float-right text-white">₹{totals.fee.toFixed(2)}</b></p><p className="rounded-xl bg-slate-800 p-3 text-slate-300">Tips <b className="float-right text-white">₹{totals.tip.toFixed(2)}</b></p></div>
        {loading ? <p className="mt-4 text-sm text-slate-500">Loading earnings...</p> : earnings.length === 0 ? <p className="mt-4 text-sm text-slate-500">No earnings for this period.</p> : earnings.map((row) => <div key={row.order_id} className="mt-3 flex justify-between border-t border-slate-800 pt-3 text-sm"><span>Order #{row.order_id}</span><b>₹{(Number(row.fee || 0) + Number(row.tip || 0)).toFixed(2)}</b></div>)}
      </section>
      <DeliveryBottomNav active="pocket" />
    </main>
  );
};

export const DeliveryBottomNav = ({ active }) => {
  const navigate = useNavigate();
  const tabs = [['home', 'Home', '/delivery/dashboard'], ['pocket', 'Pocket', '/delivery/pocket'], ['orders', 'Orders', '/delivery/dashboard#orders'], ['profile', 'Profile', '/delivery/profile']];
  return <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-800 bg-slate-950/95 px-2 py-2 backdrop-blur"><div className="mx-auto grid max-w-3xl grid-cols-4 gap-1">{tabs.map(([key, label, path]) => <button key={key} type="button" onClick={() => navigate(path)} className={`rounded-xl py-2 text-[11px] font-black ${active === key ? 'bg-emerald-500 text-slate-950' : 'text-slate-400'}`}>{label}</button>)}</div></nav>;
};

export default DeliveryPocket;
