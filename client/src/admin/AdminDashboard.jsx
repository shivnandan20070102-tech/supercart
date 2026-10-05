import React, { useEffect, useRef, useState } from 'react';
import { BarChart3, Box, ChevronDown, Check, Crown, ImagePlus, LogOut, Menu, MessageSquareWarning, Minus, Pencil, Plus, Save, ScrollText, Search, ShieldCheck, Store, Ticket, Trash2, TriangleAlert, Truck, UserRound, Users, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../config/supabase';
import { useStore } from '../context/StoreContext';
import { ensureOrderNotificationPermission, notifyAdminNewOrder, preloadOrderSound, unlockOrderAudio } from '../utils/orderSound';
import ActivityLogSection from './ActivityLogSection';
import InactivityGuard from '../components/InactivityGuard';
import DeliveryBoyDetailsModal from './DeliveryBoyDetailsModal';
import { SignedDocImage, SignedDocLink } from '../components/SignedDoc';
import { logAdminActivity } from '../utils/adminActivity';
import StoresSection from './StoresSection';
import MasterOverview from './MasterOverview';
import ComplaintsSection from './ComplaintsSection';

const sections = [
  { id: 'overview', label: 'Master Overview', icon: Crown },
  { id: 'products', label: 'Products', icon: Box },
  { id: 'inventory', label: 'Inventory Alerts', icon: TriangleAlert },
  { id: 'orders', label: 'Orders', icon: BarChart3 },
  { id: 'stores', label: 'Stores', icon: Store },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'delivery', label: 'Delivery Boys', icon: Truck },
  { id: 'deliveryProfiles', label: 'Pending Partners', icon: UserRound },
  { id: 'complaints', label: 'Complaints', icon: MessageSquareWarning },
  { id: 'coupons', label: 'Coupons', icon: Ticket },
  { id: 'activityLog', label: 'Activity Log', icon: ScrollText },
];
const emptyCoupon = { code: '', discount_type: 'percentage', discount_value: '', min_order_amount: 0, expiry_date: '', is_active: true, usage_limit: '', used_count: 0 };
const emptyProduct = { name: '', description: '', price: '', original_price: '', unit: '', category: '', image: '', stock_quantity: 50, low_stock_threshold: 5, badge: '', is_featured: false };

// ---- Inventory Alerts helpers (canonical: stock_quantity / is_in_stock /
// low_stock_threshold; purane stock/in_stock fallback — sync trigger mirror) ----
const alertQtyOf = (p) => {
  const n = Number(p?.stock_quantity ?? p?.stock);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
};
const alertThresholdOf = (p) => {
  const t = Number(p?.low_stock_threshold);
  return Number.isFinite(t) && t >= 0 ? Math.floor(t) : 5;
};
// 'out' (0) | 'low' (threshold se kam, par 0 nahi) | null (sab thik — list se bahar)
const alertStateOf = (p) => {
  const qty = alertQtyOf(p);
  if (qty <= 0) return 'out';
  if (qty <= alertThresholdOf(p)) return 'low';
  return null;
};
const inputClass = 'w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-500';
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'https://supercart-kloc.onrender.com').replace(/\/+$/, '');

