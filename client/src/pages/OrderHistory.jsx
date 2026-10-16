import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock3,
  LoaderCircle,
  Package,
  RotateCcw,
  Search,
  Star,
  Truck,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { getMyOrdersApi } from '../services/api';
import { supabase } from '../config/supabase';

// Jin status me partner ke paas order hai — list me naam dikhta hai, live map
// sirf Order Detail page me (OrderDetail.jsx).
const TRACKABLE_STATUSES = new Set(['assigned', 'accepted', 'picked_up', 'out_for_delivery']);
const isTrackable = (order) => {
  const boy = order?.delivery_boy_id;
  if (boy == null || String(boy).trim() === '') return false;
  return TRACKABLE_STATUSES.has(String(order?.status || '').toLowerCase());
};
import {
  arrivedInMinutes,
  formatOrderDateTime,
  getOrderItems,
  getOrderTotal,
  isDelivered,
  prettyStatus,
} from '../utils/orderHistory';

const statusIcon = (order) => {
  const s = String(order.status || '').toLowerCase();
  if (s === 'delivered')
    return { Icon: CheckCircle2, cls: 'bg-emerald-100 text-emerald-600' };
  if (s === 'cancelled')
    return { Icon: XCircle, cls: 'bg-rose-100 text-rose-500' };
  if (s === 'out_for_delivery' || s === 'picked_up' || s === 'accepted')
    return { Icon: Truck, cls: 'bg-amber-100 text-amber-600' };
  return { Icon: Clock3, cls: 'bg-slate-100 text-slate-500' };
};

const statusLine = (order) => {
  if (isDelivered(order)) return arrivedInMinutes(order);
  return prettyStatus(order);
};

