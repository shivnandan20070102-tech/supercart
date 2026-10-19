import React, { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import QuickCommerceHeader from './components/layout/QuickCommerceHeader';
import Footer from './components/layout/Footer';
import FloatingCart from './components/layout/FloatingCart';
import AutoLocationSetup from './components/AutoLocationSetup';
import { CartProvider } from './context/CartContext';
import { AuthProvider } from './context/AuthContext';
import { WishlistProvider } from './context/WishlistContext';
import { StoreProvider } from './context/StoreContext';

const Home = lazy(() => import('./pages/Home'));
const Cart = lazy(() => import('./pages/Cart'));
const Login = lazy(() => import('./pages/Login'));
const Profile = lazy(() => import('./pages/Profile'));
const OrderHistory = lazy(() => import('./pages/OrderHistory'));
const OrderDetail = lazy(() => import('./pages/OrderDetail'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const TermsAndConditions = lazy(() => import('./pages/TermsAndConditions'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const AdminDashboard = lazy(() => import('./admin/AdminDashboard'));
const AdminLogin = lazy(() => import('./admin/AdminLogin'));
const DeliveryLogin = lazy(() => import('./delivery/DeliveryLogin'));
const DeliverySignup = lazy(() => import('./delivery/DeliverySignup'));
const DeliveryForgotPassword = lazy(() => import('./delivery/DeliveryForgotPassword'));
const DeliveryResetPassword = lazy(() => import('./delivery/DeliveryResetPassword'));
const DeliveryApprovalStatus = lazy(() => import('./delivery/DeliveryApprovalStatus'));
const DeliveryDashboard = lazy(() => import('./delivery/DeliveryDashboard'));
const DeliveryHelp = lazy(() => import('./delivery/DeliveryHelp'));
const DeliveryProfile = lazy(() => import('./delivery/DeliveryProfile'));
const DeliveryGuard = lazy(() => import('./delivery/DeliveryGuard'));
const DeliveryActivity = lazy(() => import('./delivery/DeliveryActivity'));
const DeliveryOrderDetail = lazy(() => import('./delivery/DeliveryOrderDetail'));
const DeliveryComplaints = lazy(() => import('./delivery/DeliveryComplaints'));
const StoreLogin = lazy(() => import('./store/StoreLogin'));
const StoreDashboard = lazy(() => import('./store/StoreDashboard'));
const StoreGuard = lazy(() => import('./store/StoreGuard'));

function RouteLoading() {
  return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm font-bold text-slate-500">Loading...</div>;
}

/**
 * ScrollToTop — har route change + reload par page header (top) se dikhao,
 * footer ki taraf se nahi. Browser ki scroll-restoration ko manual karke
 * hamesha top par lao.
 */
function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    try {
      if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    } catch {
      // ignore
    }
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

/**
 * ShopLayout — Home/Cart/etc. par SuperCart Header, SIRF /profile par nahi.
 * /profile ka apna simple top bar Profile.jsx ke andar hai.
 */
function ShopLayout({ searchQuery, setSearchQuery, selectedCategory, setSelectedCategory }) {
  const { pathname } = useLocation();
  const isProfile = pathname === '/profile' || pathname.startsWith('/profile/orders');

  return (
    <>
      {/* Naya user: GPS se delivery address auto-set + location-off notification
          (admin/delivery/store panels isme nahi hain — sirf customer pages) */}
      <AutoLocationSetup />
      {!isProfile && (
        <QuickCommerceHeader
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          selectedCategory={selectedCategory}
          setSelectedCategory={setSelectedCategory}
        />
      )}
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home searchQuery={searchQuery} selectedCategory={selectedCategory} setSelectedCategory={setSelectedCategory} />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/profile/orders" element={<OrderHistory />} />
          <Route path="/profile/orders/:id" element={<OrderDetail />} />
          <Route path="/terms-and-conditions" element={<TermsAndConditions />} />
          <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        </Routes>
      </main>
      <FloatingCart />
      <Footer />
    </>
  );
}

function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', localStorage.getItem('supercart_dark_mode') === 'true');
  }, []);

  return (
    <AuthProvider>
      <CartProvider>
        <WishlistProvider>
          <StoreProvider>
            <Router>
              <ScrollToTop />
          <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 selection:bg-emerald-500 selection:text-white">
            {/* Header Navigation */}
            <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/admin/login" element={<AdminLogin />} />
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/delivery/login" element={<DeliveryLogin />} />
              <Route path="/delivery/signup" element={<DeliverySignup />} />
              <Route path="/delivery/forgot-password" element={<DeliveryForgotPassword />} />
              <Route path="/delivery/reset-password" element={<DeliveryResetPassword />} />
              <Route path="/delivery/approval-pending" element={<DeliveryApprovalStatus />} />
              <Route path="/delivery/approval-status" element={<DeliveryApprovalStatus />} />
              <Route path="/delivery/profile" element={<DeliveryProfile />} />
              <Route path="/delivery/activity/:type" element={<DeliveryGuard><DeliveryActivity /></DeliveryGuard>} />
              <Route path="/delivery/order/:id" element={<DeliveryGuard><DeliveryOrderDetail /></DeliveryGuard>} />
              <Route path="/delivery/help" element={<DeliveryGuard><DeliveryHelp /></DeliveryGuard>} />
              <Route path="/delivery/complaints" element={<DeliveryGuard><DeliveryComplaints /></DeliveryGuard>} />
              <Route path="/delivery/dashboard" element={<DeliveryGuard><DeliveryDashboard /></DeliveryGuard>} />
              <Route path="/delivery" element={<DeliveryGuard><DeliveryDashboard /></DeliveryGuard>} />
              {/* Store Panel — sirf store_manager role (account Admin banata hai) */}
              <Route path="/store/login" element={<StoreLogin />} />
              <Route path="/store/forgot-password" element={<ForgotPassword />} />
              <Route path="/store/reset-password" element={<ResetPassword />} />
              <Route path="/store/dashboard" element={<StoreGuard><StoreDashboard /></StoreGuard>} />
              <Route path="/store" element={<StoreGuard><StoreDashboard /></StoreGuard>} />
              {/* Customer Login/Signup — standalone clean page, bina Header/Footer ke */}
              <Route path="/login" element={<Login />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/signup" element={<Login />} />
              <Route path="*" element={(
                <ShopLayout
                  searchQuery={searchQuery}
                  setSearchQuery={setSearchQuery}
                  selectedCategory={selectedCategory}
                  setSelectedCategory={setSelectedCategory}
                />
              )} />
            </Routes>
            </Suspense>
          </div>
            </Router>
          </StoreProvider>
        </WishlistProvider>
      </CartProvider>
    </AuthProvider>
  );
}

export default App;
