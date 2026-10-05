import React, { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, BriefcaseBusiness, Check, CircleHelp, ClipboardList, DoorOpen, Loader2, Mailbox, MapPin, Package, PawPrint, Phone, PhoneOff, ShieldCheck, Siren, Store, Truck, Wallet } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../config/supabase';
import { getAssignedStoreIds, shouldShareLiveLocation } from './storeScope';
import { getDeliverySirenState, preloadDeliverySiren, resumeDeliverySiren, startDeliverySiren, stopDeliverySiren, unlockAllOrderAudio } from '../utils/orderSound';
import { SignedDocImage } from '../components/SignedDoc';

// Map library भारी hai (~2MB) — sirf Delivery page par lazy load ho
const DeliveryMap = React.lazy(() => import('./DeliveryMap'));

// Checkout wale delivery-instruction values ka label + icon map
const INSTRUCTION_META = {
  leave_with_guard: { label: 'Leave with guard', icon: ShieldCheck },
  leave_at_door: { label: 'Leave at door', icon: DoorOpen },
  dont_ring_bell: { label: "Don't ring the bell", icon: BellOff },
  avoid_calling: { label: 'Avoid calling', icon: PhoneOff },
  pet_at_home: { label: 'Pet at home', icon: PawPrint },
  leave_in_mailbox: { label: 'Leave in mailbox', icon: Mailbox },
};

const prettifyInstruction = (value) =>
  String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const prettifyStatus = (status) =>
  String(status || 'Placed').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const normalizeInstructions = (value) => {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim()).filter(Boolean);
    } catch { /* plain string nahi, single value samjho */ }
    return [value.trim()];
  }
  return [];
};

const deliveryRoles = ['delivery_partner', 'delivery'];

