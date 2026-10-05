import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageSquareWarning, X } from 'lucide-react';
import { supabase } from '../config/supabase';

const TABS = [
  { id: 'customer', label: 'Customer Complaints' },
  { id: 'delivery_partner', label: 'Delivery Partner Complaints' },
  { id: 'store_manager', label: 'Store Complaints' },
];

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

// Admin Complaints — 3 tabs (customer / delivery / store), detail modal me
// poori description + badi photo + status dropdown + admin reply box.
// Apna Realtime channel hai: nayi complaint aate hi list turant update.
const ComplaintsSection = ({ searchQuery = '' }) => {
  const [rows, setRows] = useState([]);
  const [tab, setTab] = useState('customer');
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null); // complaint row | null
  const [statusDraft, setStatusDraft] = useState('pending');
  const [replyDraft, setReplyDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    const { data, error } = await supabase
      .from('complaints')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    setRows(data || []);
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (mounted) await loadAll();
      } catch {
        if (mounted) setRows([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    const channel = supabase
      .channel('admin-complaints-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'complaints' }, async () => {
        try {
          await loadAll();
        } catch {
          /* agla refresh sambhal lega */
        }
      })
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [loadAll]);

  const q = searchQuery.trim().toLowerCase();
  const visible = useMemo(() => {
    const byType = rows.filter((r) => String(r.complainant_type) === tab);
    if (!q) return byType;
    return byType.filter((r) =>
      [r.subject, r.description, r.complainant_name, String(r.id), r.status]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [rows, tab, q]);

  const counts = useMemo(() => {
    const c = { customer: 0, delivery_partner: 0, store_manager: 0 };
    for (const r of rows) {
      if (c[String(r.complainant_type)] !== undefined) c[String(r.complainant_type)] += 1;
    }
    return c;
  }, [rows]);

  const openDetail = (row) => {
    setDetail(row);
    setStatusDraft(row.status || 'pending');
    setReplyDraft(row.admin_response || '');
  };

  const saveDetail = async () => {
    if (!detail || saving) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('complaints')
        .update({ status: statusDraft, admin_response: replyDraft.trim() })
        .eq('id', detail.id);
      if (error) throw error;
      await loadAll();
      setDetail(null);
    } catch (e) {
      // Modal ke andar hi error — alert se kaam chalega (toast system parent me hai).
      window.alert(e.message || 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-6">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <MessageSquareWarning className="h-5 w-5 text-amber-300" />
          <h2 className="text-lg font-black text-white">Complaints</h2>
          <span className="ml-auto rounded-full bg-slate-800 px-2.5 py-1 text-[10px] font-bold text-slate-400">Live · auto-updates</span>
        </div>
        <p className="mb-4 text-xs text-slate-400">Customer, delivery partner aur store — teeno ki grievances. Row par tap karke detail + reply karo.</p>
        <div className="mb-4 flex gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={`min-h-[40px] flex-1 rounded-xl px-2 text-[11px] font-black transition sm:text-xs ${tab === t.id ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            >
              {t.label} ({counts[t.id] || 0})
            </button>
          ))}
        </div>
        {loading ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading complaints…</p>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl bg-slate-800 p-8 text-center text-sm text-slate-400">
            Is category me koi complaint nahi 🎉
          </div>
        ) : (
          <ul className="space-y-2">
            {visible.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => openDetail(r)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-left transition hover:border-emerald-500/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black text-white">{r.subject}</p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-400">
                      {r.complainant_name || '—'} · {formatDate(r.created_at)}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${statusBadge(r.status)}`}>
                    {prettifyStatus(r.status)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setDetail(null); }}>
          <div role="dialog" aria-modal="true" aria-label={`Complaint #${detail.id}`} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-slate-900 p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Complaint #{detail.id}</p>
                <h2 className="mt-1 text-lg font-black leading-snug text-white">{detail.subject}</h2>
                <p className="mt-1 text-xs text-slate-400">
                  {detail.complainant_name || '—'} · {formatDate(detail.created_at)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${statusBadge(detail.status)}`}>
                  {prettifyStatus(detail.status)}
                </span>
                <button type="button" onClick={() => setDetail(null)} aria-label="Close">
                  <X className="text-slate-400 hover:text-white" />
                </button>
              </div>
            </div>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{detail.description}</p>
            {detail.photo_url && (
              <a href={detail.photo_url} target="_blank" rel="noreferrer" className="mt-3 block">
                <img src={detail.photo_url} alt="Complaint evidence (click to enlarge)" loading="lazy" className="max-h-96 w-full rounded-2xl border border-slate-700 object-contain" />
              </a>
            )}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-bold text-slate-400">
                Status Update
                <select
                  value={statusDraft}
                  onChange={(e) => setStatusDraft(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500"
                >
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                </select>
              </label>
            </div>
            <label className="mt-3 block text-xs font-bold text-slate-400">
              Admin Reply
              <textarea
                value={replyDraft}
                maxLength={2000}
                rows={3}
                onChange={(e) => setReplyDraft(e.target.value)}
                placeholder="Apna jawab yahan likho — complainant ko uski list me dikhega…"
                className="mt-1.5 w-full resize-y rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-500"
              />
            </label>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="flex-1 rounded-xl bg-slate-800 px-4 py-3 text-sm font-black text-slate-200 transition hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveDetail}
                disabled={saving}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save Status + Reply'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ComplaintsSection;
