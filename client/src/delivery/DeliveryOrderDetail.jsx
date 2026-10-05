import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  BellOff,
  Check,
  ClipboardList,
  DoorOpen,
  LoaderCircle,
  MapPin,
  Navigation,
  Package,
  PawPrint,
  Phone,
  PhoneOff,
  ShieldCheck,
  Truck,
  Wallet,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../config/supabase';
import { isOrderInScope } from './storeScope';

// Checkout wale delivery-instruction values ka label + icon map
const INSTRUCTION_META = {
  leave_with_guard: { label: 'Leave with guard', icon: ShieldCheck },
  leave_at_door: { label: 'Leave at door', icon: DoorOpen },
  dont_ring_bell: { label: "Don't ring the bell", icon: BellOff },
  avoid_calling: { label: 'Avoid calling', icon: PhoneOff },
  pet_at_home: { label: 'Pet at home', icon: PawPrint },
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

// Accept ke baad ka step flow (sirf agla step enabled rehta hai)
const FLOW = [
  { key: 'accepted', label: 'Accepted' },
  { key: 'picked_up', label: 'Picked Up' },
  { key: 'out_for_delivery', label: 'Out for Delivery' },
  { key: 'delivered', label: 'Delivered' },
];

const prettifyStatus = (status) =>
  String(status || 'Placed').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const DeliveryOrderDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [order, setOrder] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  // Rider ka Home Store — Navigate/map sirf assigned/home scope me.
  const [homeStoreId, setHomeStoreId] = useState(null);

  const loadOrder = useCallback(async (uid) => {
    const { data, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (orderError) {
      setError(orderError.message);
      setLoading(false);
      return;
    }
    if (!data) {
      setError('Order not found.');
      setLoading(false);
      return;
    }
    setOrder(data);
    if (data.user_id) {
      const { data: customerRow } = await supabase
        .from('users')
        .select('id,name,phone')
        .eq('id', data.user_id)
        .maybeSingle();
      if (customerRow) setCustomer(customerRow);
    }
    // Partner guard: sirf apna assigned order khol sakta hai
    if (uid && data.delivery_boy_id && String(data.delivery_boy_id) !== String(uid)) {
      setError('This order is not assigned to you.');
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      const { data: { user: current }, error: authError } = await supabase.auth.getUser();
      if (!mounted) return;
      if (authError || !current) {
        navigate('/delivery/login', { replace: true });
        return;
      }
      setUser(current);
      // Home store scope ke liye (Navigate guard) — fail ho to null = owner check hi scope.
      try {
        const { data } = await supabase
          .from('delivery_profiles')
          .select('home_store_id')
          .eq('user_id', current.id)
          .maybeSingle();
        if (mounted && data?.home_store_id != null) setHomeStoreId(Number(data.home_store_id));
      } catch { /* ignore — owner check still applies */ }
      await loadOrder(current.id);
    };
    init();
    return () => { mounted = false; };
  }, [loadOrder, navigate]);

  // Realtime: status change hote hi turant update ho
  useEffect(() => {
    if (!id) return undefined;
    const channel = supabase
      .channel(`delivery-order-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `id=eq.${id}` },
        () => user && loadOrder(user.id),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, user, loadOrder]);

  const updateStatus = async (status) => {
    if (!order || updating) return;
    // Scope guard: doosre rider / unassigned order ka status mat badlo.
    const scopeOk = isOrderInScope(order, {
      userId: user?.id,
      homeStoreId,
      assignedStoreIds: order?.store_id != null ? [Number(order.store_id)] : undefined,
    });
    if (!scopeOk) {
      setError('This order is outside your assigned/home store scope.');
      return;
    }
    setUpdating(true);
    setError('');
    const { error: updateError } = await supabase
      .from('orders')
      .update({ status })
      .eq('id', order.id)
      .eq('delivery_boy_id', user.id);
    if (updateError) setError(updateError.message);
    else await loadOrder(user.id);
    setUpdating(false);
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-emerald-300">
        <LoaderCircle className="h-8 w-8 animate-spin" />
      </main>
    );
  }

  const address = order?.shipping_address || {};
  const items = Array.isArray(order?.order_items) ? order.order_items : [];
  const instructions = normalizeInstructions(order?.delivery_instructions);
  const tip = Number(order?.tip_amount || 0);
  const phone = customer?.phone || address.phone || '';
  const customerName = customer?.name || address.name || 'Customer';
  const addressParts = [address.label, address.address || address.formattedAddress, address.city, address.pincode || address.postalCode, address.landmark].filter(Boolean);
  const addressLine = addressParts.length > 0 ? addressParts.join(', ') : 'Address not available';
  const lat = address.latitude ?? address.lat ?? null;
  const lng = address.longitude ?? address.lng ?? null;
  const mapsUrl = lat != null && lng != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressLine)}`;
  const paymentMethod = order?.payment_method || 'Cash On Delivery';
  const isCOD = /cash/i.test(paymentMethod);
  const statusKey = String(order?.status || '').toLowerCase();
  const stepIndex = FLOW.findIndex((s) => s.key === statusKey);
  // SCOPE GUARD: Navigate/map sirf apne assigned + home/assigned-store context me.
  // Kisi doosre rider ka order ya unassigned order khul jaye to Navigate mat do.
  // Fallback assignment (store home se alag, par mujhe assigned) allowed hai.
  const orderInScope = isOrderInScope(order, {
    userId: user?.id,
    homeStoreId,
    assignedStoreIds: order?.store_id != null ? [Number(order.store_id)] : undefined,
  });

  return (
    <main className="min-h-screen bg-slate-950 pb-10 text-white">
      {/* Top bar */}
      <div className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-4">
          <button
            type="button"
            onClick={() => navigate('/delivery/dashboard')}
            aria-label="Back to dashboard"
            className="flex h-10 w-10 items-center justify-center rounded-full text-slate-200 transition hover:bg-slate-800 active:scale-95"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-base font-black tracking-tight">Order Detail</h1>
          <span className="ml-auto rounded-full bg-slate-800 px-3 py-1 text-[11px] font-bold uppercase text-emerald-300">
            {prettifyStatus(order?.status)}
          </span>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-4 px-4 pt-4">
        {error && <p className="rounded-xl border border-rose-900 bg-rose-950/60 p-3 text-sm font-bold text-rose-300">{error}</p>}
        {statusKey === 'delivered' && (
          <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-5 text-center">
            <p className="text-xl font-black text-emerald-300">Order completed 🎉</p>
            <p className="mt-1 text-xs text-slate-400">This order has moved to history.</p>
            <button
              type="button"
              onClick={() => navigate('/delivery/dashboard')}
              className="mt-3 rounded-xl bg-emerald-500 px-6 py-2.5 text-sm font-black text-slate-950 transition hover:bg-emerald-400 active:scale-95"
            >
              Back to Dashboard
            </button>
          </div>
        )}

        {/* 1. UPAR: Order number + date/time */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-2xl font-black tracking-tight">Order #{order?.id}</h2>
              <p className="mt-1 text-xs text-slate-400">
                {order?.created_at ? new Date(order.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : ''}
              </p>
            </div>
            {tip > 0 && (
              <span className="rounded-full bg-amber-400 px-4 py-1.5 text-sm font-black text-slate-950">🎉 ₹{tip} Tip</span>
            )}
          </div>
        </section>

        {/* 2. CUSTOMER SECTION */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Customer</p>
          <p className="mt-2 text-lg font-black">{customerName}</p>
          <p className="mt-1.5 flex gap-2 text-sm leading-6 text-slate-300">
            <MapPin className="mt-1 h-4 w-4 shrink-0 text-emerald-400" />
            {addressLine}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <a
              href={phone ? `tel:${phone.replace(/\s/g, '')}` : undefined}
              aria-disabled={!phone}
              onClick={(e) => { if (!phone) e.preventDefault(); }}
              className={`flex min-h-[52px] items-center justify-center gap-2 rounded-2xl text-sm font-black transition active:scale-[0.98] ${phone ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400' : 'cursor-not-allowed bg-slate-800 text-slate-500'}`}
            >
              <Phone className="h-5 w-5" />
              Call{phone ? ` • ${phone}` : ''}
            </a>
            {orderInScope ? (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-slate-800 text-sm font-black text-white transition hover:bg-slate-700 active:scale-[0.98]"
              >
                <Navigation className="h-5 w-5 text-emerald-400" />
                Navigate
              </a>
            ) : (
              <span
                title="Not in your assigned store scope"
                className="flex min-h-[52px] cursor-not-allowed items-center justify-center gap-2 rounded-2xl bg-slate-800/50 text-sm font-black text-slate-600"
              >
                <Navigation className="h-5 w-5" />
                Navigate
              </span>
            )}
          </div>
          {!orderInScope && !loading && order && (
            <p className="mt-2 text-xs font-bold text-amber-300">
              This order is outside your assigned/home store scope — map access is restricted.
            </p>
          )}
        </section>

        {/* 3. PRODUCTS SECTION */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Products ({items.length})</p>
          <div className="mt-3 space-y-2">
            {items.map((item, index) => (
              <div key={`${order?.id}-${item.productId || item.id || index}`} className="flex items-center gap-3 rounded-xl bg-slate-800 p-2.5">
                {item.image
                  ? <img src={item.image} alt="" className="h-11 w-11 shrink-0 rounded-lg bg-slate-700 object-contain" />
                  : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-700"><Package className="h-5 w-5 text-emerald-400" /></span>}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-white">{item.name}</p>
                  <p className="text-xs text-slate-400">Qty: {item.quantity} · ₹{item.price} each</p>
                </div>
                <p className="shrink-0 text-sm font-black">₹{Number(item.price || 0) * Number(item.quantity || 0)}</p>
              </div>
            ))}
            {items.length === 0 && <p className="text-sm text-slate-500">No items found.</p>}
          </div>
        </section>

        {/* 4. DELIVERY INSTRUCTIONS */}
        {instructions.length > 0 && (
          <section className="rounded-2xl border border-slate-700 bg-slate-800/60 p-5">
            <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-amber-300">
              <ClipboardList className="h-4 w-4" />Delivery instructions
            </p>
            <ul className="mt-3 space-y-2">
              {instructions.map((value) => {
                const meta = INSTRUCTION_META[value] || {};
                const Icon = meta.icon || Bell;
                return (
                  <li key={value} className="flex items-center gap-2.5 text-sm font-bold text-slate-100">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-700 text-emerald-400">
                      <Icon className="h-4 w-4" />
                    </span>
                    {meta.label || String(value).replace(/_/g, ' ')}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* 6. PAYMENT SECTION */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Payment</p>
          <div className={`mt-3 rounded-2xl border p-4 text-center ${isCOD ? 'border-amber-400/50 bg-amber-400/10' : 'border-emerald-500/40 bg-emerald-500/10'}`}>
            <p className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-base font-black ${isCOD ? 'bg-amber-400 text-slate-950' : 'bg-emerald-500 text-slate-950'}`}>
              <Wallet className="h-4 w-4" />
              {isCOD ? paymentMethod : 'Paid Online'}
            </p>
            {!isCOD && <p className="mt-1.5 text-xs font-bold text-slate-400">{paymentMethod}</p>}
            {isCOD && (
              <p className="mt-2 text-3xl font-black tracking-tight text-amber-300">
                Collect ₹{order?.total_price ?? 0}
              </p>
            )}
          </div>
          <div className="mt-3 space-y-1.5 border-t border-slate-800 pt-3 text-xs text-slate-400">
            {order?.items_price != null && <div className="flex justify-between"><span>Items price</span><span>₹{order.items_price}</span></div>}
            {order?.delivery_fee != null && <div className="flex justify-between"><span>Delivery fee</span><span>₹{order.delivery_fee}</span></div>}
            {Number(order?.coupon_discount || 0) > 0 && <div className="flex justify-between"><span>Discount{order?.coupon_code ? ` (${order.coupon_code})` : ''}</span><span>− ₹{order.coupon_discount}</span></div>}
            {tip > 0 && <div className="flex justify-between text-amber-300"><span>Tip</span><span>+ ₹{tip}</span></div>}
            <div className="flex justify-between border-t border-slate-800 pt-2 text-sm font-black text-white">
              <span>Total Amount</span><span>₹{order?.total_price ?? 0}</span>
            </div>
          </div>
        </section>

        {/* 7. STATUS BUTTONS — sirf agla step enabled */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Delivery status</p>
          <div className="mt-3 flex items-center gap-1">
            {FLOW.map((step, i) => {
              const done = stepIndex >= i && stepIndex !== -1;
              const current = stepIndex === i;
              return (
                <React.Fragment key={step.key}>
                  <div className="flex flex-1 flex-col items-center gap-1">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-black ${done ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-500'}`}>
                      {done && !current ? <Check className="h-4 w-4" /> : i + 1}
                    </span>
                    <span className={`text-center text-[10px] font-bold leading-tight ${done ? 'text-emerald-300' : 'text-slate-500'}`}>{step.label}</span>
                  </div>
                  {i < FLOW.length - 1 && <span className={`mb-5 h-0.5 flex-1 rounded ${stepIndex > i ? 'bg-emerald-500' : 'bg-slate-800'}`} />}
                </React.Fragment>
              );
            })}
          </div>
          <div className="mt-4 space-y-2">
            {statusKey === 'assigned' && (
              <button
                type="button"
                onClick={() => updateStatus('accepted')}
                disabled={updating}
                className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 text-sm font-black text-slate-950 transition hover:bg-emerald-400 active:scale-[0.99] disabled:cursor-wait disabled:opacity-60"
              >
                <Check className="h-5 w-5" /> Accept Order
              </button>
            )}
            {[
              { key: 'picked_up', label: 'Picked Up', icon: Package },
              { key: 'out_for_delivery', label: 'Out for Delivery', icon: Truck },
              { key: 'delivered', label: 'Delivered', icon: Check },
            ].map(({ key, label, icon: Icon }) => {
              const targetIdx = FLOW.findIndex((s) => s.key === key);
              const isNext = stepIndex === targetIdx - 1;
              const isDone = stepIndex >= targetIdx;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => updateStatus(key)}
                  disabled={!isNext || updating}
                  className={`flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl text-sm font-black transition active:scale-[0.99] disabled:cursor-not-allowed ${
                    isNext
                      ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                      : isDone
                        ? 'bg-slate-800 text-emerald-300/70'
                        : 'bg-slate-800/50 text-slate-600'
                  }`}
                >
                  {isDone && !isNext ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                  {updating && isNext ? 'Updating...' : label}
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
};

export default DeliveryOrderDetail;
