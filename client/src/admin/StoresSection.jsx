import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  Crosshair,
  ExternalLink,
  Loader2,
  MapPin,
  Package,
  Pencil,
  Plus,
  Store as StoreIcon,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { supabase, supabaseAnonKey, supabaseUrl } from '../config/supabase';
import StoreMapPicker from './StoreMapPicker';
import { logAdminActivity } from '../utils/adminActivity';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || '';

const inputCls =
  'w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-500';

// Manager signup ke liye alag client (session persist NAHI) —
// taaki naya account banate waqt Admin ka apna login untouched rahe.
const tmpAuthClient = () =>
  createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

const emptyStore = { store_name: '', address: '', latitude: '', longitude: '', contact_number: '', is_active: true, opening_time: '', closing_time: '' };

// Supabase TIME ("HH:MM:SS") -> <input type="time"> format ("HH:MM")
const toTimeInput = (v) => {
  if (v == null || v === '') return '';
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  return `${m[1].padStart(2, '0')}:${m[2]}`;
};
const emptyManager = { name: '', email: '', phone: '', password: '' };

const numOrNull = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

// Aaj ke orders ginne ke liye local-date key
const dayKey = (iso) => {
  try {
    return new Date(iso).toLocaleDateString('en-CA');
  } catch {
    return '';
  }
};
const todayKey = () => new Date().toLocaleDateString('en-CA');

