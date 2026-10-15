// Invoice controller — order detail nikalo, PDF banao, email bhejo.
// Data source: Supabase (orders + stores + users). Har PDF me order id,
// date/time, store, customer, items table, totals embed hote hain —
// isliye har order ka invoice UNIQUE hota hai.

import { supabase } from '../config/supabase.js';
import { buildInvoicePdfBuffer } from '../utils/invoicePdf.js';
import { sendInvoiceEmail } from '../utils/email.js';

const fmtDateTime = (iso) => {
  try {
    return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(iso || '');
  }
};

const addressToLine = (addr, fallbackPhone) => {
  if (!addr) return { line: 'Address not available', phone: fallbackPhone || '' };
  if (typeof addr === 'string') return { line: addr, phone: fallbackPhone || '' };
  const parts = [
    addr.name, addr.label, addr.address || addr.formattedAddress,
    addr.city, addr.pincode || addr.postalCode, addr.landmark,
  ].filter(Boolean);
  return {
    line: parts.length > 0 ? parts.join(', ') : 'Address not available',
    phone: addr.phone || fallbackPhone || '',
  };
};

// Order + store + customer ko ek invoice model me badlo.
export const fetchInvoiceModel = async (orderId) => {
  const { data: order, error } = await supabase.from('orders').select('*').eq('id', orderId).single();
  if (error || !order) return { error: 'Order not found' };

  let storeName = 'SuperCart Store';
  if (order.store_id != null) {
    try {
      const { data: store } = await supabase
        .from('stores').select('store_name, address').eq('id', order.store_id).maybeSingle();
      if (store?.store_name) {
        storeName = store.store_name + (store.address ? `, ${store.address}` : '');
      }
    } catch { /* store missing ho to default naam */ }
  }

  let dbUser = null;
  if (order.user_id) {
    try {
      const { data } = await supabase
        .from('users').select('id, name, email, phone').eq('id', order.user_id).maybeSingle();
      if (data) dbUser = data;
    } catch { /* guest order */ }
  }

  const ship = order.shipping_address || {};
  const { line: addressLine, phone: addrPhone } = addressToLine(ship, dbUser?.phone);
  const rawItems = order.order_items || order.orderItems || [];
  const items = (Array.isArray(rawItems) ? rawItems : []).map((it) => ({
    name: it.name || it.title || 'Item',
    quantity: Number(it.quantity || it.qty || 1),
    price: Number(it.price || 0),
  }));

  const customerEmail =
    dbUser?.email && !String(dbUser.email).endsWith('@supercart.local')
      ? dbUser.email
      : (ship.email || null);

  const model = {
    orderNumber: String(order.id),
    orderDate: fmtDateTime(order.created_at),
    storeName,
    customerName: dbUser?.name || ship.name || 'Customer',
    customerAddress: addressLine,
    customerPhone: dbUser?.phone || addrPhone || '',
    customerEmail,
    items,
    itemsTotal: Number(order.items_price ?? 0),
    deliveryFee: Number(order.delivery_fee ?? 0),
    tip: Number(order.tip_amount ?? 0),
    couponDiscount: Number(order.coupon_discount ?? 0),
    couponCode: order.coupon_code || '',
    grandTotal: Number(order.total_price ?? 0),
    paymentMode: order.payment_method || 'Cash On Delivery',
    status: order.status || '',
  };
  return { order, model };
};

// Access: admin = sab, owner = apna, store_manager = apne store ka,
// delivery partner = assigned order. Guest order (user_id null) sirf admin.
const checkInvoiceAccess = async (req, order) => {
  const uid = req.user?.id;
  if (!uid) return false;
  let role = '';
  try {
    const { data: me } = await supabase.from('users').select('role').eq('id', uid).maybeSingle();
    role = String(me?.role || '').toLowerCase();
  } catch { /* role unknown */ }
  if (role === 'admin') return true;
  if (order.user_id && String(order.user_id) === String(uid)) return true;
  if (order.delivery_boy_id && String(order.delivery_boy_id) === String(uid)) return true;
  if (role === 'store_manager' && order.store_id != null) {
    try {
      const { data: links } = await supabase.from('store_staff').select('store_id').eq('user_id', uid);
      const ids = (links || []).map((r) => Number(r.store_id));
      if (ids.includes(Number(order.store_id))) return true;
    } catch { /* deny */ }
  }
  return false;
};

