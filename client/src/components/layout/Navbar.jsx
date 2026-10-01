import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ShoppingCart,
  Search,
  User,
  MapPin,
  Sparkles,
  Zap,
  LogOut,
  ChevronDown,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const Navbar = ({ searchQuery, setSearchQuery }) => {
  const { user, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const navigate = useNavigate();

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (window.location.pathname !== '/') {
      navigate('/');
    }
  };

  const handleLogout = () => {
    logout();
    setDropdownOpen(false);
    navigate('/');
  };

  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs">
      {/* Top micro banner */}
      <div className="bg-emerald-600 text-white text-xs font-medium py-1.5 px-4 text-center flex items-center justify-center gap-2">
        <Zap className="w-3.5 h-3.5 animate-pulse text-amber-300" />
        <span>⚡ Superfast Grocery Delivery in <b>10-15 minutes</b> | Free delivery on orders above ₹499!</span>
      </div>

      {/* Main Navbar */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between min-h-16 py-2 sm:h-20 sm:py-0 gap-2 sm:gap-4 md:gap-8">
          
          {/* Logo & Delivery Location */}
          <div className="flex items-center gap-3 lg:gap-6 shrink-0">
            <Link to="/" className="flex items-center gap-2 group">
              <div className="w-9 h-9 sm:w-11 sm:h-11 bg-emerald-500 rounded-xl sm:rounded-2xl flex items-center justify-center text-white shadow-md group-hover:bg-emerald-600 transition">
                <ShoppingCart className="w-6 h-6 transform -rotate-6" />
              </div>
              <div>
                <span className="text-lg sm:text-2xl font-black tracking-tight text-slate-900">
                  Super<span className="text-emerald-600">Cart</span>
                </span>
                <span className="hidden sm:block text-[10px] uppercase font-bold tracking-widest text-emerald-600 -mt-1">
                  Grocery in Minutes
                </span>
              </div>
            </Link>

            {/* Location selector */}
            <div className="hidden lg:flex items-center gap-2 text-xs text-slate-600 border-l border-slate-200 pl-6 py-1">
              <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600">
                <MapPin className="w-4 h-4" />
              </div>
              <div className="text-left">
                <p className="font-bold text-slate-800 flex items-center gap-1">
                  Delivery in 10 mins
                </p>
                <p className="text-slate-500 truncate max-w-[150px]">Sector 62, Noida, UP</p>
              </div>
            </div>
          </div>

          {/* Search Bar */}
          <div className="flex-1 min-w-0 max-w-xl">
            <form onSubmit={handleSearchSubmit} className="relative">
              <input
                type="text"
                placeholder="Search fresh milk, bananas, atta, chips, bread..."
                value={searchQuery || ''}
                onChange={(e) => setSearchQuery && setSearchQuery(e.target.value)}
                className="w-full pl-9 sm:pl-11 pr-2 sm:pr-4 py-2.5 bg-slate-100/80 hover:bg-slate-100 focus:bg-white text-xs sm:text-sm text-slate-800 rounded-xl border border-transparent focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none transition"
              />
              <Search className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            </form>
          </div>

          {/* Right Action Buttons */}
          <div className="flex items-center gap-1.5 sm:gap-4 shrink-0">
            
            {/* User Profile / Login Button */}
            {user ? (
              <div className="relative">
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex items-center gap-2 p-1.5 pr-3 rounded-2xl border border-slate-200 hover:border-emerald-500 bg-slate-50 hover:bg-white transition cursor-pointer"
                >
                  {user.avatar ? (
                    <img
                      src={user.avatar}
                      alt={user.name}
                      className="w-8 h-8 rounded-full object-cover border border-emerald-500"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-emerald-600 text-white font-bold text-xs flex items-center justify-center">
                      {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
                    </div>
                  )}
                  <div className="text-left hidden sm:block">
                    <p className="text-xs font-bold text-slate-800 truncate max-w-[100px]">
                      {user.name}
                    </p>
                    <p className="text-[10px] text-emerald-600 font-semibold">
                      {user.provider === 'google' ? 'Google Login' : 'Customer'}
                    </p>
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>

                {/* Dropdown Menu */}
                {dropdownOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-xl border border-slate-100 p-2 py-2 z-50 animate-fade-in">
                    <div className="px-3 py-2 border-b border-slate-100 mb-1">
                      <p className="text-xs font-bold text-slate-800">{user.name}</p>
                      <p className="text-[11px] text-slate-400 truncate">{user.email}</p>
                    </div>
                    <button
                      onClick={() => {
                        setDropdownOpen(false);
                        navigate('/profile');
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 rounded-xl transition cursor-pointer"
                    >
                      <User className="w-4 h-4" />
                      <span>My Profile</span>
                    </button>
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-xl transition cursor-pointer"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Log Out</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link
                to="/login"
                className="flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-emerald-600 p-1 sm:px-3 sm:py-2 rounded-xl hover:bg-slate-100 transition"
              >
                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600">
                  <User className="w-4 h-4" />
                </div>
                <span className="hidden sm:inline">Login / Register</span>
              </Link>
            )}

          </div>

        </div>
      </div>
    </header>
  );
};

export default Navbar;
