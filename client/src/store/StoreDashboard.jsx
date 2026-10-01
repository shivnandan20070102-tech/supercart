import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Clock,
  IndianRupee,
  LogOut,
  Mail,
  MapPin,
  Package,
  PackageCheck,
  Phone,
  RefreshCw,
  Store,
  Truck,
  User,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../config/supabase';
import { markOrderPackedApi } from '../services/api';
import { playOrderSound, preloadOrderSound, unlockOrderAudio } from '../utils/orderSound';
import InactivityGuard from '../components/InactivityGuard';

const NEED_PACK_STATUSES = new Set(['placed', 'pending_assignment']);
const CLOSED_STATUSES = new Set(['delivered', 'cancelled']);
const PACKED_STATUSES = new Set(['packed', 'assigned', 'accepted', 'out_for_delivery', 'shipped']);

const statusLower = (s) => String(s || 'placed').toLowerCase();

const prettifyStatus = (status) =>
  String(status || 'Placed').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const isPackable = (order) => {
  const s = statusLower(order.status);
  return s !== 'packed' && !CLOSED_STATUSES.has(s);
};

const formatDateTime = (value) => {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(value);
  }
};

const formatAddress = (addr) => {
  if (!addr || typeof addr !== 'object') return 'Address not available';
  const parts = [
    addr.houseNo ? `${addr.houseNo}` : '',
    addr.address || addr.formattedAddress || addr.label || '',
    addr.landmark ? `Near ${addr.landmark}` : '',
    addr.area,
    addr.city,
    addr.pincode || addr.postalCode,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'Address not available';
};

const normalizeItems = (order) => {
  const raw = order.order_items || order.orderItems || order.items || [];
  if (!Array.isArray(raw)) return [];
  return raw.map((it) => ({
    name: it.name || 'Item',
    quantity: Number(it.quantity ?? it.qty ?? 1) || 1,
    price: Number(it.price ?? 0) || 0,
    unit: it.unit || '',
    // Product image: order item me stored URL prefer karo (Cart checkout par
    // image + productId save hota hai). Na ho to productId se products table
    // se resolve hota hai (productImageById map, neeche).
    image: it.image || it.imageUrl || it.img || '',
    productId: it.productId ?? it.product_id ?? it.id ?? null,
  }));
};

// Haversine distance (km) — rider-to-store display ke liye (client copy)
const haversineKm = (lat1, lon1, lat2, lon2) => {
  const nums = [lat1, lon1, lat2, lon2].map(Number);
  if (nums.some((v) => !Number.isFinite(v))) return null;
  const R = 6371;
  const dLat = ((nums[2] - nums[0]) * Math.PI) / 180;
  const dLon = ((nums[3] - nums[1]) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);
  const h = s1 * s1 + Math.cos((nums[0] * Math.PI) / 180) * Math.cos((nums[2] * Math.PI) / 180) * s2 * s2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const numOrNull = (v) => {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return null;
};

const statusBadgeCls = (status) => {
  const s = statusLower(status);
  if (NEED_PACK_STATUSES.has(s)) return 'bg-amber-400 text-slate-950';
  if (s === 'packed') return 'bg-sky-400 text-slate-950';
  if (['assigned', 'accepted', 'out_for_delivery', 'shipped'].includes(s)) return 'bg-violet-400 text-slate-950';
  if (s === 'delivered') return 'bg-emerald-500 text-slate-950';
  if (CLOSED_STATUSES.has(s)) return 'bg-slate-600 text-slate-200';
  return 'bg-slate-600 text-slate-200';
};

// ---- Summary strip helpers (Aaj ke orders — local date key) ----
const dayKey = (iso) => {
  try {
    return new Date(iso).toLocaleDateString('en-CA');
  } catch {
    return '';
  }
};
const todayKey = () => new Date().toLocaleDateString('en-CA');

// ---- Store timing helpers (Admin-set Opening/Closing Time) ----
// Supabase TIME "HH:MM:SS" ya "HH:MM" dono chalenge. NULL/'' = timing set nahi.
const parseTimeToMinutes = (t) => {
  if (t == null || t === '') return null;
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
};

// nowMinutes: 0..1439 (local device time). Overnight range (22:00-06:00) supported.
const isStoreOpenAt = (opening, closing, nowMinutes) => {
  const open = parseTimeToMinutes(opening);
  const close = parseTimeToMinutes(closing);
  if (open == null || close == null) return null; // timing set nahi
  if (open === close) return true; // 24 ghante khula
  if (open < close) return nowMinutes >= open && nowMinutes < close;
  return nowMinutes >= open || nowMinutes < close; // raat-bhar
};

// "09:00:00" -> "09:00" display ke liye
const formatTimeShort = (t) => {
  if (t == null || t === '') return '';
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return String(t);
  return `${m[1].padStart(2, '0')}:${m[2]}`;
};

const StoreDashboard = () => {
  const navigate = useNavigate();
  const [manager, setManager] = useState(null);
  const [stores, setStores] = useState([]);
  const [orders, setOrders] = useState([]);
  const [customersById, setCustomersById] = useState(new Map());
  const [partnersById, setPartnersById] = useState(new Map());
  const [productImageById, setProductImageById] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [tab, setTab] = useState('new'); // new | packed | all
  const [packingId, setPackingId] = useState(null);
  const [showProfile, setShowProfile] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const toastTimerRef = useRef(null);

  const storeIds = useMemo(() => stores.map((s) => s.id), [stores]);

  const showToast = useCallback((message) => {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(''), 4500);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  // Apne store(s) ke orders + customer/partner naam ek saath
  const loadOrders = useCallback(async (ids) => {
    if (!ids || ids.length === 0) {
      setOrders([]);
      return;
    }
    const { data, error: ordersError } = await supabase
      .from('orders')
      .select('*')
      .in('store_id', ids)
      .order('created_at', { ascending: false })
      .limit(100);
    if (ordersError) throw ordersError;

    const rows = data || [];
    const userIds = [...new Set(rows.map((o) => o.user_id).filter(Boolean))];
    const partnerIds = [...new Set(rows.map((o) => o.delivery_boy_id).filter(Boolean).map(String))];
    const allIds = [...new Set([...userIds, ...partnerIds])];
    if (allIds.length > 0) {
      // Partner distance display ke liye live location bhi lao (columns na
      // bane hon to query fail hogi — tab bina location ke retry karo).
      let users = null;
      try {
        const res = await supabase.from('users').select('id,name,phone,current_lat,current_lng').in('id', allIds);
        if (res.error) throw res.error;
        users = res.data;
      } catch {
        const res = await supabase.from('users').select('id,name,phone').in('id', allIds);
        users = res.data;
      }
      const custMap = new Map();
      const partMap = new Map();
      for (const u of users || []) {
        if (userIds.includes(u.id)) custMap.set(u.id, u);
        if (partnerIds.includes(String(u.id))) partMap.set(String(u.id), u);
      }
      setCustomersById(custMap);
      setPartnersById(partMap);
    }
    // Item images: jin order items me image URL nahi hai, unke productId se
    // products table se actual image resolve karo (placeholder nahi).
    try {
      const missingIds = new Set();
      for (const o of rows) {
        for (const it of normalizeItems(o)) {
          if (!it.image && it.productId != null && String(it.productId).trim() !== '' && !Number.isNaN(Number(it.productId))) {
            missingIds.add(Number(it.productId));
          }
        }
      }
      if (missingIds.size > 0) {
        const { data: prods } = await supabase.from('products').select('id,image').in('id', [...missingIds]);
        const imgMap = new Map();
        for (const p of prods || []) {
          if (p?.image) imgMap.set(Number(p.id), p.image);
        }
        setProductImageById(imgMap);
      } else {
        setProductImageById(new Map());
      }
    } catch {
      /* image resolve fail ho to existing fallback UI rahega */
    }
    setOrders(rows);
  }, []);

  // Init: role check -> store_staff link -> stores -> orders
  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
          navigate('/store/login', { replace: true });
          return;
        }
        // My Profile ke liye naam + email (+phone) bhi lao. Purani users table
        // me email column na ho to auth email fallback rahega.
        let profile = null;
        try {
          const res = await supabase.from('users').select('role,name,email,phone').eq('id', user.id).maybeSingle();
          profile = res.data;
        } catch {
          const res = await supabase.from('users').select('role,name').eq('id', user.id).maybeSingle();
          profile = res.data;
        }
        if (String(profile?.role || '').toLowerCase() !== 'store_manager') {
          navigate('/store/login', { replace: true });
          return;
        }
        if (mounted) {
          setManager({
            id: user.id,
            name: profile?.name || 'Store Manager',
            email: profile?.email || user.email || '',
            phone: profile?.phone || '',
          });
        }

        const { data: links, error: linkError } = await supabase
          .from('store_staff')
          .select('store_id')
          .eq('user_id', user.id);
        if (linkError) throw new Error('store_staff table not found. Run server/supabase_multi_store.sql in Supabase.');
        const ids = [...new Set((links || []).map((r) => Number(r.store_id)).filter((n) => !Number.isNaN(n)))];
        if (ids.length === 0) {
          if (mounted) {
            setError('You are not linked to any store. Ask the admin to assign a store (store_staff table).');
            setLoading(false);
          }
          return;
        }

        const { data: storeRows } = await supabase.from('stores').select('*').in('id', ids);
        if (mounted) setStores(storeRows || ids.map((id) => ({ id })));

        await loadOrders(ids);
        if (mounted) setLoading(false);
      } catch (e) {
        if (mounted) {
          setError(e.message || 'Could not load orders.');
          setLoading(false);
        }
      }
    };
    init();
    return () => {
      mounted = false;
    };
  }, [loadOrders, navigate]);

  // Order sound: file pehle se preload + pehle click par autoplay unlock.
  // Bina iske Chrome pehla sound "NotAllowedError" se block kar deta hai
  // aur popup silent khulta hai.
  useEffect(() => {
    preloadOrderSound();
    window.addEventListener('pointerdown', unlockOrderAudio, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlockOrderAudio);
    };
  }, []);

  // Store timing banner ke liye clock — har 30 sec me re-check taaki
  // Opening/Closing Time cross hote hi banner apne-aap update ho jaye.
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);

  // Realtime: apne store(s) ka naya/updated order turant list me
  useEffect(() => {
    if (storeIds.length === 0) return undefined;
    const filter = storeIds.length === 1 ? `store_id=eq.${storeIds[0]}` : `store_id=in.(${storeIds.join(',')})`;
    const channel = supabase
      .channel(`store-orders-${storeIds.join('-')}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter }, async (payload) => {
        if (payload.eventType === 'INSERT') {
          // Popup/toast ke SAATH sound — ye line missing thi, isliye
          // popup dikhta tha par awaz nahi bajti thi.
          playOrderSound();
          showToast(`New order received! #${payload.new?.id}`);
        }
        try {
          await loadOrders(storeIds);
        } catch (e) {
          setError(e.message || 'Refresh failed.');
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [storeIds, loadOrders, showToast]);

  const handlePack = async (order) => {
    if (packingId) return;
    setPackingId(order.id);
    setError('');
    try {
      const res = await markOrderPackedApi(order.id);
      if (!res.success) throw new Error(res.message || 'Could not mark as packed.');
      showToast(res.assigned ? `Order #${order.id} packed ✅ — partner assigned 🎉` : `Order #${order.id} packed ✅ — partner pending`);
      await loadOrders(storeIds);
    } catch (e) {
      const raw = e.message || '';
      // Network tab + Console me EXACT error log karo taaki debug me
      // "Failed to fetch" ke peeche ki wajah (server down? galat URL?
      // offline? RLS?) turant pata chale. UI me user-friendly text rahega.
      console.error(`[StorePanel] Mark as Packed fail (order #${order.id}):`, e);
      // Dono paths fail (backend down + direct save fail, e.g. device offline):
      // raw TypeError ke bajaye samajh-aane wala message dikhao.
      const friendly = /failed to fetch|networkerror|load failed/i.test(raw)
        ? 'Could not connect to the backend server and direct save also failed. Check your internet/server and try again. (Tip: make sure `npm run dev` is running in server/; check VITE_API_BASE_URL in client/.env. The exact error is logged in the Console/Network tab.)'
        : raw || 'Could not mark as packed. Check that the backend server is running.';
      setError(friendly);
    } finally {
      setPackingId(null);
    }
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      /* ignore */
    }
    try {
      localStorage.removeItem('supercart_user');
      localStorage.removeItem('supercart_token');
    } catch {
      /* ignore */
    }
    navigate('/store/login', { replace: true });
  };

  const visibleOrders = useMemo(() => {
    if (tab === 'new') return orders.filter((o) => NEED_PACK_STATUSES.has(statusLower(o.status)));
    if (tab === 'packed') return orders.filter((o) => PACKED_STATUSES.has(statusLower(o.status)));
    return orders;
  }, [orders, tab]);

  const newCount = orders.filter((o) => NEED_PACK_STATUSES.has(statusLower(o.status))).length;

  // ---- 1. Summary strip: Supabase realtime orders se live counts ----
  // orders state realtime subscription (INSERT/UPDATE) par refresh hota hai,
  // isliye ye counts bhi real-time hain — alag polling ki zaroorat nahi.
  const summary = useMemo(() => {
    const tk = todayKey();
    let today = 0;
    let pending = 0;
    let packed = 0;
    for (const o of orders) {
      if (dayKey(o?.created_at) === tk) today += 1;
      const s = statusLower(o?.status);
      if (NEED_PACK_STATUSES.has(s)) pending += 1;
      if (s === 'packed') packed += 1;
    }
    return { today, pending, packed };
  }, [orders]);

  // ---- 3. Store timing banner: Opening/Closing Time (Admin-set) ----
  // Sirf informational — orders phir bhi dikhte rahenge, koi blocking nahi.
  // nowTick har 30 sec update hota hai taaki banner time cross par refresh ho.
  const timingInfo = useMemo(() => {
    void nowTick;
    const d = new Date();
    const nowMinutes = d.getHours() * 60 + d.getMinutes();
    const timed = (stores || [])
      .map((s) => {
        const hasTiming = parseTimeToMinutes(s?.opening_time) != null && parseTimeToMinutes(s?.closing_time) != null;
        if (!hasTiming) return null;
        return {
          id: s.id,
          name: s.store_name || `Store #${s.id}`,
          opening: s.opening_time,
          closing: s.closing_time,
          open: isStoreOpenAt(s.opening_time, s.closing_time, nowMinutes),
        };
      })
      .filter(Boolean);
    const closed = timed.filter((t) => t.open === false);
    return { timed, closed };
  }, [stores, nowTick]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-emerald-300">
        <div className="text-sm font-semibold tracking-[0.2em] uppercase">Loading store orders...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 pb-24 text-white">
      <InactivityGuard loginPath="/store/login" />
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500 text-slate-950">
              <Store className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1
                className="truncate text-base font-black leading-tight"
                title={stores.length > 0 ? stores.map((s) => s.store_name || `Store #${s.id}`).join(' • ') : 'Store Panel'}
              >
                {stores.length > 0 ? stores.map((s) => s.store_name || `Store #${s.id}`).join(' • ') : 'Store Panel'}
              </h1>
              {/* Store ka exact location/address — sirf dekhne ke liye (read-only).
                  Store Manager yahan se address change NAHI kar sakta — location
                  sirf ADMIN panel se set/edit hoti hai. */}
              {stores.length > 0 && (
                <p
                  className="mt-0.5 flex items-start gap-1 text-[11px] leading-snug text-slate-300"
                  title={
                    stores
                      .map((s) => `${s.store_name || `Store #${s.id}`}: ${s.address || 'Address not available'}${s.latitude != null && s.longitude != null ? ` (${s.latitude}, ${s.longitude})` : ''}`)
                      .join(' | ')
                  }
                >
                  <MapPin className="mt-[1px] h-3 w-3 shrink-0 text-emerald-400" />
                  <span className="line-clamp-2">
                    {stores.length === 1
                      ? stores[0].address || 'Address not available'
                      : stores.map((s) => `${s.store_name || `#${s.id}`}: ${s.address || 'Address not available'}`).join(' • ')}
                  </span>
                </p>
              )}
              <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-400">
                <User className="h-3 w-3 shrink-0" />
                <span className="truncate">{manager?.name || 'Store Manager'}</span>
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* My Profile toggle — naam/email/store read-only dekhne ke liye */}
            <button
              type="button"
              onClick={() => setShowProfile((v) => !v)}
              aria-label="My Profile"
              aria-expanded={showProfile}
              title="My Profile"
              className={`flex h-11 items-center gap-1.5 rounded-xl px-3 text-xs font-black transition ${
                showProfile ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              <User className="h-5 w-5" />
              <span className="hidden sm:inline">Profile</span>
              <ChevronDown className={`h-3.5 w-3.5 transition ${showProfile ? 'rotate-180' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => loadOrders(storeIds)}
              aria-label="Refresh orders"
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-800 text-slate-200 transition hover:bg-slate-700"
            >
              <RefreshCw className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Logout"
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-800 text-rose-300 transition hover:bg-slate-700"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
        {/* Tabs */}
        <div className="mx-auto flex max-w-5xl gap-2 px-4 pb-3">
          {[
            { id: 'new', label: `To Pack (${newCount})` },
            { id: 'packed', label: 'Packed & Beyond' },
            { id: 'all', label: `All (${orders.length})` },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={`min-h-[40px] flex-1 rounded-xl text-xs font-black transition ${
                tab === t.id ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pt-4">
        {/* ---- 3. Store band banner (sirf informational — orders neeche phir bhi dikhenge) ---- */}
        {timingInfo.closed.length > 0 && (
          <div role="status" className="mb-3 rounded-2xl border border-amber-500/50 bg-amber-950 px-4 py-3 text-sm text-amber-200">
            <p className="flex items-center gap-2 font-black">
              <Clock className="h-4 w-4 shrink-0" />
              {timingInfo.closed.length === 1
                ? `Store is closed — ${timingInfo.closed[0].name}`
                : `${timingInfo.closed.length} stores are closed`}
            </p>
            <ul className="mt-1.5 space-y-0.5 text-xs font-semibold text-amber-200/90">
              {timingInfo.closed.map((t) => (
                <li key={t.id}>
                  {t.name}: {formatTimeShort(t.opening)} – {formatTimeShort(t.closing)} (currently closed)
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11px] text-amber-200/70">
              Orders will still appear below — this is only a timing notice. Timing is set by the admin.
            </p>
          </div>
        )}

        {/* ---- 1. Summary strip (Supabase realtime counts) ---- */}
        <section aria-label="Today's summary" className="mb-3 grid grid-cols-3 gap-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 px-2 py-3 text-center">
            <p className="text-xl font-black text-white">{summary.today}</p>
            <p className="mt-0.5 text-[10px] font-black uppercase tracking-wide text-slate-400">Today's Orders</p>
          </div>
          <div className="rounded-2xl border border-amber-500/30 bg-slate-900 px-2 py-3 text-center">
            <p className="text-xl font-black text-amber-300">{summary.pending}</p>
            <p className="mt-0.5 text-[10px] font-black uppercase tracking-wide text-slate-400">Pending</p>
          </div>
          <div className="rounded-2xl border border-sky-500/30 bg-slate-900 px-2 py-3 text-center">
            <p className="text-xl font-black text-sky-300">{summary.packed}</p>
            <p className="mt-0.5 text-[10px] font-black uppercase tracking-wide text-slate-400">Packed</p>
          </div>
        </section>

        {/* ---- 2. My Profile (read-only — edit sirf Admin karta hai) ---- */}
        {showProfile && (
          <section aria-label="My Profile" className="mb-3 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
            <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
              <User className="h-4 w-4 text-emerald-400" />
              <h2 className="text-sm font-black">My Profile</h2>
              <span className="ml-auto rounded-full bg-slate-800 px-2.5 py-1 text-[10px] font-bold text-slate-400">
                View only — admin can edit
              </span>
            </div>
            <div className="space-y-3 px-4 py-4 text-sm">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Name</p>
                <p className="mt-0.5 font-bold text-white">{manager?.name || '—'}</p>
              </div>
              <div>
                <p className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-slate-500">
                  <Mail className="h-3 w-3" /> Email
                </p>
                <p className="mt-0.5 font-bold text-white">{manager?.email || '—'}</p>
              </div>
              {manager?.phone ? (
                <div>
                  <p className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-slate-500">
                    <Phone className="h-3 w-3" /> Phone
                  </p>
                  <p className="mt-0.5 font-bold text-white">{manager.phone}</p>
                </div>
              ) : null}
              <div className="border-t border-slate-800 pt-3">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                  My Store{stores.length > 1 ? 's' : ''} ({stores.length})
                </p>
                {stores.length === 0 ? (
                  <p className="mt-1 text-xs text-slate-400">No linked store.</p>
                ) : (
                  <ul className="mt-1.5 space-y-2">
                    {stores.map((s) => (
                      <li key={s.id} className="rounded-xl bg-slate-800/70 p-3">
                        <p className="font-black text-emerald-300">{s.store_name || `Store #${s.id}`}</p>
                        <p className="mt-0.5 flex items-start gap-1 text-xs leading-relaxed text-slate-300">
                          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                          {s.address || 'Address not available'}
                        </p>
                        {(s.opening_time || s.closing_time) && parseTimeToMinutes(s.opening_time) != null && parseTimeToMinutes(s.closing_time) != null ? (
                          <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-slate-400">
                            <Clock className="h-3 w-3" />
                            Timing: {formatTimeShort(s.opening_time)} – {formatTimeShort(s.closing_time)}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-[11px] text-slate-500">
                  Contact the admin to change your name or store details.
                </p>
              </div>
            </div>
          </section>
        )}

        {toast && (
          <div role="status" className="mb-3 rounded-2xl border border-emerald-500/40 bg-emerald-950 px-4 py-3 text-sm font-bold text-emerald-300">
            {toast}
          </div>
        )}
        {error && (
          <div role="alert" className="mb-3 rounded-2xl border border-rose-500/40 bg-rose-950 px-4 py-3 text-sm font-bold text-rose-300">
            {error}
          </div>
        )}

        {visibleOrders.length === 0 ? (
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-12 text-center">
            <Package className="mx-auto h-12 w-12 text-slate-600" />
            <h2 className="mt-4 text-lg font-black">
              {tab === 'new' ? 'No orders to pack 🎉' : 'No orders found'}
            </h2>
            <p className="mt-1 text-xs text-slate-400">New orders will appear here instantly.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {visibleOrders.map((order) => {
              const customer = customersById.get(order.user_id);
              const partner = order.delivery_boy_id ? partnersById.get(String(order.delivery_boy_id)) : null;
              const partnerName = order.delivery_boy_id
                ? partner?.name || `Partner ${String(order.delivery_boy_id).slice(0, 8)}`
                : null;
              const partnerPhone = partner?.phone || '';
              const items = normalizeItems(order).map((it) => ({
                ...it,
                image: it.image || (it.productId != null && !Number.isNaN(Number(it.productId)) ? productImageById.get(Number(it.productId)) || '' : ''),
              }));
              const packable = isPackable(order);
              const packing = packingId === order.id;
              const waitingForRider = statusLower(order.status) === 'packed' && !order.delivery_boy_id;
              // Rider-to-store distance (optional display — data ho tabhi)
              const storeRow = order.store_id != null ? stores.find((s) => Number(s.id) === Number(order.store_id)) : stores[0];
              const riderKm = (() => {
                if (!partner) return null;
                const rLat = numOrNull(partner.current_lat);
                const rLng = numOrNull(partner.current_lng);
                const sLat = numOrNull(storeRow?.latitude);
                const sLng = numOrNull(storeRow?.longitude);
                if (rLat == null || rLng == null || sLat == null || sLng == null) return null;
                return haversineKm(sLat, sLng, rLat, rLng);
              })();
              return (
                <article key={order.id} className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900">
                  {/* Top row */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-black">Order #{order.id}</span>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${statusBadgeCls(order.status)}`}>
                        {prettifyStatus(order.status)}
                      </span>
                    </div>
                    <span className="flex items-center gap-1 text-[11px] text-slate-400">
                      <Clock className="h-3.5 w-3.5" /> {formatDateTime(order.created_at)}
                    </span>
                  </div>

                  <div className="space-y-3 px-4 py-4">
                    {/* Customer */}
                    <div className="flex items-start gap-2.5 text-sm">
                      <User className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      <div>
                        <p className="font-bold">{customer?.name || 'Customer'}</p>
                        {customer?.phone && (
                          <p className="flex items-center gap-1 text-xs text-slate-400">
                            <Phone className="h-3 w-3" /> {customer.phone}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-start gap-2.5 text-sm">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      <p className="text-xs leading-relaxed text-slate-300">{formatAddress(order.shipping_address)}</p>
                    </div>

                    {/* Items */}
                    <div className="rounded-2xl bg-slate-800/70 p-3">
                      <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-slate-400">
                        Items ({items.reduce((n, it) => n + it.quantity, 0)})
                      </p>
                      <ul className="divide-y divide-slate-700/60">
                        {items.map((it, idx) => (
                          <li key={idx} className="flex items-center gap-2.5 py-1.5 text-xs">
                            {it.image ? (
                              <img
                                src={it.image}
                                alt=""
                                loading="lazy"
                                className="h-10 w-10 shrink-0 rounded-lg bg-slate-700 object-cover"
                                onError={(e) => { try { e.currentTarget.style.display = 'none'; } catch { /* ignore */ } }}
                              />
                            ) : (
                              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-700">
                                <Package className="h-4 w-4 text-emerald-400" />
                              </span>
                            )}
                            <span className="min-w-0 flex-1 truncate font-semibold text-slate-200">
                              {it.name} {it.unit && <span className="font-normal text-slate-500">({it.unit})</span>}
                            </span>
                            <span className="shrink-0 font-black text-slate-100">× {it.quantity}</span>
                            <span className="w-16 shrink-0 text-right font-bold text-slate-300">₹{it.price * it.quantity}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2 flex items-center justify-between border-t border-slate-700/60 pt-2 text-xs font-black">
                        <span className="flex items-center gap-1 text-slate-300">
                          <IndianRupee className="h-3.5 w-3.5" /> Total ({order.payment_method || 'COD'})
                        </span>
                        <span className="text-base text-emerald-300">₹{order.total_price ?? 0}</span>
                      </div>
                    </div>

                    {/* Partner — realtime accept par turant update hota hai */}
                    <div className="rounded-2xl border border-slate-700/60 bg-slate-800/50 p-3 text-xs">
                      <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400">
                        <Truck className="h-4 w-4 shrink-0 text-slate-400" />
                        Delivery Partner Assigned
                      </p>
                      {partnerName ? (
                        <div className="mt-1.5 space-y-0.5">
                          <p className="text-sm font-black text-violet-300">{partnerName}</p>
                          {partnerPhone && (
                            <p className="flex items-center gap-1 font-bold text-slate-300">
                              <Phone className="h-3 w-3 text-emerald-400" /> {partnerPhone}
                            </p>
                          )}
                          <p className="font-semibold text-slate-400">
                            Status: <span className="font-black text-emerald-300">{prettifyStatus(order.status)}</span>
                            {riderKm != null && (
                              <span className="font-bold text-slate-500"> · ~{riderKm < 1 ? `${Math.round(riderKm * 1000)} m` : `${riderKm.toFixed(1)} km`} from store</span>
                            )}
                          </p>
                        </div>
                      ) : waitingForRider ? (
                        <p className="mt-1.5 animate-pulse font-black text-amber-300">⌛ Waiting for delivery partner — will auto-assign when a free rider is available</p>
                      ) : (
                        <p className="mt-1.5 font-semibold text-slate-500">Rider not assigned yet</p>
                      )}
                    </div>

                    {/* Pack button */}
                    {packable ? (
                      <button
                        type="button"
                        onClick={() => handlePack(order)}
                        disabled={packing}
                        className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 text-sm font-black text-slate-950 transition hover:bg-emerald-400 active:scale-[0.99] disabled:cursor-wait disabled:opacity-60"
                      >
                        <PackageCheck className="h-5 w-5" />
                        {packing ? 'Packing...' : 'Mark as Packed'}
                      </button>
                    ) : (
                      <div className="flex items-center justify-center gap-2 rounded-2xl bg-slate-800 py-3 text-xs font-black text-slate-400">
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        {CLOSED_STATUSES.has(statusLower(order.status)) ? prettifyStatus(order.status) : 'Already packed'}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default StoreDashboard;