// @desc    Order ka PDF invoice download/stream karo
// @route   GET /api/orders/:id/invoice (?download=1 par attachment)
// @access  Private (owner / admin / store_manager / assigned partner)
export const getOrderInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const { order, model, error } = await fetchInvoiceModel(id);
    if (error) return res.status(404).json({ success: false, message: 'Order not found' });
    if (!(await checkInvoiceAccess(req, order))) {
      return res.status(403).json({ success: false, message: 'Not allowed to view this invoice' });
    }
    const pdf = await buildInvoicePdfBuffer(model);
    const filename = `SuperCart-Order-${order.id}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${filename}"`,
    );
    res.setHeader('Content-Length', String(pdf.length));
    return res.status(200).send(pdf);
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Could not generate invoice', error: e.message });
  }
};

// Internal: delivered order ka invoice-PDF us customer ko email karo.
// Email na bana/configure ho to order flow kabhi fail NAHI hota.
export const sendDeliveredInvoiceEmail = async (orderId) => {
  try {
    const { order, model, error } = await fetchInvoiceModel(orderId);
    if (error) return { sent: false, reason: 'order-not-found' };
    if (!model.customerEmail) return { sent: false, reason: 'no-customer-email' };
    const pdf = await buildInvoicePdfBuffer(model);
    return await sendInvoiceEmail({
      to: model.customerEmail,
      subject: `SuperCart Order Receipt #${order.id}`,
      text: `Hi ${model.customerName},\n\nYour order #${order.id} has been delivered. Please find your Order Receipt attached.\n\nItems Total: Rs. ${model.itemsTotal}\nDelivery Fee: Rs. ${model.deliveryFee}${model.tip > 0 ? `\nTip: Rs. ${model.tip}` : ''}${model.couponDiscount > 0 ? `\nCoupon Discount: Rs. ${model.couponDiscount}` : ''}\nGrand Total: Rs. ${model.grandTotal} (${model.paymentMode})\n\nThank you for shopping with SuperCart!`,
      pdfBuffer: pdf,
      filename: `SuperCart-Order-${order.id}.pdf`,
    });
  } catch (e) {
    console.warn(`⚠️ sendDeliveredInvoiceEmail #${orderId} failed: ${e.message}`);
    return { sent: false, reason: e.message };
  }
};

// @desc    Order status update karo; delivered hote hi invoice email auto-bhejo
// @route   PUT /api/orders/:id/status  { status }
// @access  Private (delivery partner / store_manager / admin — RLS + ownership code me)
export const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const nextStatus = String(req.body?.status || '').trim();
    if (!nextStatus) return res.status(400).json({ success: false, message: 'Status is required' });

    const { data: order, error: fetchError } = await supabase.from('orders').select('*').eq('id', id).single();
    if (fetchError || !order) return res.status(404).json({ success: false, message: 'Order not found' });

    const wasDelivered = String(order.status || '').toLowerCase() === 'delivered';
    const { data: updated, error: updateError } = await supabase
      .from('orders').update({ status: nextStatus }).eq('id', id).select().single();
    if (updateError) {
      return res.status(500).json({ success: false, message: 'Could not update order status', error: updateError.message });
    }

    let email = null;
    if (!wasDelivered && String(nextStatus).toLowerCase() === 'delivered') {
      email = await sendDeliveredInvoiceEmail(id); // awaited taaki test/admin ko result dikhe
    }
    return res.status(200).json({ success: true, message: 'Order status updated', data: updated, email });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Error updating order status', error: e.message });
  }
};

// @desc    Kisi bhi order ka invoice manually email karo (admin resend / test)
// @route   POST /api/orders/:id/send-invoice-email
// @access  Private (invoice dekh sakne wale roles)
export const sendInvoiceEmailEndpoint = async (req, res) => {
  try {
    const { id } = req.params;
    const { data: order, error } = await supabase.from('orders').select('*').eq('id', id).single();
    if (error || !order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (!(await checkInvoiceAccess(req, order))) {
      return res.status(403).json({ success: false, message: 'Not allowed to email this invoice' });
    }
    const result = await sendDeliveredInvoiceEmail(id);
    return res.status(200).json({ success: true, message: result.sent ? 'Invoice emailed' : 'Invoice generated, email skipped', email: result });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Could not send invoice email', error: e.message });
  }
};

export default { getOrderInvoice, updateOrderStatus, sendInvoiceEmailEndpoint, sendDeliveredInvoiceEmail, fetchInvoiceModel };
