import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  BadgePercent,
  Check,
  Copy,
  Download,
  Eye,
  Gift,
  LoaderCircle,
  MapPin,
  MessageCircle,
  Package,
  Phone,
  Repeat2,
  Star,
  Truck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { getMyOrdersApi } from '../services/api';
import { supabase } from '../config/supabase';
import { downloadOrderInvoice, viewOrderInvoice } from '../services/invoice';

// Live map (~2MB) sirf trackable order par lazy load ho — list/detail ki
// initial load halki rahe.
const OrderTrackingMap = React.lazy(() => import('../components/OrderTrackingMap'));

// Jin status me delivery partner ke paas order hai — SIRF tabhi tracking
// section dikhta hai. pending/pending_assignment/packed (bina partner) +
// delivered/cancelled par section hidden rehta hai.
const TRACKABLE_STATUSES = new Set(['assigned', 'accepted', 'picked_up', 'out_for_delivery']);
import {
  arrivedAtTime,
  formatOrderPlaced,
  getBillDetails,
  getDeliveryAddressLine,
  getItemWeightLabel,
  getOrderItems,
  isDelivered,
  prettyStatus,
} from '../utils/orderHistory';

const BillRow = ({ label, value, bold, green, strike }) => (
  <div className={`flex items-center justify-between text-[13px] ${bold ? 'font-black text-slate-900' : 'font-medium text-slate-600'}`}>
    <span>{label}</span>
    <span className={`${green ? 'font-black text-emerald-600' : ''} ${strike ? 'line-through text-slate-400' : ''}`}>
      {value}
    </span>
  </div>
);