const AdminDashboard = () => {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [active, setActive] = useState('overview');
  const [email, setEmail] = useState('');
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [users, setUsers] = useState([]);
  const [deliveryBoys, setDeliveryBoys] = useState([]);
  const [deliveryProfiles, setDeliveryProfiles] = useState([]);
  const [stores, setStores] = useState([]);
  const [coupons, setCoupons] = useState([]);
  const [couponForm, setCouponForm] = useState(emptyCoupon);
  const [editingCoupon, setEditingCoupon] = useState(null);
  const [couponModal, setCouponModal] = useState(false);
  const [productForm, setProductForm] = useState(emptyProduct);
  const [editingProduct, setEditingProduct] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [productModal, setProductModal] = useState(false);
  // Inventory Alerts quick-edit state.
  const [stockDrafts, setStockDrafts] = useState({}); // productId -> typed input string
  const [updatingStockId, setUpdatingStockId] = useState(null);
  const [expandedOrder, setExpandedOrder] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [userForm, setUserForm] = useState({ name: '', phone: '', role: 'customer' });
  const [notice, setNotice] = useState({ type: '', text: '' });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const { isOnline, setStoreOnline } = useStore();
  const [updatingStore, setUpdatingStore] = useState(false);
  const [assigningId, setAssigningId] = useState(null);
  const [presenceId, setPresenceId] = useState(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [selectedDeliveryBoy, setSelectedDeliveryBoy] = useState(null);

  const notify = (type, text) => setNotice({ type, text });
  const formatDate = (value) => value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Date unavailable';
  // New-order sound dedup: first load = baseline (NO sound). Only IDs never seen
  // before trigger the sound — reloads, re-renders, polling, realtime UPDATEs
  // of known orders stay silent.
  const knownOrderIdsRef = useRef(new Set());
  const ordersReadyRef = useRef(false);
  const IGNORED_NEW_ORDER_STATUS = new Set(['cancelled', 'failed']);
  const handleFreshOrders = (fresh) => {
    if (!fresh || fresh.length === 0) return;
    const first = fresh[0];
    notifyAdminNewOrder({ orderId: first.id, total: first.total_price ?? first.totalPrice });
    notify('success', fresh.length === 1 ? `New Order Received! Order #${String(first.id).slice(-8)} received.` : `New Order Received! ${fresh.length} new orders received.`);
  };
  const loadProducts = async () => { const { data, error } = await supabase.from('products').select('*').order('id', { ascending: false }); if (error) notify('error', error.message); else setProducts(data || []); };
  const loadOrders = async () => {
    const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
    if (error) { notify('error', error.message); return; }
    const rows = data || [];
    if (!ordersReadyRef.current) {
      knownOrderIdsRef.current = new Set(rows.map((order) => String(order.id)));
      ordersReadyRef.current = true;
      setOrders(rows);
      return;
    }
    const known = knownOrderIdsRef.current;
    const fresh = rows.filter((order) => {
      if (known.has(String(order.id))) return false;
      return !IGNORED_NEW_ORDER_STATUS.has(String(order.status || '').toLowerCase());
    });
    rows.forEach((order) => known.add(String(order.id)));
    setOrders(rows);
    if (fresh.length > 0) handleFreshOrders(fresh);
  };
  const loadUsers = async () => {
    // Availability flags ke saath (admin dropdown me busy/available dikhe).
    // Columns abhi Supabase me na bane hon to basic select par fallback.
    const full = await supabase.from('users').select('id,name,email,phone,location,role,verified,is_available,created_at').order('created_at', { ascending: false });
    if (!full.error) {
      setUsers(full.data || []);
      setDeliveryBoys((full.data || []).filter((item) => ['delivery_partner', 'delivery'].includes(item.role)));
      return;
    }
    const { data, error } = await supabase.from('users').select('id,name,email,phone,location,role,created_at').order('created_at', { ascending: false });
    if (error) notify('error', `Users: ${error.message}`);
    else { setUsers(data || []); setDeliveryBoys((data || []).filter((item) => ['delivery_partner', 'delivery'].includes(item.role))); }
  };
  const loadDeliveryProfiles = async () => { const { data, error } = await supabase.from('delivery_profiles').select('*').order('created_at', { ascending: false }); if (error) notify('error', `Partner profiles: ${error.message}`); else setDeliveryProfiles(data || []); };
  // Home Store naam + manual change ke liye halki stores list (id + naam hi kaafi)
  const loadStores = async () => { const { data, error } = await supabase.from('stores').select('id, store_name').order('id', { ascending: true }); if (error) notify('error', `Stores: ${error.message}`); else setStores(data || []); };
  const homeStoreNameById = new Map(stores.map((s) => [Number(s.id), s.store_name]));
  // Edge case (galat pin) ke liye Admin manual Home Store badal sakta hai
  const updateHomeStore = async (partner, value) => {
    const home_store_id = value === '' ? null : Number(value);
    if (value !== '' && !Number.isFinite(home_store_id)) { notify('error', 'Please select a valid store.'); return; }
    const { error } = await supabase.from('delivery_profiles').update({ home_store_id }).eq('user_id', partner.user_id);
    if (error) {
      if (/home_store_id|column|schema cache/i.test(error.message || '')) notify('error', 'Home Store column not found — Run server/supabase_delivery_home_store.sql in Supabase.');
      else notify('error', `Home Store: ${error.message}`);
    } else {
      await loadDeliveryProfiles();
      notify('success', home_store_id == null ? `${partner.name || 'Partner'}'s Home Store removed.` : `${partner.name || 'Partner'}'s Home Store set to "${homeStoreNameById.get(home_store_id) || `#${home_store_id}`}".`);
    }
  };
  const loadCoupons = async () => { const { data, error } = await supabase.from('coupons').select('*').order('created_at', { ascending: false }); if (error) { if (/could not find the table|does not exist|schema cache/i.test(error.message || '')) notify('error', 'Coupons table missing. Please run server/supabase_coupons.sql in Supabase SQL editor.'); else notify('error', `Coupons: ${error.message}`); } else setCoupons(data || []); };

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) { navigate('/admin/login', { replace: true }); return; }
      const { data: profile } = await supabase.from('users').select('role').eq('email', user.email).maybeSingle();
      const isAdmin = String(user.user_metadata?.role || '').toLowerCase() === 'admin' || String(profile?.role || '').toLowerCase() === 'admin';
      if (!mounted) return;
      if (!isAdmin) { navigate('/', { replace: true }); return; }
      setEmail(user.email || 'Admin');
      ensureOrderNotificationPermission();
      preloadOrderSound();
      // Pehle click par audio unlock (autoplay policy) — ek baar hi chahiye.
      window.addEventListener('pointerdown', unlockOrderAudio, { once: true });
      await Promise.all([loadProducts(), loadOrders(), loadUsers(), loadDeliveryProfiles(), loadCoupons(), loadStores()]);
      setLoading(false); setChecking(false);
    };
    init();
    return () => { mounted = false; };
  }, [navigate]);

  useEffect(() => {
    if (checking) return undefined;
    const channel = supabase.channel('admin-data-realtime').on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, loadProducts).on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, loadOrders).on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, loadUsers).on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_profiles' }, loadDeliveryProfiles).on('postgres_changes', { event: '*', schema: 'public', table: 'coupons' }, loadCoupons).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [checking]);

  const saveProduct = async (event) => {
    event.preventDefault();
    try {
      let image = productForm.image;
      if (imageFile) {
        const path = `products/${crypto.randomUUID()}-${imageFile.name}`;
        const upload = await supabase.storage.from('product-images').upload(path, imageFile, { contentType: imageFile.type });
        if (upload.error) throw upload.error;
        image = supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl;
      }
      if (!image) throw new Error('Product image required.');
      // Canonical stock columns (sync trigger purane stock/in_stock ko mirror
      // karta hai). GENERATED is_in_stock + legacy mirrors kabhi bhejo mat —
      // DB khud banata hai, bhejne par error aata hai.
      const payload = {
        ...productForm,
        image,
        price: Number(productForm.price),
        original_price: Number(productForm.original_price || productForm.price),
        stock_quantity: Math.max(0, Number(productForm.stock_quantity ?? productForm.stock ?? 0) || 0),
        low_stock_threshold: Math.max(0, Number(productForm.low_stock_threshold ?? 5) || 0),
      };
      delete payload.stock;
      delete payload.in_stock;
      delete payload.is_in_stock;
      const result = editingProduct ? await supabase.from('products').update(payload).eq('id', editingProduct) : await supabase.from('products').insert(payload);
      if (result.error) throw result.error;
      setProductModal(false); setEditingProduct(null); setProductForm(emptyProduct); setImageFile(null); setImagePreview(''); notify('success', editingProduct ? 'Product updated.' : 'Product added.'); await loadProducts();
    } catch (error) { notify('error', error.message); }
  };

  const editProduct = (product) => { setEditingProduct(product.id); setProductForm({ ...emptyProduct, ...product }); setImagePreview(product.image || ''); setImageFile(null); setProductModal(true); };
  const deleteProduct = async (product) => { if (!window.confirm(`Delete ${product.name}?`)) return; const { error } = await supabase.from('products').delete().eq('id', product.id); if (error) notify('error', error.message); else { notify('success', 'Product deleted.'); loadProducts(); } };
  const updateStatus = async (id, status) => { const { error } = await supabase.from('orders').update({ status }).eq('id', id); if (error) notify('error', error.message); else { notify('success', 'Order status updated.'); logAdminActivity({ actionType: 'order_status_changed', targetId: id, description: `Manually changed order #${id} status to ${status}` }); loadOrders(); } };
  const assignBoy = async (id, delivery_boy_id) => {
    const order = orders.find((item) => String(item.id) === String(id));
    const prev = order?.delivery_boy_id ? String(order.delivery_boy_id) : '';
    const next = delivery_boy_id ? String(delivery_boy_id) : '';
    if (prev === next) return;
    // Pehle se assigned partner ko emergency me hi badlo — galat click se bacho
    if (prev && next && !window.confirm(`Order #${id} is already assigned. Override and change the partner?`)) {
      await loadOrders();
      return;
    }
    setAssigningId(id);
    try {
      // 1. Backend API first: status + availability swap server par atomic hota hai
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${API_BASE_URL}/api/orders/${id}/assign`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
          body: JSON.stringify({ deliveryBoyId: next || null }),
        });
        const json = await res.json().catch(() => null);
        if (res.ok && json?.success) {
          notify('success', json.message || 'Delivery partner updated (manual override).');
          const targetBoy = next ? deliveryBoys.find((b) => String(b.id) === next) : null;
          const boyLabel = targetBoy ? (targetBoy.name || targetBoy.email || next) : next;
          logAdminActivity({
            actionType: next ? 'assigned_delivery_partner' : 'unassigned_delivery_partner',
            targetId: id,
            description: next ? `Manually assigned ${boyLabel} to order #${id}` : `Manually removed partner from order #${id}`,
          });
          await Promise.all([loadOrders(), loadUsers()]);
          return;
        }
        throw new Error(json?.message || `Server responded ${res.status}`);
      } catch (apiError) {
        // 2. Fallback: backend down ho to direct Supabase (emergency path)
        //    Rejected partner ko bhi allow — admin override sabse upar.
        //    FINAL FLOW: unassign hamesha 'packed' (delivery queue) me — store ko
        //    dobara pack nahi karna padta; worker agle FREE partner ko dega.
        const patch = next
          ? { delivery_boy_id: next, status: String(order?.status || '').toLowerCase() === 'delivered' ? order.status : 'assigned' }
          : { delivery_boy_id: null, status: 'packed' };
        if (next && Array.isArray(order?.rejected_by)) {
          patch.rejected_by = order.rejected_by.filter((r) => String(r) !== String(next));
        }
        const { error } = await supabase.from('orders').update(patch).eq('id', id);
        if (error) throw error;
        // NOTE: is_available ko HAATH NAHI lagate — Online/Offline SIRF neeche
        // wale Admin toggle ya partner ke apne toggle se badalta hai.
        notify('success', next ? 'Delivery partner updated (manual override).' : 'Partner removed - order moved to packed queue.');
        const fallbackBoy = next ? deliveryBoys.find((b) => String(b.id) === next) : null;
        const fallbackLabel = fallbackBoy ? (fallbackBoy.name || fallbackBoy.email || next) : next;
        logAdminActivity({
          actionType: next ? 'assigned_delivery_partner' : 'unassigned_delivery_partner',
          targetId: id,
          description: next ? `Manually assigned ${fallbackLabel} to order #${id}` : `Manually removed partner from order #${id}`,
        });
        await Promise.all([loadOrders(), loadUsers()]);
      }
    } catch (error) {
      notify('error', error.message || 'Could not update delivery partner.');
      await loadOrders();
    } finally {
      setAssigningId(null);
    }
  };
  const eligibleDeliveryBoys = (order) => { const rejectedBy = Array.isArray(order.rejected_by) ? order.rejected_by : []; return deliveryBoys.filter((boy) => !rejectedBy.includes(boy.id)); };
  // ADMIN presence toggle — is_available ka dusra allowed writer (pehla: partner ka apna toggle).
  // Turant Supabase me update hota hai; partner dashboard Realtime se reflect karta hai.
  const togglePartnerAvailability = async (boy, partner) => {
    const current = partner?.is_available !== false && boy?.is_available !== false;
    const next = !current;
    setPresenceId(boy.id);
    try {
      const { error: userError } = await supabase.from('users').update({ is_available: next }).eq('id', boy.id);
      if (userError) throw userError;
      try { await supabase.from('delivery_profiles').update({ is_available: next }).eq('user_id', boy.id); } catch (e) { /* profile row optional */ }
      notify('success', `${boy.name || boy.email} is now ${next ? 'Online' : 'Offline'}.`);
      await Promise.all([loadUsers(), loadDeliveryProfiles()]);
    } catch (error) {
      notify('error', error.message || 'Status could not be updated.');
    } finally {
      setPresenceId(null);
    }
  };
  // Manual-override dropdown: SAARE partners dikhao (rejected ko bhi — emergency),
  // busy/available + rejected label ke saath. Current partner hamesha list me.
  const dropdownBoys = (order) => {
    const rejectedBy = Array.isArray(order?.rejected_by) ? order.rejected_by.map(String) : [];
    const current = order?.delivery_boy_id ? String(order.delivery_boy_id) : '';
    const sorted = [...deliveryBoys].sort((a, b) => String(a.name || a.email || '').localeCompare(String(b.name || b.email || '')));
    if (current && !sorted.some((boy) => String(boy.id) === current)) {
      sorted.unshift({ id: current, name: 'Current partner', email: `${String(current).slice(0, 8)}…` });
    }
    return sorted.map((boy) => ({ ...boy, _rejected: rejectedBy.includes(String(boy.id)) }));
  };
  const partnerLabel = (boy) => {
    const base = boy.name || boy.email || String(boy.id).slice(0, 8);
    const tags = [];
    if (boy.is_available === false) tags.push('offline');
    if (boy._rejected) tags.push('rejected — override');
    return tags.length > 0 ? `${base} (${tags.join(', ')})` : base;
  };
  const q = search.trim().toLowerCase();
  const filteredProducts = q ? products.filter((item) => [item.name, item.category, item.unit, item.description, item.badge, String(item.id), String(item.price)].filter(Boolean).join(' ').toLowerCase().includes(q)) : products;
  const filteredOrders = q ? orders.filter((order) => { const items = order.order_items || order.orderItems || []; const itemsText = items.map((i) => `${i.name || ''} ${i.productId || i.id || ''}`).join(' '); const addr = order.shipping_address || order.shippingAddress || {}; const hay = [String(order.id), order.status, order.payment_method || order.paymentMethod, order.user_id || order.userId, order.delivery_boy_id, String(order.total_price ?? order.totalPrice ?? ''), itemsText, addr.address, addr.label, addr.city, addr.phone].filter(Boolean).join(' ').toLowerCase(); return hay.includes(q); }) : orders;
  const filteredUsers = q ? users.filter((item) => [item.name, item.email, item.phone, item.role, item.location, String(item.id)].filter(Boolean).join(' ').toLowerCase().includes(q)) : users;
  const filteredDeliveryBoys = q ? deliveryBoys.filter((boy) => [boy.name, boy.email, boy.phone, String(boy.id)].filter(Boolean).join(' ').toLowerCase().includes(q)) : deliveryBoys;
  const profileCandidates = active === 'deliveryProfiles' ? deliveryProfiles.filter((p) => String(p.approval_status || 'pending').toLowerCase() === 'pending' && p.profile_completed === true) : deliveryProfiles;
  const filteredDeliveryProfiles = q ? profileCandidates.filter((p) => [p.name, p.email, p.phone, p.user_id].filter(Boolean).join(' ').toLowerCase().includes(q)) : profileCandidates;
  const deliveryProfileByUser = new Map(deliveryProfiles.map((profile) => [profile.user_id, profile]));
  const filteredCoupons = q ? coupons.filter((c) => [c.code, c.discount_type, String(c.discount_value), String(c.min_order_amount), c.expiry_date, String(c.id)].filter(Boolean).join(' ').toLowerCase().includes(q)) : coupons;
  // Inventory Alerts: saare stores ke Out + Low stock ek list me (Out sabse
  // upar). products state admin-data-realtime channel se live reload hota hai,
  // isliye ye list bhi Realtime hai — alag subscription nahi chahiye.
  const alertProducts = (() => {
    const base = q ? products.filter((item) => [item.name, item.category, item.unit, String(item.id)].filter(Boolean).join(' ').toLowerCase().includes(q)) : products;
    return base
      .filter((item) => alertStateOf(item) !== null)
      .sort((a, b) => {
        const ra = alertStateOf(a) === 'out' ? 0 : 1;
        const rb = alertStateOf(b) === 'out' ? 0 : 1;
        return ra - rb || String(a.name || '').localeCompare(String(b.name || ''));
      });
  })();
  const outCount = alertProducts.filter((p) => alertStateOf(p) === 'out').length;
  const lowCount = alertProducts.length - outCount;
  // Quick-edit: seedha yahin se stock save (sync trigger mirrors sambhalta hai).
  const saveAlertStock = async (product, nextQty) => {
    const qty = Math.floor(Number(nextQty));
    if (!product || !Number.isFinite(qty) || qty < 0) {
      notify('error', 'Enter a valid quantity (0 or more).');
      return;
    }
    if (updatingStockId) return;
    setUpdatingStockId(product.id);
    try {
      const { error } = await supabase.from('products').update({ stock_quantity: qty }).eq('id', product.id);
      if (error) throw error;
      setStockDrafts((prev) => {
        const next = { ...prev };
        delete next[product.id];
        return next;
      });
      notify('success', `${product.name}: stock updated to ${qty}.`);
      await loadProducts();
    } catch (error) {
      notify('error', error.message || 'Could not update stock.');
    } finally {
      setUpdatingStockId(null);
    }
  };
  const saveUser = async (id) => { const { error } = await supabase.from('users').update(userForm).eq('id', id); if (error) notify('error', error.message); else { setEditingUser(null); notify('success', 'User updated.'); loadUsers(); } };
  const deleteUser = async (user) => {
    if (user.email === email) {
      notify('error', 'You cannot delete the currently logged-in admin.');
      return;
    }
    if (!window.confirm(`Delete profile ${user.email}? Existing orders will be preserved.`)) return;
    const detachOrders = await supabase.from('orders').update({ user_id: null }).eq('user_id', user.id);
    if (detachOrders.error) {
      notify('error', `Could not preserve user orders: ${detachOrders.error.message}`);
      return;
    }
    const { error } = await supabase.from('users').delete().eq('id', user.id);
    if (error) notify('error', error.message);
    else { notify('success', 'User profile deleted. Existing orders were preserved.'); loadUsers(); }
  };
  const openCouponModal = (coupon) => { if (coupon) { setEditingCoupon(coupon.id); setCouponForm({ code: coupon.code || '', discount_type: coupon.discount_type || 'percentage', discount_value: coupon.discount_value ?? '', min_order_amount: coupon.min_order_amount ?? 0, expiry_date: coupon.expiry_date ? String(coupon.expiry_date).slice(0, 10) : '', is_active: coupon.is_active !== false, usage_limit: coupon.usage_limit ?? '', used_count: coupon.used_count ?? 0 }); } else { setEditingCoupon(null); setCouponForm(emptyCoupon); } setCouponModal(true); };
  const saveCoupon = async (event) => {
    event.preventDefault();
    try {
      const code = String(couponForm.code || '').trim().toUpperCase();
      if (!code) throw new Error('Coupon code required.');
      const discountValue = Number(couponForm.discount_value);
      if (!discountValue || discountValue <= 0) throw new Error('Discount value must be greater than 0.');
      if (couponForm.discount_type === 'percentage' && discountValue > 100) throw new Error('Percentage discount cannot exceed 100.');
      const payload = { code, discount_type: couponForm.discount_type === 'flat' ? 'flat' : 'percentage', discount_value: discountValue, min_order_amount: Number(couponForm.min_order_amount || 0), expiry_date: couponForm.expiry_date || null, is_active: couponForm.is_active !== false, usage_limit: couponForm.usage_limit === '' || couponForm.usage_limit === null ? null : Number(couponForm.usage_limit), used_count: Number(couponForm.used_count || 0) };
      const result = editingCoupon ? await supabase.from('coupons').update(payload).eq('id', editingCoupon) : await supabase.from('coupons').insert(payload);
      if (result.error) throw result.error;
      setCouponModal(false); setEditingCoupon(null); setCouponForm(emptyCoupon); notify('success', editingCoupon ? 'Coupon updated.' : 'Coupon added.'); await loadCoupons();
    } catch (error) { notify('error', error.message); }
  };
  const deleteCoupon = async (coupon) => { if (!window.confirm(`Delete coupon ${coupon.code}?`)) return; const { error } = await supabase.from('coupons').delete().eq('id', coupon.id); if (error) notify('error', error.message); else { notify('success', 'Coupon deleted.'); loadCoupons(); } };
  const updateApprovalStatus = async (partner, approval_status) => {
    const rejection_reason = approval_status === 'rejected' ? window.prompt('Reject reason (optional):', partner.rejection_reason || '') : null;
    const { error } = await supabase.from('delivery_profiles').update({ approval_status, rejection_reason }).eq('user_id', partner.user_id);
    if (error) notify('error', `Approval status: ${error.message}`);
    else {
      // Auto-assign (Node worker/pack + DB triggers) users.verified gate par bhi
      // chalta hai — approval ke saath ye flag sync rakho, warna approved +
      // Online partner ko bhi packed order assign nahi hoga.
      try {
        await supabase.from('users').update({ verified: approval_status === 'approved' }).eq('id', partner.user_id);
      } catch { /* best-effort: assign me approval_status fallback bhi hai */ }
      await loadDeliveryProfiles();
      notify('success', `${partner.name || 'Partner'} is now ${approval_status}.`);
      if (approval_status === 'approved' || approval_status === 'rejected') {
        logAdminActivity({
          actionType: approval_status === 'approved' ? 'approved_delivery_partner' : 'rejected_delivery_partner',
          targetId: partner.user_id,
          description: `${approval_status === 'approved' ? 'Approved' : 'Rejected'} ${partner.name || partner.email || 'partner'} as delivery partner`,
        });
      }
    }
  };
  const toggleCoupon = async (coupon) => { const { error } = await supabase.from('coupons').update({ is_active: !coupon.is_active }).eq('id', coupon.id); if (error) notify('error', error.message); else { notify('success', `Coupon ${coupon.code} is now ${!coupon.is_active ? 'active' : 'inactive'}.`); loadCoupons(); } };
  // Assign source badge: order us store ke HOME partner ko gaya ya fallback ko.
  // Inference: partner ka home_store_id == order ka store_id → Home, warna Fallback.
  // Node/worker/DB-trigger/manual — har path par sahi dikhta hai, schema change nahi.
  const assignSourceBadge = (order) => {
    const boyId = order?.delivery_boy_id ? String(order.delivery_boy_id) : '';
    if (!boyId) return null;
    const prof = deliveryProfileByUser.get(boyId);
    const home = prof?.home_store_id != null ? Number(prof.home_store_id) : null;
    const isHome = home != null && order.store_id != null && Number(order.store_id) === home;
    return isHome
      ? <span title="Home Store Partner — assigned partner of this store" className="rounded-full bg-emerald-950 px-2 py-1 text-[10px] font-black uppercase text-emerald-300">🏠 Home Store Partner</span>
      : <span title="Fallback Partner — home partner of that store was unavailable" className="rounded-full bg-amber-950 px-2 py-1 text-[10px] font-black uppercase text-amber-300">↩ Fallback Partner</span>;
  };
  const logout = async () => { await supabase.auth.signOut(); navigate('/', { replace: true }); };
  const toggleStore = async () => {
    setUpdatingStore(true);
    try { await setStoreOnline(!isOnline); notify('success', `Store is now ${!isOnline ? 'online' : 'offline'}.`); }
    catch (error) { notify('error', error.message); }
    finally { setUpdatingStore(false); }
  };

  if (checking) return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm font-bold text-emerald-300">Checking admin access...</div>;
  const current = sections.find((item) => item.id === active) || sections[0];
  const CurrentIcon = current.icon;

  return <div className="flex min-h-screen bg-slate-950 text-slate-100">
    <InactivityGuard loginPath="/admin/login" />
    <button type="button" aria-label="Open admin navigation" onClick={() => setMobileSidebarOpen(true)} className="fixed left-4 top-4 z-40 rounded-xl border border-slate-700 bg-slate-900 p-2.5 text-slate-100 shadow-lg md:hidden"><Menu className="h-5 w-5" /></button>
    {mobileSidebarOpen && <button type="button" aria-label="Close admin navigation" onClick={() => setMobileSidebarOpen(false)} className="fixed inset-0 z-40 bg-black/60 md:hidden" />}
    <aside className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] shrink-0 flex-col border-r border-slate-800 bg-slate-900 p-4 transition-transform duration-200 md:static md:z-auto md:w-64 md:translate-x-0 ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}><div className="flex items-center gap-3 border-b border-slate-800 px-2 pb-5"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-slate-950"><ShieldCheck className="h-5 w-5" /></div><div><p className="font-black">SuperCart</p><p className="text-[10px] uppercase tracking-widest text-emerald-400">Admin Panel</p></div></div><nav className="mt-6 space-y-2">{sections.map(({ id, label, icon: Icon }) => { const count = id === 'overview' ? orders.length : id === 'orders' ? orders.length : id === 'users' ? users.length : id === 'delivery' ? deliveryBoys.length : id === 'coupons' ? coupons.length : null; return <button key={id} onClick={() => { setActive(id); setSearch(''); setMobileSidebarOpen(false); }} className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm font-bold ${active === id ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}><span className="flex items-center gap-3"><Icon className="h-4 w-4" />{label}</span>{count !== null && <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px]">{count}</span>}</button>; })}</nav><button onClick={logout} className="mt-auto flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold text-rose-300"><LogOut className="h-4 w-4" />Log out</button></aside>
    <main className="min-w-0 flex-1 bg-slate-950 p-4 pt-20 sm:p-8 sm:pt-8"><div className="mx-auto max-w-7xl"><div className="mb-8 flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-emerald-400">Control room</p><h1 className="mt-2 text-3xl font-black text-white">{current.label}</h1></div><div className="flex flex-wrap items-center gap-3"><label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 sm:max-w-xs"><Search className="h-4 w-4 shrink-0 text-slate-500" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={active === 'overview' ? 'Search all data (order, customer, store...)' : active === 'products' ? 'Search products...' : active === 'orders' ? 'Search orders...' : active === 'stores' ? 'Search stores...' : active === 'users' ? 'Search users...' : active === 'delivery' ? 'Search delivery boys...' : active === 'coupons' ? 'Search coupons...' : 'Search partners...'} className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500" />{search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search"><X className="h-4 w-4 text-slate-500 hover:text-white" /></button>}</label><button type="button" onClick={toggleStore} disabled={updatingStore} className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black transition disabled:cursor-wait disabled:opacity-60 ${isOnline ? 'bg-emerald-500 text-slate-950' : 'bg-rose-500 text-white'}`}><Store className="h-4 w-4" />{updatingStore ? 'Updating...' : isOnline ? 'Online' : 'Offline'}</button><p className="text-xs text-slate-500">{email}</p></div></div>{notice.text && <div className={`mb-5 rounded-xl p-3 text-sm font-bold ${notice.type === 'error' ? 'bg-rose-950 text-rose-300' : 'bg-emerald-950 text-emerald-300'}`}>{notice.text}</div>}
      {active === 'overview' && <MasterOverview searchQuery={search} />}
      {active === 'products' && <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-6"><div className="mb-5 flex justify-between gap-3"><div><h2 className="font-black">Products</h2><p className="text-xs text-slate-500">{q ? `${filteredProducts.length} of ${products.length} products` : `${products.length} products`}</p></div><button onClick={() => { setProductForm(emptyProduct); setEditingProduct(null); setImagePreview(''); setProductModal(true); }} className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-black text-slate-950"><Plus className="h-4 w-4" />Add Product</button></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="text-xs text-slate-500"><tr><th className="p-3">Product</th><th className="p-3">Category</th><th className="p-3">Price</th><th className="p-3">Stock</th><th className="p-3">Actions</th></tr></thead><tbody className="divide-y divide-slate-800">{filteredProducts.map((item) => <tr key={item.id}><td className="p-3"><div className="flex items-center gap-3"><img src={item.image || '/favicon.svg'} alt={item.name} onError={(event) => { event.currentTarget.src = '/favicon.svg'; }} className="h-12 w-12 rounded-xl bg-slate-800 object-contain" /><div><p className="font-bold text-white">{item.name}</p><p className="text-xs text-slate-500">{item.unit}</p></div></div></td><td className="p-3 text-slate-400">{item.category}</td><td className="p-3">₹{item.price}</td><td className="p-3">{item.stock_quantity ?? item.stock}</td><td className="p-3"><button onClick={() => editProduct(item)} className="mr-2 text-blue-300"><Pencil className="h-4 w-4" /></button><button onClick={() => deleteProduct(item)} className="text-rose-300"><Trash2 className="h-4 w-4" /></button></td></tr>)}</tbody></table></div></section>}
      {active === 'inventory' && <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-6">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <TriangleAlert className="h-5 w-5 text-amber-300" />
          <h2 className="text-lg font-black">Inventory Alerts</h2>
          <span className="rounded-full bg-rose-600 px-2.5 py-1 text-[10px] font-black uppercase text-white">{outCount} Out</span>
          <span className="rounded-full bg-amber-400 px-2.5 py-1 text-[10px] font-black uppercase text-slate-950">{lowCount} Low</span>
          <span className="ml-auto rounded-full bg-slate-800 px-2.5 py-1 text-[10px] font-bold text-slate-400">Live · auto-updates</span>
        </div>
        <p className="mb-4 text-xs text-slate-400">Saare stores ke khatam / khatam-hone-wale products — store naam ke saath. Stock yahin se turant update karo.</p>
        {alertProducts.length === 0 ? (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8 text-center">
            <p className="text-sm font-black text-emerald-300">All stocked up — koi Low ya Out of Stock product nahi 🎉</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {alertProducts.map((p) => {
              const qty = alertQtyOf(p);
              const th = alertThresholdOf(p);
              const state = alertStateOf(p);
              const busy = updatingStockId === p.id;
              const draft = stockDrafts[p.id];
              const storeName = p.store_id == null ? 'All stores' : (homeStoreNameById.get(Number(p.store_id)) || `Store #${p.store_id}`);
              return (
                <li key={p.id} className={`overflow-hidden rounded-2xl border bg-slate-950/60 ${state === 'out' ? 'border-rose-500/60' : 'border-amber-400/50'}`}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    {p.image ? (
                      <img src={p.image} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-xl bg-slate-800 object-contain" onError={(event) => { try { event.currentTarget.style.display = 'none'; } catch { /* ignore */ } }} />
                    ) : (
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-xs font-black text-slate-500">—</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-black text-white">{p.name}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                        <span className="rounded-full bg-slate-800 px-2 py-0.5 font-bold text-emerald-300">{storeName}</span>
                        <span>{p.unit || ''}</span>
                      </p>
                      <p className={`mt-1 text-xs font-black ${state === 'out' ? 'text-rose-400' : 'text-amber-300'}`}>
                        {state === 'out' ? 'Out of Stock — 0 available' : `Low Stock — only ${qty} left (alert at ${th})`}
                      </p>
                    </div>
                    {state === 'out' ? (
                      <span className="shrink-0 rounded-full bg-rose-600 px-3 py-1 text-[10px] font-black uppercase text-white">Out of Stock</span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-amber-400 px-3 py-1 text-[10px] font-black uppercase text-slate-950">Low Stock</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 border-t border-slate-800 px-4 py-3">
                    <button type="button" aria-label={`Decrease stock of ${p.name}`} disabled={busy || qty <= 0} onClick={() => saveAlertStock(p, qty - 1)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-white transition hover:bg-slate-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40">
                      <Minus className="h-4 w-4" />
                    </button>
                    <input type="number" min="0" inputMode="numeric" aria-label={`Exact stock quantity for ${p.name}`} disabled={busy} value={draft !== undefined ? draft : String(qty)} onChange={(e) => setStockDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') saveAlertStock(p, stockDrafts[p.id] !== undefined ? stockDrafts[p.id] : qty); }} className="h-10 w-20 shrink-0 rounded-xl border border-slate-700 bg-slate-950 px-2 text-center text-sm font-black text-white outline-none focus:border-emerald-500 disabled:opacity-50" />
                    <button type="button" aria-label={`Increase stock of ${p.name}`} disabled={busy} onClick={() => saveAlertStock(p, qty + 1)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-white transition hover:bg-slate-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40">
                      <Plus className="h-4 w-4" />
                    </button>
                    <button type="button" disabled={busy} onClick={() => saveAlertStock(p, stockDrafts[p.id] !== undefined ? stockDrafts[p.id] : qty)} className="h-10 flex-1 rounded-xl bg-emerald-500 text-xs font-black text-slate-950 transition hover:bg-emerald-400 active:scale-[0.99] disabled:cursor-wait disabled:opacity-60">
                      {busy ? 'Saving…' : 'Update'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>}
      {active === 'stores' && <StoresSection searchQuery={search} />}
      {active === 'complaints' && <ComplaintsSection searchQuery={search} />}
      {active === 'activityLog' && <ActivityLogSection />}
      {active === 'orders' && <section className="space-y-3">{q && <p className="text-xs text-slate-400">{filteredOrders.length} of {orders.length} orders match</p>}{filteredOrders.length === 0 && <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center text-sm text-slate-400">No orders found.</div>}{filteredOrders.map((order) => { const items = order.order_items || order.orderItems || []; const savedStatus = order.status || ''; const knownStatus = ['pending', 'pending_assignment', 'packed', 'assigned', 'accepted', 'picked_up', 'Placed', 'confirmed', 'out_for_delivery', 'delivered']; return <article key={order.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><button onClick={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)} className="flex items-center gap-2 text-left font-bold"><ChevronDown className="h-4 w-4" /><span>Order #{order.id}<small className="mt-1 block text-xs font-normal text-slate-400">{formatDate(order.created_at || order.createdAt)} · {items.length} items{Array.isArray(order.rejected_by) && order.rejected_by.length > 0 ? ` · Rejected by ${order.rejected_by.length} partner(s)` : ''}</small></span></button><div className="flex flex-wrap gap-2"><b>₹{order.total_price ?? order.totalPrice ?? 0}</b>{assignSourceBadge(order)}<select value={savedStatus} onChange={(event) => updateStatus(order.id, event.target.value)} className="rounded-lg bg-slate-800 p-2 text-xs"><option value="">Keep current status</option>{savedStatus && !knownStatus.includes(savedStatus) && <option value={savedStatus}>{savedStatus}</option>}<option value="pending">pending</option><option value="pending_assignment">pending_assignment</option><option value="packed">packed</option><option value="assigned">assigned</option><option value="confirmed">confirmed</option><option value="out_for_delivery">out_for_delivery</option><option value="accepted">accepted</option><option value="picked_up">picked_up</option><option value="delivered">delivered</option></select><select value={order.delivery_boy_id ?? ''} disabled={assigningId === order.id} title="Manual override — change partner in an emergency despite auto-assign" onChange={(event) => assignBoy(order.id, event.target.value)} className="rounded-lg bg-slate-800 p-2 text-xs disabled:cursor-wait disabled:opacity-60"><option value="">{assigningId === order.id ? 'Updating…' : 'No delivery boy assigned'}</option>{dropdownBoys(order).map((boy) => <option key={boy.id} value={boy.id}>{partnerLabel(boy)}</option>)}</select></div></div>{expandedOrder === order.id && <div className="mt-4 space-y-2 border-t border-slate-800 pt-4">{items.map((item, index) => <div key={index} className="flex items-center justify-between gap-3 rounded-lg bg-slate-800 p-3 text-xs"><div className="flex min-w-0 items-center gap-3"><img src={item.image || '/favicon.svg'} alt={item.name || ''} onError={(event) => { event.currentTarget.src = '/favicon.svg'; }} className="h-12 w-12 shrink-0 rounded-lg bg-slate-700 object-contain" /><span className="min-w-0"><b className="block truncate">{item.name || 'Product'}</b><span className="text-slate-400">Qty {item.quantity} · ₹{item.price}</span></span></div><b>₹{Number(item.price || 0) * Number(item.quantity || 0)}</b></div>)}</div>}</article>; })}</section>}
      {active === 'users' && <section className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900 p-4"><h2 className="mb-4 font-black">Users ({q ? `${filteredUsers.length} of ${users.length}` : users.length})</h2><table className="w-full min-w-[850px] text-left text-sm"><thead className="text-xs text-slate-500"><tr><th className="p-3">Name</th><th className="p-3">Email</th><th className="p-3">Phone</th><th className="p-3">Role</th><th className="p-3">Actions</th></tr></thead><tbody className="divide-y divide-slate-800">{filteredUsers.map((item) => <tr key={item.id}><td className="p-3">{editingUser === item.id ? <input value={userForm.name} onChange={(event) => setUserForm({ ...userForm, name: event.target.value })} className="rounded bg-slate-800 p-2" /> : item.name}</td><td className="p-3 text-slate-400">{item.email}</td><td className="p-3">{editingUser === item.id ? <input value={userForm.phone} onChange={(event) => setUserForm({ ...userForm, phone: event.target.value })} className="rounded bg-slate-800 p-2" /> : item.phone || '-'}</td><td className="p-3">{editingUser === item.id ? <select value={userForm.role} onChange={(event) => setUserForm({ ...userForm, role: event.target.value })} className="rounded bg-slate-800 p-2"><option value="customer">customer</option><option value="admin">admin</option><option value="delivery_partner">delivery_partner</option><option value="delivery">delivery</option><option value="store_manager">store_manager</option></select> : item.role}</td><td className="p-3">{editingUser === item.id ? <button onClick={() => saveUser(item.id)} className="mr-2 text-emerald-300"><Save className="h-4 w-4" /></button> : <button onClick={() => { setEditingUser(item.id); setUserForm({ name: item.name || '', phone: item.phone || '', role: item.role || 'customer' }); }} className="mr-2 text-blue-300"><Pencil className="h-4 w-4" /></button>}<button onClick={() => deleteUser(item)} className="text-rose-300"><Trash2 className="h-4 w-4" /></button></td></tr>)}</tbody></table></section>}
      {active === 'delivery' && <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><h2 className="mb-4 font-black">Delivery Boys ({q ? `${filteredDeliveryBoys.length} of ${deliveryBoys.length}` : deliveryBoys.length})</h2>{filteredDeliveryBoys.map((boy) => { const partner = deliveryProfileByUser.get(boy.id); const isOnline = partner?.is_available !== false && boy.is_available !== false; return <div key={boy.id} className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-800 p-3"><div><button type="button" onClick={() => setSelectedDeliveryBoy({ ...boy, profile: partner })} className="font-black text-emerald-300 hover:text-emerald-200 hover:underline">{boy.name || 'Unnamed'}</button><p className="text-xs text-slate-400">{boy.email} · {boy.phone || 'No phone'}</p></div><div className="flex items-center gap-3"><button type="button" role="switch" aria-checked={isOnline} aria-label={`${boy.name || boy.email} online status`} title={isOnline ? 'Tap to go offline' : 'Tap to go online'} disabled={presenceId === boy.id} onClick={() => togglePartnerAvailability(boy, partner)} className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:cursor-wait disabled:opacity-50 ${isOnline ? 'bg-emerald-500' : 'bg-slate-600'}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${isOnline ? 'left-[22px]' : 'left-0.5'}`} /></button><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${isOnline ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-700 text-slate-400'}`}>{presenceId === boy.id ? '...' : isOnline ? 'Online' : 'Offline'}</span><button type="button" onClick={() => setSelectedDeliveryBoy({ ...boy, profile: partner })} className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-black text-slate-950">Show Details</button></div></div>; })}</section>}{selectedDeliveryBoy && <DeliveryBoyDetailsModal partner={selectedDeliveryBoy} onClose={() => setSelectedDeliveryBoy(null)} />}
      {active === 'deliveryProfiles' && <section className="space-y-4"><div className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><h2 className="font-black">Partner Profiles ({q ? `${filteredDeliveryProfiles.length} of ${deliveryProfiles.length}` : deliveryProfiles.length})</h2><p className="mt-1 text-xs text-slate-500">Live profile and document uploads from delivery partners.</p></div>{filteredDeliveryProfiles.length === 0 ? <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center text-sm text-slate-400">No partner profiles yet.</div> : filteredDeliveryProfiles.map((partner) => <article key={partner.user_id} className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex min-w-0 items-start gap-4"><div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-800 text-emerald-400">{partner.profile_photo_url ? <SignedDocImage stored={partner.profile_photo_url} alt={partner.name} className="h-full w-full object-cover" placeholderClassName="flex h-full w-full items-center justify-center text-xs" /> : <UserRound className="h-7 w-7" />}</div><div><h3 className="font-black text-white">{partner.name}</h3><p className="mt-1 text-xs text-slate-400">{partner.email} · {partner.phone}</p><p className="mt-1.5 rounded-lg bg-slate-800 px-2.5 py-1.5 text-[11px] font-bold text-slate-300">🏠 Home Store (auto): <span className="text-emerald-300">{homeStoreNameById.get(Number(partner.home_store_id)) || 'Not assigned'}</span></p></div></div><div className="flex shrink-0 flex-col items-end gap-2"><label className="text-xs font-bold uppercase tracking-wider text-slate-400">Home Store (manual change)<select value={partner.home_store_id ?? ''} onChange={(event) => updateHomeStore(partner, event.target.value)} className="mt-1.5 block rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-bold normal-case text-white outline-none focus:border-emerald-500"><option value="">Not assigned</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.store_name}</option>)}</select></label><label className="text-xs font-bold uppercase tracking-wider text-slate-400">Approval status<select value={partner.approval_status || 'pending'} onChange={(event) => updateApprovalStatus(partner, event.target.value)} className="mt-1.5 block rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-bold normal-case text-white outline-none focus:border-emerald-500"><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label></div></div><div className="mt-5 grid gap-3 sm:grid-cols-3">{[['Aadhar Card', partner.aadhar_card_url], ['Driving License', partner.driving_license_url], ['PAN Card', partner.pan_card_url]].map(([label, url]) => <div key={label} className="rounded-xl bg-slate-800 p-3"><p className="text-xs font-bold text-slate-300">{label}</p>{url ? <SignedDocLink stored={url} className="mt-2 inline-flex items-center text-xs font-bold text-emerald-400 hover:underline">View document</SignedDocLink> : <p className="mt-2 text-xs text-amber-300">Not uploaded</p>}</div>)}</div></article>)}</section>}
      {active === 'coupons' && <section className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-6"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-black">Coupons</h2><p className="text-xs text-slate-500">{q ? `${filteredCoupons.length} of ${coupons.length} coupons` : `${coupons.length} coupons`}</p></div><button onClick={() => openCouponModal(null)} className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-black text-slate-950"><Plus className="h-4 w-4" />Add Coupon</button></div>{filteredCoupons.length === 0 ? <div className="rounded-2xl bg-slate-800 p-8 text-center text-sm text-slate-400">{q ? `No coupons match “${search.trim()}”.` : 'No coupons yet. Click “Add Coupon” to create one.'}</div> : <table className="w-full min-w-[900px] text-left text-sm"><thead className="text-xs text-slate-500"><tr><th className="p-3">Code</th><th className="p-3">Discount</th><th className="p-3">Min Order</th><th className="p-3">Expiry</th><th className="p-3">Usage</th><th className="p-3">Status</th><th className="p-3">Actions</th></tr></thead><tbody className="divide-y divide-slate-800">{filteredCoupons.map((coupon) => <tr key={coupon.id}><td className="p-3"><span className="rounded-lg bg-emerald-950 px-2.5 py-1 font-black tracking-wider text-emerald-300">{coupon.code}</span></td><td className="p-3 font-bold text-white">{coupon.discount_type === 'flat' ? `₹${coupon.discount_value} off` : `${coupon.discount_value}% off`}</td><td className="p-3 text-slate-400">₹{coupon.min_order_amount ?? 0}</td><td className="p-3 text-slate-400">{coupon.expiry_date ? new Date(coupon.expiry_date).toLocaleDateString('en-IN') : 'No expiry'}</td><td className="p-3 text-slate-400">{coupon.used_count ?? 0}{coupon.usage_limit ? ` / ${coupon.usage_limit}` : ' / ∞'}</td><td className="p-3"><button type="button" role="switch" aria-checked={coupon.is_active !== false} aria-label={`Toggle ${coupon.code}`} onClick={() => toggleCoupon(coupon)} className={`relative h-6 w-11 shrink-0 rounded-full transition ${coupon.is_active !== false ? 'bg-emerald-500' : 'bg-slate-700'}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${coupon.is_active !== false ? 'left-[22px]' : 'left-0.5'}`} /></button></td><td className="p-3"><button onClick={() => openCouponModal(coupon)} className="mr-2 text-blue-300" aria-label={`Edit ${coupon.code}`}><Pencil className="h-4 w-4" /></button><button onClick={() => deleteCoupon(coupon)} className="text-rose-300" aria-label={`Delete ${coupon.code}`}><Trash2 className="h-4 w-4" /></button></td></tr>)}</tbody></table>}</section>}
    </div></main>
    {productModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"><form onSubmit={saveProduct} className="grid max-h-[90vh] w-full max-w-2xl gap-3 overflow-y-auto rounded-2xl bg-slate-900 p-6 sm:grid-cols-2"><div className="flex items-center justify-between sm:col-span-2"><h2 className="font-black">{editingProduct ? 'Edit Product' : 'Add Product'}</h2><button type="button" onClick={() => setProductModal(false)}><X /></button></div>{['name', 'category', 'unit', 'description'].map((field) => <input key={field} required value={productForm[field]} onChange={(event) => setProductForm({ ...productForm, [field]: event.target.value })} placeholder={field} className={inputClass} />)}<input required type="number" value={productForm.price} onChange={(event) => setProductForm({ ...productForm, price: event.target.value })} placeholder="price" className={inputClass} /><input type="number" value={productForm.stock_quantity} onChange={(event) => setProductForm({ ...productForm, stock_quantity: event.target.value })} placeholder="stock_quantity" className={inputClass} /><input type="number" value={productForm.low_stock_threshold} onChange={(event) => setProductForm({ ...productForm, low_stock_threshold: event.target.value })} placeholder="low stock alert at" title="Is number se kam hone par Low Stock alert" className={inputClass} /><label className="flex items-center gap-2 text-xs sm:col-span-2"><ImagePlus /> Image <input required={!editingProduct} type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; setImageFile(file); setImagePreview(file ? URL.createObjectURL(file) : ''); }} /></label>{imagePreview && <img src={imagePreview} alt="Preview" className="h-20 w-20 rounded object-contain" />}<button className="rounded-xl bg-emerald-500 p-3 font-black text-slate-950 sm:col-span-2">Save Product</button></form></div>}
    {couponModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"><form onSubmit={saveCoupon} className="grid max-h-[90vh] w-full max-w-2xl gap-3 overflow-y-auto rounded-2xl bg-slate-900 p-6 sm:grid-cols-2"><div className="flex items-center justify-between sm:col-span-2"><h2 className="font-black">{editingCoupon ? 'Edit Coupon' : 'Add Coupon'}</h2><button type="button" onClick={() => setCouponModal(false)}><X /></button></div><label className="text-xs font-bold text-slate-400">Code<input required value={couponForm.code} onChange={(event) => setCouponForm({ ...couponForm, code: event.target.value.toUpperCase() })} placeholder="SAVE20" className={`${inputClass} mt-1.5 uppercase`} /></label><label className="text-xs font-bold text-slate-400">Discount type<select value={couponForm.discount_type} onChange={(event) => setCouponForm({ ...couponForm, discount_type: event.target.value })} className={`${inputClass} mt-1.5`}><option value="percentage">Percentage (%)</option><option value="flat">Flat (₹)</option></select></label><label className="text-xs font-bold text-slate-400">Discount value<input required type="number" min="1" value={couponForm.discount_value} onChange={(event) => setCouponForm({ ...couponForm, discount_value: event.target.value })} placeholder={couponForm.discount_type === 'flat' ? '50' : '20'} className={`${inputClass} mt-1.5`} /></label><label className="text-xs font-bold text-slate-400">Min order amount (₹)<input type="number" min="0" value={couponForm.min_order_amount} onChange={(event) => setCouponForm({ ...couponForm, min_order_amount: event.target.value })} placeholder="0" className={`${inputClass} mt-1.5`} /></label><label className="text-xs font-bold text-slate-400">Expiry date<input type="date" value={couponForm.expiry_date} onChange={(event) => setCouponForm({ ...couponForm, expiry_date: event.target.value })} className={`${inputClass} mt-1.5`} /></label><label className="text-xs font-bold text-slate-400">Usage limit (blank = unlimited)<input type="number" min="1" value={couponForm.usage_limit} onChange={(event) => setCouponForm({ ...couponForm, usage_limit: event.target.value })} placeholder="Unlimited" className={`${inputClass} mt-1.5`} /></label><label className="flex items-center gap-2 text-xs font-bold text-slate-300 sm:col-span-2"><button type="button" role="switch" aria-checked={couponForm.is_active !== false} onClick={() => setCouponForm({ ...couponForm, is_active: !(couponForm.is_active !== false) })} className={`relative h-6 w-11 shrink-0 rounded-full transition ${couponForm.is_active !== false ? 'bg-emerald-500' : 'bg-slate-700'}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${couponForm.is_active !== false ? 'left-[22px]' : 'left-0.5'}`} /></button>Active</label><button className="rounded-xl bg-emerald-500 p-3 font-black text-slate-950 sm:col-span-2">Save Coupon</button></form></div>}
  </div>;
};
export default AdminDashboard;
