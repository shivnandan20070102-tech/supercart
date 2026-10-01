import React from 'react';
import { ChevronRight, ShoppingCart } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useCart } from '../../context/CartContext';
import { useAuth } from '../../context/AuthContext';

const FloatingCart = () => {
  const { cartItems, cartCount } = useCart();
  const { user } = useAuth();
  const location = useLocation();

  if (!user || cartCount === 0 || location.pathname === '/cart') return null;

  return (
    <Link
      to="/cart"
      className="fixed bottom-4 left-1/2 z-40 flex w-[calc(100%-3rem)] max-w-[300px] -translate-x-1/2 items-center gap-2 rounded-full bg-emerald-700 px-2.5 py-2 text-white shadow-[0_10px_24px_rgba(4,120,87,0.32)] transition hover:bg-emerald-800 hover:shadow-[0_14px_30px_rgba(4,120,87,0.38)] sm:bottom-6 sm:w-auto sm:min-w-[260px]"
      aria-label="View cart"
    >
      <div className="flex -space-x-3">
        {cartItems.slice(0, 2).map((item) => (
          <div key={item.id} className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-white shadow-sm">
            <img src={item.image} alt="" className="h-full w-full object-contain" />
          </div>
        ))}
        {cartItems.length === 1 && <div className="h-11 w-11 rounded-full border-2 border-white bg-emerald-500" />}
      </div>
      <div className="min-w-0 flex-1 pl-1">
        <p className="text-lg font-black leading-tight">View cart</p>
        <p className="text-sm font-medium text-emerald-100">{cartCount} {cartCount === 1 ? 'item' : 'items'}</p>
      </div>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600/70">
        <ChevronRight className="h-6 w-6" />
      </div>
    </Link>
  );
};

export default FloatingCart;