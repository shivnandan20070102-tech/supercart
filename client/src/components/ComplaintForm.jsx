import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, Send, X } from 'lucide-react';
import { supabase } from '../config/supabase';
import { fetchMyComplaints, resolveComplaintPhotoUrls, submitComplaint, validateComplaint } from '../services/complaints';

const statusBadge = (status) => {
  const s = String(status || 'pending');
  if (s === 'resolved') return 'bg-emerald-500 text-slate-950';
  if (s === 'in_progress') return 'bg-sky-400 text-slate-950';
  return 'bg-amber-400 text-slate-950';
};

const prettifyStatus = (s) => String(s || 'pending').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const formatDate = (v) => {
  try {
    return new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(v || '');
  }
};

// Shared complaint form — teeno panels (customer light / delivery+store dark)
// isi ko `dark` prop ke saath reuse karte hain. Apni past complaints bhi
// yahin dikhti hain (status + admin reply ke saath).
const ComplaintForm = ({ dark = false, complainantType, userId, userName }) => {
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [signedPhotos, setSignedPhotos] = useState({});
  const [lightbox, setLightbox] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [mine, setMine] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const fileInputRef = useRef(null);

  const card = dark ? 'bg-slate-900 text-white' : 'bg-white text-slate-900';
  const input = dark
    ? 'w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-500'
    : 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white';
  const label = dark ? 'mb-1.5 block text-xs font-bold text-slate-300' : 'mb-1.5 block text-xs font-bold text-slate-700';
  const muted = dark ? 'text-slate-400' : 'text-slate-500';
  const rowBg = dark ? 'border-slate-800 bg-slate-950/60' : 'border-slate-100 bg-slate-50';

  const loadMine = async () => {
    if (!userId) {
      setListLoading(false);
      return;
    }
    try {
      setMine(await fetchMyComplaints(supabase, userId));
    } catch {
      /* table/RLS migration pending ho to list chhup rahegi, form kaam karega */
      setMine([]);
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!userId || !mounted) {
        setListLoading(false);
        return;
      }
      await loadMine();
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    let active = true;
    (async () => {
      const entries = await Promise.all(mine.map(async (complaint) => [complaint.id, await resolveComplaintPhotoUrls(supabase, complaint)]));
      if (active) setSignedPhotos(Object.fromEntries(entries));
    })();
    return () => { active = false; };
  }, [mine]);

  const onSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setMessage({ type: '', text: '' });
    try {
      await submitComplaint(supabase, { userId, type: complainantType, name: userName, subject, description, files });
      setSubject('');
      setDescription('');
      setFiles([]);
      setPreviews([]);
      await loadMine();
      setMessage({ type: 'success', text: 'Complaint submitted. Admin will review it soon.' });
    } catch (e) {
      setMessage({ type: 'error', text: e.message || 'Could not submit complaint.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <form onSubmit={onSubmit} className={`rounded-3xl border p-5 sm:p-6 ${dark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white shadow-sm'}`}>
        <h3 className={`text-base font-black ${dark ? 'text-white' : 'text-slate-900'}`}>Raise a Complaint</h3>
        <p className={`mt-1 text-xs ${muted}`}>Subject + detail likho, chaaho to photo lagao. Admin jald jawab dega.</p>
        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor="complaint-subject" className={label}>Subject *</label>
            <input
              id="complaint-subject"
              value={subject}
              maxLength={200}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Damaged product received"
              className={input}
            />
          </div>
          <div>
            <label htmlFor="complaint-description" className={label}>Description *</label>
            <textarea
              id="complaint-description"
              value={description}
              maxLength={5000}
              rows={4}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Poori detail likho — kya hua, kab hua, order id (agar ho to)…"
              className={`${input} resize-y`}
            />
          </div>
          <div>
            <span className={label}>Photo (optional)</span>
            <label className={`flex cursor-pointer items-center gap-2 rounded-xl border border-dashed px-3.5 py-3 text-xs font-bold transition ${dark ? 'border-slate-600 text-slate-300 hover:border-emerald-500' : 'border-slate-300 text-slate-600 hover:border-emerald-500'}`}>
              <ImagePlus className="h-4 w-4 shrink-0 text-emerald-500" />
              {files.length ? `${files.length}/3 photo${files.length > 1 ? 's' : ''} selected` : 'Add photos (JPG, PNG, WebP; max 3 MB each)'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={(e) => {
                  const next = [...files, ...Array.from(e.target.files || [])].slice(0, 3);
                  const error = validateComplaint({ subject: 'ok', description: 'ok', files: next });
                  if (error) {
                    setMessage({ type: 'error', text: error });
                    return;
                  }
                  setFiles(next);
                  setPreviews(next.map((file) => URL.createObjectURL(file)));
                  e.target.value = '';
                }}
                ref={fileInputRef}
              />
            </label>
            {files.length > 0 && <p className={`mt-2 text-xs font-bold ${muted}`}>{files.length}/3</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {previews.map((previewUrl, index) => (
                <div key={previewUrl} className="relative">
                  <img src={previewUrl} alt={`Selected complaint photo ${index + 1}`} className="h-20 w-20 rounded-xl object-cover" />
                  <button type="button" onClick={() => { setFiles(files.filter((_, i) => i !== index)); setPreviews(previews.filter((_, i) => i !== index)); if (fileInputRef.current) fileInputRef.current.value = ''; }} className="absolute -right-1.5 -top-1.5 rounded-full bg-rose-600 p-1 text-white" aria-label="Remove photo"><X className="h-3 w-3" /></button>
                </div>
              ))}
            </div>
          </div>
          {message.text && (
            <p role={message.type === 'error' ? 'alert' : 'status'} className={`rounded-xl p-3 text-xs font-bold ${message.type === 'error' ? 'bg-rose-950 text-rose-300' : 'bg-emerald-950 text-emerald-300'}`}>
              {message.text}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting || !userId}
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 text-sm font-black text-slate-950 transition hover:bg-emerald-400 active:scale-[0.99] disabled:cursor-wait disabled:opacity-60"
          >
            {submitting ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            {submitting ? 'Submitting…' : 'Submit Complaint'}
          </button>
          {!userId && <p className={`text-center text-[11px] font-bold ${muted}`}>Please log in to raise a complaint.</p>}
        </div>
      </form>

      <div className={`rounded-3xl border p-5 sm:p-6 ${card} ${dark ? 'border-slate-800' : 'border-slate-200 shadow-sm'}`}>
        <h3 className={`text-base font-black ${dark ? 'text-white' : 'text-slate-900'}`}>My Complaints</h3>
        {listLoading ? (
          <p className={`mt-2 text-xs ${muted}`}>Loading…</p>
        ) : mine.length === 0 ? (
          <p className={`mt-2 text-xs ${muted}`}>Abhi tak koi complaint nahi ki.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {mine.map((c) => (
              <li key={c.id} className={`rounded-2xl border p-3.5 ${rowBg} ${dark ? '' : ''}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={`text-sm font-black ${dark ? 'text-white' : 'text-slate-900'}`}>{c.subject}</p>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${statusBadge(c.status)}`}>
                    {prettifyStatus(c.status)}
                  </span>
                </div>
                <p className={`mt-0.5 text-[11px] ${muted}`}>{formatDate(c.created_at)}</p>
                <p className={`mt-1.5 text-xs leading-relaxed ${dark ? 'text-slate-300' : 'text-slate-600'}`}>{c.description}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(signedPhotos[c.id] || []).map((url, index) => url ? (
                    <button type="button" key={url} onClick={() => setLightbox(url)}><img src={url} alt={`Complaint evidence ${index + 1}`} loading="lazy" className="h-20 w-20 rounded-xl object-cover" /></button>
                  ) : <span key={index} className={`flex h-20 w-20 items-center justify-center rounded-xl text-center text-[10px] ${muted}`}>Photo unavailable</span>)}
                </div>
                {c.admin_response && (
                  <div className={`mt-2 rounded-xl p-2.5 text-xs ${dark ? 'bg-emerald-950/60 text-emerald-200' : 'bg-emerald-50 text-emerald-800'}`}>
                    <p className="font-black">Admin reply:</p>
                    <p className="mt-0.5 leading-relaxed">{c.admin_response}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {lightbox && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setLightbox(null); }}><button type="button" onClick={() => setLightbox(null)} className="absolute right-4 top-4 rounded-full bg-white p-2 text-slate-900" aria-label="Close preview"><X className="h-5 w-5" /></button><img src={lightbox} alt="Complaint evidence preview" className="max-h-[90vh] max-w-full rounded-xl object-contain" /></div>}
    </div>
  );
};

export default ComplaintForm;
