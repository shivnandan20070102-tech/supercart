import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import QuickCommerceHeader from './components/layout/QuickCommerceHeader';
import Footer from './components/layout/Footer';
import Home from './pages/Home';
import Cart from './pages/Cart';
import Login from './pages/Login';
import Profile from './pages/Profile';
import TermsAndConditions from './pages/TermsAndConditions';
import PrivacyPolicy from './pages/PrivacyPolicy';
import FloatingCart from './components/layout/FloatingCart';
import { CartProvider } from './context/CartContext';
import { AuthProvider } from './context/AuthContext';
import { WishlistProvider } from './context/WishlistContext';
import { StoreProvider } from './context/StoreContext';
import AdminDashboard from './admin/AdminDashboard';
import AdminLogin from './admin/AdminLogin';
import DeliveryLogin from './delivery/DeliveryLogin';
import DeliverySignup from './delivery/DeliverySignup';
import DeliveryForgotPassword from './delivery/DeliveryForgotPassword';
import DeliveryResetPassword from './delivery/DeliveryResetPassword';
import DeliveryApprovalStatus from './delivery/DeliveryApprovalStatus';
import DeliveryDashboard from './delivery/DeliveryDashboard';
import DeliveryHelp from './delivery/DeliveryHelp';
import DeliveryProfile from './delivery/DeliveryProfile';
import DeliveryGuard from './delivery/DeliveryGuard';
import DeliveryActivity from './delivery/DeliveryActivity';
import DeliveryOrderDetail from './delivery/DeliveryOrderDetail';
import DeliverySupportTickets from './delivery/DeliverySupportTickets';
import DeliveryComplaints from './delivery/DeliveryComplaints';
import StoreLogin from './store/StoreLogin';
import StoreDashboard from './store/StoreDashboard';
import StoreGuard from './store/StoreGuard';

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
  const isProfile = pathname === '/profile';

  return (
    <>
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
              <Route path="/delivery/support-tickets" element={<DeliveryGuard><DeliverySupportTickets /></DeliveryGuard>} />
              <Route path="/delivery/complaints" element={<DeliveryGuard><DeliveryComplaints /></DeliveryGuard>} />
              <Route path="/delivery/dashboard" element={<DeliveryGuard><DeliveryDashboard /></DeliveryGuard>} />
              <Route path="/delivery" element={<DeliveryGuard><DeliveryDashboard /></DeliveryGuard>} />
              {/* Store Panel — sirf store_manager role (account Admin banata hai) */}
              <Route path="/store/login" element={<StoreLogin />} />
              <Route path="/store/dashboard" element={<StoreGuard><StoreDashboard /></StoreGuard>} />
              <Route path="/store" element={<StoreGuard><StoreDashboard /></StoreGuard>} />
              {/* Customer Login/Signup — standalone clean page, bina Header/Footer ke */}
              <Route path="/login" element={<Login />} />
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
          </div>
            </Router>
          </StoreProvider>
        </WishlistProvider>
      </CartProvider>
    </AuthProvider>
  );
}

export default App;
