import React, { useEffect, useState } from 'react';
import { ArrowLeft, CircleHelp, LoaderCircle, Send, TicketCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../config/supabase';

const statusStyles = {
  open: 'bg-amber-950 text-amber-300',
  in_progress: 'bg-blue-950 text-blue-300',
  resolved: 'bg-emerald-950 text-emerald-300',
  closed: 'bg-slate-800 text-slate-300',
};

const DeliverySupportTickets = () => {
  const [user, setUser] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [form, setForm] = useState({ title: '', description: '' });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const loadTickets = async (userId) => {
    const { data, error } = await supabase.from('support_tickets').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) throw error;
    setTickets(data || []);
  };

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      const { data: { user: current }, error: authError } = await supabase.auth.getUser();
      if (authError || !current) {
        if (mounted) setMessage({ type: 'error', text: 'Please log in to view support tickets.' });
        setLoading(false);
        return;
      }
      try {
        await loadTickets(current.id);
        if (mounted) setUser(current);
      } catch (error) {
        if (mounted) setMessage({ type: 'error', text: error.message });
      } finally {
        if (mounted) setLoading(false);
      }
    };
    init();
    return () => { mounted = false; };
  }, []);

  const submitTicket = async (event) => {
    event.preventDefault();
    if (!user) return;
    setSubmitting(true);
    setMessage({ type: '', text: '' });
    try {
      const { error } = await supabase.from('support_tickets').insert({
        user_id: user.id,
        title: form.title.trim(),
        description: form.description.trim(),
      });
      if (error) throw error;
      setForm({ title: '', description: '' });
      await loadTickets(user.id);
      setMessage({ type: 'success', text: 'Support ticket raised successfully.' });
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Could not raise ticket.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white sm:px-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-400"><TicketCheck className="h-4 w-4" /> Support</p>
            <h1 className="mt-2 text-3xl font-black">Support Tickets</h1>
            <p className="mt-1 text-sm text-slate-400">Raise an issue and track its status here.</p>
          </div>
          <Link to="/delivery/profile" className="flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-slate-300 hover:border-emerald-500 hover:text-white"><ArrowLeft className="h-4 w-4" /> Profile</Link>
        </header>

        {message.text && <p className={`mb-5 rounded-xl p-3 text-sm font-bold ${message.type === 'error' ? 'bg-rose-950 text-rose-300' : 'bg-emerald-950 text-emerald-300'}`}>{message.text}</p>}

        <form onSubmit={submitTicket} className="rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-black"><CircleHelp className="h-5 w-5 text-emerald-400" /> Raise a new issue</h2>
          <div className="mt-5 grid gap-4">
            <input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Issue title" className="w-full rounded-xl border border-slate-700 bg-slate-800 p-3 text-sm text-white outline-none focus:border-emerald-500" />
            <textarea required minLength={10} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Describe your issue" rows={4} className="w-full resize-y rounded-xl border border-slate-700 bg-slate-800 p-3 text-sm text-white outline-none focus:border-emerald-500" />
            <button disabled={submitting || !user} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-black text-slate-950 hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60">{submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {submitting ? 'Submitting...' : 'Submit ticket'}</button>
          </div>
        </form>

        <section className="mt-6">
          <h2 className="mb-3 text-lg font-black">Your previous tickets</h2>
          {loading && <div className="flex justify-center py-10 text-emerald-300"><LoaderCircle className="h-6 w-6 animate-spin" /></div>}
          {!loading && tickets.length === 0 && <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">No support tickets yet.</div>}
          <div className="space-y-3">
            {tickets.map((ticket) => <article key={ticket.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><h3 className="font-black">{ticket.title}</h3><span className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase ${statusStyles[ticket.status] || statusStyles.open}`}>{ticket.status.replace('_', ' ')}</span></div>
              <p className="mt-2 text-sm leading-6 text-slate-400">{ticket.description}</p>
              <p className="mt-3 text-xs text-slate-500">{new Date(ticket.created_at).toLocaleString('en-IN')}</p>
            </article>)}
          </div>
        </section>
      </div>
    </main>
  );
};

export default DeliverySupportTickets;
