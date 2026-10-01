import React from 'react';
import { ArrowLeft, CircleHelp, Phone, Siren, Truck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const STRINGS = {
  en: {
    brand: 'SuperCart Delivery',
    title: 'Help Center',
    sub: 'Quick answers for delivery partners.',
    back: 'Back to dashboard',
    faqs: [
      {
        q: 'How do I get new orders?',
        a: 'Orders are auto-assigned while you are Online. New orders appear instantly on your dashboard with a "New Order" badge — no need to accept.',
      },
      {
        q: 'What does Online / Offline mean?',
        a: 'Online means you are available and the system can assign you new orders. Offline pauses new assignments. Use the toggle in the top bar to switch.',
      },
      {
        q: 'How do I complete a delivery?',
        a: 'Open the order card, tap "Start Delivery" when you pick up the items, then "Mark Delivered" after handing them to the customer.',
      },
      {
        q: 'What is the SOS button?',
        a: 'The SOS button is for emergencies during a delivery. It is coming soon — for now, call support directly in any emergency.',
      },
    ],
    contactTitle: 'Still need help?',
    contactSub: 'Our support team is available 24x7.',
    callSupport: 'Call support',
    sosNote: 'In any emergency, call support immediately. SOS in-app feature is coming soon.',
  },
};

const DeliveryHelp = () => {
  const navigate = useNavigate();
  const t = STRINGS.en;

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-white sm:px-8">
      <div className="mx-auto max-w-3xl">
        <button
          type="button"
          onClick={() => navigate('/delivery', { replace: true })}
          className="mb-6 flex items-center gap-1 text-sm font-bold text-emerald-400 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> {t.back}
        </button>

        <header className="mb-8">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-400">
            <CircleHelp className="h-4 w-4" /> {t.brand}
          </p>
          <h1 className="mt-2 text-3xl font-black">{t.title}</h1>
          <p className="mt-1 text-sm text-slate-400">{t.sub}</p>
        </header>

        <div className="space-y-3">
          {t.faqs.map((faq) => (
            <details key={faq.q} className="group rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <summary className="cursor-pointer text-sm font-black text-white marker:text-emerald-400">
                {faq.q}
              </summary>
              <p className="mt-3 text-sm leading-6 text-slate-400">{faq.a}</p>
            </details>
          ))}
        </div>

        <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="flex items-center gap-2 font-black">
            <Truck className="h-5 w-5 text-emerald-400" /> {t.contactTitle}
          </h2>
          <p className="mt-1 text-xs text-slate-400">{t.contactSub}</p>
          <a
            href="tel:+919876543210"
            className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-black text-slate-950 hover:bg-emerald-400"
          >
            <Phone className="h-4 w-4" /> {t.callSupport}: +91 98765 43210
          </a>
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-rose-950 p-3 text-xs font-bold text-rose-300">
            <Siren className="h-4 w-4 shrink-0" /> {t.sosNote}
          </p>
        </section>
      </div>
    </div>
  );
};

export default DeliveryHelp;
