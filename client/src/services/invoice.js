import { supabase } from '../config/supabase';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'https://supercart-kloc.onrender.com').replace(/\/+$/, '');

const getToken = async () => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || localStorage.getItem('supercart_token') || '';
};

const invoiceUrl = (orderId) => `${API_BASE_URL.replace(/\/api$/, '')}/api/orders/${orderId}/invoice`;

export const fetchInvoicePdfBlob = async (orderId) => {
  const token = await getToken();
  const response = await fetch(invoiceUrl(orderId), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) {
    const json = await response.json().catch(() => null);
    throw new Error(json?.message || `Server error (${response.status})`);
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error('Empty invoice PDF');
  return new Blob([blob], { type: 'application/pdf' });
};

export const invoiceBlobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('Could not render invoice PDF.'));
  reader.readAsDataURL(blob);
});

export const downloadOrderInvoice = async (orderId) => {
  const pdfBlob = await fetchInvoicePdfBlob(orderId);
  const objectUrl = URL.createObjectURL(pdfBlob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = `SuperCart-Order-${orderId}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
  return { ok: true };
};

export const triggerDeliveredInvoiceEmail = async (orderId) => {
  try {
    const token = await getToken();
    const response = await fetch(`${API_BASE_URL.replace(/\/api$/, '')}/api/orders/${orderId}/send-invoice-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    return response.ok ? response.json().catch(() => ({ success: true })) : { success: false };
  } catch {
    return { success: false };
  }
};

export default { downloadOrderInvoice, fetchInvoicePdfBlob, invoiceBlobToDataUrl, triggerDeliveredInvoiceEmail };
