import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  Star,
  Truck,
  Wallet,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../config/supabase';
import { isOrderInScope } from './storeScope';
import { triggerDeliveredInvoiceEmail } from '../services/invoice';
import { DeliveryBottomNav } from './DeliveryPocket';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'https://supercart-kloc.onrender.com').replace(/\/+$/, '');

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
// Part A: Accepted -> Picked up -> Out for delivery -> OTP -> Payment -> Delivered
// 'payment' aur 'otp' real DB status nahi hain — ye deliverables ke beech ke
// gate hain (dono tabhi complete hote hain jab payment collected + OTP verified).
const FLOW = [
  { key: 'accepted', label: 'Accepted' },
  { key: 'picked_up', label: 'Picked Up' },
  { key: 'out_for_delivery', label: 'Out for Delivery' },
  { key: 'otp', label: 'OTP' },
  { key: 'payment', label: 'Payment' },
  { key: 'delivered', label: 'Delivered' },
];

const REVIEW_TAG_OPTIONS = [
  { value: 'good_behavior', label: 'Good behavior' },
  { value: 'bad_behavior', label: 'Bad behavior' },
  { value: 'polite', label: 'Polite' },
  { value: 'rude', label: 'Rude' },
  { value: 'wrong_address', label: 'Wrong address' },
  { value: 'payment_issue', label: 'Payment issue' },
  { value: 'other', label: 'Other' },
];

const prettifyStatus = (status) =>
  String(status || 'Placed').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// ---- Slide-to-confirm slider (touch + mouse) ----
// Use is right side tak kheenchna padta hai. Beech me chhodne par wapas
// spring-back hota hai (release pe 0). Complete hone par onConfirm() call.
const ChevronRight = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
);

