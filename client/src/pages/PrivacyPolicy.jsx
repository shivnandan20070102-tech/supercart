import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, ChevronRight } from 'lucide-react';

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

const PrivacyPolicy = () => {
  return (
    <div className="bg-slate-50 min-h-screen">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs text-slate-500 mb-6">
          <Link to="/" className="hover:text-emerald-600 transition">Home</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-slate-800 font-medium">Privacy Policy</span>
        </nav>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-10">
          {/* Header */}
          <div className="flex items-center gap-3 mb-4">
            <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-black text-slate-900">Privacy Policy</h1>
              <p className="text-xs text-slate-500 mt-1">Last updated: October 2026 • SuperCart Technologies Pvt Ltd</p>
            </div>
          </div>

          <p className="text-sm sm:text-[15px] text-slate-600 leading-relaxed mb-8 pb-8 border-b border-slate-100">
            Your privacy is our top priority. This policy explains how SuperCart collects, uses,
            shares, and protects your data. By using our service, you agree to this policy.
          </p>

          <Section no="1" title="What Data We Collect">
            <BulletList
              items={[
                'Contact details: name, mobile number, email address.',
                'Delivery details: address, landmark, pincode, and location (with your permission).',
                'Order details: cart items, payment method, and transaction history.',
                'Account activity: login history, preferences, wishlist, and reviews.',
                'Device and usage data: device type, app version, crash reports, and browsing behaviour via cookies.',
              ]}
            />
          </Section>

          <Section no="2" title="How We Use Your Data">
            <BulletList
              items={[
                'To process, confirm, and deliver your orders.',
                'To share order details with the delivery partner and the nearest store.',
                'To provide customer support and resolve refunds and complaints.',
                'To send offers, discounts, and personalized recommendations (you can opt out at any time).',
                'To prevent fraud, improve security, and enhance our service.',
              ]}
            />
          </Section>

          <Section no="3" title="Cookies & Tracking">
            <p>
              We use cookies and similar technologies to remember your login session, save your
              cart, and understand site performance. You can disable cookies in your browser
              settings, but some features may not work correctly.
            </p>
          </Section>

          <Section no="4" title="Data Sharing">
            <BulletList
              items={[
                'Delivery partners and stores: only the details needed for order fulfilment (name, address, phone).',
                'Payment gateways: for secure payment processing (we never store your card or CVV).',
                'Legal authorities: when required by law or for fraud investigations.',
                'We never sell your personal data to third parties.',
              ]}
            />
          </Section>

          <Section no="5" title="Data Security">
            <p>
              Your data is protected with encrypted connections (HTTPS), secure servers, and
              restricted access. However, no method of transmission over the internet can guarantee
              100% security — so please never share your OTP or password with anyone.
            </p>
          </Section>

          <Section no="6" title="Data Retention">
            <p>
              We retain your data for as long as your account is active or as needed for legitimate
              business or legal purposes. When you delete your account, your personal data is
              deleted or anonymized, except where we are legally required to keep it.
            </p>
          </Section>

          <Section no="7" title="Your Rights">
            <BulletList
              items={[
                'The right to access, correct, or update your data (via the Profile page or support).',
                'The right to unsubscribe from promotional messages.',
                'The right to request account deletion and data erasure.',
                'For any request, write to support@supercart.com — we will respond within 7 working days.',
              ]}
            />
          </Section>

          <Section no="8" title="Children\u2019s Privacy">
            <p>
              Our service is not intended for children under 18. We do not knowingly collect data
              from children. If we become aware of such data, it will be deleted immediately.
            </p>
          </Section>

          <Section no="9" title="Changes to This Policy">
            <p>
              If this policy changes, the updated version will be published on this page and the
              &ldquo;Last updated&rdquo; date will be revised. We may also notify you of significant
              changes by email or app notification.
            </p>
          </Section>

          <Section no="10" title="Contact Us">
            <p>
              For any privacy-related questions or requests, contact us:
              <br />
              <span className="font-semibold text-slate-800">SuperCart Technologies Pvt Ltd</span>
              <br />
              Email: <a href="mailto:support@supercart.com" className="text-emerald-600 font-medium hover:underline">support@supercart.com</a>
              <br />
              Phone: +91 98765 43210 (available 24x7)
            </p>
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

export default PrivacyPolicy;
