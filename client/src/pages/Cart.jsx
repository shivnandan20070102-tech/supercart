import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Trash2,
  Plus,
  Minus,
  ShoppingBag,
  ArrowRight,
  ShieldCheck,
  Zap,
  Tag,
  Clock,
  MapPin,
  CheckCircle2,
  DoorOpen,
  BellOff,
  PhoneOff,
  PawPrint,
  Mailbox,
  ClipboardList,
  HeartHandshake,
} from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { createOrderApi, validateCouponApi } from '../services/api';
import { supabase } from '../config/supabase';
import { fetchStockMap, validateCartStock } from '../services/stock';
import { findNearestStore } from '../services/nearestStore';
import LoadingState from '../components/layout/LoadingState';
import { useStore } from '../context/StoreContext';
import useDeliveryAddress from '../hooks/useDeliveryAddress';
import { playOrderSound, preloadOrderSound, unlockOrderAudio } from '../utils/orderSound';

// Delivery partner ke liye instructions — DB me delivery_instructions TEXT[] me save hote hain
const DELIVERY_INSTRUCTION_OPTIONS = [
  { value: 'leave_with_guard', label: 'Leave with guard', icon: ShieldCheck },
  { value: 'leave_at_door', label: 'Leave at door', icon: DoorOpen },
  { value: 'dont_ring_bell', label: "Don't ring the bell", icon: BellOff },
  { value: 'avoid_calling', label: 'Avoid calling', icon: PhoneOff },
  { value: 'pet_at_home', label: 'Pet at home', icon: PawPrint },
  { value: 'leave_in_mailbox', label: 'Leave in mailbox', icon: Mailbox },
];

// Delivery partner tip presets
const TIP_PRESETS = [20, 30, 50];