const OrderDetail = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { user, loading } = useAuth();
  const { addToCart } = useCart();
  const navigate = useNavigate();

  const [order, setOrder] = useState(null);
  const [fetching, setFetching] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [invoiceBusy, setInvoiceBusy] = useState(null); // 'view' | 'download' | null
  const [invoiceError, setInvoiceError] = useState('');
  const [copied, setCopied] = useState(false);
  const [repeating, setRepeating] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [rated, setRated] = useState(false);
  const [showRateBox, setShowRateBox] = useState(false);
  const [partner, setPartner] = useState(null);

  useEffect(() => {
    if (searchParams.get('rate') === '1') setShowRateBox(true);
  }, [searchParams]);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate('/login');
      return;
    }
    const load = async () => {
      setFetching(true);
      setFetchError('');
      try {
        const res = await getMyOrdersApi(user.id);
        const found = (res.data || []).find((o) => String(o.id) === String(id));
        if (!found) {
          setFetchError('Order not found.');
          setOrder(null);
        } else {
          setOrder(found);
          try {
            const ratedMap = JSON.parse(localStorage.getItem('supercart_rated_orders') || '{}');
            if (ratedMap?.[found.id]) {
              setRated(true);
              setRating(Number(ratedMap[found.id]) || 5);
            }
          } catch { /* ignore */ }
        }
      } catch (e) {
        setFetchError(e?.message || 'Could not load order.');
      } finally {
        setFetching(false);
      }
    };
    load();
  }, [loading, user, id, navigate]);

  const items = useMemo(() => getOrderItems(order || {}), [order]);
  const bill = useMemo(() => getBillDetails(order || {}), [order]);

  // Live delivery tracking — SIRF jab partner assign ho aur order uske paas ho.
  const riderId = useMemo(() => {
    const raw = order?.delivery_boy_id;
    if (raw == null || String(raw).trim() === '') return null;
    return String(raw);
  }, [order]);
  const statusKey = String(order?.status || '').toLowerCase();
  const showTracking = Boolean(riderId && TRACKABLE_STATUSES.has(statusKey));

  // Partner ka naam/phone lao (trackable hote hi).
  useEffect(() => {
    if (!showTracking || !riderId) {
      setPartner(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('users')
          .select('id, name, phone')
          .eq('id', riderId)
          .maybeSingle();
        if (!cancelled) setPartner(data || null);
      } catch {
        if (!cancelled) setPartner(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showTracking, riderId]);

  // Order status live: store pack / partner accept karte hi ye page khud
  // update ho jaye (bina refresh tracking section aa jayega).
  useEffect(() => {
    if (!id) return undefined;
    const channel = supabase
      .channel(`order-detail-${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${id}` },
        (payload) => {
          if (payload?.new) setOrder((prev) => ({ ...(prev || {}), ...payload.new }));
        },
      )
      .subscribe();
    return () => {
      try {
        supabase.removeChannel(channel);
      } catch { /* ignore */ }
    };
  }, [id]);

  const handleView = async () => {
    setInvoiceError('');
    setInvoiceBusy('view');
    try {
      await viewOrderInvoice(id);
    } catch (e) {
      setInvoiceError(e?.message || 'Could not open invoice.');
    } finally {
      setInvoiceBusy(null);
    }
  };

  const handleDownload = async () => {
    setInvoiceError('');
    setInvoiceBusy('download');
    try {
      await downloadOrderInvoice(id);
    } catch (e) {
      setInvoiceError(e?.message || 'Could not download invoice.');
    } finally {
      setInvoiceBusy(null);
    }
  };

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(String(order?.id || id));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const handleRepeat = () => {
    if (!order || items.length === 0) return;
    setRepeating(true);
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
      setRepeating(false);
      navigate('/cart');
    }, 450);
  };

  const handleRateSubmit = (value) => {
    const v = Number(value) || 0;
    if (v < 1 || v > 5) return;
    setRating(v);
    setRated(true);
    try {
      const map = JSON.parse(localStorage.getItem('supercart_rated_orders') || '{}');
      map[order.id] = v;
      localStorage.setItem('supercart_rated_orders', JSON.stringify(map));
    } catch { /* ignore */ }
  };

  if (loading || fetching) {
    return (
      <div className="min-h-screen bg-[#f4f6f5]">
        <div className="sticky top-0 z-40 border-b border-slate-200 bg-white">
          <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-4">
            <button type="button" onClick={() => navigate(-1)} aria-label="Go back" className="flex h-10 w-10 items-center justify-center rounded-full text-slate-800 hover:bg-slate-100">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h1 className="text-base font-black text-slate-900">Order summary</h1>
          </div>
        </div>
        <div className="mx-auto flex max-w-2xl items-center justify-center gap-2 px-4 py-16 text-sm text-slate-500">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Loading order…
        </div>
      </div>
    );
  }

  if (fetchError || !order) {
    return (
      <div className="min-h-screen bg-[#f4f6f5]">
        <div className="sticky top-0 z-40 border-b border-slate-200 bg-white">
          <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-4">
            <button type="button" onClick={() => navigate('/profile/orders')} aria-label="Go back" className="flex h-10 w-10 items-center justify-center rounded-full text-slate-800 hover:bg-slate-100">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h1 className="text-base font-black text-slate-900">Order summary</h1>
          </div>
        </div>
        <div className="mx-auto max-w-2xl px-4 py-10 text-center">
          <p className="text-sm font-black text-slate-800">{fetchError || 'Order not found.'}</p>
          <Link to="/profile/orders" className="mt-4 inline-block rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white">
            Back to Order History
          </Link>
        </div>
      </div>
    );
  }

  const delivered = isDelivered(order);
  const addressLine = getDeliveryAddressLine(order);
  const paymentMode = order.payment_method || order.paymentMethod || 'Cash On Delivery';
  const placedAt = formatOrderPlaced(order.created_at || order.createdAt);
  const arrivedAt = arrivedAtTime(order);

  return (
    <div className="min-h-screen bg-[#f4f6f5] pb-28">
      {/* Header */}
      <div className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-4">
          <button
            type="button"
            onClick={() => {
              if (window.history.length > 1) navigate(-1);
              else navigate('/profile/orders');
            }}
            aria-label="Go back"
            className="flex h-10 w-10 items-center justify-center rounded-full text-slate-800 transition hover:bg-slate-100 active:scale-95"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-base font-black leading-tight tracking-tight text-slate-900">Order summary</h1>
            <p className={`truncate text-[11px] font-bold ${delivered ? 'text-emerald-600' : 'text-amber-600'}`}>
              {delivered ? (arrivedAt ? `Arrived at ${arrivedAt}` : 'Arrived') : prettyStatus(order)}
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-3 px-4 pt-4">
        {invoiceError && (
          <p className="rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-600">{invoiceError}</p>
        )}

        {/* Live delivery tracking — SIRF accepted/out_for_delivery (partner ke
            paas order) par. pending/packed (bina partner) par hidden. */}
        {showTracking && (() => {
          const addr = order.shipping_address || order.shippingAddress || {};
          const dropLat = addr.latitude ?? addr.lat ?? null;
          const dropLng = addr.longitude ?? addr.lng ?? null;
          return (
            <section aria-label="Live delivery tracking" className="rounded-2xl border border-blue-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-[13px] font-black text-slate-900">
                  <Truck className="h-4 w-4 text-blue-600" />
                  Delivery Partner
                </p>
                <span className="flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-blue-700">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-600" />
                  {prettyStatus(order)}
                </span>
              </div>
              <p className="mt-2 text-sm font-black text-slate-800">
                {partner?.name || 'Delivery partner assigned'}
              </p>
              {partner?.phone && (
                <a
                  href={`tel:${partner.phone}`}
                  className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-bold text-emerald-700 hover:underline"
                >
                  <Phone className="h-3.5 w-3.5" />
                  {partner.phone}
                </a>
              )}
              <div className="mt-3">
                <React.Suspense
                  fallback={
                    <div className="flex h-56 items-center justify-center rounded-xl bg-slate-100 text-xs font-bold text-slate-500">
                      Loading live map…
                    </div>
                  }
                >
                  <OrderTrackingMap
                    riderId={riderId}
                    dropLat={dropLat}
                    dropLng={dropLng}
                    dropLabel={getDeliveryAddressLine(order)}
                  />
                </React.Suspense>
              </div>
            </section>
          );
        })()}

        {/* Invoice actions — View + Download dono saath me */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-[13px] font-black text-slate-900">Invoice</p>
          <p className="mt-0.5 text-[11px] text-slate-500">View se turant dekho, Download se PDF save karo.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleView}
              disabled={invoiceBusy !== null}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2.5 text-xs font-black text-slate-800 transition hover:border-emerald-500 hover:text-emerald-700 disabled:opacity-60"
            >
              {invoiceBusy === 'view' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
              {invoiceBusy === 'view' ? 'Opening…' : 'View Invoice'}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={invoiceBusy !== null}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2.5 text-xs font-black text-white transition hover:bg-emerald-600 disabled:opacity-60"
            >
              {invoiceBusy === 'download' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {invoiceBusy === 'download' ? 'Preparing…' : 'Download Invoice'}
            </button>
          </div>
        </section>

        {/* Items */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-[13px] font-black text-slate-900">
            {items.length} item{items.length !== 1 ? 's' : ''} in this order
          </p>
          <div className="mt-3 space-y-3">
            {items.map((it, idx) => {
              const qty = Number(it.quantity || it.qty || 1);
              const price = Number(it.price || 0);
              const mrpUnit = Number(it.originalPrice ?? it.mrp ?? it.price ?? 0);
              const hasDiscount = mrpUnit > price;
              const isGift = price === 0;
              return (
                <div key={`${order.id}-item-${it.productId || it.id || idx}`} className="flex items-center gap-3">
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                    {it.image ? (
                      <img src={it.image} alt={it.name || ''} className="h-full w-full object-contain" loading="lazy" />
                    ) : (
                      <Package className="h-5 w-5 text-slate-300" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-slate-800">{it.name || 'Item'}</p>
                    <p className="mt-0.5 text-[11px] font-medium text-slate-500">{getItemWeightLabel(it) || `Qty ${qty}`}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {isGift ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">
                          <Gift className="h-3 w-3" /> FREE GIFT
                        </span>
                      ) : hasDiscount ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">
                          <BadgePercent className="h-3 w-3" />
                          Save ₹{(mrpUnit - price) * qty}
                        </span>
                      ) : null}
                      <span className="text-[11px] font-medium text-slate-400">Qty {qty}</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {hasDiscount && !isGift && (
                      <p className="text-[11px] font-medium text-slate-400 line-through">₹{mrpUnit * qty}</p>
                    )}
                    <p className="text-[13px] font-black text-slate-900">
                      {isGift ? 'FREE' : `₹${price * qty}`}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Rating */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] font-black text-slate-900">How were your ordered items?</p>
            {!showRateBox && !rated && (
              <button
                type="button"
                onClick={() => setShowRateBox(true)}
                className="rounded-xl bg-amber-100 px-3.5 py-2 text-xs font-black text-amber-700 transition hover:bg-amber-200"
              >
                Rate now
              </button>
            )}
          </div>
          {(showRateBox || rated) && (
            <div className="mt-3 flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((star) => {
                const active = (hoverRating || rating) >= star;
                return (
                  <button
                    key={star}
                    type="button"
                    aria-label={`Rate ${star} star`}
                    onClick={() => handleRateSubmit(star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    className="rounded-lg p-1 transition hover:scale-110"
                  >
                    <Star className={`h-6 w-6 ${active ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
                  </button>
                );
              })}
              {rated && (
                <span className="ml-2 inline-flex items-center gap-1 text-[11px] font-black text-emerald-600">
                  <Check className="h-3.5 w-3.5" /> Thanks for rating!
                </span>
              )}
            </div>
          )}
        </section>

        {/* Bill details */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-[13px] font-black text-slate-900">Bill details</p>
          <div className="mt-3 space-y-2">
            <BillRow label="MRP" value={`₹${bill.mrp}`} />
            {bill.productDiscount > 0 && (
              <BillRow label="Product discount" value={`− ₹${bill.productDiscount}`} green />
            )}
            <BillRow label="Item total" value={`₹${bill.itemTotal}`} />
            <BillRow
              label="Handling charge"
              value={bill.handling > 0 ? `₹${bill.handling}` : 'FREE'}
              green={bill.handling === 0}
            />
            <BillRow
              label="Delivery charges"
              value={bill.delivery > 0 ? `₹${bill.delivery}` : 'FREE'}
              green={bill.delivery === 0}
            />
            {bill.tip > 0 && <BillRow label="Delivery tip" value={`₹${bill.tip}`} />}
            {bill.couponDiscount > 0 && (
              <BillRow label="Coupon discount" value={`− ₹${bill.couponDiscount}`} green />
            )}
            <div className="my-1 border-t border-dashed border-slate-200" />
            <BillRow label="Bill total" value={`₹${bill.total}`} bold />
          </div>
          {bill.productDiscount + bill.couponDiscount > 0 && (
            <p className="mt-3 rounded-xl bg-emerald-50 p-2.5 text-center text-[11px] font-black text-emerald-700">
              You saved ₹{bill.productDiscount + bill.couponDiscount} on this order 🎉
            </p>
          )}
        </section>

        {/* Order details */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-[13px] font-black text-slate-900">Order details</p>
          <div className="mt-3 space-y-3 text-[13px]">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Order ID</p>
              <p className="mt-1 flex items-center justify-between gap-2 font-bold text-slate-800">
                <span className="break-all">{order.id}</span>
                <button
                  type="button"
                  onClick={handleCopyId}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] font-black text-slate-600 hover:bg-emerald-100 hover:text-emerald-700"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </p>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Payment mode</p>
              <p className="mt-1 font-bold text-slate-800">{paymentMode}</p>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Deliver to</p>
              <p className="mt-1 flex items-start gap-1.5 font-medium leading-5 text-slate-700">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                {addressLine}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Order placed</p>
              <p className="mt-1 font-medium text-slate-700">{placedAt}</p>
            </div>
          </div>
        </section>

        {/* Help */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-[13px] font-black text-slate-900">Need help with your order?</p>
          <Link
            to="/profile"
            state={{ section: 'complaints' }}
            className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3.5 py-3 transition hover:border-emerald-400 hover:bg-emerald-50/50"
          >
            <span className="flex items-center gap-2.5 text-[13px] font-bold text-slate-800">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <MessageCircle className="h-5 w-5" />
              </span>
              Chat with us
            </span>
            <span className="text-xs font-black text-emerald-600">→</span>
          </Link>
        </section>
      </div>

      {/* Sticky Repeat Order */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <button
            type="button"
            onClick={handleRepeat}
            disabled={repeating || items.length === 0}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3.5 text-sm font-black text-white shadow-lg transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
          >
            <Repeat2 className="h-5 w-5" />
            {repeating ? 'Adding to cart…' : 'Repeat Order'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OrderDetail;
