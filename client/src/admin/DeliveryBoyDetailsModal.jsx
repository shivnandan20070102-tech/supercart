import React, { useEffect, useState } from 'react';
import { FileText, Image, X } from 'lucide-react';
import { supabase } from '../config/supabase';
import { SignedDocImage, SignedDocLink, SignedDocPreviewButton } from '../components/SignedDoc';

const documents = [
  { key: 'bike_image_url', label: 'Bike Image' },
  { key: 'aadhar_card_url', label: 'Aadhar Card' },
  { key: 'driving_license_url', label: 'License' },
  { key: 'pan_card_url', label: 'PAN Card' },
];

const DeliveryBoyDetailsModal = ({ partner, onClose }) => {
  const [preview, setPreview] = useState(null);
  const [homeStoreName, setHomeStoreName] = useState('');
  const profile = partner?.profile || {};
  const isOnline = profile.is_available !== false && partner?.is_available !== false;
  const displayName = partner?.name || profile.name || 'Unnamed delivery partner';
  const homeStoreId = profile?.home_store_id != null ? Number(profile.home_store_id) : null;

  useEffect(() => {
    if (!partner) return undefined;
    const handleEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose, partner]);

  // Auto-assigned Home Store ka naam (column SQL se pehle na bani ho to skip)
  useEffect(() => {
    let active = true;
    if (homeStoreId == null || Number.isNaN(homeStoreId)) {
      setHomeStoreName('');
      return undefined;
    }
    supabase.from('stores').select('store_name').eq('id', homeStoreId).maybeSingle().then(({ data }) => {
      if (active) setHomeStoreName(data?.store_name || '');
    }).catch(() => {
      if (active) setHomeStoreName('');
    });
    return () => {
      active = false;
    };
  }, [homeStoreId]);

  if (!partner) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="delivery-boy-details-title" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 text-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-800 bg-slate-900/95 p-5 backdrop-blur">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-emerald-500 bg-slate-800 text-emerald-400">
              {profile.profile_photo_url ? <SignedDocImage stored={profile.profile_photo_url} alt={`${displayName} profile`} className="h-full w-full object-cover" placeholderClassName="flex h-full w-full items-center justify-center" /> : <Image className="h-7 w-7" />}
            </div>
            <div>
              <h2 id="delivery-boy-details-title" className="text-xl font-black">{displayName}</h2>
              <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black uppercase ${isOnline ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-slate-500'}`} />{isOnline ? 'Online' : 'Offline'}
              </span>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close delivery boy details" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-6 p-5">
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"><p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Email</p><p className="mt-1 break-all text-sm font-bold text-slate-200">{partner.email || profile.email || 'Not available'}</p></div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"><p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Phone Number</p><p className="mt-1 text-sm font-bold text-slate-200">{partner.phone || profile.phone || 'Not available'}</p></div>
            <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/30 p-4 sm:col-span-2"><p className="text-[10px] font-black uppercase tracking-wider text-slate-500">🏠 Home Store (auto-assigned)</p><p className="mt-1 text-sm font-black text-emerald-300">{homeStoreId != null && !Number.isNaN(homeStoreId) ? homeStoreName || `Store #${homeStoreId}` : 'Not assigned'}</p></div>
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2"><FileText className="h-4 w-4 text-emerald-400" /><h3 className="text-sm font-black">Documents</h3></div>
            <div className="grid gap-3 sm:grid-cols-2">
              {documents.map((document) => {
                const url = profile[document.key];
                const isImage = url && !/\.pdf(?:\?|$)/i.test(url);
                return (
                  <div key={document.key} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <p className="mb-2 text-xs font-bold text-slate-300">{document.label}</p>
                    {url && isImage ? (
                      <SignedDocPreviewButton stored={url} label={document.label} onPreview={(signedUrl) => setPreview({ url: signedUrl, label: document.label })} />
                    ) : url ? (
                      <SignedDocLink stored={url} className="flex h-28 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-xs font-bold text-emerald-300 hover:border-emerald-500">Open {document.label}</SignedDocLink>
                    ) : (
                      <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-slate-700 text-xs text-slate-500">Not uploaded</div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      {preview && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}>
        <button type="button" onClick={() => setPreview(null)} aria-label="Close document preview" className="absolute right-5 top-5 rounded-lg bg-slate-800 p-2 text-white hover:bg-slate-700"><X className="h-5 w-5" /></button>
        <img src={preview.url} alt={preview.label} className="max-h-[88vh] max-w-full rounded-xl object-contain" />
      </div>}
    </div>
  );
};

export default DeliveryBoyDetailsModal;