const Cart = () => {
  const {
    cartItems,
    removeFromCart,
    updateQuantity,
    clearCart,
    subtotal,
    originalSubtotal,
    savings,
    deliveryFee,
    grandTotal,
  } = useCart();
  const { user } = useAuth();
  const { isOnline, serviceable, nearestStore } = useStore();
  const { savedAddress } = useDeliveryAddress();

  const [couponCode, setCouponCode] = useState('');
  const [couponApplied, setCouponApplied] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [couponValidating, setCouponValidating] = useState(false);
  const [couponError, setCouponError] = useState('');
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [orderToast, setOrderToast] = useState('');
  const [checkoutError, setCheckoutError] = useState('');
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [paymentPending, setPaymentPending] = useState(false);
  const [paymentCountdown, setPaymentCountdown] = useState(10);
  const [paymentMethod, setPaymentMethod] = useState(() => localStorage.getItem('supercart_payment_method') || 'Cash On Delivery');
  const [deliveryInstructions, setDeliveryInstructions] = useState([]);
  const [tipAmount, setTipAmount] = useState(0);
  const [customTipActive, setCustomTipActive] = useState(false);
  const [customTipValue, setCustomTipValue] = useState('');
  const [placedTip, setPlacedTip] = useState(0);
  // Fresh available stock (checkout guard + per-item display). Best-effort —
  // fetch fail ho to checkout server-side stock check sambhal lega.
  const [stockMap, setStockMap] = useState(() => new Map());

  useEffect(() => {
    let cancelled = false;
    const ids = (cartItems || []).map((i) => i?.id).filter((v) => v != null);
    if (ids.length === 0) {
      setStockMap(new Map());
      return undefined;
    }
    (async () => {
      try {
        const rows = await fetchStockMap(supabase, ids);
        if (cancelled) return;
        setStockMap(new Map((rows || []).map((r) => [String(r.id), r])));
      } catch {
        if (!cancelled) setStockMap(new Map());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cartItems]);

  // Order success ("Thank you") same /cart page par conditional render hota hai,
  // isliye App wala ScrollToTop (pathname change) trigger nahi hota.
  // Yahi scroll neeche footer par atka rehta tha — top par lao.
  useEffect(() => {
    if (orderPlaced) {
      window.scrollTo(0, 0);
    }
  }, [orderPlaced]);

  // Success toast auto-dismiss (sound sirf ek baar placeOrder success par bajta hai)
  useEffect(() => {
    if (!orderToast) return undefined;
    const timer = window.setTimeout(() => setOrderToast(''), 4000);
    return () => window.clearTimeout(timer);
  }, [orderToast]);

  // Sound file pehle se load rakho taaki success par turant baje
  useEffect(() => {
    preloadOrderSound();
  }, []);

  // 10-sec inline confirm: 0% -> 100% linear fill (koi popup nahi)
  const confirmProgress = Math.min(1, Math.max(0, (10 - paymentCountdown) / 10));

  const toggleInstruction = (value) => {
    setDeliveryInstructions((current) =>
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    );
  };

  // Preset tip: same button dubara dabao to deselect (tip 0)
  const selectPresetTip = (amount) => {
    if (!customTipActive && tipAmount === amount) {
      setTipAmount(0);
    } else {
      setTipAmount(amount);
      setCustomTipActive(false);
      setCustomTipValue('');
    }
  };

  // Custom: dubara dabao to band + tip 0
  const toggleCustomTip = () => {
    if (customTipActive) {
      setCustomTipActive(false);
      setCustomTipValue('');
      setTipAmount(0);
    } else {
      setCustomTipActive(true);
      setCustomTipValue('');
      setTipAmount(0);
    }
  };

  const handleCustomTipChange = (event) => {
    const raw = event.target.value.replace(/[^0-9]/g, '').slice(0, 4);
    setCustomTipValue(raw);
    setTipAmount(raw ? Math.max(0, Number(raw)) : 0);
  };

  const handleApplyCoupon = async (e) => {
    e.preventDefault();
    const cleanCode = couponCode.trim().toUpperCase();
    if (!cleanCode) {
      setCouponError('Please enter a coupon code.');
      return;
    }
    setCouponValidating(true);
    setCouponError('');
    const result = await validateCouponApi(cleanCode, subtotal);
    setCouponValidating(false);
    if (result.success) {
      setAppliedCoupon(result.data);
      setCouponApplied(true);
      setCouponCode(cleanCode);
      setCouponError('');
    } else {
      setAppliedCoupon(null);
      setCouponApplied(false);
      setCouponError(result.message || 'Invalid coupon code.');
    }
  };

  const handleRemoveCoupon = () => {
    setCouponApplied(false);
    setAppliedCoupon(null);
    setCouponCode('');
    setCouponError('');
  };

  const calcCouponDiscount = (coupon, amount) => {
    if (!coupon) return 0;
    const value = Number(coupon.discount_value) || 0;
    const raw = coupon.discount_type === 'flat' ? value : Math.round((amount * value) / 100);
    return Math.max(0, Math.min(raw, amount));
  };

  // If cart shrinks below the coupon's minimum, discount pauses until amount recovers
  const couponMinOk = !couponApplied || !appliedCoupon || subtotal >= Number(appliedCoupon.min_order_amount || 0);
  const couponDiscount = couponApplied && appliedCoupon && couponMinOk ? calcCouponDiscount(appliedCoupon, subtotal) : 0;
  const finalPayable = Math.max(0, grandTotal - couponDiscount + tipAmount);

  useEffect(() => {
    if (!paymentPending) return undefined;
    if (paymentCountdown <= 0) {
      setPaymentPending(false);
      placeOrder();
      return undefined;
    }
    const timer = window.setTimeout(() => setPaymentCountdown((current) => current - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [paymentPending, paymentCountdown]);

  const placeOrder = async () => {
    if (!user) {
      setCheckoutError('Please login before placing your order.');
      return;
    }

    setCheckoutError('');
    setIsCheckingOut(true);
    try {
      // Stock guard: stale cart (doosre user ne beech me kharid liya ho) to
      // order bhejo hi mat — fresh DB stock se exact available batao.
      try {
        const freshRows = await fetchStockMap(
          supabase,
          (cartItems || []).map((i) => i?.id),
        );
        const problems = validateCartStock(cartItems, freshRows);
        if (problems.length > 0) {
          const p = problems[0];
          throw new Error(`Only ${p.available} left for "${p.name}" — please reduce quantity.`);
        }
        setStockMap(new Map((freshRows || []).map((r) => [String(r.id), r])));
      } catch (e) {
        if (/Only \d+ left for/.test(e?.message || '')) throw e;
        // Stock read fail (offline/RPC) — server authoritative check karega.
      }

      // Picker se saved delivery address + GPS coords order ke saath bhejo
      // taaki delivery partner exact spot par navigate kar sake
      const ship = savedAddress || {};
      const numOrNull = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : null);
      const shipLat = numOrNull(ship.lat) ?? numOrNull(ship.latitude);
      const shipLng = numOrNull(ship.lng) ?? numOrNull(ship.longitude);

      // Order-time authoritative store: DELIVERY address coords se FRESH nearest
      // store nikalo. Context wala nearestStore stale ho sakta hai (address abhi
      // badla ho / GPS fix baad me aaya ho) — isliye yehi store_id order me jayega.
      let orderStoreId = nearestStore?.id ?? null;
      if (shipLat != null && shipLng != null) {
        const fresh = await findNearestStore(supabase, shipLat, shipLng);
        if (fresh.storesAvailable && !fresh.serviceable) {
          throw new Error("Sorry, we don't deliver to your area yet");
        }
        if (fresh.store) orderStoreId = fresh.store.id;
      }

      const response = await createOrderApi({
        userId: user.id,
        // Multi-store: order kis store ko assign hua (orders.store_id)
        storeId: orderStoreId,
        orderItems: cartItems.map(({ id, name, price, quantity, image, unit }) => ({
          productId: id,
          name,
          price,
          quantity,
          image,
          unit,
        })),
        shippingAddress: {
          label: ship.label || 'Home',
          address: ship.address || 'Flat 402, Green Avenue',
          city: ship.city || '',
          pincode: ship.pincode || '',
          postalCode: ship.pincode || '',
          phone: user.phone || '',
          latitude: ship.lat ?? null,
          longitude: ship.lng ?? null,
          lat: ship.lat ?? null,
          lng: ship.lng ?? null,
          houseNo: ship.houseNo || '',
          landmark: ship.landmark || '',
          area: ship.area || '',
          formattedAddress: ship.formattedAddress || ship.address || '',
        },
        paymentMethod,
        itemsPrice: subtotal,
        deliveryFee,
        couponDiscount,
        couponCode: couponApplied && appliedCoupon ? appliedCoupon.code : null,
        deliveryInstructions,
        tipAmount,
        totalPrice: finalPayable,
      });

      if (!response.success) {
        throw new Error(response.message || 'Order could not be placed.');
      }

      // used_count is bumped server-side on order success (no client call needed)
      clearCart();
      setCouponApplied(false);
      setAppliedCoupon(null);
      setCouponCode('');
      setCouponError('');
      setDeliveryInstructions([]);
      setPlacedTip(tipAmount);
      setTipAmount(0);
      setCustomTipActive(false);
      setCustomTipValue('');
      setOrderPlaced(true);
      // Order CONFIRMED + saved — abhi ek baar success sound + toast.
      // Fail path (catch) me kabhi nahi bajta; order creation me koi delay nahi.
      setOrderToast('Order Placed Successfully! Your order has been confirmed.');
      playOrderSound();
    } catch (error) {
      setCheckoutError(error.message || 'Could not connect to the order service.');
    } finally {
      setIsCheckingOut(false);
    }
  };

  const handleCheckout = () => {
    if (!isOnline) {
      setCheckoutError('Store is currently closed, please check back later.');
      return;
    }
    // 10km me koi store nahi — ordering band
    if (serviceable === false) {
      setCheckoutError("Sorry, we don't deliver to your area yet");
      return;
    }
    if (isCheckingOut || paymentPending) return;
    // User gesture (click) ke andar hi audio unlock — warna countdown + API ke
    // baad Chrome autoplay policy play() block kar deta hai aur sound nahi bajta.
    unlockOrderAudio();
    setCheckoutError('');
    setPaymentCountdown(10);
    setPaymentPending(true);
  };

  const cancelPayment = () => {
    setPaymentPending(false);
    setPaymentCountdown(10);
    setCheckoutError('Payment cancelled. Your cart is safe.');
  };

  if (orderPlaced) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center px-4">
        {orderToast && (
          <div
            role="status"
            aria-live="polite"
            className="fixed left-1/2 top-4 z-[80] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-center shadow-xl"
          >
            <p className="text-sm font-black text-white">Order Placed Successfully!</p>
            <p className="mt-0.5 text-xs font-semibold text-emerald-50">Your order has been confirmed.</p>
          </div>
        )}
        <div className="bg-white rounded-3xl border border-slate-200 p-8 sm:p-12 text-center max-w-lg shadow-xl animate-fade-in">
          <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
            <CheckCircle2 className="w-12 h-12" />
          </div>
          <span className="text-xs font-bold uppercase tracking-widest text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full">
            Order Confirmed 🎉
          </span>
          <h2 className="text-2xl sm:text-3xl font-black text-slate-900 mt-3">
            Thank you for your order!
          </h2>
          <p className="text-sm text-slate-600 mt-2">
            Your grocery bag is being packed at the nearest dark store.
          </p>
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 my-6 text-left text-xs space-y-2">
            <div className="flex justify-between font-semibold text-slate-700">
              <span>Estimated Delivery:</span>
              <span className="text-emerald-700 font-bold flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> 10 - 15 Mins
              </span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>Payment Mode:</span>
                <span className="font-bold text-slate-700">{paymentMethod}</span>
            </div>
            {placedTip > 0 && (
              <div className="flex justify-between text-slate-500">
                <span>Delivery Partner Tip:</span>
                <span className="font-bold text-emerald-700">₹{placedTip} 🙏</span>
              </div>
            )}
          </div>
          <Link
            to="/"
            onClick={() => { setOrderPlaced(false); setOrderToast(''); }}
            className="inline-flex items-center justify-center gap-2 w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl transition shadow-md shadow-emerald-500/20 text-sm"
          >
            <span>Continue Shopping</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  if (cartItems.length === 0) {
    return (
      <div className="min-h-[75vh] flex items-center justify-center px-4">
        <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center max-w-md shadow-sm">
          <div className="w-24 h-24 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-600 mx-auto mb-6">
            <ShoppingBag className="w-12 h-12" />
          </div>
          <h2 className="text-2xl font-black text-slate-900">Your Cart is Empty</h2>
          <p className="text-sm text-slate-500 mt-2 mb-8">
            Looks like you haven't added any fresh groceries to your cart yet.
          </p>
          <Link
            to="/"
            className="inline-flex items-center justify-center gap-2 w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white font-bold rounded-2xl transition shadow-lg shadow-emerald-600/20 text-sm"
          >
            <span>Explore Fresh Groceries</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="min-h-screen bg-slate-50 py-5 sm:py-8">
    <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        
        {/* Page Title */}
        <div className="flex items-center justify-between gap-3 pb-5 border-b border-slate-200 mb-6 sm:pb-6 sm:mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              My Grocery Bag
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              {cartItems.length} {cartItems.length === 1 ? 'item' : 'items'} in your cart
            </p>
          </div>
          <button
            onClick={clearCart}
            className="text-xs font-bold text-red-600 hover:text-red-700 hover:underline flex items-center gap-1 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Cart</span>
          </button>
        </div>

        {/* Cart Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left: Cart Items List */}
          <div className="lg:col-span-7 xl:col-span-8 space-y-4">
            
            {/* Delivery address & instant timing notice */}
            <div className="bg-white rounded-2xl p-3 sm:p-4 border border-emerald-200 shadow-xs flex items-center justify-between gap-3 sm:gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-900">Delivering in 10-15 Mins</p>
                  <p className="text-[11px] text-slate-500">Deliver to: <b>{savedAddress?.label || 'Home'}</b> - {savedAddress?.address || 'Flat 402, Green Avenue'}</p>
                </div>
              </div>
              <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg">
                Superfast
              </span>
            </div>

            {/* List of Cart Items */}
            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs divide-y divide-slate-100 overflow-hidden">
              {cartItems.map((item) => (
                <div
                  key={item.id}
                  className="p-3 sm:p-5 flex items-center justify-between gap-2 sm:gap-4 hover:bg-slate-50/50 transition"
                >
                  {/* Item Image */}
                  <div className="w-14 h-14 sm:w-20 sm:h-20 bg-slate-50 rounded-xl sm:rounded-2xl border border-slate-100 p-1.5 sm:p-2 shrink-0 flex items-center justify-center overflow-hidden">
                    <img
                      src={item.image}
                      alt={item.name}
                      className="w-full h-full object-contain"
                    />
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-400 font-semibold">{item.unit}</p>
                    <h3 className="text-sm sm:text-base font-bold text-slate-900 truncate">
                      {item.name}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-sm font-black text-slate-900">
                        ₹{item.price}
                      </span>
                      {item.originalPrice && item.originalPrice > item.price && (
                        <span className="text-xs text-slate-400 line-through">
                          ₹{item.originalPrice}
                        </span>
                      )}
                    </div>
                    {(() => {
                      const row = stockMap.get(String(item.id));
                      if (!row || row.stock == null) return null;
                      const avail = Math.max(0, Math.floor(Number(row.stock) || 0));
                      const short = row.in_stock === false || avail <= 0 || item.quantity > avail;
                      return (
                        <p className={`mt-1 text-[11px] font-bold ${short ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {short
                            ? avail <= 0
                              ? 'Out of Stock'
                              : `Only ${avail} available`
                            : `${avail} available`}
                        </p>
                      );
                    })()}
                  </div>

                  {/* Quantity Stepper & Remove */}
                  <div className="flex items-center gap-1 sm:gap-3 shrink-0">
                    <div className="flex items-center bg-emerald-600 text-white rounded-xl shadow-xs overflow-hidden">
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity - 1)}
                        className="p-1.5 sm:px-2.5 sm:py-2 hover:bg-emerald-700 active:bg-emerald-800 transition cursor-pointer"
                        title="Decrease"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="px-2 font-black text-xs min-w-5 text-center">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity + 1)}
                        className="p-1.5 sm:px-2.5 sm:py-2 hover:bg-emerald-700 active:bg-emerald-800 transition cursor-pointer"
                        title="Increase"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <button
                      onClick={() => removeFromCart(item.id)}
                      className="text-slate-400 hover:text-red-500 p-2 rounded-xl hover:bg-red-50 transition cursor-pointer"
                      title="Remove item"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Savings Callout */}
            {savings > 0 && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-2xl flex items-center justify-between text-xs font-bold">
                <span className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-emerald-600" />
                  Yayy! You are saving ₹{savings} on this grocery order!
                </span>
              </div>
            )}

            {/* Delivery Instructions */}
            <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-emerald-600" />
                <span>Delivery Instructions</span>
                <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Optional</span>
              </h3>
              <p className="mt-1 text-[11px] text-slate-500">Anything specific for the delivery partner? Swipe sideways to select multiple options.</p>
              <div className="qc-no-scrollbar -mx-1 mt-3 flex gap-2.5 overflow-x-auto px-1 pb-1">
                {DELIVERY_INSTRUCTION_OPTIONS.map(({ value, label, icon: Icon }) => {
                  const selected = deliveryInstructions.includes(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleInstruction(value)}
                      className={`flex w-24 shrink-0 flex-col items-center gap-2 rounded-2xl border p-3 text-center transition active:scale-95 ${
                        selected
                          ? 'border-emerald-500 bg-emerald-50 shadow-xs'
                          : 'border-slate-200 bg-white hover:border-emerald-300'
                      }`}
                    >
                      <span className={`flex h-11 w-11 items-center justify-center rounded-2xl transition ${
                        selected ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'
                      }`}>
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className={`text-[11px] font-bold leading-tight ${selected ? 'text-emerald-800' : 'text-slate-600'}`}>
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right: Bill Summary & Checkout */}
          <div className="lg:col-span-5 xl:col-span-4 space-y-6">
            
            {/* Coupon Box */}
            <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs">
              <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                <Tag className="w-4 h-4 text-emerald-600" />
                <span>Apply Promo Coupon</span>
              </h3>
              <form onSubmit={handleApplyCoupon} className="flex flex-col gap-2 min-[420px]:flex-row">
                <input
                  type="text"
                  placeholder="e.g. SAVE20"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value)}
                  disabled={couponApplied || couponValidating}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-800 focus:outline-emerald-500"
                />
                <button
                  type="submit"
                  disabled={couponApplied || couponValidating}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:bg-emerald-600 text-white rounded-xl text-xs font-bold transition cursor-pointer min-[420px]:shrink-0"
                >
                  {couponValidating ? 'Checking...' : couponApplied ? 'Applied ✓' : 'Apply'}
                </button>
              </form>
              {couponError && (
                <p className="text-[11px] text-red-600 font-semibold mt-2">{couponError}</p>
              )}
              {couponApplied && appliedCoupon && (
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-emerald-600 font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {appliedCoupon.code} applied! ₹{couponDiscount} instant discount.
                  </p>
                  <button
                    type="button"
                    onClick={handleRemoveCoupon}
                    className="text-[11px] font-bold text-red-600 hover:underline shrink-0 cursor-pointer"
                  >
                    Remove
                  </button>
                </div>
              )}
              {couponApplied && appliedCoupon && !couponMinOk && (
                <p className="text-[11px] text-amber-600 font-semibold mt-2">Add ₹{Number(appliedCoupon.min_order_amount || 0) - subtotal} more to keep {appliedCoupon.code} applied.</p>
              )}
            </div>

            {/* Tip your delivery partner */}
            <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <HeartHandshake className="w-4 h-4 text-emerald-600" />
                <span>Tip your delivery partner</span>
              </h3>
              <p className="mt-1 text-[11px] text-slate-500">Your kindness means a lot! 100% of the tip goes to your delivery partner.</p>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {TIP_PRESETS.map((amount) => {
                  const selected = !customTipActive && tipAmount === amount;
                  return (
                    <button
                      key={amount}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => selectPresetTip(amount)}
                      className={`min-h-[48px] rounded-2xl border text-sm font-black transition active:scale-95 ${
                        selected
                          ? 'border-emerald-600 bg-emerald-600 text-white shadow-xs'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-400 hover:bg-emerald-50/50'
                      }`}
                    >
                      ₹{amount}
                    </button>
                  );
                })}
                <button
                  type="button"
                  aria-pressed={customTipActive}
                  onClick={toggleCustomTip}
                  className={`min-h-[48px] rounded-2xl border text-xs font-black transition active:scale-95 ${
                    customTipActive
                      ? 'border-emerald-600 bg-emerald-600 text-white shadow-xs'
                      : 'border-dashed border-slate-300 bg-white text-slate-600 hover:border-emerald-400 hover:bg-emerald-50/50'
                  }`}
                >
                  Custom
                </button>
              </div>
              {customTipActive && (
                <div className="mt-2 flex items-center gap-2 rounded-2xl border border-emerald-300 bg-emerald-50/50 px-3 py-1">
                  <span className="text-sm font-black text-emerald-700">₹</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={customTipValue}
                    onChange={handleCustomTipChange}
                    placeholder="Enter amount"
                    aria-label="Custom tip amount"
                    className="w-full bg-transparent py-2.5 text-sm font-bold text-slate-800 outline-none placeholder:text-slate-400"
                  />
                </div>
              )}
              {tipAmount > 0 && (
                <p className="mt-2 text-[11px] font-bold text-emerald-600">₹{tipAmount} tip added — thank you! 🙏</p>
              )}
            </div>

            {/* Bill Details */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm space-y-4">
              <h3 className="text-base font-black text-slate-900 pb-3 border-b border-slate-100">
                Bill Summary
              </h3>

              <div className="space-y-2.5 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span>Item Total (MRP)</span>
                  <span className="font-semibold text-slate-800">₹{originalSubtotal}</span>
                </div>

                <div className="flex justify-between text-emerald-600 font-semibold">
                  <span>Product Discount</span>
                  <span>- ₹{savings}</span>
                </div>

                {couponApplied && appliedCoupon && couponMinOk && (
                  <div className="flex justify-between text-emerald-600 font-semibold">
                    <span>Promo Discount ({appliedCoupon.code})</span>
                    <span>- ₹{couponDiscount}</span>
                  </div>
                )}

                <div className="flex justify-between">
                  <span>Delivery Partner Fee</span>
                  {deliveryFee === 0 ? (
                    <span className="text-emerald-600 font-bold uppercase">FREE</span>
                  ) : (
                    <span className="font-semibold text-slate-800">₹{deliveryFee}</span>
                  )}
                </div>
                {tipAmount > 0 && (
                  <div className="flex justify-between text-emerald-600 font-semibold">
                    <span>Delivery Partner Tip</span>
                    <span>+ ₹{tipAmount}</span>
                  </div>
                )}
                {deliveryFee > 0 && (
                  <p className="text-[10px] text-slate-400">
                    Add ₹{499 - subtotal} more for FREE delivery!
                  </p>
                )}
              </div>

              {/* Total Payable */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                <div>
                  <span className="text-xs text-slate-400 block font-semibold">To Pay</span>
                  <span className="text-2xl font-black text-slate-900">
                    ₹{finalPayable}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[11px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded">
                    Total Savings: ₹{savings + couponDiscount}
                  </span>
                </div>
              </div>

              {/* Payment method and Place Order CTA */}
              <div className="border-t border-slate-100 pt-4">
                <label htmlFor="payment-method" className="mb-2 block text-xs font-bold text-slate-700">
                  Payment method
                </label>
                <select
                  id="payment-method"
                  value={paymentMethod}
                  onChange={(event) => {
                    setPaymentMethod(event.target.value);
                    localStorage.setItem('supercart_payment_method', event.target.value);
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-bold text-slate-800 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100"
                >
                  <option>Cash On Delivery</option>
                  <option>UPI</option>
                  <option>PhonePe</option>
                  <option>Google Pay</option>
                  <option>Debit / Credit Card</option>
                  <option>Other Payment Method</option>
                </select>
                <p className="mt-2 text-[10px] text-slate-400">
                  Payment gateway can be connected to these options later.
                </p>
              </div>

              <button
                onClick={handleCheckout}
                disabled={!isOnline || serviceable === false || isCheckingOut || paymentPending}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-4 text-sm font-black text-white transition shadow-lg shadow-emerald-600/25 hover:bg-emerald-700 active:scale-98 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none"
              >
                <span>{!isOnline ? 'Store is currently closed' : serviceable === false ? 'Service not available in your area' : isCheckingOut ? 'Saving your order...' : `Proceed to Pay (₹${finalPayable})`}</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              {/* Inline 10-sec confirm — checkout page ke andar hi, koi popup nahi */}
              {paymentPending && (
                <div
                  aria-live="polite"
                  className="sc-card-in mt-3 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-slate-700">
                      Confirming your order... last chance to cancel
                    </p>
                    <span
                      key={paymentCountdown}
                      className="sc-count-pop shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-black tabular-nums text-emerald-700 shadow-sm border border-emerald-100"
                    >
                      Auto-confirm in {paymentCountdown}s
                    </span>
                  </div>
                  {/* horizontal progress 0% -> 100% in 10s, green-to-blue gradient */}
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(confirmProgress * 100)}
                    className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-slate-200/70"
                  >
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-teal-400 to-sky-500"
                      style={{
                        width: `${confirmProgress * 100}%`,
                        transition: 'width 1s linear',
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={cancelPayment}
                    className="mt-2.5 w-full rounded-xl border border-rose-200 bg-white py-2.5 text-xs font-black text-rose-600 transition hover:bg-rose-50 hover:border-rose-300 active:scale-[0.98] cursor-pointer"
                  >
                    Cancel Order
                  </button>
                </div>
              )}

              {isCheckingOut && <LoadingState label="Saving your order securely..." />}

              {checkoutError && (
                <p className="text-xs text-red-600 font-semibold text-center">{checkoutError}</p>
              )}

              <p className="text-[10px] text-center text-slate-400 flex items-center justify-center gap-1 mt-2">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Safe & Secure Checkout
              </p>
            </div>

          </div>

        </div>

      </div>
    </div>
    </>
  );
};

export default Cart;
