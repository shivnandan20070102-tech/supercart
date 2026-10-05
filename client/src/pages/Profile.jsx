import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  CreditCard,
  Heart,
  HelpCircle,
  Info,
  LoaderCircle,
  LogOut,
  MapPin,
  Plus,
  Package,
  Phone,
  Save,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getMyOrdersApi } from '../services/api';
import { useWishlist } from '../context/WishlistContext';
import { useCart } from '../context/CartContext';
import ComplaintForm from '../components/ComplaintForm';

const inputClassName = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-800 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100';

const ProfileSection = ({ icon: Icon, title, description, children }) => (
  <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
    <div className="mb-5 flex items-start gap-3 border-b border-slate-100 pb-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <h2 className="text-base font-black text-slate-900">{title}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{description}</p>
      </div>
    </div>
    {children}
  </section>
);

const Profile = () => {
  const { user, updateProfile, logout } = useAuth();
  const { wishlistItems, toggleWishlist } = useWishlist();
  const { addToCart } = useCart();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ name: '', phone: '', email: '', location: '' });
  const [saved, setSaved] = useState(false);
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState(() => localStorage.getItem('supercart_payment_method') || 'Cash on Delivery');
  const [upiId, setUpiId] = useState(() => localStorage.getItem('supercart_upi_id') || '');
  const [paymentSaved, setPaymentSaved] = useState(false);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('supercart_dark_mode') === 'true');
  const [activeSection, setActiveSection] = useState(() => {
    const fromMenu = location.state?.section;
    return ['personal', 'orders', 'payment', 'wishlist', 'appearance', 'complaints'].includes(fromMenu) ? fromMenu : 'personal';
  });
  const sectionContentRef = useRef(null);

  const profileOptions = [
    { id: 'personal', label: 'Personal details', icon: UserRound },
    { id: 'orders', label: 'Your orders', icon: Package },
    { id: 'payment', label: 'Payment settings', icon: CreditCard },
    { id: 'wishlist', label: 'Your wishlist', icon: Heart },
    { id: 'appearance', label: 'Appearance', icon: ShieldCheck },
    { id: 'complaints', label: 'Raise a Complaint', icon: HelpCircle },
  ];

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('supercart_dark_mode', String(darkMode));
  }, [darkMode]);

  useEffect(() => {
    if (activeSection !== 'personal') {
      sectionContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [activeSection]);

  // Account menu se aaye to wahi section kholo (same route par dobara tap par bhi)
  useEffect(() => {
    const fromMenu = location.state?.section;
    if (['personal', 'orders', 'payment', 'wishlist', 'appearance'].includes(fromMenu)) {
      setActiveSection(fromMenu);
    }
  }, [location.state]);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    setForm({
      name: user.name || '',
      phone: user.phone || '',
      email: user.email || '',
      location: user.location || '',
    });

    const loadOrders = async () => {
      try {
        const response = await getMyOrdersApi(user.id);
        if (response.success) setOrders(response.data || []);
      } catch {
        setOrders([]);
      } finally {
        setOrdersLoading(false);
      }
    };
    loadOrders();
  }, [navigate, user]);

  if (!user) return null;

  const handleChange = (event) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
    setSaved(false);
  };

  const handleSaveProfile = async (event) => {
    event.preventDefault();
    setSaved(false);
    const result = await updateProfile(form);
    if (result.success) {
      setSaved(true);
    } else {
      setSaved(result.message || 'Could not save profile.');
    }
  };

  const handleSavePayment = (event) => {
    event.preventDefault();
    localStorage.setItem('supercart_payment_method', paymentMethod);
    localStorage.setItem('supercart_upi_id', upiId);
    setPaymentSaved(true);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <>
      {/* Simple clean top bar — SIRF Profile ke liye (bina branding/delivery/search ke) */}
      <div className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => {
              if (window.history.length > 1) navigate(-1);
              else navigate('/');
            }}
            aria-label="Go back"
            className="flex h-10 w-10 items-center justify-center rounded-full text-slate-700 transition hover:bg-slate-100 active:scale-95"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-base font-black tracking-tight text-slate-900">My Profile</h1>
        </div>
      </div>
      <div className="min-h-screen bg-slate-50 py-8 sm:py-10">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-600">Account center</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-900">My Profile</h1>
            <p className="mt-1 text-sm text-slate-500">Manage your details, orders and preferences.</p>
          </div>
          <Link to="/" className="inline-flex items-center gap-1 text-sm font-bold text-emerald-700 hover:text-emerald-800">
            Continue shopping <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {profileOptions.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSection(id)}
              className={`flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border px-2 py-3 text-center text-xs font-bold transition sm:min-h-24 ${activeSection === id ? 'border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:bg-emerald-50/50'}`}
            >
              <Icon className="h-5 w-5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(260px,0.8fr)]">
          <div ref={sectionContentRef} className="min-w-0 scroll-mt-24 space-y-6">
            {activeSection === 'personal' && <ProfileSection icon={UserRound} title="Personal details" description="Keep your delivery and contact details up to date.">
              <form onSubmit={handleSaveProfile} className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-bold text-slate-600">Full name
                  <input name="name" value={form.name} onChange={handleChange} className={`${inputClassName} mt-1.5`} placeholder="Your name" required />
                </label>
                <label className="text-xs font-bold text-slate-600">Phone number
                  <input name="phone" value={form.phone} onChange={handleChange} className={`${inputClassName} mt-1.5`} placeholder="+91 98765 43210" />
                </label>
                <label className="text-xs font-bold text-slate-600">Email address
                  <input type="email" name="email" value={form.email} onChange={handleChange} className={`${inputClassName} mt-1.5`} placeholder="you@example.com" required />
                </label>
                <label className="text-xs font-bold text-slate-600">Location / delivery address
                  <input name="location" value={form.location} onChange={handleChange} className={`${inputClassName} mt-1.5`} placeholder="Sector 62, Noida" />
                </label>
                <div className="flex items-center gap-3 sm:col-span-2">
                  <button type="submit" className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700">
                    <Save className="h-4 w-4" /> Save changes
                  </button>
                  {saved === true && <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600"><Check className="h-4 w-4" /> Saved to Supabase</span>}
                  {typeof saved === 'string' && <span className="text-xs font-bold text-red-600">{saved}</span>}
                </div>
              </form>
            </ProfileSection>}

            {activeSection === 'orders' && <ProfileSection icon={Package} title="Your orders" description="View your recent grocery orders and their status.">
              {ordersLoading ? (
                <div className="flex items-center gap-2 py-4 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" /> Loading orders...</div>
              ) : orders.length === 0 ? (
                <div className="rounded-2xl bg-slate-50 p-5 text-center">
                  <Package className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-2 text-sm font-bold text-slate-700">No orders yet</p>
                  <Link to="/" className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-emerald-600">Shop groceries <ChevronRight className="h-3.5 w-3.5" /></Link>
                </div>
              ) : orders.map((order) => {
                const orderItems = order.order_items || order.orderItems || [];
                const shippingAddress = order.shipping_address || order.shippingAddress || {};
                const orderDate = order.created_at || order.createdAt;
                const totalPrice = order.total_price ?? order.totalPrice ?? 0;

                return (
                  <article key={order.id} className="mb-4 min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-4 last:mb-0">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
                      <div>
                        <p className="text-sm font-black text-slate-900">Order #{String(order.id).slice(-8)}</p>
                        <p className="mt-1 text-xs text-slate-500">{orderDate ? new Date(orderDate).toLocaleString('en-IN') : 'Recent order'}</p>
                      </div>
                      <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-black text-emerald-700">{order.status || 'Placed'}</span>
                    </div>

                    <div className="grid gap-3 py-3 text-xs sm:grid-cols-2">
                      <div><p className="font-bold text-slate-500">Payment</p><p className="mt-1 font-bold text-slate-800">{order.payment_method || order.paymentMethod || 'Cash On Delivery'}</p></div>
                      <div><p className="font-bold text-slate-500">Delivery location</p><p className="mt-1 font-bold text-slate-800">{shippingAddress.address || shippingAddress.label || 'Home delivery'}</p></div>
                    </div>

                    <div className="border-t border-slate-200 pt-3">
                      <p className="mb-2 text-xs font-black text-slate-700">Products ({orderItems.length})</p>
                      <div className="space-y-2">
                        {orderItems.map((item, index) => (
                          <div key={`${order.id}-${item.productId || item.id || index}`} className="flex min-w-0 items-center justify-between gap-2 rounded-xl bg-white p-2.5">
                            <div className="flex min-w-0 items-center gap-2">
                              {item.image && <img src={item.image} alt="" className="h-9 w-9 shrink-0 rounded-lg object-contain sm:h-10 sm:w-10" />}
                              <div className="min-w-0"><p className="break-words text-xs font-bold text-slate-800">{item.name}</p><p className="text-[11px] text-slate-500">Qty: {item.quantity} · ₹{item.price} each</p></div>
                            </div>
                            <p className="shrink-0 text-xs font-black text-slate-900">₹{Number(item.price || 0) * Number(item.quantity || 0)}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3"><span className="text-xs font-bold text-slate-500">Total paid</span><span className="text-base font-black text-slate-900">₹{totalPrice}</span></div>
                  </article>
                );
              })}
            </ProfileSection>}

            {activeSection === 'payment' && <ProfileSection icon={CreditCard} title="Payment settings" description="Choose your preferred payment method for checkout.">
              <form onSubmit={handleSavePayment} className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  {['Cash on Delivery', 'UPI'].map((method) => (
                    <label key={method} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm font-bold transition ${paymentMethod === method ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600'}`}>
                      <input type="radio" name="payment" value={method} checked={paymentMethod === method} onChange={(event) => { setPaymentMethod(event.target.value); setPaymentSaved(false); }} className="accent-emerald-600" />
                      <CreditCard className="h-4 w-4" /> {method}
                    </label>
                  ))}
                </div>
                {paymentMethod === 'UPI' && <input value={upiId} onChange={(event) => { setUpiId(event.target.value); setPaymentSaved(false); }} className={inputClassName} placeholder="yourname@upi" />}
                <div className="flex items-center gap-3"><button type="submit" className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800">Save payment settings</button>{paymentSaved && <span className="text-xs font-bold text-emerald-600">Saved</span>}</div>
              </form>
            </ProfileSection>}

            {activeSection === 'wishlist' && <ProfileSection icon={Heart} title="Your wishlist" description="Save products you want to buy later.">
              {wishlistItems.length === 0 ? (
                <div className="rounded-2xl bg-rose-50 p-5 text-center"><Heart className="mx-auto h-8 w-8 text-rose-300" /><p className="mt-2 text-sm font-bold text-slate-700">Your wishlist is empty</p><Link to="/" className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-rose-600">Explore products <ChevronRight className="h-3.5 w-3.5" /></Link></div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">{wishlistItems.map((item) => <div key={item.id} className="flex min-w-0 items-center gap-3 rounded-2xl border border-slate-200 p-3"><img src={item.image} alt={item.name} className="h-14 w-14 shrink-0 rounded-xl bg-slate-50 object-contain" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-800">{item.name}</p><p className="text-xs font-black text-slate-900">₹{item.price}</p></div><button type="button" onClick={() => addToCart(item)} aria-label={`Add ${item.name} to cart`} title="Add to cart" className="rounded-xl bg-emerald-50 p-2 text-emerald-600 hover:bg-emerald-600 hover:text-white"><Plus className="h-4 w-4" /></button><button type="button" onClick={() => toggleWishlist(item)} aria-label={`Remove ${item.name} from wishlist`} title="Remove from wishlist" className="rounded-xl p-2 text-rose-500 hover:bg-rose-50"><Heart className="h-4 w-4 fill-current" /></button></div>)}</div>
              )}
            </ProfileSection>}

            {activeSection === 'appearance' && <ProfileSection icon={ShieldCheck} title="Appearance" description="Choose how SuperCart looks on your device.">
              <div className="flex items-center justify-between gap-4">
                <div><p className="text-sm font-bold text-slate-800">Dark mode</p><p className="mt-1 text-xs text-slate-500">Use a darker theme for comfortable night shopping.</p></div>
                <button type="button" role="switch" aria-checked={darkMode} aria-label="Toggle dark mode" onClick={() => setDarkMode((current) => !current)} className={`relative h-7 w-12 shrink-0 rounded-full transition ${darkMode ? 'bg-emerald-600' : 'bg-slate-300'}`}>
                  <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${darkMode ? 'left-6' : 'left-1'}`} />
                </button>
              </div>
            </ProfileSection>}

            {activeSection === 'complaints' && <ProfileSection icon={HelpCircle} title="Raise a Complaint" description="Issue batao (photo ke saath) — Admin jald jawab dega.">
              <ComplaintForm complainantType="customer" userId={user?.id} userName={form.name || user?.name || user?.email || ''} />
            </ProfileSection>}
          </div>

          <aside className="min-w-0 space-y-6">
            <div className="rounded-3xl bg-slate-900 p-6 text-white shadow-lg">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500 text-xl font-black">{user.name?.charAt(0).toUpperCase() || 'U'}</div>
                <div className="min-w-0"><p className="truncate text-lg font-black">{user.name}</p><p className="truncate text-xs text-slate-400">{user.email}</p></div>
              </div>
              <div className="mt-6 flex items-center gap-2 text-xs text-emerald-300"><ShieldCheck className="h-4 w-4" /> Your account is secure</div>
            </div>

            <ProfileSection icon={HelpCircle} title="Need help?" description="We are available 24x7 for your grocery queries.">
              <div className="space-y-3 text-sm"><a href="tel:+919876543210" className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 font-bold text-slate-700 hover:bg-emerald-50"><Phone className="h-4 w-4 text-emerald-600" /> +91 98765 43210</a><a href="mailto:support@supercart.com" className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 font-bold text-slate-700 hover:bg-emerald-50"><HelpCircle className="h-4 w-4 text-emerald-600" /> support@supercart.com</a></div>
            </ProfileSection>

            <ProfileSection icon={Info} title="About us" description="Fresh groceries, delivered to your door in minutes.">
              <p className="text-sm leading-6 text-slate-600">SuperCart makes everyday grocery shopping simple with fresh products, fair prices and reliable delivery.</p>
            </ProfileSection>

            <button onClick={handleLogout} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-200 bg-white px-4 py-3.5 text-sm font-bold text-red-600 transition hover:bg-red-50"><LogOut className="h-4 w-4" /> Log out</button>
          </aside>
        </div>

        <div className="mt-6 flex items-center gap-2 text-xs text-slate-400"><MapPin className="h-3.5 w-3.5" /> Your location is used only to improve delivery estimates.</div>
      </div>
    </div>
    </>
  );
};

export default Profile;