const SlideToConfirm = ({ onConfirm, disabled, children, busyLabel }) => {
  const trackRef = useRef(null);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [done, setDone] = useState(false);

  const posFromClientX = (clientX) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    const max = rect.width - 56;
    if (max <= 0) return 0;
    const pct = (clientX - rect.left - 28) / max;
    return Math.max(0, Math.min(1, pct));
  };

  const onMove = (clientX) => setProgress(posFromClientX(clientX));

  const onEnd = (clientX) => {
    setDragging(false);
    if (posFromClientX(clientX) >= 0.9 && !disabled) {
      setDone(true);
      setProgress(1);
      onConfirm?.();
      setTimeout(() => { setDone(false); setProgress(0); }, 1000);
    } else {
      setProgress(0);
    }
  };

  const knobLeft = Math.round(progress * 100);

  return (
    <div
      ref={trackRef}
      className={`relative h-[56px] w-full cursor-grab select-none overflow-hidden rounded-2xl transition ${disabled ? 'bg-slate-800/60' : 'bg-slate-800 active:cursor-grabbing'}`}
      style={{ touchAction: 'none' }}
      onTouchStart={(e) => { if (!disabled) { setDragging(true); onMove(e.touches[0].clientX); } }}
      onTouchMove={(e) => { if (dragging) onMove(e.touches[0].clientX); }}
      onTouchEnd={(e) => { if (dragging) onEnd(e.changedTouches[0].clientX); }}
      onMouseDown={(e) => { if (!disabled) { setDragging(true); onMove(e.clientX); } }}
      onMouseMove={(e) => { if (dragging) onMove(e.clientX); }}
      onMouseUp={(e) => { if (dragging) onEnd(e.clientX); }}
      onMouseLeave={() => { if (dragging) { setDragging(false); setProgress(0); } }}
    >
      <div
        className={`absolute inset-y-0 left-0 rounded-2xl ${disabled ? 'bg-slate-700' : 'bg-emerald-500'} ${dragging ? '' : 'transition-[width] duration-150'}`}
        style={{ width: `${knobLeft}%` }}
      />
      <div className={`absolute inset-0 flex items-center justify-center gap-2 text-sm font-black ${disabled ? 'text-slate-500' : 'text-slate-950'}`}>
        {done ? busyLabel || 'Done ✓' : children}
      </div>
      <div
        className={`absolute top-1 flex h-12 w-12 items-center justify-center rounded-xl shadow-lg ${dragging ? '' : 'transition-[left] duration-150'}`}
        style={{ left: `calc(${knobLeft}% - 8px)` }}
      >
        <span className={`flex h-12 w-12 items-center justify-center rounded-xl ${disabled ? 'bg-slate-600 text-slate-400' : 'bg-slate-950 text-emerald-300'}`}>
          <ChevronRight className="h-6 w-6" />
        </span>
      </div>
    </div>
  );
};

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
  const [otpOpen, setOtpOpen] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState('');
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueReason, setIssueReason] = useState('');
  const [issueBusy, setIssueBusy] = useState(false);
  const [issueError, setIssueError] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewTags, setReviewTags] = useState([]);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [reviewSkipped, setReviewSkipped] = useState(false);

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
    const activeStatuses = new Set(['assigned', 'accepted', 'reached_store', 'picked_up', 'reached_customer', 'out_for_delivery']);
    if (data.user_id && activeStatuses.has(String(data.status || '').toLowerCase())) {
      const { data: customerRow } = await supabase
        .from('users')
        .select('id,name,phone')
        .eq('id', data.user_id)
        .maybeSingle();
      if (customerRow) setCustomer(customerRow);
    } else setCustomer(null);
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

  // Part A: advance-step (forward-only) — assigned partner, server-side guard
  const advanceStep = async (target) => {
    if (!order || updating) return;
    setUpdating(true);
    setError('');
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(`${API_BASE_URL}/api/orders/${order.id}/advance-step`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ step: target }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) setError(result?.message || 'Could not update delivery step.');
    else {
      await loadOrder(user.id);
      if (target === 'delivered') triggerDeliveredInvoiceEmail(order.id);
    }
    setUpdating(false);
  };

  // Part A: partner confirms cash collected (amount comes from server total)
  const collectPayment = async () => {
    if (!order || updating) return;
    setUpdating(true);
    setError('');
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(`${API_BASE_URL}/api/orders/${order.id}/collect-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({}),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) setError(result?.message || 'Could not collect payment.');
    else await loadOrder(user.id);
    setUpdating(false);
  };

  const submitOtp = async (event) => {
    event.preventDefault();
    setOtpError('');
    setUpdating(true);
    const { data: { session } } = await supabase.auth.getSession();
    // verify-otp sirf OTP verify karta hai (deliver alag step hai)
    const response = await fetch(`${API_BASE_URL}/api/orders/${order.id}/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ otp }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) setOtpError(result?.message || 'Could not verify OTP.');
    else {
      setOtpOpen(false);
      setOtp('');
      await loadOrder(user.id);
    }
    setUpdating(false);
  };

  // Report issue: picked_up..reached_customer ke beech (return_refund banao)
  const submitIssue = async () => {
    if (!order || issueBusy) return;
    setIssueBusy(true);
    setIssueError('');
    const { data: { session } } = await supabase.auth.getSession();
    try {
      const res = await fetch(`${API_BASE_URL}/api/orders/${order.id}/delivery-issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ reason: issueReason }),
      });
      const result = await res.json().catch(() => null);
      if (!res.ok || !result?.success) {
        setIssueError(result?.message || 'Could not report issue.');
      } else {
        setIssueOpen(false);
        setIssueReason('');
        await loadOrder(user.id);
      }
    } catch {
      setIssueError('Network error. Please try again.');
    } finally {
      setIssueBusy(false);
    }
  };

  const submitReview = async () => {
    if (!order || reviewBusy || reviewRating < 1) return;
    setReviewBusy(true);
    setReviewError('');
    const { data: { session } } = await supabase.auth.getSession();
    try {
      const res = await fetch(`${API_BASE_URL}/api/orders/${order.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ rating: reviewRating, tags: reviewTags, comment: reviewComment.trim() }),
      });
      const result = await res.json().catch(() => null);
      if (!res.ok || !result?.success) {
        setReviewError(result?.message || 'Could not submit review.');
      } else {
        setReviewOpen(false);
        setReviewRating(0);
        setReviewTags([]);
        setReviewComment('');
        try { sessionStorage.setItem(`delivery_review_done_${order.id}`, '1'); } catch { /* ignore */ }
      }
    } catch {
      setReviewError('Network error. Please try again.');
    } finally {
      setReviewBusy(false);
    }
  };

  const skipReview = () => {
    setReviewOpen(false);
    setReviewRating(0);
    setReviewTags([]);
    setReviewComment('');
    setReviewSkipped(true);
    try { sessionStorage.setItem(`delivery_review_done_${order.id}`, '1'); } catch { /* ignore */ }
  };

  // Delivered hote hi review sheet khule (jab tak ek baar submit/skip na ho)
  useEffect(() => {
    if (!order || String(order.status || '').toLowerCase() !== 'delivered') return;
    let done = false;
    try { done = sessionStorage.getItem(`delivery_review_done_${order.id}`) === '1'; } catch { /* ignore */ }
    if (!done && !reviewSkipped) setReviewOpen(true);
  }, [order?.status, order?.id, reviewSkipped]);

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
  const rawStatusKey = String(order?.status || '').toLowerCase();
  // Legacy (purana) statuses ko naye flow me map karo — forward progress safe.
  const LEGACY_MAP = { reached_store: 'accepted', reached_customer: 'out_for_delivery' };
  const statusKey = LEGACY_MAP[rawStatusKey] || rawStatusKey;
  const stepIndex = FLOW.findIndex((s) => s.key === statusKey);
  // Payment / OTP gates (deliver ke liye dono zaroori)
  const paymentCollected =
    !!order?.payment_collected || String(order?.payment_status || '').toLowerCase() === 'paid';
  const otpVerified = !!order?.otp_verified_at;
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
        {(statusKey === 'cancelled' || statusKey === 'return_refund') && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-950/60 p-5 text-center">
            <p className="text-xl font-black text-rose-300">Order cancelled / refund</p>
            <p className="mt-1 text-xs text-slate-400">सामान store वापस ले जाओ।</p>
          </div>
        )}
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
            {isCOD ? (
              paymentCollected ? (
                <p className="mt-2 inline-flex items-center gap-2 text-2xl font-black text-emerald-300">
                  <Check className="h-6 w-6" /> Cash received {order?.collected_amount != null ? `₹${order.collected_amount}` : ''}
                </p>
              ) : (
                <p className="mt-2 text-3xl font-black tracking-tight text-amber-300">
                  Collect ₹{order?.total_price ?? 0}
                </p>
              )
            ) : (
              <p className="mt-2 text-2xl font-black text-emerald-300">Paid online</p>
            )}
          </div>
          {(isCOD && !paymentCollected && ['picked_up', 'out_for_delivery', 'accepted', 'assigned'].includes(statusKey)) && (
            <div className="mt-4">
              <SlideToConfirm onConfirm={collectPayment} disabled={updating} busyLabel="Collecting…">
                <Wallet className="h-5 w-5" /> Slip to confirm cash ₹{order?.total_price ?? 0}
              </SlideToConfirm>
              <p className="mt-2 text-center text-[11px] font-bold text-slate-500">
                Cash tabhi confirm karo jab customer se paisa mil jaye
              </p>
            </div>
          )}
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
              <SlideToConfirm onConfirm={() => advanceStep('accepted')} disabled={updating} busyLabel="Accepting…">
                <Check className="h-5 w-5" /> Slide to Accept Order
              </SlideToConfirm>
            )}
            {statusKey === 'accepted' && (
              <SlideToConfirm onConfirm={() => advanceStep('picked_up')} disabled={updating} busyLabel="Updating…">
                <Package className="h-5 w-5" /> Slide to confirm Picked Up
              </SlideToConfirm>
            )}
            {statusKey === 'picked_up' && (
              <SlideToConfirm onConfirm={() => advanceStep('out_for_delivery')} disabled={updating} busyLabel="Updating…">
                <Truck className="h-5 w-5" /> Slide to start Out for Delivery
              </SlideToConfirm>
            )}
            {statusKey === 'out_for_delivery' && (
              <>
                {!otpVerified && (
                  <button
                    type="button"
                    onClick={() => { setOtpOpen(true); setOtpError(''); }}
                    disabled={updating}
                    className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-slate-800 text-sm font-black text-white transition hover:bg-slate-700 active:scale-[0.99] disabled:cursor-wait disabled:opacity-60"
                  >
                    <ShieldCheck className="h-5 w-5 text-emerald-400" /> Enter Customer OTP
                  </button>
                )}
                {!paymentCollected && isCOD && (
                  <p className="rounded-xl bg-amber-950/40 p-3 text-xs font-bold text-amber-300">
                    Pehle cash bhi collect karo (Slip to confirm cash).
                  </p>
                )}
                {paymentCollected && otpVerified && (
                  <SlideToConfirm onConfirm={() => advanceStep('delivered')} disabled={updating} busyLabel="Delivering…">
                    <Check className="h-5 w-5" /> Slide to Deliver
                  </SlideToConfirm>
                )}
              </>
            )}
            {['picked_up', 'out_for_delivery'].includes(statusKey) && (
              <button
                type="button"
                onClick={() => { setIssueOpen(true); setIssueReason(''); setIssueError(''); }}
                disabled={updating}
                className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl border border-rose-500/50 bg-rose-950/40 text-sm font-black text-rose-300 transition hover:bg-rose-900/40"
              >
                ⚠️ Report issue
              </button>
            )}
          </div>
        </section>
      </div>
      {otpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form onSubmit={submitOtp} className="w-full max-w-sm rounded-3xl border border-slate-700 bg-slate-900 p-6">
            <h2 className="text-xl font-black">Customer delivery OTP</h2>
            <p className="mt-1 text-sm text-slate-400">Ask the customer for the 4-digit OTP.</p>
            <input autoFocus inputMode="numeric" maxLength={4} pattern="\d{4}" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))} className="mt-5 w-full rounded-2xl border border-slate-700 bg-slate-800 p-4 text-center text-3xl font-black tracking-[0.5em] text-white outline-none focus:border-emerald-500" />
            {otpError && <p className="mt-3 rounded-xl bg-rose-950 p-3 text-xs font-bold text-rose-300">{otpError}</p>}
            <div className="mt-5 grid grid-cols-2 gap-2"><button type="button" onClick={() => setOtpOpen(false)} className="rounded-xl bg-slate-800 py-3 text-sm font-black text-slate-300">Cancel</button><button type="submit" disabled={otp.length !== 4 || updating} className="rounded-xl bg-emerald-500 py-3 text-sm font-black text-slate-950 disabled:opacity-50">{updating ? 'Checking...' : 'Verify'}</button></div>
          </form>
        </div>
      )}
      {issueOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-3xl border border-slate-700 bg-slate-900 p-6">
            <h2 className="text-xl font-black">Report an issue</h2>
            <p className="mt-1 text-sm text-slate-400">This will return the order for a refund.</p>
            <div className="mt-5 space-y-2">
              {[
                { value: 'customer_refused', label: 'Customer refused' },
                { value: 'damaged', label: 'Damaged' },
                { value: 'wrong_address', label: 'Wrong address' },
                { value: 'customer_unreachable', label: 'Customer unreachable' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setIssueReason(opt.value)}
                  className={`w-full rounded-xl border px-4 py-3 text-sm font-bold transition ${issueReason === opt.value ? 'border-rose-500 bg-rose-900/40 text-rose-200' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {issueError && <p className="mt-3 rounded-xl bg-rose-950 p-3 text-xs font-bold text-rose-300">{issueError}</p>}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setIssueOpen(false)} disabled={issueBusy} className="rounded-xl bg-slate-800 py-3 text-sm font-black text-slate-300">Cancel</button>
              <button type="button" onClick={submitIssue} disabled={!issueReason || issueBusy} className="rounded-xl bg-rose-500 py-3 text-sm font-black text-slate-950 disabled:opacity-40">
                {issueBusy ? 'Submitting…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
      {reviewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-3xl border border-slate-700 bg-slate-900 p-6">
            <h2 className="text-xl font-black">Rate this customer</h2>
            <div className="mt-4 flex items-center justify-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  aria-label={`Rate ${star} star`}
                  onClick={() => setReviewRating(star)}
                  className="rounded-lg p-1 transition hover:scale-110"
                >
                  <Star className={`h-8 w-8 ${reviewRating >= star ? 'fill-amber-400 text-amber-400' : 'text-slate-600'}`} />
                </button>
              ))}
            </div>
            <p className="mt-2 text-center text-xs font-bold text-slate-400">
              {reviewRating < 1 ? 'Select at least one star to submit' : `${reviewRating} star${reviewRating > 1 ? 's' : ''} selected`}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {REVIEW_TAG_OPTIONS.map((tag) => {
                const active = reviewTags.includes(tag.value);
                return (
                  <button
                    key={tag.value}
                    type="button"
                    onClick={() => setReviewTags((prev) => active ? prev.filter((t) => t !== tag.value) : [...prev, tag.value])}
                    className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${active ? 'border-emerald-400 bg-emerald-500 text-slate-950' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}
                  >
                    {tag.label}
                  </button>
                );
              })}
            </div>
            <textarea
              placeholder="Comment (optional, max 500 chars)"
              maxLength={500}
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value)}
              className="mt-4 w-full rounded-2xl border border-slate-700 bg-slate-800 p-4 text-sm text-white outline-none focus:border-emerald-500"
              rows={3}
            />
            {reviewError && <p className="mt-3 rounded-xl bg-rose-950 p-3 text-xs font-bold text-rose-300">{reviewError}</p>}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={skipReview} disabled={reviewBusy} className="rounded-xl bg-slate-800 py-3 text-sm font-black text-slate-300">Skip</button>
              <button type="button" onClick={submitReview} disabled={reviewRating < 1 || reviewBusy} className="rounded-xl bg-emerald-500 py-3 text-sm font-black text-slate-950 disabled:opacity-40">
                {reviewBusy ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
      <DeliveryBottomNav active="orders" />
    </main>
  );
};

export default DeliveryOrderDetail;
