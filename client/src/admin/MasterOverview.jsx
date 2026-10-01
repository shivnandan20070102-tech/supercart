import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronDown,
  Crown,
  Loader2,
  MapPin,
  Package,
  Search,
  Store as StoreIcon,
  Truck,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { supabase } from '../config/supabase';
import DeliveryBoyDetailsModal from './DeliveryBoyDetailsModal';

const dayKey = (iso) => {
  try {
    return new Date(iso).toLocaleDateString('en-CA');
  } catch {
    return '';
  }
};
const todayKey = () => new Date().toLocaleDateString('en-CA');
const fmtDateTime = (v) =>
  v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const fmtRs = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;

const itemsSummary = (order) => {
  const items = order.order_items || order.orderItems || [];
  if (!Array.isArray(items) || items.length === 0) return '—';
  const first = items
    .slice(0, 2)
    .map((i) => `${i.name || 'Item'}${i.qty || i.quantity ? ` ×${i.qty || i.quantity}` : ''}`)
    .join(', ');
  return items.length > 2 ? `${first} +${items.length - 2} more` : first;
};

const statusCls = (s) => {
  const v = String(s || '').toLowerCase();
  if (v === 'delivered') return 'bg-emerald-950 text-emerald-300';
  if (v === 'cancelled' || v === 'rejected') return 'bg-rose-950 text-rose-300';
  if (v === 'out_for_delivery' || v === 'picked_up' || v === 'accepted') return 'bg-sky-950 text-sky-300';
  return 'bg-amber-950 text-amber-300';
};

/**
 * MasterOverview — Owner/Admin ka SABSE POWERFUL section.
 * Stores + unke andar orders drill-down, customers, delivery partners,
 * store managers — sab ek jagah, Supabase Realtime se live.
 */
