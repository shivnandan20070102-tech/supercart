import React, { useEffect, useState } from 'react';
import { ArrowLeft, Bell, BellOff, BriefcaseBusiness, ClipboardList, DoorOpen, Gift, LoaderCircle, Mailbox, MapPin, PawPrint, PhoneOff, Route, CalendarDays, ShieldCheck } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../config/supabase';

// Checkout wale delivery-instruction values ka label + icon map (dashboard jaisa)
const INSTRUCTION_META = {
  leave_with_guard: { label: 'Leave with guard', icon: ShieldCheck },
  leave_at_door: { label: 'Leave at door', icon: DoorOpen },
  dont_ring_bell: { label: "Don't ring the bell", icon: BellOff },
  avoid_calling: { label: 'Avoid calling', icon: PhoneOff },
  pet_at_home: { label: 'Pet at home', icon: PawPrint },
  leave_in_mailbox: { label: 'Leave in mailbox', icon: Mailbox },
};

const normalizeInstructions = (value) => {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim()).filter(Boolean);
    } catch { /* single value */ }
    return [value.trim()];
  }
  return [];
};

const config = {
  gigs: { title: 'Gigs History', description: 'Your completed extra tasks and gigs.', icon: BriefcaseBusiness },
  trips: { title: 'Trips History', description: 'Orders and trips delivered by you.', icon: Route },
  offers: { title: 'Offers', description: 'Active incentives and partner offers.', icon: Gift },
};

const DeliveryActivity = () => {
  const { type } = useParams();
  const current = config[type] || config.trips;
  const Icon = current.icon;
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) { setError('Please log in to view this page.'); setLoading(false); return; }
      let result;
      if (type === 'gigs') {
        result = await supabase.from('delivery_gigs').select('*').eq('delivery_partner_id', user.id).order('created_at', { ascending: false });
      } else if (type === 'offers') {
        result = await supabase.from('delivery_offers').select('*').eq('is_active', true).order('created_at', { ascending: false });
      } else {
        result = await supabase.from('orders').select('id, status, total_price, tip_amount, delivery_instructions, created_at, shipping_address').eq('delivery_boy_id', user.id).in('status', ['delivered', 'Delivered', 'completed', 'Completed']).order('created_at', { ascending: false });
      }
      if (!mounted) return;
      if (result.error) setError(result.error.message);
      else {
        const rows = type === 'offers'
          ? (result.data || []).filter((offer) => !offer.expires_at || new Date(offer.expires_at) > new Date())
          : (result.data || []);
        setItems(rows);
      }
      setLoading(false);
    };
    load();
    return () => { mounted = false; };
  }, [type]);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white sm:px-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-emerald-500/15 p-3 text-emerald-400"><Icon className="h-6 w-6" /></div>
            <div><h1 className="text-2xl font-black sm:text-3xl">{current.title}</h1><p className="mt-1 text-sm text-slate-400">{current.description}</p></div>
          </div>
          <Link to="/delivery/profile" className="flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-slate-300 hover:border-emerald-500 hover:text-white"><ArrowLeft className="h-4 w-4" /> Profile</Link>
        </header>
        {loading && <div className="flex justify-center py-16 text-emerald-300"><LoaderCircle className="h-6 w-6 animate-spin" /></div>}
        {!loading && error && <div className="rounded-2xl border border-rose-900 bg-rose-950/50 p-4 text-sm font-semibold text-rose-300">{error}</div>}
        {!loading && !error && items.length === 0 && <div className="rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center text-sm text-slate-400">No records found yet.</div>}
        {!loading && !error && items.length > 0 && (
          <div className="space-y-3">
            {items.map((item) => (
              <article key={item.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-black text-white">{item.title || item.name || (type === 'trips' ? `Trip #${String(item.id).slice(-6)}` : `Gig #${String(item.id).slice(-6)}`)}</h2>
                    <p className="mt-1 flex items-center gap-1 text-xs text-slate-400"><CalendarDays className="h-3.5 w-3.5" />{item.created_at ? new Date(item.created_at).toLocaleString('en-IN') : 'Date unavailable'}</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {Number(item.tip_amount || 0) > 0 && <span className="rounded-full bg-amber-400 px-3 py-1 text-xs font-black text-slate-950">🎉 ₹{item.tip_amount} Tip</span>}
                    {item.amount != null && <span className="font-black text-emerald-300">₹{item.amount}</span>}
                    {item.total_price != null && <span className="font-black text-emerald-300">₹{item.total_price}</span>}
                  </div>
                </div>
                {(item.description || item.address || item.shipping_address) && <p className="mt-3 flex gap-2 text-sm text-slate-300"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />{item.description || item.address || (typeof item.shipping_address === 'string' ? item.shipping_address : item.shipping_address?.address) || 'Details available in the record.'}</p>}
                {type === 'trips' && normalizeInstructions(item.delivery_instructions).length > 0 && (
                  <div className="mt-3 rounded-xl border border-slate-700 bg-slate-800/60 p-3">
                    <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-amber-300">
                      <ClipboardList className="h-3.5 w-3.5" />Delivery instructions
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {normalizeInstructions(item.delivery_instructions).map((value) => {
                        const meta = INSTRUCTION_META[value] || {};
                        const Icon = meta.icon || Bell;
                        return (
                          <li key={value} className="flex items-center gap-2 text-xs font-bold text-slate-200">
                            <Icon className="h-4 w-4 shrink-0 text-emerald-400" />
                            {meta.label || String(value).replace(/_/g, ' ')}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
};

export default DeliveryActivity;
