// Invoice download + delivered-email trigger (backend pdfkit PDF).
// Backend routes: GET /api/orders/:id/invoice (PDF),
// POST /api/orders/:id/send-invoice-email (delivered email / resend).

import { supabase } from '../config/supabase';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'https://supercart-kloc.onrender.com').replace(/\/+$/, '');

const getToken = async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) return session.access_token;
  } catch { /* ignore */ }
  try {
    return localStorage.getItem('supercart_token') || '';
  } catch {
    return '';
  }
};

const invoiceUrls = (orderId) => {
  const base = String(API_BASE_URL || '').replace(/\/+$/, '');
  const root = base.replace(/\/api$/, '');
  return [...new Set([`${root}/api/orders/${orderId}/invoice`, `${root}/orders/${orderId}/invoice`])];
};

// User/Admin: "Download Invoice" button — PDF download (naye tab me bhi khul sakta hai).
// Returns { ok:true } ya throw Error.
export const downloadOrderInvoice = async (orderId) => {
  const token = await getToken();
  let lastError = null;
  for (const url of invoiceUrls(orderId)) {
    try {
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        let msg = `Server error (${res.status})`;
        try {
          const j = await res.json();
          if (j?.message) msg = j.message;
        } catch { /* PDF error nahi, text error */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      if (!blob || blob.size === 0) throw new Error('Empty invoice PDF');
      const objUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `SuperCart-Order-${orderId}.pdf`;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 10_000);
      return { ok: true };
    } catch (e) {
      lastError = e;
      // Network fail ho to dusri URL try karo, HTTP error ho to turant throw.
      const isNetwork = e instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(e?.message || '');
      if (!isNetwork) throw e;
    }
  }
  throw lastError || new Error('Could not download invoice. Check backend.');
};

// Delivered hote hi backend ko invoice-email bhejne ko bolo.
// Fire-and-forget: email fail ho to order status NAHI rukta.
export const triggerDeliveredInvoiceEmail = async (orderId) => {
  try {
    const token = await getToken();
    const base = String(API_BASE_URL || '').replace(/\/+$/, '').replace(/\/api$/, '');
    const urls = [`${base}/api/orders/${orderId}/send-invoice-email`, `${base}/orders/${orderId}/send-invoice-email`];
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (res.ok) return await res.json().catch(() => ({ success: true }));
      } catch { /* next URL */ }
    }
    return { success: false };
  } catch {
    return { success: false };
  }
};

export default { downloadOrderInvoice, triggerDeliveredInvoiceEmail };
