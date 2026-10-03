import React from 'react';
import { Link } from 'react-router-dom';
import { FileText, ChevronRight } from 'lucide-react';

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

const TermsAndConditions = () => {
  return (
    <div className="bg-slate-50 min-h-screen">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs text-slate-500 mb-6">
          <Link to="/" className="hover:text-emerald-600 transition">Home</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-slate-800 font-medium">Terms & Conditions</span>
        </nav>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-10">
          {/* Header */}
          <div className="flex items-center gap-3 mb-4">
            <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-black text-slate-900">Terms & Conditions</h1>
              <p className="text-xs text-slate-500 mt-1">Last updated: October 2026 • SuperCart Technologies Pvt Ltd</p>
            </div>
          </div>

          <p className="text-sm sm:text-[15px] text-slate-600 leading-relaxed mb-8 pb-8 border-b border-slate-100">
            Welcome to SuperCart (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;). By placing an order through
            our website or app, you agree to the terms and conditions set out below. Please read
            them carefully before ordering.
          </p>

          <Section no="1" title="Service Overview">
            <p>
              SuperCart is an online grocery delivery platform that brings fresh fruits, vegetables,
              dairy, grains, snacks, and daily household essentials to your doorstep. Product
              availability depends on your delivery address, the nearest store, and current stock.
            </p>
          </Section>

          <Section no="2" title="Account & Eligibility">
            <BulletList
              items={[
                'You must be at least 18 years old to place an order.',
                'The information provided at signup (name, mobile number, address) must be accurate and kept up to date.',
                'You are responsible for keeping your account and OTP confidential. Report any unauthorized use immediately at support@supercart.com.',
                'We may suspend or terminate accounts that provide false information or misuse the platform.',
              ]}
            />
          </Section>

          <Section no="3" title="Orders, Pricing & Payments">
            <BulletList
              items={[
                'Prices shown on the website/app are in INR and may change without notice. The final price is confirmed at checkout.',
                'An order is considered confirmed only after you receive a confirmation SMS or app notification.',
                'We accept UPI, cards, net-banking, and cash on delivery (where available).',
                'If an item is out of stock, it may be cancelled or replaced — the refund or payment adjustment will reach your source account within 3–7 working days.',
                'Coupons and offers cannot be combined on a single order unless explicitly stated in the offer.',
              ]}
            />
          </Section>

          <Section no="4" title="Delivery Policy">
            <BulletList
              items={[
                'We aim for superfast 10-minute delivery, but delays may occur due to traffic, weather, or high demand.',
                'Providing a correct address and a reachable phone number is the customer\u2019s responsibility. A fee may apply for deliveries that fail due to an incorrect address.',
                'Please refrigerate perishable items (milk, curd, frozen food) immediately after delivery.',
                'Our delivery partners may refuse an order if the address is unsafe or the customer is unreachable.',
              ]}
            />
          </Section>

          <Section no="5" title="Cancellation, Return & Refund">
            <BulletList
              items={[
                'You can cancel your order before it is packed, via the app or by calling customer care (+91 98765 43210) — a full refund will be issued.',
                'Cancellation is not possible once the order has been packed or dispatched.',
                'For damaged, expired, or incorrect items, raise a complaint within 24 hours with a photo — we will provide a replacement or refund.',
                '100% Quality Guarantee: if you are not satisfied, you get a no-questions-asked refund or replacement.',
                'Refunds are credited to the original payment method within 3–7 working days; COD orders are refunded via bank or UPI transfer.',
              ]}
            />
          </Section>

          <Section no="6" title="Acceptable Use">
            <BulletList
              items={[
                'Misusing the website, placing fraudulent orders, posting fake reviews, or attempting to damage our systems is strictly prohibited.',
                'Extracting data using bots, scraping, or automated tools is not allowed.',
                'Using the platform for any illegal, harmful, or offensive activity may result in legal action.',
              ]}
            />
          </Section>

          <Section no="7" title="Intellectual Property">
            <p>
              The SuperCart logo, design, text, images, and code are our property. Copying,
              reproducing, or distributing them without written permission is prohibited.
            </p>
          </Section>

          <Section no="8" title="Limitation of Liability">
            <p>
              To the maximum extent permitted by law, SuperCart shall not be liable for any indirect,
              incidental, or consequential losses (such as data loss or loss of profit). Our maximum
              liability for any claim is limited to the value of that order.
            </p>
          </Section>

          <Section no="9" title="Changes to Terms">
            <p>
              We may update these Terms from time to time. The updated version will be published on
              this page and will take effect immediately upon publication. Please check this page
              regularly.
            </p>
          </Section>

          <Section no="10" title="Contact Us">
            <p>
              For any questions related to these Terms, contact us:
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

export default TermsAndConditions;
