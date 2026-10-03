import React from 'react';
import { ShoppingCart, ShieldCheck, Clock, Award, Phone, Mail, Heart } from 'lucide-react';
import { Link } from 'react-router-dom';

const Footer = () => {
  return (
    <footer className="bg-slate-900 text-slate-300 pt-16 pb-8 border-t border-slate-800 mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Features / Trust Badges */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pb-12 border-b border-slate-800">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-bold text-white text-base">Superfast 10-Min Delivery</h4>
              <p className="text-sm text-slate-400 mt-1">
                Fresh fruits, veggies, and daily essentials at your doorstep within minutes.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
              <Award className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-bold text-white text-base">Best Prices & Offers</h4>
              <p className="text-sm text-slate-400 mt-1">
                Direct farm-to-table sourcing with unbeatable discounts and instant cashback.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-bold text-white text-base">100% Quality Guarantee</h4>
              <p className="text-sm text-slate-400 mt-1">
                No-questions-asked refund or replacement if you are not 100% satisfied.
              </p>
            </div>
          </div>
        </div>

        {/* Links & Brand Info */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 py-12">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 bg-emerald-500 rounded-xl flex items-center justify-center text-white font-black">
                <ShoppingCart className="w-4 h-4" />
              </div>
              <span className="text-xl font-black text-white">
                Super<span className="text-emerald-400">Cart</span>
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              India's favorite online grocery store. Delivering fresh organic vegetables, dairy, grains, snacks, and daily household needs.
            </p>
          </div>

          <div>
            <h5 className="font-bold text-white text-sm uppercase tracking-wider mb-4">Categories</h5>
            <ul className="space-y-2 text-sm text-slate-400">
              <li><Link to="/" className="hover:text-emerald-400 transition">Fruits & Vegetables</Link></li>
              <li><Link to="/" className="hover:text-emerald-400 transition">Dairy, Bread & Eggs</Link></li>
              <li><Link to="/" className="hover:text-emerald-400 transition">Atta, Rice & Dal</Link></li>
              <li><Link to="/" className="hover:text-emerald-400 transition">Snacks & Beverages</Link></li>
            </ul>
          </div>

          <div>
            <h5 className="font-bold text-white text-sm uppercase tracking-wider mb-4">Customer Care</h5>
            <ul className="space-y-2 text-sm text-slate-400">
              <li><Link to="/cart" className="hover:text-emerald-400 transition">My Cart</Link></li>
              <li><Link to="/login" className="hover:text-emerald-400 transition">Track Order</Link></li>
              <li><Link to="/terms-and-conditions" className="hover:text-emerald-400 transition">Terms & Conditions</Link></li>
              <li><Link to="/privacy-policy" className="hover:text-emerald-400 transition">Privacy Policy</Link></li>
              <li><Link to="/delivery/signup" className="font-semibold text-emerald-400 hover:text-emerald-300 transition">Join Delivery Partner</Link></li>
              <li><Link to="/delivery/login" className="hover:text-emerald-400 transition">Delivery Partner Login</Link></li>
            </ul>
          </div>

          <div>
            <h5 className="font-bold text-white text-sm uppercase tracking-wider mb-4">Contact Us</h5>
            <div className="space-y-2 text-xs text-slate-400">
              <p className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-emerald-400" /> +91 98765 43210
              </p>
              <p className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-emerald-400" /> support@supercart.com
              </p>
              <p className="pt-2 text-slate-500">
                Available 24x7 for all your grocery queries.
              </p>
            </div>
          </div>
        </div>

        {/* Bottom copyright */}
        <div className="pt-8 border-t border-slate-800 text-center text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© {new Date().getFullYear()} SuperCart Technologies Pvt Ltd. All rights reserved.</p>
          <p className="flex items-center gap-1">
            Built with <Heart className="w-3.5 h-3.5 text-red-500 fill-red-500" /> for fast grocery shopping
          </p>
        </div>

      </div>
    </footer>
  );
};

export default Footer;