const OrderHistory = () => {
  const { user, loading } = useAuth();
  const { addToCart } = useCart();
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [partnersById, setPartnersById] = useState(new Map());
  const [query, setQuery] = useState('');
  const [reorderId, setReorderId] = useState(null);
  const [ratedMap, setRatedMap] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('supercart_rated_orders') || '{}');
    } catch {
      return {};
    }
  });

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate('/login');
      return;
    }
    const load = async () => {
      try {
        const res = await getMyOrdersApi(user.id);
        if (res.success) {
          const sorted = [...(res.data || [])].sort(
            (a, b) => new Date(b.created_at || b.createdAt || 0) - new Date(a.created_at || a.createdAt || 0),
          );
          setOrders(sorted);
          // Trackable orders ke partner naam ek batch me (live map nahi —
          // wo sirf Order Detail me khulta hai).
          try {
            const riderIds = [...new Set(
              sorted.filter(isTrackable).map((o) => String(o.delivery_boy_id)),
            )];
            if (riderIds.length > 0) {
              const { data: riders } = await supabase
                .from('users')
                .select('id, name')
                .in('id', riderIds);
              setPartnersById(new Map((riders || []).map((r) => [String(r.id), r.name || 'Delivery partner'])));
            } else {
              setPartnersById(new Map());
            }
          } catch {
            setPartnersById(new Map());
          }
        }
      } catch {
        setOrders([]);
      } finally {
        setOrdersLoading(false);
      }
    };
    load();
  }, [loading, user, navigate]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((order) => {
      const items = getOrderItems(order);
      const hay = [
        String(order.id || ''),
        order.status || '',
        String(getOrderTotal(order)),
        items.map((i) => i.name || '').join(' '),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [orders, query]);

  const handleReorder = (event, order) => {
    event.stopPropagation();
    const items = getOrderItems(order);
    if (items.length === 0) return;
    setReorderId(order.id);
    items.forEach((it) => {
      addToCart(
        {
          id: it.productId || it.product_id || it.id,
          name: it.name,
          price: Number(it.price || 0),
          originalPrice: Number(it.originalPrice ?? it.mrp ?? it.price ?? 0),
          image: it.image,
          weight: it.weight || it.unit,
        },
        Number(it.quantity || it.qty || 1),
      );
    });
    setTimeout(() => {
      setReorderId(null);
      navigate('/cart');
    }, 450);
  };

  const handleRate = (event, order) => {
    event.stopPropagation();
    navigate(`/profile/orders/${order.id}?rate=1`);
  };

  if (loading || ordersLoading) {
    return (
      <div className="min-h-screen bg-[#f4f6f5]">
        <div className="sticky top-0 z-40 border-b border-slate-200 bg-white">
          <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-4">
            <button type="button" onClick={() => navigate(-1)} aria-label="Go back" className="flex h-10 w-10 items-center justify-center rounded-full text-slate-800 hover:bg-slate-100">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h1 className="text-base font-black text-slate-900">Order History</h1>
          </div>
        </div>
        <div className="mx-auto flex max-w-2xl items-center justify-center gap-2 px-4 py-16 text-sm text-slate-500">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Loading your orders…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f6f5] pb-24">
      {/* Top bar — Blinkit jaisa simple header */}
      <div className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-4">
          <button
            type="button"
            onClick={() => {
              if (window.history.length > 1) navigate(-1);
              else navigate('/profile');
            }}
            aria-label="Go back"
            className="flex h-10 w-10 items-center justify-center rounded-full text-slate-800 transition hover:bg-slate-100 active:scale-95"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-base font-black tracking-tight text-slate-900">Order History</h1>
        </div>
        {/* Search bar */}
        <div className="mx-auto max-w-2xl px-4 pb-3">
          <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-3 text-sm text-slate-600 focus-within:border-emerald-500 focus-within:bg-white">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your grocery orders"
              className="w-full bg-transparent text-sm font-medium text-slate-800 outline-none placeholder:text-slate-400"
            />
          </label>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-3 px-4 pt-4">
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
            <Package className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm font-black text-slate-800">
              {orders.length === 0 ? 'No orders yet' : 'No matching orders'}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {orders.length === 0
                ? 'Jab aap order karenge, wo yahan newest-first dikhega.'
                : 'Search badal kar dobara try karo.'}
            </p>
            {orders.length === 0 && (
              <Link to="/" className="mt-4 inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white">
                Shop groceries <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        ) : (
          filtered.map((order) => {
            const items = getOrderItems(order);
            const total = getOrderTotal(order);
            const date = formatOrderDateTime(order.created_at || order.createdAt);
            const { Icon, cls } = statusIcon(order);
            const thumbs = items.slice(0, 3);
            const extra = Math.max(0, items.length - thumbs.length);
            const rated = Boolean(ratedMap?.[order.id]);

            return (
              <article
                key={order.id}
                onClick={() => navigate(`/profile/orders/${order.id}`)}
                className="cursor-pointer rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition hover:border-emerald-300 hover:shadow-md active:scale-[0.99]"
              >
                {/* Status row */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${cls}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-black ${isDelivered(order) ? 'text-emerald-700' : 'text-slate-800'}`}>
                        {statusLine(order)}
                      </p>
                      <p className="mt-0.5 text-xs font-medium text-slate-500">
                        ₹{total} <span className="mx-1 text-slate-300">•</span> {date}
                      </p>
                      {isTrackable(order) && (
                        <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-black text-blue-700">
                          <Truck className="h-3 w-3" />
                          {partnersById.get(String(order.delivery_boy_id)) || 'Delivery partner assigned'} • Live
                        </p>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300" />
                </div>

                {/* Thumbnails */}
                {items.length > 0 && (
                  <div className="mt-3 flex items-center gap-2">
                    {thumbs.map((it, idx) => (
                      <span key={`${order.id}-thumb-${it.productId || it.id || idx}`} className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                        {it.image ? (
                          <img src={it.image} alt={it.name || ''} className="h-full w-full object-contain" loading="lazy" />
                        ) : (
                          <Package className="h-5 w-5 text-slate-300" />
                        )}
                      </span>
                    ))}
                    {extra > 0 && (
                      <span className="flex h-12 items-center rounded-xl bg-slate-100 px-3 text-xs font-black text-slate-600">
                        +{extra} more
                      </span>
                    )}
                    <span className="ml-auto hidden text-[11px] font-bold text-slate-400 sm:block">
                      {items.length} item{items.length > 1 ? 's' : ''}
                    </span>
                  </div>
                )}

                {/* Actions */}
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-dashed border-slate-200 pt-3">
                  <button
                    type="button"
                    onClick={(e) => handleReorder(e, order)}
                    disabled={reorderId === order.id}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2.5 text-xs font-black text-slate-800 transition hover:border-emerald-500 hover:text-emerald-700 disabled:opacity-60"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {reorderId === order.id ? 'Adding…' : 'Reorder'}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleRate(e, order)}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-black transition ${
                      rated
                        ? 'bg-amber-50 text-amber-600'
                        : 'text-emerald-700 hover:bg-emerald-50'
                    }`}
                  >
                    <Star className={`h-3.5 w-3.5 ${rated ? 'fill-current' : ''}`} />
                    {rated ? 'Rated' : 'Rate order'}
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
};

export default OrderHistory;
