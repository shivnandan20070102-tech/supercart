import React, { useEffect, useState } from 'react';
import { LoaderCircle, RotateCcw, Star } from 'lucide-react';
import { supabase } from '../config/supabase';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'https://supercart-kloc.onrender.com').replace(/\/+$/, '');

const getToken = async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) return session.access_token;
  } catch { /* ignore */ }
  return localStorage.getItem('supercart_token') || '';
};

const AdminRefundsReviews = () => {
  const [tab, setTab] = useState('refunds');
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [reviews, setReviews] = useState([]);
  const [avgRating, setAvgRating] = useState(0);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [error, setError] = useState('');
  const [markingId, setMarkingId] = useState(null);

  const loadRefunds = async () => {
    setOrdersLoading(true);
    setError('');
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/orders/admin/refunds`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.success === false) {
        setError(json?.message || `Server error (${res.status})`);
        setOrders([]);
      } else {
        setOrders(Array.isArray(json?.data) ? json.data : []);
      }
    } catch (e) {
      setError(e?.message || 'Could not load refund orders.');
      setOrders([]);
    } finally {
      setOrdersLoading(false);
    }
  };

  const loadReviews = async () => {
    setReviewsLoading(true);
    setError('');
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/orders/admin/reviews`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.success === false) {
        setError(json?.message || `Server error (${res.status})`);
        setReviews([]);
      } else {
        setReviews(Array.isArray(json?.data) ? json.data : []);
        setAvgRating(Number(json?.averageRating || 0));
      }
    } catch (e) {
      setError(e?.message || 'Could not load reviews.');
      setReviews([]);
    } finally {
      setReviewsLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'refunds') loadRefunds();
    else loadReviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const markRefunded = async (orderId) => {
    setMarkingId(orderId);
    setError('');
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/orders/${orderId}/mark-refunded`, {
        method: 'PATCH',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.success === false) {
        setError(json?.message || `Server error (${res.status})`);
      } else {
        setOrders((prev) => prev.map((o) => (String(o.id) === String(orderId) ? { ...o, refund_status: 'refunded' } : o)));
      }
    } catch (e) {
      setError(e?.message || 'Could not mark refunded.');
    } finally {
      setMarkingId(null);
    }
  };

  const statusBadge = (order) => {
    const s = String(order.status || '').toLowerCase();
    if (s === 'return_refund') return <span className="rounded-full bg-amber-400 px-2.5 py-1 text-[11px] font-black text-slate-950">RETURN/REFUND</span>;
    if (s === 'cancelled') return <span className="rounded-full bg-rose-500 px-2.5 py-1 text-[11px] font-black text-white">CANCELLED</span>;
    return <span className="rounded-full bg-slate-700 px-2.5 py-1 text-[11px] font-black text-slate-200">{s}</span>;
  };

  const refundBadge = (order) => {
    const r = String(order.refund_status || 'none');
    const map = {
      none: <span className="rounded-full bg-slate-700 px-2.5 py-1 text-[11px] font-black text-slate-300">No payment (COD)</span>,
      pending: <span className="rounded-full bg-amber-400/20 px-2.5 py-1 text-[11px] font-black text-amber-300">Pending</span>,
      approved: <span className="rounded-full bg-blue-400/20 px-2.5 py-1 text-[11px] font-black text-blue-300">Approved</span>,
      refunded: <span className="rounded-full bg-emerald-400/20 px-2.5 py-1 text-[11px] font-black text-emerald-300">Refunded</span>,
    };
    return map[r] || <span className="rounded-full bg-slate-700 px-2.5 py-1 text-[11px] font-black text-slate-300">{r}</span>;
  };

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-black">Refunds &amp; Reviews</h2>
            <p className="text-xs text-slate-400">Cancelled / returned orders and delivery partner reviews.</p>
          </div>
          <div className="flex gap-1">
            {['refunds', 'reviews'].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setTab(t); setError(''); }}
                className={`rounded-xl px-4 py-2 text-xs font-black capitalize transition ${tab === t ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="mt-3 rounded-xl bg-rose-950 p-3 text-xs font-bold text-rose-300">{error}</p>}
      </div>

      {tab === 'refunds' && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          {ordersLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
              <LoaderCircle className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : orders.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No cancelled / returned orders.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-slate-500">
                    <th className="pb-3">Order</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3">Reason</th>
                    <th className="pb-3">Cancelled by</th>
                    <th className="pb-3">Amount</th>
                    <th className="pb-3">Refund</th>
                    <th className="pb-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td className="py-3 font-black text-white">#{order.id}</td>
                      <td className="py-3">{statusBadge(order)}</td>
                      <td className="py-3 text-slate-300">{order.cancel_reason || order.return_reason || '—'}</td>
                      <td className="py-3 text-slate-300">{order.cancelled_by || '—'}</td>
                      <td className="py-3 font-bold text-white">₹{order.total_price ?? 0}</td>
                      <td className="py-3">{refundBadge(order)}</td>
                      <td className="py-3">
                        {order.refund_status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => markRefunded(order.id)}
                            disabled={markingId === order.id}
                            className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-black text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
                          >
                            {markingId === order.id ? 'Updating…' : 'Mark refunded'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'reviews' && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          {reviewsLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
              <LoaderCircle className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : reviews.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No reviews yet.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-800 p-4">
                <span className="flex items-center gap-1 text-2xl font-black text-amber-400">
                  <Star className="h-6 w-6 fill-amber-400 text-amber-400" />
                  {avgRating.toFixed(1)}
                </span>
                <span className="text-xs text-slate-400">average of {reviews.length} ratings</span>
              </div>
              {reviews.map((review, idx) => (
                <div key={review.id || idx} className="rounded-xl border border-slate-800 bg-slate-800/50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex gap-0.5">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <Star key={s} className={`h-4 w-4 ${review.rating >= s ? 'fill-amber-400 text-amber-400' : 'text-slate-600'}`} />
                        ))}
                      </span>
                      <span className="text-sm font-black text-white">{review.rating}/5</span>
                    </div>
                    <span className="text-[11px] text-slate-500">Order #{review.order_id}</span>
                  </div>
                  {(review.partner_name || review.reviewer_name) && (
                    <p className="mt-2 text-xs text-slate-400">Partner: {review.partner_name || review.reviewer_name}</p>
                  )}
                  {review.customer_name && (
                    <p className="mt-0.5 text-xs text-slate-400">Customer: {review.customer_name}</p>
                  )}
                  {Array.isArray(review.tags) && review.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {review.tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-slate-700 px-2.5 py-0.5 text-[11px] font-bold text-slate-200">{String(tag).replace(/_/g, ' ')}</span>
                      ))}
                    </div>
                  )}
                  {review.comment && <p className="mt-2 text-sm text-slate-300">{review.comment}</p>}
                  <button type="button" onClick={loadReviews} className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 hover:underline">
                    <RotateCcw className="h-3 w-3" /> Refresh
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default AdminRefundsReviews;
