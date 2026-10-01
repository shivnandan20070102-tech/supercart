import React from 'react';
import { Star, Plus, Minus, Check, Clock, Heart } from 'lucide-react';
import { useCart } from '../../context/CartContext';
import { useWishlist } from '../../context/WishlistContext';
import { useStore } from '../../context/StoreContext';

const ProductCard = ({ product }) => {
  const { cartItems, addToCart, updateQuantity } = useCart();
  const { toggleWishlist, isInWishlist } = useWishlist();
  const { isOnline, serviceable } = useStore();

  // Area serviceable nahi (10km me koi store nahi) to ordering band — sirf browsing
  const canOrder = isOnline && serviceable !== false;

  const cartItem = cartItems.find((item) => item.id === product.id);
  const quantity = cartItem ? cartItem.quantity : 0;
  const wished = isInWishlist(product.id);

  const discountPercentage = product.originalPrice
    ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)
    : 0;

  return (
    <div className="group bg-white rounded-2xl border border-slate-200/80 hover:border-emerald-500/50 shadow-xs hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between overflow-hidden relative">
      
      {/* Top Image Section */}
      <div className="relative p-4 pb-0 bg-slate-50/50 flex items-center justify-center aspect-square overflow-hidden">
        {/* Discount / Custom Badge */}
        <div className="absolute top-3 left-3 z-10 flex flex-col gap-1">
          {discountPercentage > 0 && (
            <span className="bg-emerald-600 text-white text-[11px] font-extrabold px-2 py-0.5 rounded-lg shadow-xs">
              {discountPercentage}% OFF
            </span>
          )}
          {product.badge && discountPercentage === 0 && (
            <span className="bg-slate-900 text-white text-[10px] font-bold px-2 py-0.5 rounded-lg shadow-xs">
              {product.badge}
            </span>
          )}
        </div>

        {/* 10 Min Delivery Tag */}
        <div className="absolute bottom-2 left-3 z-10 flex items-center gap-1 bg-white/90 backdrop-blur-xs text-slate-700 text-[10px] font-bold px-2 py-0.5 rounded-md border border-slate-100 shadow-xs">
          <Clock className="w-3 h-3 text-emerald-600" />
          <span>10 MINS</span>
        </div>

        <button
          type="button"
          onClick={() => toggleWishlist(product)}
          aria-label={wished ? 'Remove from wishlist' : 'Add to wishlist'}
          className={`absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full border bg-white/95 shadow-sm transition hover:scale-105 ${wished ? 'border-rose-200 text-rose-500' : 'border-slate-100 text-slate-400 hover:text-rose-500'}`}
        >
          <Heart className={`h-4 w-4 ${wished ? 'fill-current' : ''}`} />
        </button>

        {/* Image */}
        <img
          src={product.image}
          alt={product.name}
          className="w-full h-full object-contain object-center transform group-hover:scale-108 transition-transform duration-500"
          loading="lazy"
        />
      </div>

      {/* Product Details Section */}
      <div className="p-4 flex flex-col flex-1 justify-between">
        <div>
          {/* Unit / Weight */}
          <p className="text-xs font-semibold text-slate-400 mb-1">
            {product.unit}
          </p>

          {/* Title */}
          <h3 className="font-bold text-slate-900 text-sm md:text-base line-clamp-2 leading-snug group-hover:text-emerald-700 transition">
            {product.name}
          </h3>

          {/* Rating */}
          <div className="flex items-center gap-1.5 mt-2">
            <div className="flex items-center gap-1 bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-md text-xs font-bold border border-amber-200/50">
              <Star className="w-3 h-3 fill-amber-400 text-amber-500" />
              <span>{product.rating || 4.5}</span>
            </div>
            <span className="text-[11px] text-slate-400">
              ({product.reviewsCount || 40})
            </span>
          </div>
        </div>

        {/* Price and Add/Quantity Actions */}
        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
          {/* Price */}
          <div className="flex flex-col">
            <span className="text-lg font-black text-slate-900 leading-none">
              ₹{product.price}
            </span>
            {product.originalPrice && product.originalPrice > product.price && (
              <span className="text-xs text-slate-400 line-through mt-0.5">
                ₹{product.originalPrice}
              </span>
            )}
          </div>

          {/* Add to Cart / Quantity Stepper */}
          {quantity === 0 ? (
            <button
              disabled={!canOrder}
              onClick={() => addToCart(product)}
              className="flex items-center justify-center gap-1 rounded-xl border border-emerald-500/30 bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-700 transition-all shadow-xs hover:border-emerald-600 hover:bg-emerald-600 hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>ADD</span>
            </button>
          ) : (
            <div className="flex items-center bg-emerald-600 text-white rounded-xl shadow-xs overflow-hidden">
              <button
                disabled={!canOrder}
                onClick={() => updateQuantity(product.id, quantity - 1)}
                className="px-2.5 py-2 transition hover:bg-emerald-700 active:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                title="Decrease quantity"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 font-black text-xs min-w-5 text-center">
                {quantity}
              </span>
              <button
                disabled={!canOrder}
                onClick={() => updateQuantity(product.id, quantity + 1)}
                className="px-2.5 py-2 transition hover:bg-emerald-700 active:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                title="Increase quantity"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

      </div>

    </div>
  );
};

export default ProductCard;