const StoresSection = ({ searchQuery = '' }) => {
  const [stores, setStores] = useState([]);
  const [orderStats, setOrderStats] = useState({}); // storeId -> { total, today, todayRevenue }
  const [staffByStore, setStaffByStore] = useState({}); // storeId -> [{id,name,email}]
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState({ type: '', text: '' });

  const [storeModal, setStoreModal] = useState(false);
  const [editingStore, setEditingStore] = useState(null); // null = Add mode, store object = Edit mode (ADMIN ONLY)
  const [storeForm, setStoreForm] = useState(emptyStore);
  const [savingStore, setSavingStore] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [togglingId, setTogglingId] = useState(null);

  const [managerModal, setManagerModal] = useState(null); // store row | null
  const [managerForm, setManagerForm] = useState(emptyManager);
  const [savingManager, setSavingManager] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null); // store row | null (confirmation popup)
  const [deleting, setDeleting] = useState(false);
  // Store detail modal: naam/address/manager + poori inventory (Realtime).
  const [detailStore, setDetailStore] = useState(null); // store row | null
  const [detailProducts, setDetailProducts] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const showNotice = (type, text) => setNotice({ type, text });

  const loadAll = useCallback(async () => {
    setLoading(true);
    setNotice({ type: '', text: '' });
    try {
      const { data: storeRows, error: storeError } = await supabase
        .from('stores')
        .select('*')
        .order('id', { ascending: true });
      if (storeError) throw new Error(`Stores table not found: ${storeError.message} (Run server/supabase_multi_store.sql)`);
      setStores(storeRows || []);

      // Orders summary — halki columns, client-side aggregate
      const { data: orderRows, error: orderError } = await supabase
        .from('orders')
        .select('store_id, created_at, total_price');
      if (orderError) throw orderError;
      const stats = {};
      const tk = todayKey();
      for (const o of orderRows || []) {
        if (o.store_id == null) continue;
        const id = Number(o.store_id);
        if (!stats[id]) stats[id] = { total: 0, today: 0, todayRevenue: 0 };
        stats[id].total += 1;
        if (dayKey(o.created_at) === tk) {
          stats[id].today += 1;
          stats[id].todayRevenue += Number(o.total_price || 0);
        }
      }
      setOrderStats(stats);

      // Staff links + naam
      const { data: links } = await supabase.from('store_staff').select('store_id, user_id');
      const userIds = [...new Set((links || []).map((l) => l.user_id).filter(Boolean))];
      let usersById = new Map();
      if (userIds.length > 0) {
        const { data: users } = await supabase.from('users').select('id,name,email').in('id', userIds);
        usersById = new Map((users || []).map((u) => [u.id, u]));
      }
      const grouped = {};
      for (const l of links || []) {
        const sid = Number(l.store_id);
        if (!grouped[sid]) grouped[sid] = [];
        const u = usersById.get(l.user_id);
        grouped[sid].push({ id: l.user_id, name: u?.name || 'Manager', email: u?.email || '' });
      }
      setStaffByStore(grouped);
    } catch (e) {
      showNotice('error', e.message || 'Stores could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ---- 1. Naya store (Add) / Existing store (Edit) — SIRF ADMIN ----
  const openStoreModal = () => {
    setEditingStore(null);
    setStoreForm(emptyStore);
    setStoreModal(true);
  };

  const openEditStoreModal = (store) => {
    setEditingStore(store);
    setStoreForm({
      store_name: store.store_name || '',
      address: store.address || '',
      latitude: store.latitude != null ? String(store.latitude) : '',
      longitude: store.longitude != null ? String(store.longitude) : '',
      contact_number: store.contact_number || '',
      is_active: store.is_active !== false,
      opening_time: toTimeInput(store.opening_time),
      closing_time: toTimeInput(store.closing_time),
    });
    setStoreModal(true);
  };

  const closeStoreModal = () => {
    setStoreModal(false);
    setEditingStore(null);
    setStoreForm(emptyStore);
  };

  const useGpsForStore = () => {
    if (!('geolocation' in navigator)) {
      showNotice('error', 'Location is not supported on this device.');
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setStoreForm((f) => ({
          ...f,
          latitude: String(pos.coords.latitude.toFixed(6)),
          longitude: String(pos.coords.longitude.toFixed(6)),
        }));
        setGpsLoading(false);
      },
      () => {
        setGpsLoading(false);
        showNotice('error', 'Location unavailable. Allow permission and try again.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  const saveStore = async (e) => {
    e.preventDefault();
    const lat = numOrNull(storeForm.latitude);
    const lng = numOrNull(storeForm.longitude);
    if (!storeForm.store_name.trim()) {
      showNotice('error', 'Enter the store name.');
      return;
    }
    if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      showNotice('error', 'Enter valid latitude (-90..90) and longitude (-180..180) — place a pin on the map or search.');
      return;
    }
    setSavingStore(true);
    try {
      // Map se aayi wahi lat-lng stores table me save hoti hai
      // Timing khaali ho to NULL (matlab: time limit nahi — Store Panel me koi banner nahi)
      const payload = {
        store_name: storeForm.store_name.trim(),
        address: storeForm.address.trim(),
        latitude: lat,
        longitude: lng,
        contact_number: storeForm.contact_number.trim(),
        opening_time: storeForm.opening_time ? storeForm.opening_time : null,
        closing_time: storeForm.closing_time ? storeForm.closing_time : null,
      };
      // Agar SQL migration (server/supabase_store_timings.sql) abhi RUN nahi hui
      // to timing columns nahi honge — tab bina timing ke retry karo taaki
      // store save hona na ruke, aur Admin ko SQL chalane ka hint do.
      const saveWithFallback = async (saveFn) => {
        try {
          await saveFn(payload);
        } catch (err) {
          const msg = String(err?.message || '');
          if (/opening_time|closing_time|column/i.test(msg)) {
            const { opening_time: _ot, closing_time: _ct, ...withoutTiming } = payload;
            await saveFn(withoutTiming);
            showNotice('error', 'Store saved, but opening/closing time was not saved — Run server/supabase_store_timings.sql in Supabase, then save the timing again.');
            return true; // fallback notice already shown
          }
          throw err;
        }
        return false;
      };
      if (editingStore) {
        // Edit mode — SIRF ADMIN (ye component AdminDashboard ke andar hi hai)
        const usedFallback = await saveWithFallback(async (p) => {
          const { error } = await supabase.from('stores').update(p).eq('id', editingStore.id);
          if (error) throw error;
        });
        closeStoreModal();
        if (!usedFallback) showNotice('success', `Store "${payload.store_name}" updated ✅ (location: ${lat}, ${lng})`);
      } else {
        const usedFallback = await saveWithFallback(async (p) => {
          const { error } = await supabase.from('stores').insert({ ...p, is_active: true });
          if (error) throw error;
        });
        closeStoreModal();
        if (!usedFallback) showNotice('success', `Store "${payload.store_name}" added ✅ (location: ${lat}, ${lng})`);
      }
      await loadAll();
    } catch (err) {
      showNotice('error', err.message || 'Store could not be saved.');
    } finally {
      setSavingStore(false);
    }
  };

  // ---- 3. Active / Inactive toggle ----
  const toggleActive = async (store) => {
    setTogglingId(store.id);
    try {
      const { error } = await supabase.from('stores').update({ is_active: !store.is_active }).eq('id', store.id);
      if (error) throw error;
      setStores((prev) => prev.map((s) => (s.id === store.id ? { ...s, is_active: !store.is_active } : s)));
      showNotice('success', `"${store.store_name}" is now ${!store.is_active ? 'ACTIVE ✅' : 'INACTIVE ⏸️'}`);
      logAdminActivity({
        actionType: !store.is_active ? 'activated_store' : 'deactivated_store',
        targetId: store.id,
        description: `${!store.is_active ? 'Activated' : 'Deactivated'} store "${store.store_name}" (ID #${store.id})`,
      });
    } catch (e) {
      showNotice('error', e.message || 'Status could not be changed.');
    } finally {
      setTogglingId(null);
    }
  };

  // ---- 4. Store Delete (SIRF ADMIN) ----
  // Rules:
  //  - Active order (delivered/cancelled ke alawa kuch bhi) ho to delete BLOCK.
  //  - Warna: store_staff links delete, products unlink (store_id=NULL,
  //    products delete NAHI honge), phir store delete.
  //  - Purane (delivered/cancelled) orders ke rows database me rahenge
  //    (history); unka store_id FK (ON DELETE SET NULL) ke kaaran NULL ho
  //    jayega — order ka baaki data (items, amount, customer) preserved rahega.
  const CLOSED_ORDER_STATUSES = new Set(['delivered', 'cancelled']);

  const confirmDeleteStore = async () => {
    if (!deleteTarget || deleting) return;
    const store = deleteTarget;
    setDeleting(true);
    try {
      // Step 1: active orders check — status column hi kaafi hai
      const { data: storeOrders, error: ordersError } = await supabase
        .from('orders')
        .select('id,status')
        .eq('store_id', store.id)
        .limit(1000);
      if (ordersError) throw ordersError;
      const activeOrders = (storeOrders || []).filter(
        (o) => !CLOSED_ORDER_STATUSES.has(String(o?.status || '').toLowerCase()),
      );
      if (activeOrders.length > 0) {
        setDeleteTarget(null);
        showNotice('error', `This store has pending orders (${activeOrders.length}), please complete/cancel them first`);
        return;
      }

      // Step 2: store_staff links saaf karo (FK CASCADE bhi hai, phir bhi explicit)
      const { error: staffError } = await supabase.from('store_staff').delete().eq('store_id', store.id);
      if (staffError) throw staffError;

      // Step 3: products unlink — store_id NULL (products delete NAHI honge).
      // (FK ON DELETE SET NULL bhi yehi karega, phir bhi explicit taaki
      // FK na bhi ho to bhi products orphan na rahen.)
      const { error: productsError } = await supabase.from('products').update({ store_id: null }).eq('store_id', store.id);
      if (productsError) throw productsError;

      // Step 4: store delete — purane delivered/cancelled orders ke rows
      // rahenge (history), sirf unka store_id SET NULL hoga.
      const { error: deleteError } = await supabase.from('stores').delete().eq('id', store.id);
      if (deleteError) throw deleteError;

      setDeleteTarget(null);
      showNotice('success', `Store "${store.store_name}" deleted ✅ (products unlinked, past orders kept in history)`);
      logAdminActivity({
        actionType: 'deleted_store',
        targetId: store.id,
        description: `Deleted store "${store.store_name}" (ID #${store.id})`,
      });
      await loadAll();
    } catch (e) {
      showNotice('error', e.message || 'Store could not be deleted.');
    } finally {
      setDeleting(false);
    }
  };

  // ---- 2. Manager account + store_staff link ----
  const openManagerModal = (store) => {
    setManagerForm(emptyManager);
    setManagerModal(store);
  };

  const linkStaff = async (storeId, userId) => {
    const { error } = await supabase
      .from('store_staff')
      .upsert({ store_id: storeId, user_id: userId }, { onConflict: 'store_id,user_id' });
    if (error) throw error;
  };

  const createManager = async (e) => {
    e.preventDefault();
    const email = managerForm.email.trim().toLowerCase();
    if (!managerForm.name.trim() || !email || managerForm.password.length < 6) {
      showNotice('error', 'Enter a name, valid email, and a password of at least 6 characters.');
      return;
    }
    setSavingManager(true);
    try {
      // Pehle signup try (trigger users row me role=store_manager lagayega)
      const { data, error } = await tmpAuthClient().auth.signUp({
        email,
        password: managerForm.password,
        options: { data: { full_name: managerForm.name.trim(), phone: managerForm.phone.trim(), role: 'store_manager' } },
      });

      let userId = data?.user?.id || null;

      if (error) {
        // Email pehle se registered → existing user ko link karo
        if (/already|registered|exists|duplicate/i.test(error.message || '')) {
          const { data: existing, error: lookupError } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .maybeSingle();
          if (lookupError || !existing) throw new Error('This email is already registered, but no user record was found.');
          userId = existing.id;
        } else {
          throw error;
        }
      }

      if (!userId) throw new Error('Account could not be created. Please try again.');

      // Role pakka store_manager (trigger miss ho to bhi)
      await supabase.from('users').update({ role: 'store_manager', name: managerForm.name.trim() }).eq('id', userId);
      await linkStaff(managerModal.id, userId);

      const needsConfirm = !data?.session;
      setManagerModal(null);
      showNotice(
        'success',
        needsConfirm && !error
          ? `Manager account created ✅ — A confirmation email was sent to ${email}; after verification, /store/login will work. Linked to the store.`
          : `Manager "${managerForm.name.trim()}" created ✅ and linked to "${managerModal.store_name}".`,
      );
      await loadAll();
    } catch (err) {
      showNotice('error', err.message || 'Manager account could not be created.');
    } finally {
      setSavingManager(false);
    }
  };

  const unlinkStaff = async (storeId, staff) => {
    if (!window.confirm(`Remove ${staff.name} from this store? (Login account will remain, only the link will be removed)`)) return;
    try {
      const { error } = await supabase.from('store_staff').delete().eq('store_id', storeId).eq('user_id', staff.id);
      if (error) throw error;
      showNotice('success', 'Staff link removed.');
      await loadAll();
    } catch (e) {
      showNotice('error', e.message || 'Link could not be removed.');
    }
  };

  // Store detail inventory: is store ke (store_id) + global (NULL) products.
  // Naye columns na bane hon to purane stock par fallback (panel na toote).
  const loadDetailProducts = useCallback(async (storeId) => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('id,name,image,unit,price,stock_quantity,low_stock_threshold,is_in_stock,store_id')
        .or(`store_id.eq.${storeId},store_id.is.null`)
        .order('name', { ascending: true });
      if (error) throw error;
      return data || [];
    } catch (e) {
      if (!/stock_quantity|column|schema cache/i.test(e?.message || '')) throw e;
      const { data, error } = await supabase
        .from('products')
        .select('id,name,image,unit,price,stock,in_stock,store_id')
        .or(`store_id.eq.${storeId},store_id.is.null`)
        .order('name', { ascending: true });
      if (error) throw error;
      return data || [];
    }
  }, []);

  const openStoreDetail = async (store) => {
    setDetailStore(store);
    setDetailProducts([]);
    setDetailLoading(true);
    try {
      setDetailProducts(await loadDetailProducts(store.id));
    } catch (e) {
      showNotice('error', e.message || 'Could not load store inventory.');
    } finally {
      setDetailLoading(false);
    }
  };

  // Detail modal khula ho to inventory Realtime: manager kuch badle turant dikhe.
  useEffect(() => {
    if (!detailStore) return undefined;
    const sid = detailStore.id;
    const channel = supabase
      .channel(`store-inventory-${sid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, async () => {
        try {
          setDetailProducts(await loadDetailProducts(sid));
        } catch {
          /* agla refresh sambhal lega */
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [detailStore, loadDetailProducts]);

  const q = searchQuery.trim().toLowerCase();
  const filteredStores = q
    ? stores.filter((s) =>
        [s.store_name, s.address, s.contact_number, String(s.id)].filter(Boolean).join(' ').toLowerCase().includes(q),
      )
    : stores;

  const mapLat = numOrNull(storeForm.latitude);
  const mapLng = numOrNull(storeForm.longitude);
  const mapPreview =
    mapLat != null && mapLng != null
      ? `https://www.openstreetmap.org/export/embed.html?bbox=${mapLng - 0.02}%2C${mapLat - 0.015}%2C${mapLng + 0.02}%2C${mapLat + 0.015}&layer=mapnik&marker=${mapLat}%2C${mapLng}`
      : null;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-black text-white">Stores ({filteredStores.length})</h2>
            <p className="text-xs text-slate-500">Manage stores, manager accounts, status, and order summaries here.</p>
          </div>
          <button
            onClick={openStoreModal}
            className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-black text-slate-950"
          >
            <Plus className="h-4 w-4" /> Add Store
          </button>
        </div>

        {notice.text && (
          <div className={`mb-4 rounded-xl p-3 text-sm font-bold ${notice.type === 'error' ? 'bg-rose-950 text-rose-300' : 'bg-emerald-950 text-emerald-300'}`}>
            {notice.text}
          </div>
        )}

        {loading ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading stores...</p>
        ) : filteredStores.length === 0 ? (
          <div className="rounded-2xl bg-slate-800 p-8 text-center text-sm text-slate-400">
            No stores yet. Create your first store with “Add Store” above.
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {filteredStores.map((store) => {
              const stats = orderStats[Number(store.id)] || { total: 0, today: 0, todayRevenue: 0 };
              const staff = staffByStore[Number(store.id)] || [];
              const active = store.is_active !== false;
              return (
                <article key={store.id} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${active ? 'bg-emerald-500 text-slate-950' : 'bg-slate-700 text-slate-300'}`}>
                        <StoreIcon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate font-black text-white">{store.store_name}</h3>
                        <p className="mt-0.5 truncate text-[11px] font-bold text-emerald-300">
                          Manager: {staff.length > 0 ? staff.map((m) => m.name).filter(Boolean).join(', ') : 'Not assigned'}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-slate-400">{store.address || 'No address provided'}</p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {store.latitude}, {store.longitude}
                          {store.contact_number ? ` · ${store.contact_number}` : ''}
                        </p>
                        <p className="mt-1 text-[11px] font-bold text-slate-400">
                          ⏰ {toTimeInput(store.opening_time) && toTimeInput(store.closing_time)
                            ? `${toTimeInput(store.opening_time)} – ${toTimeInput(store.closing_time)}`
                            : 'Timing not set (always open)'}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={active}
                        aria-label={`${store.store_name} ${active ? 'deactivate' : 'activate'}`}
                        title={active ? 'Tap to deactivate' : 'Tap to activate'}
                        disabled={togglingId === store.id}
                        onClick={() => toggleActive(store)}
                        className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${active ? 'bg-emerald-500' : 'bg-slate-600'}`}
                      >
                        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${active ? 'left-[22px]' : 'left-0.5'}`} />
                      </button>
                      {/* Edit Store (address + location) — SIRF ADMIN. Store Manager ke paas ye button/kahin option nahi hai. */}
                      <button
                        type="button"
                        onClick={() => openEditStoreModal(store)}
                        title="Edit store (name, address, location)"
                        aria-label={`Edit ${store.store_name}`}
                        className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-[11px] font-black text-sky-300 transition hover:bg-slate-700"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                      {/* Store detail: naam/address/manager + poori inventory (Realtime) */}
                      <button
                        type="button"
                        onClick={() => openStoreDetail(store)}
                        title="View full inventory"
                        aria-label={`View inventory of ${store.store_name}`}
                        className="flex items-center gap-1.5 rounded-lg bg-emerald-950 px-3 py-2 text-[11px] font-black text-emerald-300 transition hover:bg-emerald-900"
                      >
                        <Package className="h-3.5 w-3.5" /> Inventory
                      </button>
                      {/* Delete Store — SIRF ADMIN, laal alag button + confirmation popup */}
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(store)}
                        title="Delete store"
                        aria-label={`Delete ${store.store_name}`}
                        className="flex items-center gap-1.5 rounded-lg bg-rose-950 px-3 py-2 text-[11px] font-black text-rose-300 transition hover:bg-rose-900"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </div>
                  </div>

                  {/* Order summary */}
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-slate-800 px-2 py-2.5">
                      <p className="text-lg font-black text-white">{stats.total}</p>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Total orders</p>
                    </div>
                    <div className="rounded-xl bg-slate-800 px-2 py-2.5">
                      <p className="text-lg font-black text-emerald-300">{stats.today}</p>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Today's orders</p>
                    </div>
                    <div className="rounded-xl bg-slate-800 px-2 py-2.5">
                      <p className="text-lg font-black text-amber-300">₹{stats.todayRevenue}</p>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Today's sales</p>
                    </div>
                  </div>

                  {/* Staff */}
                  <div className="mt-3">
                    <p className="mb-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500">
                      Staff / Managers ({staff.length})
                    </p>
                    {staff.length === 0 ? (
                      <p className="text-xs text-slate-500">No manager linked.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {staff.map((m) => (
                          <li key={m.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-800 px-3 py-2 text-xs">
                            <span className="min-w-0 truncate font-bold text-slate-200">
                              {m.name} <span className="font-normal text-slate-500">{m.email}</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => unlinkStaff(store.id, m)}
                              aria-label={`Remove ${m.name}`}
                              className="shrink-0 text-slate-500 hover:text-rose-300"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <button
                      type="button"
                      onClick={() => openManagerModal(store)}
                      className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-600 px-3 py-2.5 text-xs font-black text-emerald-300 transition hover:border-emerald-500 hover:bg-emerald-950/40"
                    >
                      <UserPlus className="h-4 w-4" /> Create manager account
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* ---- Add/Edit Store Modal — SIRF ADMIN (Store Manager ke paas ye form nahi hai) ---- */}
      {storeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <form onSubmit={saveStore} className="grid max-h-[90vh] w-full max-w-2xl gap-3 overflow-y-auto rounded-2xl bg-slate-900 p-6 sm:grid-cols-2">
            <div className="flex items-center justify-between sm:col-span-2">
              <div>
                <h2 className="font-black text-white">{editingStore ? `Edit Store — ${editingStore.store_name}` : 'New Store'}</h2>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {editingStore
                    ? `ID #${editingStore.id} — Drag/search the pin on the map to change location; saving updates lat-lng in the stores table`
                    : 'Drag/search the pin on the map to set the exact location — those coordinates will be saved'}
                </p>
              </div>
              <button type="button" onClick={closeStoreModal} aria-label="Close">
                <X className="text-slate-400 hover:text-white" />
              </button>
            </div>
            <label className="text-xs font-bold text-slate-400 sm:col-span-2">
              Store name *
              <input required value={storeForm.store_name} onChange={(e) => setStoreForm({ ...storeForm, store_name: e.target.value })} placeholder="SuperCart Chanan Nagar" className={`${inputCls} mt-1.5`} />
            </label>
            <label className="text-xs font-bold text-slate-400 sm:col-span-2">
              Address
              <input value={storeForm.address} onChange={(e) => setStoreForm({ ...storeForm, address: e.target.value })} placeholder="Shop 5, Main Market, Chanan Nagar" className={`${inputCls} mt-1.5`} />
            </label>
            <label className="text-xs font-bold text-slate-400">
              Latitude *
              <input required inputMode="decimal" value={storeForm.latitude} onChange={(e) => setStoreForm({ ...storeForm, latitude: e.target.value })} placeholder="30.123456" className={`${inputCls} mt-1.5`} />
            </label>
            <label className="text-xs font-bold text-slate-400">
              Longitude *
              <input required inputMode="decimal" value={storeForm.longitude} onChange={(e) => setStoreForm({ ...storeForm, longitude: e.target.value })} placeholder="75.123456" className={`${inputCls} mt-1.5`} />
            </label>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <button
                type="button"
                onClick={useGpsForStore}
                disabled={gpsLoading}
                className="flex min-h-[44px] items-center gap-2 rounded-xl bg-slate-800 px-4 text-xs font-black text-emerald-300 transition hover:bg-slate-700 disabled:opacity-60"
              >
                {gpsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}
                {gpsLoading ? 'Locating...' : 'Use my current location'}
              </button>
              {mapPreview && (
                <a
                  href={`https://www.google.com/maps?q=${mapLat},${mapLng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-slate-800 px-4 text-xs font-black text-sky-300 transition hover:bg-slate-700"
                >
                  View on Google Maps <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
            <div className="sm:col-span-2">
              <p className="mb-1.5 text-xs font-bold text-slate-400">
                Select location from map * <span className="font-normal text-slate-500">(Like “Pin your location” — search / drag pin / GPS)</span>
              </p>
              {MAPBOX_TOKEN ? (
                <StoreMapPicker
                  latitude={storeForm.latitude}
                  longitude={storeForm.longitude}
                  onPick={(lat, lng) =>
                    setStoreForm((f) => ({ ...f, latitude: String(lat), longitude: String(lng) }))
                  }
                  onAddressChange={(addr) =>
                    setStoreForm((f) => ({ ...f, address: addr }))
                  }
                />
              ) : (
                <p className="rounded-2xl border border-amber-700 bg-amber-950 px-4 py-3 text-[11px] font-semibold text-amber-200">
                  VITE_MAPBOX_TOKEN is required for the map — until then, enter lat/long manually or via GPS.
                </p>
              )}
            </div>
            {mapPreview && !MAPBOX_TOKEN && (
              <div className="overflow-hidden rounded-2xl border border-slate-700 sm:col-span-2">
                <iframe title="Store location preview" src={mapPreview} className="h-56 w-full" loading="lazy" />
                <p className="flex items-center gap-1.5 bg-slate-800 px-3 py-2 text-[11px] font-bold text-slate-300">
                  <MapPin className="h-3.5 w-3.5 text-emerald-400" /> Pin is here — correct lat/long if it looks wrong
                </p>
              </div>
            )}
            {!mapPreview && !MAPBOX_TOKEN && (
              <p className="rounded-2xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-[11px] font-semibold text-slate-400 sm:col-span-2">
                Map preview will appear here once you enter lat/long. You can get coordinates by right-clicking the shop on Google Maps.
              </p>
            )}
            <label className="text-xs font-bold text-slate-400 sm:col-span-2">
              Contact number
              <input value={storeForm.contact_number} onChange={(e) => setStoreForm({ ...storeForm, contact_number: e.target.value })} placeholder="+91-98XXXXXXX" className={`${inputCls} mt-1.5`} />
            </label>
            <div className="grid grid-cols-2 gap-3 sm:col-span-2">
              <label className="text-xs font-bold text-slate-400">
                Opening Time
                <input type="time" value={storeForm.opening_time} onChange={(e) => setStoreForm({ ...storeForm, opening_time: e.target.value })} className={`${inputCls} mt-1.5`} />
              </label>
              <label className="text-xs font-bold text-slate-400">
                Closing Time
                <input type="time" value={storeForm.closing_time} onChange={(e) => setStoreForm({ ...storeForm, closing_time: e.target.value })} className={`${inputCls} mt-1.5`} />
              </label>
            </div>
            <p className="-mt-1 text-[11px] text-slate-500 sm:col-span-2">
              Leave both empty = no time limit. Fill both (e.g. 09:00 – 21:00) to show a “Store closed” banner in the Store Panel outside those hours. Overnight timings (22:00 – 06:00) are supported.
            </p>
            <button
              type="submit"
              disabled={savingStore}
              className="rounded-xl bg-emerald-500 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-60 sm:col-span-2"
            >
              {savingStore ? 'Saving...' : editingStore ? 'Update Store' : 'Save Store'}
            </button>
          </form>
        </div>
      )}

      {/* ---- Delete Confirmation Popup — SIRF ADMIN ---- */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-black text-white">Delete Store?</h2>
              <button type="button" onClick={() => !deleting && setDeleteTarget(null)} aria-label="Close" disabled={deleting}>
                <X className="text-slate-400 hover:text-white" />
              </button>
            </div>
            <p className="mt-3 text-sm font-bold text-slate-200">
              Are you sure you want to delete this store? This action cannot be undone.
            </p>
            <p className="mt-2 rounded-xl bg-slate-800 px-3 py-2 text-xs font-bold text-slate-300">
              {deleteTarget.store_name} <span className="font-normal text-slate-500">(ID #{deleteTarget.id})</span>
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-[11px] text-slate-400">
              <li>If there are active (pending/packed) orders, deletion will be blocked.</li>
              <li>Staff links will be removed, products unlinked (not deleted).</li>
              <li>Past delivered/cancelled orders will remain in history.</li>
            </ul>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="flex-1 rounded-xl bg-slate-800 px-4 py-3 text-sm font-black text-slate-200 transition hover:bg-slate-700 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteStore}
                disabled={deleting}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-sm font-black text-white transition hover:bg-rose-500 disabled:opacity-60"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {deleting ? 'Deleting...' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Store Detail Modal: info + manager + FULL inventory (Realtime) ---- */}
      {detailStore && (() => {
        const dstaff = staffByStore[Number(detailStore.id)] || [];
        const outN = detailProducts.filter((p) => Number(p.stock_quantity ?? p.stock ?? 0) <= 0).length;
        const lowN = detailProducts.filter((p) => {
          const qn = Number(p.stock_quantity ?? p.stock ?? 0);
          const th = Number(p.low_stock_threshold);
          const t = Number.isFinite(th) && th >= 0 ? th : 5;
          return qn > 0 && qn <= t;
        }).length;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setDetailStore(null); }}>
            <div role="dialog" aria-modal="true" aria-label={`Inventory of ${detailStore.store_name}`} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-slate-900 p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-black text-white">{detailStore.store_name}</h2>
                  <p className="mt-1 flex items-start gap-1 text-xs text-slate-400">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    {detailStore.address || 'Address not available'}
                  </p>
                  <p className="mt-1.5 text-xs font-bold text-emerald-300">
                    Manager: {dstaff.length > 0 ? dstaff.map((m) => `${m.name}${m.email ? ` (${m.email})` : ''}`).join(', ') : 'Not assigned'}
                  </p>
                  <p className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-slate-800 px-2.5 py-1 text-[10px] font-black text-slate-300">{detailProducts.length} products</span>
                    <span className="rounded-full bg-rose-600 px-2.5 py-1 text-[10px] font-black text-white">{outN} Out</span>
                    <span className="rounded-full bg-amber-400 px-2.5 py-1 text-[10px] font-black text-slate-950">{lowN} Low</span>
                    <span className="rounded-full bg-slate-800 px-2.5 py-1 text-[10px] font-bold text-slate-400">Live · auto-updates</span>
                  </p>
                </div>
                <button type="button" onClick={() => setDetailStore(null)} aria-label="Close">
                  <X className="text-slate-400 hover:text-white" />
                </button>
              </div>
              <div className="mt-4">
                {detailLoading ? (
                  <p className="py-8 text-center text-sm text-slate-400">Loading inventory…</p>
                ) : detailProducts.length === 0 ? (
                  <p className="rounded-2xl bg-slate-800 p-8 text-center text-sm text-slate-400">No products for this store yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {detailProducts.map((p) => {
                      const qn = Math.max(0, Math.floor(Number(p.stock_quantity ?? p.stock ?? 0) || 0));
                      const thRaw = Number(p.low_stock_threshold);
                      const th = Number.isFinite(thRaw) && thRaw >= 0 ? thRaw : 5;
                      const st = qn <= 0 ? 'out' : qn <= th ? 'low' : 'ok';
                      return (
                        <li key={p.id} className={`flex items-center gap-3 rounded-2xl border bg-slate-950/60 px-3 py-2.5 ${st === 'out' ? 'border-rose-500/50' : st === 'low' ? 'border-amber-400/40' : 'border-slate-800'}`}>
                          {p.image ? (
                            <img src={p.image} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-lg bg-slate-800 object-contain" onError={(e) => { try { e.currentTarget.style.display = 'none'; } catch { /* ignore */ } }} />
                          ) : (
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-800">
                              <Package className="h-4 w-4 text-slate-500" />
                            </span>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-black text-white">
                              {p.name}
                              {p.store_id == null && <span className="ml-1.5 rounded-full bg-slate-800 px-2 py-0.5 text-[9px] font-bold text-slate-400">GLOBAL</span>}
                            </p>
                            <p className="text-[11px] text-slate-500">₹{p.price}{p.unit ? ` · ${p.unit}` : ''}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className={`text-sm font-black ${st === 'out' ? 'text-rose-400' : st === 'low' ? 'text-amber-300' : 'text-emerald-300'}`}>{qn}</p>
                            <p className={`text-[9px] font-black uppercase ${st === 'out' ? 'text-rose-400' : st === 'low' ? 'text-amber-300' : 'text-slate-500'}`}>
                              {st === 'out' ? 'Out' : st === 'low' ? 'Low' : 'In Stock'}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ---- Manager Modal ---- */}
      {managerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <form onSubmit={createManager} className="grid max-h-[90vh] w-full max-w-lg gap-3 overflow-y-auto rounded-2xl bg-slate-900 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-black text-white">Manager Account</h2>
                <p className="text-xs text-slate-500">Store: {managerModal.store_name} — will be linked automatically</p>
              </div>
              <button type="button" onClick={() => setManagerModal(null)} aria-label="Close">
                <X className="text-slate-400 hover:text-white" />
              </button>
            </div>
            <label className="text-xs font-bold text-slate-400">
              Name *
              <input required value={managerForm.name} onChange={(e) => setManagerForm({ ...managerForm, name: e.target.value })} placeholder="Ramesh Kumar" className={`${inputCls} mt-1.5`} />
            </label>
            <label className="text-xs font-bold text-slate-400">
              Email * (this will be the login ID)
              <input required type="email" value={managerForm.email} onChange={(e) => setManagerForm({ ...managerForm, email: e.target.value })} placeholder="manager@store.com" className={`${inputCls} mt-1.5`} />
            </label>
            <label className="text-xs font-bold text-slate-400">
              Phone
              <input value={managerForm.phone} onChange={(e) => setManagerForm({ ...managerForm, phone: e.target.value })} placeholder="+91-98XXXXXXX" className={`${inputCls} mt-1.5`} />
            </label>
            <label className="text-xs font-bold text-slate-400">
              Password * (min 6 characters — share it with the manager)
              <input required type="text" minLength={6} value={managerForm.password} onChange={(e) => setManagerForm({ ...managerForm, password: e.target.value })} placeholder="Strong password" className={`${inputCls} mt-1.5`} />
            </label>
            <button
              type="submit"
              disabled={savingManager}
              className="rounded-xl bg-emerald-500 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-60"
            >
              {savingManager ? 'Creating account...' : 'Create Account + Link'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export default StoresSection;
