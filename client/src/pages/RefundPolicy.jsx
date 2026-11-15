import React from 'react';
import { Link } from 'react-router-dom';
import { RefreshCcw, ChevronRight } from 'lucide-react';

const Section = ({ no, title, children }) => (
  <section className="mb-8">
    <h2 className="text-lg sm:text-xl font-bold text-slate-900 mb-3 flex items-start gap-2">
      <span className="shrink-0 w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-sm font-black flex items-center justify-center mt-0.5">
        {no}
      </span>
      {title}
    </h2>
    <div className="text-sm sm:text-[15px] text-slate-600 leading-relaxed space-y-3 pl-9">
      {children}
    </div>
  </section>
);

const BulletList = ({ items }) => (
  <ul className="list-disc pl-5 space-y-1.5">
    {items.map((item, i) => (
      <li key={i}>{item}</li>
    ))}
  </ul>
);

const RefundPolicy = () => {
  return (
    <div className="bg-slate-50 min-h-screen">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs text-slate-500 mb-6">
          <Link to="/" className="hover:text-emerald-600 transition">Home</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-slate-800 font-medium">Refund & Cancellation Policy</span>
        </nav>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-10">
          {/* Header */}
          <div className="flex items-center gap-3 mb-4">
            <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600">
              <RefreshCcw className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-black text-slate-900">Refund & Cancellation Policy</h1>
              <p className="text-xs text-slate-500 mt-1">Last updated: November 2026 • SuperCart</p>
            </div>
          </div>

          <Section no="1" title="Order cancellation">
            <BulletList
              items={[
                'You can cancel an order before the store accepts it, free of charge.',
                'Once the store has accepted or packed the order, or the delivery partner has picked it up, the order cannot be cancelled.',
                'SuperCart may cancel an order if items are out of stock, the address is not serviceable, or payment is not completed. If this happens, you will be notified.',
              ]}
            />
          </Section>

          <Section no="2" title="Refunds for problem orders">
            <p>Contact us within 24 hours of delivery if:</p>
            <BulletList
              items={[
                'an item is missing, wrong, damaged, or expired;',
                'the quality of a product is not acceptable.',
              ]}
            />
            <p>
              Please share the order number and a clear photo of the item. After verification we will
              arrange a refund or replacement.
            </p>
            <p>
              Fresh and perishable items (fruits, vegetables, dairy, bakery) cannot be returned once
              delivered, but are refunded if they are damaged or spoiled when delivered.
            </p>
          </Section>

          <Section no="3" title="How refunds are paid">
            <BulletList
              items={[
                'Online payments (UPI, cards, wallets): refunded to the original payment method within 5-7 working days after the refund is approved. Actual credit time depends on your bank.',
                'Cash on Delivery orders: refunds are made to your UPI/bank account or as store credit, as agreed with you.',
                'If money was deducted but your order was not placed, the amount is refunded automatically to the original payment method within 5-7 working days.',
              ]}
            />
          </Section>

          <Section no="4" title="Delivery charges">
            <p>
              Delivery charges are refunded only if the order is cancelled by SuperCart or the delivery
              failed due to our fault.
            </p>
          </Section>

          <Section no="5" title="Contact us">
            <p>For any refund or cancellation request:</p>
            <div className="space-y-1">
              <p>Email: <a href="mailto:supportsupercart@gmail.com" className="text-emerald-600 font-medium hover:underline">supportsupercart@gmail.com</a></p>
              <p>Phone / WhatsApp: +91 82781 30026</p>
              <p>Address: Chandan Nagar, Hisar</p>
              <p>Support hours: 8 AM - 10 PM</p>
            </div>
          </Section>

          <div className="mt-10 pt-6 border-t border-slate-100 text-center">
            <Link
              to="/"
              className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold px-6 py-3 rounded-xl transition"
            >
              Back to Shopping
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RefundPolicy;
