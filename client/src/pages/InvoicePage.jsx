import React, { useEffect, useState } from 'react';
import { ArrowLeft, Download, LoaderCircle } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { downloadOrderInvoice, fetchInvoicePdfBlob, invoiceBlobToDataUrl } from '../services/invoice';

const InvoicePage = () => {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const [dataUrl, setDataUrl] = useState('');
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let active = true;
    fetchInvoicePdfBlob(orderId)
      .then(invoiceBlobToDataUrl)
      .then((url) => { if (active) setDataUrl(url); })
      .catch((reason) => { if (active) setError(reason?.message || 'Could not load invoice.'); });
    return () => { active = false; };
  }, [orderId]);

  const download = async () => {
    setDownloading(true);
    try { await downloadOrderInvoice(orderId); } catch (reason) { setError(reason?.message || 'Could not download invoice.'); }
    finally { setDownloading(false); }
  };

  return (
    <main className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <button type="button" onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm font-bold text-slate-700"><ArrowLeft className="h-4 w-4" /> Back</button>
        <button type="button" onClick={download} disabled={downloading || !dataUrl} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"><Download className="h-4 w-4" /> {downloading ? 'Preparing…' : 'Download'}</button>
      </header>
      {error ? <p className="mx-auto max-w-xl p-8 text-center text-sm font-bold text-rose-600">{error}</p> : dataUrl ? <iframe title={`Invoice for order ${orderId}`} src={dataUrl} className="min-h-[calc(100vh-60px)] w-full border-0" /> : <p className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" /> Loading invoice…</p>}
    </main>
  );
};

export default InvoicePage;
