import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShoppingBag,
  Mail,
  Lock,
  User,
  Phone,
  ArrowRight,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Loader2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// Google G Logo SVG Component
const GoogleIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

const Login = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', password: '' });
  const [message, setMessage] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const navigate = useNavigate();
  const { signInWithEmail, signUpWithEmail, signInWithGoogle } = useAuth();

  const handleChange = (e) => {
    const { name, value } = e.target;
    // Email is often pasted with an accidental space or backslash before @.
    const cleanedValue = name === 'email' ? value.replace(/[\\\s]/g, '') : value;
    setFormData({ ...formData, [name]: cleanedValue });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');
    setErrorMsg('');
    setLoading(true);

    try {
      if (isLogin) {
        const res = await signInWithEmail(formData.email, formData.password);
        if (res.success) {
          setMessage(`Welcome back, ${res.user?.name || formData.email}! Logged in successfully.`);
          setTimeout(() => navigate('/'), 1200);
        } else {
          setErrorMsg(res.message || 'Login failed. Please check your credentials.');
        }
      } else {
        const res = await signUpWithEmail(formData);
        if (res.success) {
          if (res.needsEmailConfirmation) {
            setMessage(res.message);
            setIsLogin(true);
            return;
          }
          if (res.user) {
            setMessage(`Account created for ${formData.name}! Redirecting...`);
            setTimeout(() => navigate('/'), 1200);
            return;
          }
          setMessage(`Account created for ${formData.name}! Redirecting...`);
          setTimeout(() => navigate('/'), 1200);
        } else {
          setErrorMsg(res.message || 'Signup failed. Please try again.');
        }
      }
    } catch (err) {
      setErrorMsg('Account service could not be reached. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    setErrorMsg('');
    setMessage('');
    try {
      const result = await signInWithGoogle();
      if (result.success) {
        // If real Google OAuth redirect happens, page will reload automatically
      } else {
        setErrorMsg(result.message || 'Google sign-in failed. Please try again or enable it in Supabase dashboard.');
      }
    } catch (err) {
      setErrorMsg('Google login error: ' + err.message);
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center px-4 py-12 bg-slate-50">
      <div className="bg-white w-full max-w-md rounded-3xl border border-slate-200/80 p-8 sm:p-10 shadow-xl relative overflow-hidden">

        {/* Top Color Decoration */}
        <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600"></div>

        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-inner">
            <ShoppingBag className="w-7 h-7" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            {isLogin ? 'Welcome Back!' : 'Join SuperCart'}
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            {isLogin
              ? 'Login to access your orders and grocery savings'
              : 'Sign up for 10-minute grocery delivery at doorstep'}
          </p>
        </div>

        {/* Login / Sign Up Toggle Tabs */}
        <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-2xl mb-6">
          <button
            type="button"
            onClick={() => { setIsLogin(true); setMessage(''); setErrorMsg(''); }}
            className={`py-2 text-xs font-bold rounded-xl transition cursor-pointer ${isLogin ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'}`}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => { setIsLogin(false); setMessage(''); setErrorMsg(''); }}
            className={`py-2 text-xs font-bold rounded-xl transition cursor-pointer ${!isLogin ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'}`}
          >
            Sign Up
          </button>
        </div>

        {/* ─── GOOGLE LOGIN BUTTON ─────────────────── */}
        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={googleLoading}
          className="w-full flex items-center justify-center gap-3 py-3 px-4 border-2 border-slate-200 hover:border-emerald-500 hover:bg-emerald-50/50 rounded-2xl text-sm font-bold text-slate-700 transition-all duration-200 cursor-pointer disabled:opacity-70 group mb-5"
        >
          {googleLoading ? (
            <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
          ) : (
            <GoogleIcon />
          )}
          <span className="group-hover:text-emerald-700 transition">
            {googleLoading ? 'Connecting to Google...' : 'Continue with Google'}
          </span>
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1 h-px bg-slate-200"></div>
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">or with email</span>
          <div className="flex-1 h-px bg-slate-200"></div>
        </div>

        {/* Feedback Alerts */}
        {message && (
          <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold rounded-xl flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{message}</span>
          </div>
        )}
        {errorMsg && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Auth Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* Name Field - Signup only */}
          {!isLogin && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Full Name</label>
              <div className="relative">
                <input type="text" name="name" value={formData.name} onChange={handleChange}
                  placeholder="e.g. Rohan Sharma" required={!isLogin}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none transition" />
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              </div>
            </div>
          )}

          {/* Email */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Email Address</label>
            <div className="relative">
              <input type="email" name="email" value={formData.email} onChange={handleChange}
                placeholder="name@example.com" required
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none transition" />
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            </div>
          </div>

          {/* Phone - Signup only */}
          {!isLogin && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Mobile Number</label>
              <div className="relative">
                <input type="tel" name="phone" value={formData.phone} onChange={handleChange}
                  placeholder="10-digit mobile number"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none transition" />
                <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              </div>
            </div>
          )}

          {/* Password */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-slate-700">Password</label>
              {isLogin && <a href="#forgot" className="text-[11px] font-semibold text-emerald-600 hover:underline">Forgot?</a>}
            </div>
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} name="password" value={formData.password} onChange={handleChange}
                placeholder="••••••••" required
                className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none transition" />
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                className="text-slate-400 hover:text-slate-600 absolute right-3.5 top-1/2 -translate-y-1/2 cursor-pointer">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Submit Button */}
          <button type="submit" disabled={loading}
            className="w-full mt-2 py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-75 active:scale-98 text-white text-xs font-bold rounded-2xl transition shadow-lg shadow-emerald-600/25 flex items-center justify-center gap-2 cursor-pointer">
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : (<><span>{isLogin ? 'Sign In to SuperCart' : 'Create SuperCart Account'}</span><ArrowRight className="w-4 h-4" /></>)
            }
          </button>
        </form>

        {/* Security badge */}
        <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-center">
          <span className="text-[10px] text-slate-400 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> 100% Secure
          </span>
        </div>

      </div>
    </div>
  );
};

export default Login;
