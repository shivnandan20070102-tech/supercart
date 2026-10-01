import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { History } from 'lucide-react';
import { supabase } from '../config/supabase';

const PAGE_LIMIT = 200;

const groupOf = (actionType) => {
  const t = String(actionType || '').toLowerCase();
  if (t.includes('delivery_partner') || (t.includes('partner') && !t.includes('store'))) return 'partner';
  if (t.includes('store')) return 'store';
  if (t.includes('order') || t.includes('assign')) return 'order';
  return 'other';
};

const groupStyle = (group) => {
  if (group === 'partner') return { dot: 'bg-sky-400', badge: 'bg-sky-950 text-sky-300' };
  if (group === 'store') return { dot: 'bg-amber-400', badge: 'bg-amber-950 text-amber-300' };
  if (group === 'order') return { dot: 'bg-violet-400', badge: 'bg-violet-950 text-violet-300' };
  return { dot: 'bg-slate-500', badge: 'bg-slate-800 text-slate-300' };
};

const prettifyAction = (actionType) =>
  String(actionType || 'Action').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const dayKey = (iso) => {
  try {
    return new Date(iso).toLocaleDateString('en-CA');
  } catch {
    return '';
  }
};

const formatDateTime = (value) => {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(value);
  }
};

// Admin Panel "Activity Log" tab — admin actions ki timeline (sabse naya upar).
// Realtime: nayi entry turant upar jud jati hai.
const ActivityLogSection = () => {
  const [logs, setLogs] = useState([]);
  const [adminsById, setAdminsById] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('all'); // all | partner | store | order
  const [date, setDate] = useState(''); // yyyy-mm-dd

  const loadAll = useCallback(async () => {
    setLoading(true);
    setNotice('');
    try {
      const { data, error } = await supabase
        .from('admin_activity_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(PAGE_LIMIT);
      if (error) throw error;
      const rows = data || [];
      setLogs(rows);
      const adminIds = [...new Set(rows.map((r) => r.admin_id).filter(Boolean))];
      if (adminIds.length > 0) {
        const { data: users } = await supabase.from('users').select('id,name,email').in('id', adminIds);
        setAdminsById(new Map((users || []).map((u) => [u.id, u])));
      } else {
        setAdminsById(new Map());
      }
    } catch (e) {
      const msg = String(e?.message || 'Activity log load nahi hua.');
      setNotice(
        /relation|table|does not exist|schema cache/i.test(msg)
          ? 'admin_activity_log table nahi mili — Supabase me server/supabase_admin_activity_log.sql RUN karo.'
          : msg,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Nayi admin action turant timeline me (page reload nahi chahiye)
  useEffect(() => {
    const channel = supabase
      .channel('admin-activity-log')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'admin_activity_log' }, (payload) => {
        const row = payload?.new;
        if (!row) return;
        setLogs((prev) => {
          if (prev.some((r) => String(r.id) === String(row.id))) return prev;
          return [row, ...prev].slice(0, PAGE_LIMIT);
        });
        if (row.admin_id) {
          setAdminsById((prev) => {
            if (prev.has(row.admin_id)) return prev;
            supabase.from('users').select('id,name,email').eq('id', row.admin_id).maybeSingle().then(({ data }) => {
              if (data) setAdminsById((cur) => new Map(cur).set(data.id, data));
            });
            return prev;
          });
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((log) => {
      if (group !== 'all' && groupOf(log.action_type) !== group) return false;
      if (date && dayKey(log.created_at) !== date) return false;
      if (!q) return true;
      const admin = adminsById.get(log.admin_id);
      const hay = [log.description, log.action_type, String(log.target_id), admin?.name, admin?.email]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [logs, search, group, date, adminsById]);

  const groups = [
    { id: 'all', label: 'All' },
    { id: 'partner', label: 'Delivery Partners' },
    { id: 'store', label: 'Stores' },
    { id: 'order', label: 'Orders' },
  ];

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-black text-white">
            <History className="h-5 w-5 text-emerald-400" /> Activity Log ({filtered.length})
          </h2>
          <p className="text-xs text-slate-500">Admin actions — sabse naya sabse upar. Nayi entry turant dikhegi.</p>
        </div>
        <button
          type="button"
          onClick={loadAll}
          className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-black text-slate-200 transition hover:bg-slate-700"
        >
          Refresh
        </button>
      </div>

      {/* Filters: search + group + date */}
      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search action, name, order/store id…"
          aria-label="Search activity log"
          className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-500"
        />
        <div className="flex gap-1.5 overflow-x-auto" role="group" aria-label="Filter by category">
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGroup(g.id)}
              aria-pressed={group === g.id}
              className={`whitespace-nowrap rounded-xl px-3 py-2.5 text-xs font-black transition ${
                group === g.id ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Filter by date"
          className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500"
        />
      </div>

      {notice && <div role="alert" className="mb-4 rounded-xl bg-rose-950 p-3 text-sm font-bold text-rose-300">{notice}</div>}

      {loading ? (
        <p className="py-8 text-center text-sm text-slate-400">Activity load ho rahi hai…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl bg-slate-800 p-8 text-center text-sm text-slate-400">
          {logs.length === 0 ? 'Abhi koi admin action logged nahi hai.' : 'Is filter me koi entry nahi mili.'}
        </div>
      ) : (
        <ol className="relative space-y-0 border-l-2 border-slate-800 pl-0">
          {filtered.map((log) => {
            const g = groupOf(log.action_type);
            const style = groupStyle(g);
            const admin = adminsById.get(log.admin_id);
            return (
              <li key={log.id} className="relative pb-5 pl-6 last:pb-0">
                <span className={`absolute -left-[7px] top-1 h-3 w-3 rounded-full ${style.dot}`} aria-hidden />
                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${style.badge}`}>
                      {prettifyAction(log.action_type)}
                    </span>
                    {log.target_id && (
                      <span className="rounded-full bg-slate-800 px-2.5 py-1 text-[10px] font-bold text-slate-300">
                        #{log.target_id}
                      </span>
                    )}
                    <span className="ml-auto text-[11px] text-slate-500">{formatDateTime(log.created_at)}</span>
                  </div>
                  <p className="mt-2 text-sm font-bold text-slate-100">{log.description || prettifyAction(log.action_type)}</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    by {admin ? `${admin.name || admin.email || 'Admin'}` : 'Admin'}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
};

export default ActivityLogSection;