const MasterOverview = ({ searchQuery = '' }) => {
  const [stores, setStores] = useState([]);
  const [orders, setOrders] = useState([]);
  const [users, setUsers] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [staffLinks, setStaffLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [notice, setNotice] = useState({ type: '', text: '' });

  // Local filters (top search ke SAATH combine hote hain)
  const [storeFilter, setStoreFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedStore, setExpandedStore] = useState(null);
  const [selectedPartner, setSelectedPartner] = useState(null);

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [storeRes, orderRes, userRes, profileRes, staffRes] = await Promise.all([
        supabase.from('stores').select('*').order('id', { ascending: true }),
        supabase
          .from('orders')
          .select('id, user_id, store_id, order_items, total_price, status, payment_method, delivery_boy_id, created_at, shipping_address')
          .order('created_at', { ascending: false })
          .limit(2000),
        supabase.from('users').select('id, name, email, phone, role, created_at').order('created_at', { ascending: false }).limit(2000),
        supabase.from('delivery_profiles').select('*').order('created_at', { ascending: false }).limit(2000),
        supabase.from('store_staff').select('store_id, user_id'),
      ]);
      if (storeRes.error && /schema cache|does not exist|not find/i.test(storeRes.error.message || '')) {
        throw new Error('Stores table not found — Run server/supabase_multi_store.sql in Supabase.');
      }
      if (orderRes.error) throw orderRes.error;
      if (userRes.error) throw userRes.error;
      // delivery_profiles / store_staff optional (purane DB me na ho to khaali)
      setStores(storeRes.data || []);
      setOrders(orderRes.data || []);
      setUsers(userRes.data || []);
      setProfiles(profileRes.error ? [] : profileRes.data || []);
      setStaffLinks(staffRes.error ? [] : staffRes.data || []);
      setLastUpdated(new Date());
      setNotice({ type: '', text: '' });
    } catch (e) {
      if (!silent) setNotice({ type: 'error', text: e.message || 'Master data could not be loaded.' });
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll(false);
  }, [loadAll]);

  // ---- REALTIME: kisi bhi panel me change → yahan turant reflect ----
  useEffect(() => {
    const refresh = () => loadAll(true);
    const ch = supabase
      .channel('master-overview-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stores' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_profiles' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_staff' }, refresh)
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));
    return () => {
      supabase.removeChannel(ch);
    };
  }, [loadAll]);

  // ---- Derived maps ----
  const usersById = useMemo(() => new Map(users.map((u) => [String(u.id), u])), [users]);
  const storesById = useMemo(() => new Map(stores.map((s) => [String(s.id), s])), [stores]);
  const profileByUser = useMemo(() => new Map(profiles.map((p) => [String(p.user_id), p])), [profiles]);

  const deliveryUsers = useMemo(
    () => users.filter((u) => ['delivery', 'delivery_partner'].includes(String(u.role || '').toLowerCase())),
    [users],
  );
  const customers = useMemo(
    () => users.filter((u) => !['delivery', 'delivery_partner', 'admin', 'store_manager'].includes(String(u.role || '').toLowerCase())),
    [users],
  );
  const managers = useMemo(
    () => users.filter((u) => String(u.role || '').toLowerCase() === 'store_manager'),
    [users],
  );

  const staffStoresByUser = useMemo(() => {
    const m = new Map();
    for (const l of staffLinks) {
      const uid = String(l.user_id);
      if (!m.has(uid)) m.set(uid, []);
      const s = storesById.get(String(l.store_id));
      m.get(uid).push(s ? s.store_name : `Store #${l.store_id}`);
    }
    return m;
  }, [staffLinks, storesById]);

  const ordersByStore = useMemo(() => {
    const m = new Map();
    for (const o of orders) {
      const k = o.store_id == null ? 'unassigned' : String(o.store_id);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(o);
    }
    return m;
  }, [orders]);

  const ordersByUser = useMemo(() => {
    const m = new Map();
    for (const o of orders) {
      if (!o.user_id) continue;
      const k = String(o.user_id);
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [orders]);

  const deliveredByPartner = useMemo(() => {
    const m = new Map();
    for (const o of orders) {
      if (!o.delivery_boy_id) continue;
      const k = String(o.delivery_boy_id);
      const cur = m.get(k) || { assigned: 0, delivered: 0 };
      cur.assigned += 1;
      if (String(o.status || '').toLowerCase() === 'delivered') cur.delivered += 1;
      m.set(k, cur);
    }
    return m;
  }, [orders]);

  const kpis = useMemo(() => {
    const tk = todayKey();
    let todayOrders = 0;
    let todayRevenue = 0;
    for (const o of orders) {
      if (dayKey(o.created_at) === tk) {
        todayOrders += 1;
        todayRevenue += Number(o.total_price || 0);
      }
    }
    return {
      totalStores: stores.length,
      activeStores: stores.filter((s) => s.is_active !== false).length,
      totalOrders: orders.length,
      todayOrders,
      todayRevenue,
      customers: customers.length,
      delivery: deliveryUsers.length,
      managers: managers.length,
    };
  }, [stores, orders, customers, deliveryUsers, managers]);

  // ---- Global order filter (search + store + date + status) ----
  const filteredOrders = useMemo(() => {
    const q = `${searchQuery || ''}`.trim().toLowerCase();
    return orders.filter((o) => {
      if (storeFilter !== 'all') {
        if (storeFilter === 'unassigned' ? o.store_id != null : String(o.store_id) !== String(storeFilter)) return false;
      }
      if (dateFilter && dayKey(o.created_at) !== dateFilter) return false;
      if (statusFilter !== 'all' && String(o.status || '').toLowerCase() !== String(statusFilter).toLowerCase()) return false;
      if (!q) return true;
      const u = usersById.get(String(o.user_id));
      const d = usersById.get(String(o.delivery_boy_id));
      const s = o.store_id != null ? storesById.get(String(o.store_id)) : null;
      const hay = [
        String(o.id), o.status, o.payment_method, u?.name, u?.email, u?.phone,
        d?.name, d?.email, s?.store_name, String(o.total_price ?? ''), itemsSummary(o),
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [orders, storeFilter, dateFilter, statusFilter, searchQuery, usersById, storesById]);

  const filteredCustomers = useMemo(() => {
    const q = `${searchQuery || ''}`.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((u) =>
      [u.name, u.email, u.phone, String(u.id)].filter(Boolean).join(' ').toLowerCase().includes(q),
    );
  }, [customers, searchQuery]);

  const statusOptions = useMemo(() => {
    const set = new Set(orders.map((o) => String(o.status || 'Placed')));
    return ['all', ...[...set].sort()];
  }, [orders]);

  const clearFilters = () => {
    setStoreFilter('all');
    setDateFilter('');
    setStatusFilter('all');
  };
  const hasFilter = storeFilter !== 'all' || dateFilter !== '' || statusFilter !== 'all';

  const storeOrders = (storeId) => {
    const list = ordersByStore.get(String(storeId)) || [];
    return list.filter((o) => {
      if (dateFilter && dayKey(o.created_at) !== dateFilter) return false;
      if (statusFilter !== 'all' && String(o.status || '').toLowerCase() !== String(statusFilter).toLowerCase()) return false;
      const q = `${searchQuery || ''}`.trim().toLowerCase();
      if (!q) return true;
      const u = usersById.get(String(o.user_id));
      return [String(o.id), o.status, u?.name, u?.email, itemsSummary(o)].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
  };

  const partnerName = (id) => {
    if (!id) return '—';
    const u = usersById.get(String(id));
    return u?.name || u?.email || `${String(id).slice(0, 8)}…`;
  };

  return (
    <div className="space-y-4">
      {/* Header + LIVE */}
      <section className="rounded-2xl border border-amber-700/50 bg-gradient-to-r from-amber-950/60 via-slate-900 to-slate-900 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-400 text-slate-950">
              <Crown className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-black text-white">Master Overview — All Data</h2>
              <p className="text-xs text-slate-400">Owner access: all stores, orders, users, partners, managers</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-bold">
            <span className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 ${live ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
              <span className={`h-2 w-2 rounded-full ${live ? 'animate-pulse bg-emerald-400' : 'bg-slate-500'}`} />
              {live ? 'LIVE' : 'connecting...'}
            </span>
            {lastUpdated && <span className="text-slate-500">Updated {lastUpdated.toLocaleTimeString('en-IN')}</span>}
            <button type="button" onClick={() => loadAll(false)} className="rounded-xl bg-slate-800 px-3 py-1.5 text-slate-200 hover:bg-slate-700">
              Refresh
            </button>
          </div>
        </div>

        {/* KPI cards */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {[
            ['Stores', `${kpis.activeStores}/${kpis.totalStores}`],
            ['Orders', kpis.totalOrders],
            ['Aaj orders', kpis.todayOrders],
            ['Aaj sale', fmtRs(kpis.todayRevenue)],
            ['Customers', kpis.customers],
            ['Delivery', kpis.delivery],
            ['Managers', kpis.managers],
          ].map(([label, val]) => (
            <div key={label} className="rounded-xl bg-slate-950/70 px-3 py-2.5 text-center">
              <p className="text-lg font-black text-white">{val}</p>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="mt-4 grid gap-2 md:grid-cols-4">
          <label className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5">
            <Search className="h-4 w-4 shrink-0 text-slate-500" />
            <input value={searchQuery || ''} readOnly placeholder="Top search bar se search karo..." className="w-full bg-transparent text-sm text-slate-400 outline-none placeholder:text-slate-600" />
          </label>
          <label className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-sm">
            <StoreIcon className="h-4 w-4 shrink-0 text-slate-500" />
            <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} className="w-full bg-transparent text-white outline-none">
              <option value="all" className="bg-slate-900">Sare stores ke orders</option>
              {stores.map((s) => (
                <option key={s.id} value={String(s.id)} className="bg-slate-900">{s.store_name}</option>
              ))}
              <option value="unassigned" className="bg-slate-900">Bina store (legacy)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-sm">
            <CalendarDays className="h-4 w-4 shrink-0 text-slate-500" />
            <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="w-full bg-transparent text-white outline-none" />
          </label>
          <div className="flex gap-2">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-sm text-white outline-none">
              {statusOptions.map((s) => (
                <option key={s} value={s} className="bg-slate-900">{s === 'all' ? 'Sare status' : s}</option>
              ))}
            </select>
            {hasFilter && (
              <button type="button" onClick={clearFilters} aria-label="Filters hatao" className="rounded-xl bg-slate-800 px-3 text-slate-300 hover:bg-slate-700">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        {hasFilter && (
          <p className="mt-2 text-xs text-amber-200/80">
            Filter active: {filteredOrders.length}/{orders.length} orders dikh rahe hain
          </p>
        )}
      </section>

      {notice.text && (
        <div className={`rounded-xl p-3 text-sm font-bold ${notice.type === 'error' ? 'bg-rose-950 text-rose-300' : 'bg-emerald-950 text-emerald-300'}`}>
          {notice.text}
        </div>
      )}

      {loading ? (
        <p className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Master data load ho raha hai...
        </p>
      ) : (
        <>
          {/* 1. STORES + drill-down */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-6">
            <h3 className="font-black text-white">1. Sare Stores ({stores.length})</h3>
            <p className="mb-4 text-xs text-slate-500">Store par tap karo → uske sare orders (customer, items, status, delivery partner)</p>
            {stores.length === 0 ? (
              <p className="rounded-xl bg-slate-800 p-6 text-center text-sm text-slate-400">Koi store nahi — Stores tab se pehla store banao.</p>
            ) : (
              <div className="space-y-2">
                {stores.map((s) => {
                  const list = ordersByStore.get(String(s.id)) || [];
                  const shown = storeOrders(s.id);
                  const open = expandedStore === s.id;
                  return (
                    <article key={s.id} className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60">
                      <button type="button" onClick={() => setExpandedStore(open ? null : s.id)} className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left">
                        <span className="flex min-w-0 items-center gap-3">
                          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${s.is_active !== false ? 'bg-emerald-500 text-slate-950' : 'bg-slate-700 text-slate-300'}`}>
                            <StoreIcon className="h-5 w-5" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-black text-white">{s.store_name}</span>
                            <span className="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
                              <MapPin className="h-3 w-3 shrink-0" />
                              <span className="truncate">{s.address || 'Address nahi'}</span>
                            </span>
                          </span>
                        </span>
                        <span className="flex items-center gap-2 text-xs">
                          <span className={`rounded-full px-2.5 py-1 font-black uppercase ${s.is_active !== false ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-700 text-slate-400'}`}>
                            {s.is_active !== false ? 'Active' : 'Inactive'}
                          </span>
                          <span className="rounded-full bg-slate-800 px-2.5 py-1 font-black text-slate-200">{list.length} orders</span>
                          <ChevronDown className={`h-4 w-4 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
                        </span>
                      </button>
                      {open && (
                        <div className="border-t border-slate-800 p-3">
                          {shown.length === 0 ? (
                            <p className="p-4 text-center text-xs text-slate-500">Is store ka koi order nahi{dateFilter ? ' (is date me)' : ''}.</p>
                          ) : (
                            <div className="space-y-2">
                              {shown.slice(0, 50).map((o) => {
                                const u = usersById.get(String(o.user_id));
                                return (
                                  <div key={o.id} className="rounded-lg bg-slate-800/70 p-3 text-xs">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <b className="text-white">Order #{o.id}</b>
                                      <span className={`rounded-full px-2 py-0.5 font-black uppercase ${statusCls(o.status)}`}>{o.status || 'Placed'}</span>
                                    </div>
                                    <p className="mt-1 text-slate-300">
                                      <UserRound className="mr-1 inline h-3 w-3" />
                                      {u?.name || 'Guest'} {u?.phone ? `· ${u.phone}` : ''} · {fmtDateTime(o.created_at)}
                                    </p>
                                    <p className="mt-0.5 flex items-center gap-1 text-slate-400">
                                      <Package className="h-3 w-3 shrink-0" /> {itemsSummary(o)}
                                    </p>
                                    <p className="mt-0.5 text-slate-400">
                                      <Truck className="mr-1 inline h-3 w-3" /> {partnerName(o.delivery_boy_id)} · <b className="text-slate-200">{fmtRs(o.total_price)}</b>
                                    </p>
                                  </div>
                                );
                              })}
                              {shown.length > 50 && <p className="p-2 text-center text-[11px] text-slate-500">+{shown.length - 50} aur orders — neeche All Orders me filter karo</p>}
                            </div>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {/* 2. ALL ORDERS */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-6">
            <h3 className="font-black text-white">2. Orders ({filteredOrders.length}/{orders.length})</h3>
            <p className="mb-4 text-xs text-slate-500">Store / date / status filter yahan lagta hai</p>
            {filteredOrders.length === 0 ? (
              <p className="rounded-xl bg-slate-800 p-6 text-center text-sm text-slate-400">Koi order match nahi hua.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-xs">
                  <thead className="text-[11px] uppercase text-slate-500">
                    <tr><th className="p-2">Order</th><th className="p-2">Store</th><th className="p-2">Customer</th><th className="p-2">Items</th><th className="p-2">Total</th><th className="p-2">Status</th><th className="p-2">Delivery Partner</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {filteredOrders.slice(0, 100).map((o) => {
                      const u = usersById.get(String(o.user_id));
                      const s = o.store_id != null ? storesById.get(String(o.store_id)) : null;
                      return (
                        <tr key={o.id} className="align-top">
                          <td className="p-2"><b className="text-white">#{o.id}</b><span className="block text-slate-500">{fmtDateTime(o.created_at)}</span></td>
                          <td className="p-2 text-slate-300">{s?.store_name || <span className="text-slate-600">—</span>}</td>
                          <td className="p-2"><span className="font-bold text-slate-200">{u?.name || 'Guest'}</span><span className="block text-slate-500">{u?.phone || u?.email || ''}</span></td>
                          <td className="max-w-[220px] p-2 text-slate-400">{itemsSummary(o)}</td>
                          <td className="p-2 font-black text-white">{fmtRs(o.total_price)}</td>
                          <td className="p-2"><span className={`rounded-full px-2 py-0.5 font-black uppercase ${statusCls(o.status)}`}>{o.status || 'Placed'}</span></td>
                          <td className="p-2 text-slate-300">{partnerName(o.delivery_boy_id)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredOrders.length > 100 && <p className="p-3 text-center text-[11px] text-slate-500">Pehle 100 dikh rahe hain — filter aur tight karo</p>}
              </div>
            )}
          </section>

          {/* 3. USERS */}
          <section className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-6">
            <h3 className="font-black text-white">3. Customers ({filteredCustomers.length})</h3>
            <p className="mb-4 text-xs text-slate-500">Naam, email, phone, kitne orders</p>
            <table className="w-full min-w-[700px] text-left text-xs">
              <thead className="text-[11px] uppercase text-slate-500">
                <tr><th className="p-2">Naam</th><th className="p-2">Email</th><th className="p-2">Phone</th><th className="p-2">Orders</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filteredCustomers.slice(0, 100).map((u) => (
                  <tr key={u.id}>
                    <td className="p-2 font-bold text-white">{u.name || '—'}</td>
                    <td className="p-2 text-slate-400">{u.email}</td>
                    <td className="p-2 text-slate-400">{u.phone || '-'}</td>
                    <td className="p-2"><span className="rounded-full bg-slate-800 px-2.5 py-1 font-black text-slate-200">{ordersByUser.get(String(u.id)) || 0}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* 4. DELIVERY PARTNERS */}
          <section className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-6">
            <h3 className="font-black text-white">4. Delivery Partners ({deliveryUsers.length})</h3>
            <p className="mb-4 text-xs text-slate-500">Details, documents, delivered orders — naam par tap karke full details</p>
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="text-[11px] uppercase text-slate-500">
                <tr><th className="p-2">Partner</th><th className="p-2">Phone</th><th className="p-2">Approval</th><th className="p-2">Online</th><th className="p-2">Docs</th><th className="p-2">Delivered</th><th className="p-2">Assigned</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {deliveryUsers.map((u) => {
                  const p = profileByUser.get(String(u.id)) || {};
                  const stat = deliveredByPartner.get(String(u.id)) || { assigned: 0, delivered: 0 };
                  const docs = ['profile_photo_url', 'aadhar_card_url', 'driving_license_url', 'pan_card_url'].filter((k) => p[k]).length;
                  const online = (p.is_available !== false || u.is_available !== false) && (p.is_available ?? true) && (u.is_available ?? true);
                  return (
                    <tr key={u.id}>
                      <td className="p-2">
                        <button type="button" onClick={() => setSelectedPartner({ ...u, profile: p })} className="font-bold text-emerald-300 hover:underline">
                          {u.name || p.name || 'Unnamed'}
                        </button>
                        <span className="block text-slate-500">{u.email}</span>
                      </td>
                      <td className="p-2 text-slate-400">{u.phone || p.phone || '-'}</td>
                      <td className="p-2"><span className="rounded-full bg-slate-800 px-2 py-0.5 font-black uppercase text-slate-300">{p.approval_status || '—'}</span></td>
                      <td className="p-2"><span className={`rounded-full px-2 py-0.5 font-black uppercase ${online ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-700 text-slate-400'}`}>{online ? 'Online' : 'Offline'}</span></td>
                      <td className="p-2 text-slate-300">{docs}/4</td>
                      <td className="p-2 font-black text-emerald-300">{stat.delivered}</td>
                      <td className="p-2 text-slate-300">{stat.assigned}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {selectedPartner && <DeliveryBoyDetailsModal partner={selectedPartner} onClose={() => setSelectedPartner(null)} />}
          </section>

          {/* 5. MANAGERS */}
          <section className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-6">
            <h3 className="font-black text-white">5. Store Managers ({managers.length})</h3>
            <p className="mb-4 text-xs text-slate-500">Naam, login email, linked store</p>
            {managers.length === 0 ? (
              <p className="rounded-xl bg-slate-800 p-6 text-center text-sm text-slate-400">Koi manager nahi — Stores tab se manager account banao.</p>
            ) : (
              <table className="w-full min-w-[700px] text-left text-xs">
                <thead className="text-[11px] uppercase text-slate-500">
                  <tr><th className="p-2">Naam</th><th className="p-2">Login email</th><th className="p-2">Linked store</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {managers.map((m) => (
                    <tr key={m.id}>
                      <td className="p-2 font-bold text-white">{m.name || '—'}</td>
                      <td className="p-2 text-slate-400">{m.email}</td>
                      <td className="p-2 text-emerald-300">{(staffStoresByUser.get(String(m.id)) || []).join(', ') || <span className="text-amber-300">Link nahi (Stores tab se link karo)</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <p className="flex items-center gap-1.5 pb-2 text-[11px] text-slate-600">
            <Users className="h-3.5 w-3.5" /> Master Overview realtime hai — User/Delivery/Store panel me kuch bhi badlo, yahan turant dikhega (bina refresh).
          </p>
        </>
      )}
    </div>
  );
};

export default MasterOverview;
