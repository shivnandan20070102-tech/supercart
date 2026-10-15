// Order History shared helpers — List + Detail dono me same calculation.
// Backend order shape: Supabase `orders` row (snake_case + camelCase fallback).

export const getOrderItems = (order = {}) =>
  Array.isArray(order.order_items)
    ? order.order_items
    : Array.isArray(order.orderItems)
      ? order.orderItems
      : [];

export const getOrderTotal = (order = {}) =>
  Number(order.total_price ?? order.totalPrice ?? 0);

export const getOrderDate = (order = {}) => order.created_at || order.createdAt || null;

export const formatOrderDateTime = (iso) => {
  if (!iso) return 'Recent order';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return String(iso);
  }
};

export const formatOrderPlaced = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return String(iso);
  }
};

export const isDelivered = (order = {}) =>
  String(order.status || '').toLowerCase() === 'delivered';

const prettyStatusMap = {
  pending: 'Order placed',
  pending_assignment: 'Finding delivery partner',
  confirmed: 'Order confirmed',
  packed: 'Packed',
  assigned: 'Delivery partner assigned',
  accepted: 'Partner accepted your order',
  picked_up: 'Order picked up',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export const prettyStatus = (order = {}) => {
  const raw = String(order.status || 'Placed').trim();
  const key = raw.toLowerCase();
  return prettyStatusMap[key] || raw.charAt(0).toUpperCase() + raw.slice(1);
};

// "Arrived in X minutes" — delivered_at/updated_at mile to wahi, warna created_at se estimate.
export const arrivedInMinutes = (order = {}) => {
  try {
    const start = new Date(getOrderDate(order)).getTime();
    const endRaw = order.delivered_at || order.deliveredAt || order.updated_at || order.updatedAt || null;
    const end = endRaw ? new Date(endRaw).getTime() : NaN;
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      const mins = Math.max(1, Math.round((end - start) / 60000));
      if (mins < 180) return `Arrived in ${mins} minutes`;
    }
  } catch { /* fallback below */ }
  return 'Arrived';
};

export const arrivedAtTime = (order = {}) => {
  const raw = order.delivered_at || order.deliveredAt || order.updated_at || order.updatedAt || getOrderDate(order);
  if (!raw) return '';
  try {
    return new Date(raw).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return String(raw);
  }
};

// Bill breakdown — MRP / discount / handling / delivery / total.
export const getBillDetails = (order = {}) => {
  const items = getOrderItems(order);
  const itemTotalFromDb = Number(order.items_price ?? order.itemsPrice ?? NaN);
  const sumSale = items.reduce(
    (sum, it) => sum + Number(it.price || 0) * Number(it.quantity || it.qty || 1),
    0,
  );
  const mrp = items.reduce((sum, it) => {
    const perUnitMrp = Number(it.originalPrice ?? it.mrp ?? it.strikePrice ?? it.price ?? 0);
    return sum + perUnitMrp * Number(it.quantity || it.qty || 1);
  }, 0);
  const itemTotal = Number.isFinite(itemTotalFromDb) ? itemTotalFromDb : sumSale;
  const mrpSafe = mrp > 0 ? mrp : Math.max(itemTotal, sumSale);
  const productDiscount = Math.max(0, mrpSafe - itemTotal);
  const handling = Number(order.handling_charge ?? order.handlingCharge ?? 0) || 0;
  const delivery = Number(order.delivery_fee ?? order.deliveryFee ?? 0) || 0;
  const tip = Number(order.tip_amount ?? order.tipAmount ?? 0) || 0;
  const couponDiscount = Number(order.coupon_discount ?? order.couponDiscount ?? 0) || 0;
  const total = getOrderTotal(order) || Math.max(0, itemTotal + handling + delivery + tip - couponDiscount);
  return { mrp: mrpSafe, productDiscount, itemTotal, handling, delivery, tip, couponDiscount, total };
};

export const getDeliveryAddressLine = (order = {}) => {
  const addr = order.shipping_address || order.shippingAddress || {};
  if (typeof addr === 'string') return addr;
  const parts = [
    addr.name,
    addr.address || addr.formattedAddress || addr.label,
    addr.city,
    addr.pincode || addr.postalCode,
    addr.landmark,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'Home delivery';
};

export const getItemWeightLabel = (item = {}) =>
  item.weight || item.unit || item.variant || (item.quantity ? `Qty ${item.quantity}` : '');

export default {
  getOrderItems,
  getOrderTotal,
  getOrderDate,
  formatOrderDateTime,
  formatOrderPlaced,
  isDelivered,
  prettyStatus,
  arrivedInMinutes,
  arrivedAtTime,
  getBillDetails,
  getDeliveryAddressLine,
  getItemWeightLabel,
};