// Siren "suna hua" registry — kaunsa assignment popup is device par pehle
// khul chuka hai. Phone pocket/screen-off me assignment miss ho jaye to agli
// baar app khulne par boot backlog SILENT khulta tha (alert=false) — isliye
// kabhi sound nahi bajta tha. Registry se pata chalta hai kaunsa backlog
// genuinely UNHEARD hai (wahi ek baar RING karega), pehle suna hua backlog
// purani tarah silent rahega (repeat noise nahi).
const SIREN_SEEN_KEY = 'delivery_siren_seen_v1';
const readSirenSeenRegistry = () => {
  try {
    const raw = localStorage.getItem(SIREN_SEEN_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set((Array.isArray(arr) ? arr : []).map((v) => String(v)));
  } catch {
    return new Set();
  }
};
const writeSirenSeenRegistry = (set) => {
  try {
    localStorage.setItem(SIREN_SEEN_KEY, JSON.stringify([...set].slice(-100)));
  } catch {
    /* private mode — memory seen hi kaafi hai */
  }
};

// Naya order aane par Accept popup ka jawab dene ka samay
const ACCEPT_WINDOW_MS = 10000;

/**
 * NewOrderPopup — naya "assigned" order aate hi khulne wala SIMPLE popup.
 * Sirf: Order number, customer naam, ek-line address, 10-sec countdown ring,
 * poori-width Accept button + Reject button. Items/price/instructions/tip
 * YAHAN NAHI — wo Accept ke baad wale detailed card me dikhte hain.
 *
 * Siren: `alert` true ho (genuinely NAYA assignment) to mount par continuous
 * siren start, unmount par stop. Purane orders (initial load) `alert=false`
 * ke saath khulte hain — bina siren.
 */
const NewOrderPopup = ({ orderNumber, customerName, addressLine, busy, alert, acceptLabel, rejectLabel, newOrderLabel, secondsRemainingLabel, respondFastLabel, onAccept, onReject, onTimeout }) => {
  const [remaining, setRemaining] = React.useState(ACCEPT_WINDOW_MS);
  const [sirenState, setSirenState] = React.useState('stopped');
  const onTimeoutRef = React.useRef(onTimeout);
  onTimeoutRef.current = onTimeout;
  const firedRef = React.useRef(false);

  // Siren lifecycle: popup khula (naya assignment, alert=true) -> turant AUTO
  // start, poore acceptance window tak loop (file ~10s + loop backup), band
  // (Accept/Reject/Timeout/close) -> immediate stop. Same order dobara no-op.
  // countdown effect se alag rakha hai taaki timer logic untouched rahe.
  // FULLY AUTOMATIC: browser ne pehli try block ki to har 1.2s me KHUD retry
  // hota hai (koi button/tap nahi chahiye) + koi bhi tap/safari-restore par
  // global gesture listener khud resume karta hai. Tab visible hote hi resume.
  React.useEffect(() => {
    if (!alert) {
      setSirenState('stopped');
      return () => stopDeliverySiren();
    }
    try {
      console.info(`[deliverySiren] popup mount order=${orderNumber} alert=${alert} — auto-start`);
    } catch { /* ignore */ }
    startDeliverySiren(orderNumber);
    setSirenState(getDeliverySirenState());
    const t1 = window.setTimeout(() => setSirenState(getDeliverySirenState()), 400);
    const t2 = window.setTimeout(() => setSirenState(getDeliverySirenState()), 1200);
    // Auto-retry loop: playing nahi hai to khud resume — popup khula rahe
    // tab tak har 1.2s me (policy allow hote hi awaz shuru, bina tap ke).
    const retry = window.setInterval(() => {
      try {
        if (getDeliverySirenState() !== 'playing') resumeDeliverySiren();
        setSirenState(getDeliverySirenState());
      } catch { /* ignore */ }
    }, 1200);
    const onVis = () => {
      try {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
          if (getDeliverySirenState() !== 'playing') resumeDeliverySiren();
          setSirenState(getDeliverySirenState());
        }
      } catch { /* ignore */ }
    };
    try {
      document.addEventListener('visibilitychange', onVis);
    } catch { /* ignore */ }
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearInterval(retry);
      try {
        document.removeEventListener('visibilitychange', onVis);
      } catch { /* ignore */ }
      stopDeliverySiren();
    };
  }, [orderNumber, alert]);

  React.useEffect(() => {
    firedRef.current = false;
    setRemaining(ACCEPT_WINDOW_MS);
    const deadline = Date.now() + ACCEPT_WINDOW_MS;
    const timer = window.setInterval(() => {
      const left = deadline - Date.now();
      if (left <= 0) {
        window.clearInterval(timer);
        setRemaining(0);
        if (!firedRef.current) {
          firedRef.current = true;
          onTimeoutRef.current?.();
        }
      } else {
        setRemaining(left);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [orderNumber]);

  const secs = Math.max(0, Math.ceil(remaining / 1000));
  const R = 30;
  const CIRC = 2 * Math.PI * R;
  const progress = Math.max(0, Math.min(1, remaining / ACCEPT_WINDOW_MS));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={`New order ${orderNumber}`}>
      <div className="qc-sheet-up w-full max-w-md rounded-t-3xl border border-amber-400/40 bg-slate-900 p-6 text-white shadow-2xl sm:rounded-3xl">
        <p className="mx-auto w-fit animate-pulse rounded-full bg-amber-400 px-4 py-1 text-xs font-black uppercase tracking-wider text-slate-950">
          {respondFastLabel}
        </p>
        <h2 className="mt-3 text-center text-2xl font-black tracking-tight">Order #{orderNumber}</h2>
        <p className="mt-1 text-center text-sm font-black uppercase tracking-widest text-red-400">{newOrderLabel}</p>
        <p className="mt-1 text-center text-sm font-bold text-slate-200">{customerName}</p>
        <p className="mt-1 flex items-center justify-center gap-1 truncate text-center text-xs text-slate-400">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
          <span className="truncate">{addressLine}</span>
        </p>

        <div className="relative mx-auto mt-5 h-20 w-20">
          <svg viewBox="0 0 72 72" className="h-20 w-20 -rotate-90">
            <circle cx="36" cy="36" r={R} fill="none" stroke="#1e293b" strokeWidth="7" />
            <circle
              cx="36"
              cy="36"
              r={R}
              fill="none"
              stroke="#fbbf24"
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - progress)}
              style={{ transition: 'stroke-dashoffset 100ms linear' }}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-xl font-black tabular-nums">{secs}</span>
        </div>
        <p role="status" aria-live="polite" className="mt-2 text-center text-sm font-black tabular-nums text-amber-300">
          {secs} {secondsRemainingLabel}
        </p>
        {/* Siren status: baj raha ho to halka indicator. Sound FULLY automatic
            hai — popup khulte hi khud start, auto-retry ke saath. Koi button
            dabane ki zaroorat nahi. */}
        {alert && sirenState === 'playing' && (
          <p aria-live="polite" className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs font-black uppercase tracking-widest text-emerald-300">
            <span aria-hidden className="animate-ping">🔊</span>
            Siren playing — new order arrived
          </p>
        )}
        {/* Browser ne autoplay block kiya to ye dikhega — is button par TAP
            gesture ke andar resume hota hai, isliye 100% bajega. Ye case tab
            hota hai jab panel kholne ke baad koi tap nahi hua ho. */}
        {alert && sirenState === 'blocked' && (
          <div className="mt-3 rounded-2xl border border-amber-400/50 bg-amber-950/60 p-3 text-center">
            <p className="text-xs font-black uppercase tracking-widest text-amber-300">🔇 Browser blocked sound</p>
            <button
              type="button"
              onClick={() => {
                try { resumeDeliverySiren(); } catch { /* ignore */ }
                window.setTimeout(() => {
                  try { setSirenState(getDeliverySirenState()); } catch { /* ignore */ }
                }, 400);
              }}
              className="mt-2 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-amber-400 text-sm font-black text-slate-950 transition hover:bg-amber-300 active:scale-[0.99]"
            >
              🔊 Turn sound ON (tap)
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={onAccept}
          disabled={busy}
          className="mt-5 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 text-base font-black text-slate-950 transition hover:bg-emerald-400 active:scale-[0.99] disabled:cursor-wait disabled:opacity-60"
        >
          <Check className="h-5 w-5" />
          {busy ? '...' : acceptLabel}
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={busy}
          className="mt-2 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-rose-500/60 text-sm font-black text-rose-300 transition hover:bg-rose-950 active:scale-[0.99] disabled:cursor-wait disabled:opacity-60"
        >
          {rejectLabel}
        </button>
      </div>
    </div>
  );
};

const STRINGS = {
  en: {
    brand: 'SuperCart Delivery',
    newOrder: 'New Order',
    startDelivery: 'Start Delivery',
    starting: 'Starting...',
    markDelivered: 'Mark Delivered',
    completed: 'Completed',
    total: 'Total',
    customerFallback: 'Customer',
    addressFallback: 'Address not available',
    loading: 'Loading orders...',
    paymentMethod: 'Payment',
    itemsPrice: 'Items price',
    deliveryFee: 'Delivery fee',
    discount: 'Discount',
    tip: 'Tip',
    deliveryInstructions: 'Delivery instructions',
    online: 'Online',
    offline: 'Offline',
    helpCenter: 'Help Center',
    profile: 'Profile',
    sos: 'SOS',
    sosSoon: 'SOS emergency feature is coming soon.',
    statusError: 'Status update failed. Please try again.',
    accept: 'Accept',
    accepting: 'Accepting...',
    reject: 'Reject Order',
    rejecting: 'Rejecting...',
    respondFast: 'Respond fast — 10 seconds',
    newDeliveryOrder: 'New Delivery Order',
    secondsRemaining: 'seconds remaining',
    orderMissed: 'Time up — order passed to next partner.',
    orderRejected: 'Order rejected — passed to next partner.',
    pickedUp: 'Picked Up',
    outForDelivery: 'Out for Delivery',
    waitingTitle: 'Waiting for next order',
    waitingSub: 'Stay online — new orders will pop up here automatically.',
  },
};

const DeliveryDashboard = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('feed');
  const [isOnline, setIsOnline] = useState(null); // null = abhi load ho raha
  const [toggling, setToggling] = useState(false);
  const [photoUrl, setPhotoUrl] = useState('');
  // Partner ka Home Store (delivery_profiles.home_store_id) — "Go to Store"
  // button isi store ka Google Maps route kholta hai, kisi aur ka nahi.
  const [homeStoreId, setHomeStoreId] = useState(null);
  // Home Store ke coords {lat, lng} — GPS off ho to background map Delhi ke
  // bajaye Home Store par khule (DeliveryMap fallbackCenter). Na mile to null
  // = purana Delhi default.
  const [homeStoreCenter, setHomeStoreCenter] = useState(null);
  // Home Store popup card: pehle naam + details dikho, phir andar wale
  // "Go to Store" se Maps khulo (seedha redirect nahi).
  const [storePopup, setStorePopup] = useState(null); // {id,name,address,lat,lng} | null
  const [storePopupLoading, setStorePopupLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [popupOrderId, setPopupOrderId] = useState(null);
  // Siren sirf genuinely NAYE assignment par: initial load par jo 'assigned'
  // orders pehle se hain wo popup to kholte hain, lekin bina siren (silent).
  const [popupAlert, setPopupAlert] = useState(false);
  const bootDoneRef = React.useRef(false);
  const seenPopupRef = React.useRef(new Set());
  const t = STRINGS.en;

  useEffect(() => {
    const message = location.state?.approvalMessage;
    if (!message) return undefined;

    setToast(message);
    navigate(location.pathname, { replace: true, state: null });
    const timeout = window.setTimeout(() => setToast(''), 4500);
    return () => window.clearTimeout(timeout);
  }, [location.pathname, location.state, navigate]);

  const formatDate = (value) => {
    if (!value) return '';
    try {
      return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    } catch (e) {
      return String(value);
    }
  };

  const formatAddress = (addr) => {
    const parts = [addr.address || addr.label, addr.city, addr.state, addr.pincode || addr.pin || addr.zip].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : t.addressFallback;
  };

  const loadOrders = useCallback(async (deliveryPartnerId) => {
    const { data, error: ordersError } = await supabase
      .from('orders')
      .select('*')
      .eq('delivery_boy_id', deliveryPartnerId)
      .order('created_at', { ascending: false });

    if (ordersError) {
      setError(ordersError.message);
      setLoading(false);
      return;
    }

    const customerIds = [...new Set((data || []).map((order) => order.user_id).filter(Boolean))];
    let customers = [];
    if (customerIds.length > 0) {
      const { data: customerRows, error: customersError } = await supabase
        .from('users')
        .select('id,name,phone')
        .in('id', customerIds);
      if (customersError) {
        setError(customersError.message);
      } else {
        customers = customerRows || [];
      }
    }

    const customerById = new Map(customers.map((customer) => [customer.id, customer]));
    setOrders((data || []).map((order) => ({
      ...order,
      customer: customerById.get(order.user_id) || null,
    })));
    setLoading(false);
  }, []);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const { data: { user: current }, error: authError } = await supabase.auth.getUser();
      if (authError || !current) {
        navigate('/delivery/login', { replace: true });
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('role')
        .eq('id', current.id)
        .maybeSingle();

      if (profileError || !deliveryRoles.includes(String(profile?.role || '').toLowerCase())) {
        navigate('/', { replace: true });
        return;
      }

      if (mounted) {
        setUser(current);
        // Top bar ke liye availability + profile photo lao (delivery_profiles canonical).
        try {
          // home_store_id column SQL se pehle na bani ho to full select fail
          // hoga — tab bina home store ke basic select (online/photo na toote).
          let availRow = null;
          try {
            const full = await supabase
              .from('delivery_profiles')
              .select('is_available, profile_photo_url, home_store_id')
              .eq('user_id', current.id)
              .maybeSingle();
            if (!full.error) {
              availRow = full.data;
            } else if (/home_store_id|column|schema cache/i.test(full.error?.message || '')) {
              const basic = await supabase
                .from('delivery_profiles')
                .select('is_available, profile_photo_url')
                .eq('user_id', current.id)
                .maybeSingle();
              availRow = basic.data || null;
            }
          } catch {
            availRow = null;
          }
          if (mounted && availRow) {
            if (typeof availRow.is_available === 'boolean') setIsOnline(availRow.is_available);
            if (availRow.profile_photo_url) setPhotoUrl(availRow.profile_photo_url);
            // Column SQL se pehle na bani ho to home_store_id undefined — tab null.
            if (availRow.home_store_id != null) setHomeStoreId(Number(availRow.home_store_id));
          }
          if (mounted && typeof availRow?.is_available !== 'boolean') {
            const { data: userRow } = await supabase
              .from('users')
              .select('is_available')
              .eq('id', current.id)
              .maybeSingle();
            if (mounted && typeof userRow?.is_available === 'boolean') setIsOnline(userRow.is_available);
          }
        } catch (e) { /* availability load fail to toggle default state me rahega */ }
        // Default Online (DB default is_available = true).
        // Functional set taaki upar load hui value (false) overwrite na ho.
        if (mounted) {
          setIsOnline((currentValue) => (currentValue === null ? true : currentValue));
        }
        await loadOrders(current.id);
      }
    };

    init();
    return () => { mounted = false; };
  }, [loadOrders, navigate]);

  useEffect(() => {
    if (!user) return undefined;

    const channel = supabase
      .channel(`delivery-orders-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `delivery_boy_id=eq.${user.id}` },
        () => loadOrders(user.id),
      )
      .subscribe();

    // Admin ne Online/Offline toggle kiya to turant reflect ho (Realtime).
    // Sirf READ — yahan se is_available kabhi write nahi hota.
    const presenceChannel = supabase
      .channel(`delivery-presence-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${user.id}` },
        (payload) => {
          const next = payload.new?.is_available;
          if (typeof next === 'boolean') setIsOnline(next);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(presenceChannel);
    };
  }, [loadOrders, user]);

  // Phone pocket/screen-off me realtime events miss ho jate hain (mobile OS
  // background tab freeze kar deta hai). Foreground me wapas aate hi fresh
  // list lao taaki miss hua assignment turant popup + siren ke saath dikhe.
  // Sirf refetch hai — popup/siren/assignment logic ko haath nahi lagata.
  useEffect(() => {
    if (!user) return undefined;
    const onVisible = () => {
      try {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
          loadOrders(user.id);
        }
      } catch {
        /* ignore */
      }
    };
    try {
      document.addEventListener('visibilitychange', onVisible);
    } catch {
      /* ignore */
    }
    return () => {
      try {
        document.removeEventListener('visibilitychange', onVisible);
      } catch {
        /* ignore */
      }
    };
  }, [loadOrders, user]);

  // Naya "assigned" order aate hi SIMPLE Accept popup kholo (ek baar me ek).
  // Realtime reload par orders badalte hi queue se agla unseen order uthao.
  // Siren flag: SIRF boot ke baad aane wala genuinely NAYA realtime assignment
  // alert=true pata hai — initial load wala poora backlog silent (siren nahi).
  useEffect(() => {
    if (loading || popupOrderId || !user) return;
    // Initial boot: backlog me se SIRF wo order RING karega jiska popup is
    // device par pehle kabhi khula hi nahi (phone band/pocket me assignment
    // miss hua tha). Pehle suna/dekha hua backlog purani tarah SILENT khulta
    // hai — koi repeat noise nahi, koi aur logic nahi badla.
    if (!bootDoneRef.current) {
      const assignedNow = orders.filter(
        (o) => String(o.status || '').toLowerCase() === 'assigned',
      );
      const registry = readSirenSeenRegistry();
      const fresh = assignedNow.filter(
        (o) => !seenPopupRef.current.has(String(o.id)) && !registry.has(String(o.id)),
      );
      assignedNow.forEach((o) => seenPopupRef.current.add(String(o.id)));
      if (assignedNow.length > 0) {
        const ring = fresh.length > 0 ? fresh[0] : null;
        setPopupAlert(!!ring);
        setPopupOrderId(ring ? ring.id : assignedNow[0].id);
        try {
          const updated = new Set(registry);
          assignedNow.forEach((o) => updated.add(String(o.id)));
          writeSirenSeenRegistry(updated);
        } catch {
          /* ignore */
        }
      }
      bootDoneRef.current = true;
      return;
    }
    // Boot ke baad dikhne wala har unseen order genuinely NAYA assignment hai.
    const next = orders.find(
      (o) => String(o.status || '').toLowerCase() === 'assigned' && !seenPopupRef.current.has(String(o.id)),
    );
    if (next) {
      seenPopupRef.current.add(String(next.id));
      try {
        const updated = readSirenSeenRegistry();
        updated.add(String(next.id));
        writeSirenSeenRegistry(updated);
      } catch {
        /* ignore */
      }
      setPopupAlert(true);
      setPopupOrderId(next.id);
    }
  }, [orders, loading, popupOrderId, user]);

  // Realtime-miss fallback: Supabase realtime event RLS/publication ya network
  // ki wajah se chhoot jaye to naya assignment isi poll se ~10s me dikhega aur
  // Accept popup + siren khulenge. Sirf refetch hai — popup/siren/countdown/
  // assignment logic ko haath nahi lagata.
  useEffect(() => {
    if (!user) return undefined;
    const pollId = window.setInterval(() => {
      try {
        loadOrders(user.id);
      } catch {
        /* ignore — agla poll retry karega */
      }
    }, 10000);
    return () => window.clearInterval(pollId);
  }, [loadOrders, user]);

  // Siren audio file ko mount par preload karo + user gesture par browser
  // autoplay unlock (customer sound + SIREN dono). Online toggle wala tap
  // guaranteed gesture hai (wahan bhi unlock hota hai), ye mount wala har
  // pehle tap ko pakadta hai. Assignment/timer logic untouched — sirf readiness.
  useEffect(() => {
    preloadDeliverySiren();
    const gestureUnlock = () => {
      try { unlockAllOrderAudio(); } catch { /* ignore */ }
    };
    try {
      window.addEventListener('pointerdown', gestureUnlock);
      window.addEventListener('touchend', gestureUnlock);
    } catch { /* ignore */ }
    return () => {
      try {
        window.removeEventListener('pointerdown', gestureUnlock);
        window.removeEventListener('touchend', gestureUnlock);
      } catch { /* ignore */ }
    };
  }, []);

  // Home Store center: homeStoreId pata chalte hi stores table se coords lao
  // taaki map GPS-off me Delhi ke bajaye Home Store par khule. Sirf READ hai —
  // popup/siren/assignment logic ko haath nahi lagata.
  useEffect(() => {
    let cancelled = false;
    const hid = homeStoreId != null ? Number(homeStoreId) : null;
    if (hid == null || Number.isNaN(hid)) {
      setHomeStoreCenter(null);
      return undefined;
    }
    (async () => {
      try {
        const { data } = await supabase
          .from('stores')
          .select('latitude, longitude')
          .eq('id', hid)
          .maybeSingle();
        if (cancelled) return;
        const lat = Number(data?.latitude);
        const lng = Number(data?.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
          setHomeStoreCenter({ lat, lng });
        } else {
          setHomeStoreCenter(null);
        }
      } catch {
        if (!cancelled) setHomeStoreCenter(null);
      }
    })();
    return () => { cancelled = true; };
  }, [homeStoreId]);

  // Dashboard unmount (logout/navigate) par siren kabhi peeche na baje.
  useEffect(() => () => stopDeliverySiren(), []);

  // Rider live location → users.current_lat/current_lng (throttled persist).
  // SCOPE GUARD: sirf assigned/home-store context me broadcast karo — koi
  // ACTIVE assigned order na ho (idle/history) to bilkul write mat karo taaki
  // doosre store ya unrelated location par location na dikhe.
  // Nearest-store assignment backend me isi se distance nikalta hai.
  // Siren/timer/assignment logic ko haath nahi lagata — sirf GPS write.
  // Permission denied ya error ho to silent (rider phir bhi eligible rehta
  // hai, backend random fallback se assign karta hai).
  // locationAllowed orders/homeStoreId se banta hai (neeche) — scope badalte
  // hi watch restart/stop hota hai, throttling/min-move same rehta hai.
  const locationAllowed = shouldShareLiveLocation({ homeStoreId, orders });
  const assignedStoreIds = getAssignedStoreIds(orders);
  useEffect(() => {
    if (!user || !('geolocation' in navigator)) return undefined;
    if (!locationAllowed) return undefined;
    const uid = user.id;
    let watchId = null;
    let lastSentAt = 0;
    let lastSent = null;
    const MIN_GAP_MS = 30000;
    const MIN_MOVE_M = 100;
    const distM = (a, b) => {
      const R = 6371000;
      const dLat = ((b.lat - a.lat) * Math.PI) / 180;
      const dLng = ((b.lng - a.lng) * Math.PI) / 180;
      const s1 = Math.sin(dLat / 2);
      const s2 = Math.sin(dLng / 2);
      const h = s1 * s1 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * s2 * s2;
      return 2 * R * Math.asin(Math.sqrt(h));
    };
    const push = async (lat, lng, force) => {
      try {
        if (typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) return;
        const now = Date.now();
        if (!force && now - lastSentAt < MIN_GAP_MS) return;
        if (!force && lastSent && distM(lastSent, { lat, lng }) < MIN_MOVE_M) return;
        lastSentAt = now;
        lastSent = { lat, lng };
        await supabase.from('users').update({
          current_lat: lat,
          current_lng: lng,
          location_updated_at: new Date().toISOString(),
        }).eq('id', uid);
      } catch { /* best-effort — assignment fallback sambhal lega */ }
    };
    const onPos = (pos) => {
      const first = !lastSent;
      push(pos?.coords?.latitude, pos?.coords?.longitude, first);
    };
    const onErr = () => { /* silent */ };
    try {
      navigator.geolocation.getCurrentPosition(onPos, onErr, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
      watchId = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
    } catch { /* ignore */ }
    return () => {
      try {
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      } catch { /* ignore */ }
    };
  }, [user, locationAllowed]);

  // Safety: popup wala order bahar se hat/badal jaye to popup band karo + siren stop.
  useEffect(() => {
    if (!popupOrderId || updatingId || loading) return;
    const still = orders.some(
      (o) => String(o.id) === String(popupOrderId) && String(o.status || '').toLowerCase() === 'assigned',
    );
    if (!still) {
      stopDeliverySiren();
      setPopupAlert(false);
      setPopupOrderId(null);
    }
  }, [orders, popupOrderId, updatingId, loading]);

  // 10s me Accept → siren+countdown stop, status "accepted", popup band,
  // detailed Order Detail page kholo.
  const acceptPopupOrder = async (order) => {
    if (!order || updatingId) return;
    stopDeliverySiren();
    setUpdatingId(order.id);
    setError('');
    const { error: updateError } = await supabase
      .from('orders')
      .update({ status: 'accepted' })
      .eq('id', order.id)
      .eq('delivery_boy_id', user.id);
    if (updateError) {
      setError(updateError.message);
    } else {
      setPopupAlert(false);
      setPopupOrderId(null);
      await loadOrders(user.id);
      navigate(`/delivery/order/${order.id}`);
    }
    setUpdatingId(null);
  };

  // Reject → turant siren+countdown stop, self ko rejected_by me add, order
  // wapas 'packed' (unassigned) taaki agle FREE partner ko jaye. Store ko
  // dobara pack nahi karna padta (order pehle hi packed tha). Is partner par
  // order assigned nahi rehta. NOTE: is_available ko haath nahi lagate.
  const rejectPopupOrder = async (order) => {
    if (!order || updatingId) return;
    stopDeliverySiren();
    setUpdatingId(order.id);
    try {
      const current = Array.isArray(order.rejected_by) ? order.rejected_by.map(String) : [];
      const updated = [...new Set([...current, String(user.id)])];
      await supabase
        .from('orders')
        .update({ rejected_by: updated, delivery_boy_id: null, status: 'packed' })
        .eq('id', order.id);
      try { await supabase.rpc('retry_pending_assignments'); } catch (e) { /* best-effort */ }
    } catch (e) { /* best-effort pass-on */ }
    setPopupAlert(false);
    setPopupOrderId(null);
    showToast(t.orderRejected);
    await loadOrders(user.id);
    setUpdatingId(null);
  };

  // 10s timeout → siren+countdown stop, rejected_by me self add, order wapas
  // 'packed' (unassigned), taaki auto-assign worker/trigger agle FREE partner
  // ko de sake. Order is partner par stuck nahi rehta, store ko dobara pack
  // nahi karna padta.
  // NOTE: is_available ko HAATH NAHI lagate — Online/Offline SIRF partner
  // ke apne toggle ya Admin ke toggle se badalta hai, kabhi auto nahi.
  const timeoutPopupOrder = async (order) => {
    if (!order || updatingId) return;
    stopDeliverySiren();
    setUpdatingId(order.id);
    try {
      const current = Array.isArray(order.rejected_by) ? order.rejected_by.map(String) : [];
      const updated = [...new Set([...current, String(user.id)])];
      await supabase
        .from('orders')
        .update({ rejected_by: updated, delivery_boy_id: null, status: 'packed' })
        .eq('id', order.id);
      // Turant retry: saare pending orders available partners me baanto.
      // Function na bana ho (migration pending) to silently skip — 30s worker backup hai.
      try { await supabase.rpc('retry_pending_assignments'); } catch (e) { /* best-effort */ }
    } catch (e) { /* best-effort pass-on */ }
    setPopupAlert(false);
    setPopupOrderId(null);
    showToast(t.orderMissed);
    await loadOrders(user.id);
    setUpdatingId(null);
  };

  // Auto-assign flow: order DB trigger se pehle se assigned hai.
  // Steps: assigned -> accepted (popup) -> picked_up -> out_for_delivery -> delivered
  const updateOrderStatus = async (orderId, status) => {
    setUpdatingId(orderId);
    setError('');

    const { error: updateError } = await supabase
      .from('orders')
      .update({ status })
      .eq('id', orderId)
      .eq('delivery_boy_id', user.id);

    if (updateError) {
      setError(updateError.message);
    } else {
      await loadOrders(user.id);
    }
    setUpdatingId(null);
  };

  // Toast (SOS jaise UI-only actions ke liye halka message)
  const showToast = (message) => {
    setToast(message);
    window.clearTimeout(showToast._timer);
    showToast._timer = window.setTimeout(() => setToast(''), 3000);
  };

  // Online/Offline toggle — is_available ke SIRF 2 writer hain: ye partner
  // toggle aur Admin panel toggle. Kahin bhi auto-write mat add karna.
  // users.is_available bhi sync rakhte hain taaki auto-assign worker/trigger kaam kare.
  const toggleAvailability = async () => {
    if (isOnline === null || toggling || !user) return;
    // Ye tap guaranteed user gesture hai — isi me dono sounds unlock karo
    // taaki uske baad aane wala order popup turant baj sake (autoplay fix).
    try { unlockAllOrderAudio(); } catch { /* ignore */ }
    const next = !isOnline;
    setIsOnline(next); // optimistic UI
    setToggling(true);
    try {
      const { error: profileError } = await supabase
        .from('delivery_profiles')
        .update({ is_available: next })
        .eq('user_id', user.id);
      if (profileError) throw profileError;
      try {
        await supabase.from('users').update({ is_available: next }).eq('id', user.id);
      } catch (e) { /* best-effort sync */ }
    } catch (e) {
      setIsOnline(!next); // rollback
      showToast(t.statusError);
    } finally {
      setToggling(false);
    }
  };

  // "Go to Store" — step 1: SIRF apne home_store_id wale store ka data lao
  // aur popup card me naam dikhao (Maps abhi NAHI khulta). Koi nearest-store
  // logic nahi: hamesha HOME store hi fetch hota hai.
  const openStorePopup = async () => {
    const hid = homeStoreId != null ? Number(homeStoreId) : null;
    if (hid == null || Number.isNaN(hid)) {
      showToast('Your Home Store is not set yet. Please contact Admin.');
      return;
    }
    setStorePopupLoading(true);
    try {
      const { data: store, error } = await supabase
        .from('stores')
        .select('id, store_name, address, latitude, longitude')
        .eq('id', hid)
        .maybeSingle();
      // Verify: kaunsi row fetch hui — console me exact values (id match guard
      // neeche: galat store ka data mix hua to popup khulega hi nahi).
      try {
        console.info('[GoToStore] home_store_id =', hid, 'fetched =', JSON.stringify(store), 'error =', error?.message || null);
      } catch { /* ignore */ }
      if (error) throw error;
      // Guard: linked id se alag store ki row aayi to roko (mix-up ban).
      if (!store || Number(store.id) !== hid) {
        showToast('Home Store data did not match. Please contact Admin.');
        return;
      }
      const lat = Number(store.latitude);
      const lng = Number(store.longitude);
      try {
        console.info('[GoToStore] coords lat =', lat, 'lng =', lng);
      } catch { /* ignore */ }
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        showToast('Home Store location not found. Please contact Admin.');
        return;
      }
      setStorePopup({ id: store.id, name: store.store_name, address: store.address, lat, lng });
    } catch {
      showToast('Could not open Home Store. Please try again.');
    } finally {
      setStorePopupLoading(false);
    }
  };

  // Step 2: popup card ke andar wala "Go to Store" — exact lat,lng se Google
  // Maps directions (comma-separated, koi space nahi; origin Google Maps khud lega).
  const openStoreDirections = () => {
    if (!storePopup) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${storePopup.lat},${storePopup.lng}`;
    try {
      console.info('[GoToStore] opening directions:', url);
    } catch { /* ignore */ }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const activeOrders = orders.filter((order) => String(order.status || '').toLowerCase() !== 'delivered');
  const historyOrders = orders.filter((order) => String(order.status || '').toLowerCase() === 'delivered');
  // "assigned" (naye, unseen) orders ka detail feed me MAT dikhao —
  // wo sirf Accept popup me simple dikhte hain; detail Accept ke baad.
  const visibleOrders = activeOrders.filter((order) => String(order.status || '').toLowerCase() !== 'assigned');
  const popupOrder = popupOrderId ? orders.find((o) => String(o.id) === String(popupOrderId)) : null;
  const deliveredEarnings = historyOrders.reduce((total, order) => total + Number(order.delivery_fee || 0), 0);

  const renderPriceBreakdown = (order) => {
    const rows = [];
    if (order.items_price !== null && order.items_price !== undefined) rows.push([t.itemsPrice, `₹${order.items_price}`]);
    if (order.delivery_fee !== null && order.delivery_fee !== undefined) rows.push([t.deliveryFee, `₹${order.delivery_fee}`]);
    if (Number(order.coupon_discount || 0) > 0) rows.push([`${t.discount}${order.coupon_code ? ` (${order.coupon_code})` : ''}`, `− ₹${order.coupon_discount}`]);
    if (Number(order.tip_amount || 0) > 0) rows.push([t.tip, `+ ₹${order.tip_amount}`]);
    if (rows.length === 0) return null;
    return (
      <div className="mt-2 space-y-1 border-t border-slate-800 pt-2 text-xs text-slate-400">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between"><span>{label}</span><span>{value}</span></div>
        ))}
      </div>
    );
  };

  const renderOrderCard = (order) => {
    const address = order.shipping_address || {};
    const customer = order.customer || {};
    const items = Array.isArray(order.order_items) ? order.order_items : [];
    const status = String(order.status || 'Placed').toLowerCase();
    const isNew = status === 'assigned';
    const canPick = status === 'assigned' || status === 'accepted';
    const canShip = status === 'picked_up';
    const canComplete = status === 'out_for_delivery';
    const isDelivered = status === 'delivered';
    const clientName = customer.name || address.name || t.customerFallback;
    const clientPhone = customer.phone || address.phone || '';
    const instructions = normalizeInstructions(order.delivery_instructions);
    const tip = Number(order.tip_amount || 0);

    return (
      <article id={`order-card-${order.id}`} key={order.id} className={`rounded-2xl border p-5 shadow-sm backdrop-blur-sm ${isNew ? 'border-amber-400/60 bg-slate-900/90' : 'border-slate-800 bg-slate-900/90'}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-black">Order #{order.id}</p>
            <p className="mt-1 text-[11px] text-slate-500">{formatDate(order.created_at)}</p>
            <p className="mt-2 text-sm font-bold text-white">{clientName}</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-slate-400"><MapPin className="h-3.5 w-3.5 text-emerald-400" />{formatAddress(address)}</p>
            {clientPhone && <p className="mt-1 flex items-center gap-1 text-xs text-slate-400"><Phone className="h-3.5 w-3.5 text-emerald-400" />{clientPhone}</p>}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {tip > 0 && <span className="rounded-full bg-amber-400 px-3 py-1 text-xs font-black text-slate-950">🎉 ₹{tip} Tip</span>}
            {isNew && <span className="animate-pulse rounded-full bg-amber-400 px-3 py-1 text-xs font-black uppercase text-slate-950">{t.newOrder}</span>}
            <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-bold uppercase text-emerald-300">{prettifyStatus(order.status)}</span>
          </div>
        </div>

        <div className="mt-4 space-y-2 border-t border-slate-800 pt-4">
          {items.map((item, index) => (
            <div key={`${order.id}-${index}`} className="flex justify-between rounded-lg bg-slate-800 p-3 text-xs">
              <span className="flex items-center gap-2"><Package className="h-4 w-4 text-emerald-400" />{item.name} × {item.quantity}</span>
              <b>₹{item.price}</b>
            </div>
          ))}
        </div>

        {instructions.length > 0 && (
          <div className="mt-4 rounded-xl border border-slate-700 bg-slate-800/60 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-amber-300">
              <ClipboardList className="h-3.5 w-3.5" />{t.deliveryInstructions}
            </p>
            <ul className="mt-2 space-y-1.5">
              {instructions.map((value) => {
                const meta = INSTRUCTION_META[value] || {};
                const Icon = meta.icon || Bell;
                return (
                  <li key={value} className="flex items-center gap-2 text-xs font-bold text-slate-200">
                    <Icon className="h-4 w-4 shrink-0 text-emerald-400" />
                    {meta.label || prettifyInstruction(value)}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3">
          <div>
            <span className="text-sm text-slate-400">{t.total} <b className="ml-2 text-white">₹{order.total_price}</b></span>
            {order.payment_method && <p className="mt-1 text-[11px] text-slate-500">{t.paymentMethod}: {order.payment_method}</p>}
            {renderPriceBreakdown(order)}
          </div>
          {(
            <div className="flex flex-wrap gap-2">
              <button onClick={() => navigate(`/delivery/order/${order.id}`)} className="flex items-center gap-1 rounded-xl border border-slate-700 px-4 py-2 text-xs font-black text-slate-200 transition hover:border-emerald-500 hover:text-white">Details</button>
              {canPick && <button disabled={updatingId === order.id} onClick={() => updateOrderStatus(order.id, 'picked_up')} className="flex items-center gap-1 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"><Package className="h-4 w-4" /> {updatingId === order.id ? t.starting : t.pickedUp}</button>}
              {canShip && <button disabled={updatingId === order.id} onClick={() => updateOrderStatus(order.id, 'out_for_delivery')} className="flex items-center gap-1 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"><Truck className="h-4 w-4" /> {updatingId === order.id ? t.starting : t.outForDelivery}</button>}
              {canComplete && <button disabled={updatingId === order.id} onClick={() => updateOrderStatus(order.id, 'delivered')} className="flex items-center gap-1 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"><Check className="h-4 w-4" /> {t.markDelivered}</button>}
              {isDelivered && <span className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-emerald-300">{t.completed}</span>}
            </div>
          )}
        </div>
      </article>
    );
  };

  return (
    <div className="relative min-h-screen text-white">
      {/* Live map: SIRF assigned/home-store context me live dot — idle me sirf
          Home Store fallback center (koi live broadcast/dot nahi). assignedStoreIds
          debug/scope ke liye pass hota hai, map UI same rehta hai. */}
      <React.Suspense fallback={<div className="fixed inset-0 z-0 bg-slate-950" />}>
        <DeliveryMap fallbackCenter={homeStoreCenter} locationAllowed={locationAllowed} assignedStoreIds={assignedStoreIds} homeStoreId={homeStoreId} />
      </React.Suspense>
      {/* Fixed top bar */}
      <div className="fixed inset-x-0 top-0 z-30 border-b border-slate-800 bg-slate-950/95 shadow-sm backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-2 px-3 sm:gap-3 sm:px-8">
          {/* Left: bada Online/Offline toggle */}
          <button
            type="button"
            role="switch"
            aria-checked={isOnline === true}
            aria-label={isOnline ? t.online : t.offline}
            onClick={toggleAvailability}
            disabled={isOnline === null || toggling}
            className={`flex max-w-[calc(100vw-150px)] items-center gap-1.5 rounded-full py-1.5 pl-1.5 pr-3 text-xs font-black uppercase tracking-wide transition disabled:cursor-wait disabled:opacity-60 sm:gap-2.5 sm:pr-5 sm:text-sm ${isOnline ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}
          >
            <span className={`flex h-8 w-14 items-center rounded-full px-1 transition ${isOnline ? 'justify-end bg-slate-950/20' : 'justify-start bg-slate-700'}`}>
              <span className="h-6 w-6 rounded-full bg-white shadow" />
            </span>
            {isOnline === null ? '…' : isOnline ? t.online : t.offline}
          </button>

          {/* Right: Go to Store + SOS + Help + Profile */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              title="Go to Store — open your Home Store route"
              aria-label="Go to Store"
              onClick={openStorePopup}
              disabled={storePopupLoading}
              className="flex h-10 items-center gap-1.5 rounded-full border border-emerald-500/50 bg-emerald-950 px-3 text-xs font-black text-emerald-300 transition hover:bg-emerald-900 disabled:opacity-60"
            >
              {storePopupLoading ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" /> : <Store className="h-5 w-5 shrink-0" />}
              <span className="hidden min-[400px]:inline">Go to Store</span>
            </button>
            <button
              type="button"
              title={t.sos}
              aria-label={t.sos}
              onClick={() => showToast(t.sosSoon)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-rose-500/50 bg-rose-950 text-rose-400 transition hover:bg-rose-900"
            >
              <Siren className="h-5 w-5" />
            </button>
            <button
              type="button"
              title={t.helpCenter}
              aria-label={t.helpCenter}
              onClick={() => navigate('/delivery/help')}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 text-slate-200 transition hover:bg-slate-800"
            >
              <CircleHelp className="h-5 w-5" />
            </button>
            <button
              type="button"
              title={t.profile}
              aria-label={t.profile}
              onClick={() => navigate('/delivery/profile')}
              className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-slate-700 bg-slate-800 text-sm font-black text-emerald-400 transition hover:border-emerald-500"
            >
              {photoUrl
                ? <SignedDocImage stored={photoUrl} alt={t.profile} className="h-full w-full object-cover" placeholderClassName="flex h-full w-full items-center justify-center text-xs" />
                : (user?.email?.charAt(0).toUpperCase() || 'D')}
            </button>
          </div>
        </div>
        {toast && <p className="mx-auto max-w-5xl px-5 pb-2 text-center text-xs font-bold text-amber-300 sm:px-8">{toast}</p>}
      </div>
      {/* Fixed bar ke neeche ka spacer (yahan se map dikhega) */}
      <div aria-hidden className="h-16" />

      <div className="relative z-10 p-3 pb-28 sm:p-8 sm:pb-32">
      <div className="mx-auto max-w-5xl">
      {activeTab === 'feed' ? (
        <>
        {error && <p className="mb-4 rounded-xl border border-rose-900 bg-rose-950/90 p-3 text-sm text-rose-300 backdrop-blur-md">{error}</p>}
        {loading ? <p className="inline-block rounded-full bg-slate-950/70 px-4 py-2 text-slate-300 backdrop-blur-md">{t.loading}</p> : visibleOrders.length > 0 ? (
          <div className="space-y-4">
            {visibleOrders.map((order) => renderOrderCard(order))}
          </div>
        ) : (
          <div className="flex justify-end">
            <div className="w-fit rounded-full border border-slate-700/60 bg-slate-950/80 px-3 py-1.5 text-xs font-bold text-slate-200 shadow backdrop-blur-md">
              {t.waitingTitle}
            </div>
            {/* Test Siren button UI se hidden hai (screen par nahi dikhega),
                lekin siren test function code me preserved hai — delete nahi kiya. */}
            <button
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              onClick={() => {
                try { unlockAllOrderAudio(); } catch { /* ignore */ }
                try { startDeliverySiren('test'); } catch { /* ignore */ }
                window.setTimeout(() => {
                  try { stopDeliverySiren(); } catch { /* ignore */ }
                }, 3000);
                showToast('Test siren playing 🔊 — if you can hear this, order popups will sound too');
              }}
              className="hidden"
              style={{ display: 'none' }}
            >
              🔊 Test Siren
            </button>
          </div>
        )}
        </>
      ) : activeTab === 'pocket' ? (
        <section className="rounded-2xl border border-slate-800 bg-slate-950/90 p-4 shadow-sm backdrop-blur-sm sm:p-6">
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-400">{t.brand}</p>
          <h1 className="mt-2 text-3xl font-black">Pocket</h1>
          <p className="mt-1 text-sm text-slate-400">Your delivery earnings and wallet summary.</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl bg-emerald-500 p-5 text-slate-950">
              <p className="text-xs font-bold uppercase tracking-wider opacity-70">Delivery earnings</p>
              <p className="mt-2 text-3xl font-black">₹{deliveredEarnings}</p>
              <p className="mt-1 text-xs font-bold opacity-70">{historyOrders.length} completed deliveries</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Wallet status</p>
              <p className="mt-2 text-lg font-black text-white">Ready for payout</p>
              <p className="mt-1 text-xs text-slate-400">Earnings will be settled according to your payout schedule.</p>
            </div>
          </div>
        </section>
      ) : activeTab === 'gigs' ? (
        <section className="rounded-2xl border border-slate-800 bg-slate-950/90 p-10 text-center shadow-sm backdrop-blur-sm">
          <BriefcaseBusiness className="mx-auto h-10 w-10 text-emerald-400" />
          <h1 className="mt-4 text-2xl font-black">Gigs</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">Extra delivery tasks will appear here when they are available in your area.</p>
        </section>
      ) : (
        <section className="rounded-2xl border border-slate-800 bg-slate-950/90 p-6 shadow-sm backdrop-blur-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-400">{t.brand}</p>
          <h1 className="mt-2 text-3xl font-black">Updates</h1>
          <div className="mt-6 space-y-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <p className="text-sm font-black">Assigned orders stay in Feed</p>
              <p className="mt-1 text-xs text-slate-400">{activeOrders.length ? `${activeOrders.length} active order${activeOrders.length === 1 ? '' : 's'} waiting for delivery.` : 'No new assigned orders right now.'}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <p className="text-sm font-black">Availability updates</p>
              <p className="mt-1 text-xs text-slate-400">You are currently {isOnline ? 'online' : 'offline'}. Toggle your status from the top bar.</p>
            </div>
          </div>
        </section>
      )}
      </div>
      </div>
      <nav aria-label="Delivery dashboard navigation" className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-800 bg-slate-950/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur">
        <div className="mx-auto grid max-w-2xl grid-cols-4 gap-1">
          {[
            ['feed', 'Feed', Truck],
            ['pocket', 'Pocket', Wallet],
            ['gigs', 'Gigs', BriefcaseBusiness],
            ['updates', 'Updates', Bell],
          ].map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-black transition ${activeTab === key ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:bg-slate-900 hover:text-white'}`}
            >
              <Icon className="h-5 w-5" />
              {label}
            </button>
          ))}
        </div>
      </nav>
      {/* Home Store card: pehle naam confirm karo, phir andar wale button se Maps kholo */}
      {storePopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setStorePopup(null); }}>
          <div role="dialog" aria-modal="true" aria-label="Home Store" className="w-full max-w-sm rounded-3xl border border-slate-700 bg-slate-900 p-6 text-center shadow-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500 text-slate-950">
              <Store className="h-7 w-7" />
            </div>
            <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Your Home Store</p>
            <h2 className="mt-1 text-xl font-black leading-tight text-white">{storePopup.name || `Store #${storePopup.id}`}</h2>
            {storePopup.address && <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{storePopup.address}</p>}
            <p className="mt-2 font-mono text-[11px] font-bold text-slate-500">📍 {storePopup.lat}, {storePopup.lng}</p>
            <button
              type="button"
              onClick={openStoreDirections}
              className="mt-5 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 text-sm font-black text-slate-950 transition hover:bg-emerald-400 active:scale-[0.99]"
            >
              <MapPin className="h-5 w-5" /> Go to Store
            </button>
            <button
              type="button"
              onClick={() => setStorePopup(null)}
              className="mt-2 min-h-[44px] w-full rounded-2xl text-xs font-black text-slate-400 transition hover:text-white"
            >
              Close
            </button>
          </div>
        </div>
      )}
      {popupOrder && String(popupOrder.status || '').toLowerCase() === 'assigned' && (
        <NewOrderPopup
          key={popupOrder.id}
          orderNumber={popupOrder.id}
          customerName={popupOrder.customer?.name || popupOrder.shipping_address?.name || t.customerFallback}
          addressLine={formatAddress(popupOrder.shipping_address || {})}
          busy={updatingId === popupOrder.id}
          alert={popupAlert}
          acceptLabel={updatingId === popupOrder.id ? t.accepting : t.accept}
          rejectLabel={updatingId === popupOrder.id ? t.rejecting : t.reject}
          newOrderLabel={t.newDeliveryOrder}
          secondsRemainingLabel={t.secondsRemaining}
          respondFastLabel={t.respondFast}
          onAccept={() => acceptPopupOrder(popupOrder)}
          onReject={() => rejectPopupOrder(popupOrder)}
          onTimeout={() => timeoutPopupOrder(popupOrder)}
        />
      )}
    </div>
  );
};

export default DeliveryDashboard;
