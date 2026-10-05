import React, { useState, useEffect, useMemo } from 'react';
import {
  MapPin,
  Navigation,
  ShoppingBag,
  TrendingUp,
} from 'lucide-react';
import ProductCard from '../components/grocery/ProductCard';
import OfferCarousel from '../components/home/OfferCarousel';
import LoadingState, { OfflineNotice } from '../components/layout/LoadingState';
import { fetchProducts } from '../services/api';
import { supabase } from '../config/supabase';
import { useStore } from '../context/StoreContext';

const Home = ({ searchQuery, selectedCategory, setSelectedCategory }) => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [usedOfflineFallback, setUsedOfflineFallback] = useState(false);
  const {
    isOnline,
    nearestStore,
    serviceable,
    hasLocation,
    locationChecked,
    nearestLoading,
    gpsLoading,
    gpsError,
    requestGpsLocation,
    refreshNearestStore,
  } = useStore();
  const outOfService = hasLocation && locationChecked && !nearestLoading && serviceable === false;
  const servingStore = hasLocation && serviceable === true ? nearestStore : null;

  // Search ko debounce karo — har keystroke par API hit se glitch hota tha
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery);
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchQuery || ''), 400);
    return () => window.clearTimeout(t);
  }, [searchQuery]);

  // Fetch products from backend API when category/debounced-search changes
  useEffect(() => {
    let isMounted = true;
    const loadProducts = async () => {
      // Pehle se products hain to full-screen loader mat dikhao (glitch kam hoga)
      if (products.length === 0) setLoading(true);
      else setLoading(true);
      setError('');
      setUsedOfflineFallback(false);
      const apiData = await fetchProducts(
        selectedCategory === 'all' ? '' : selectedCategory,
        debouncedSearch
      );

      if (isMounted) {
        if (Array.isArray(apiData)) {
          // Normalize fields between Supabase snake_case and frontend camelCase
          const normalized = apiData.map((item) => ({
            id: item.id || item._id,
            name: item.name,
            category: item.category,
            categoryName: item.category,
            price: Number(item.price),
            originalPrice: Number(item.original_price || item.originalPrice || item.price),
            unit: item.unit,
            image: item.image,
            rating: Number(item.rating || 4.5),
            reviewsCount: Number(item.reviews_count || item.reviewsCount || 40),
            badge: item.badge || '',
            // Real-time stock: available qty clearly dikhao (null = legacy/unknown).
            stock: item.stock ?? item.stock_quantity ?? null,
            in_stock: item.in_stock ?? null,
            inStock: (item.in_stock ?? item.inStock ?? true) !== false && !(item.stock != null && Number(item.stock) <= 0),
            description: item.description,
            // Multi-store: product kis store ka hai (NULL = purana/global product, sab stores par)
            store_id: item.store_id ?? item.storeId ?? null,
          }));
          setProducts(normalized);
          setUsedOfflineFallback(apiData.length > 0 && apiData.every((item) => String(item.id || '').startsWith('p')));
        } else {
          setProducts([]);
          setError('Products could not be loaded. Please make sure the backend server is running.');
        }
        setLoading(false);
      }
    };

    loadProducts();
    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory, debouncedSearch]);

  // Real-time stock: kisi aur user ke order se stock ghate to grid turant
  // update ho (page reload nahi). Sirf stock/in_stock fields patch hote hain —
  // filter/order/cart logic untouched.
  useEffect(() => {
    const channel = supabase
      .channel('products-stock-live')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'products' }, (payload) => {
        const next = payload.new;
        if (!next || next.id == null) return;
        // eslint-disable-next-line no-console
        console.info('[stock] live update product', next.id, '->', next.stock);
        setProducts((prev) =>
          prev.map((p) =>
            String(p.id) === String(next.id)
              ? {
                  ...p,
                  stock: next.stock ?? p.stock,
                  in_stock: next.in_stock ?? p.in_stock,
                  inStock:
                    (next.in_stock ?? p.in_stock ?? true) !== false &&
                    !(next.stock != null && Number(next.stock) <= 0),
                }
              : p,
          ),
        );
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Client side fallback filter for instant responsiveness (raw query se turant filter)
  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const matchesCategory =
        selectedCategory === 'all' ||
        product.category.toLowerCase().includes(selectedCategory.toLowerCase()) ||
        (product.categoryName && product.categoryName.toLowerCase().includes(selectedCategory.toLowerCase()));

      const matchesSearch =
        !searchQuery ||
        product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        product.category.toLowerCase().includes(searchQuery.toLowerCase());

      return matchesCategory && matchesSearch;
    });
  }, [products, selectedCategory, searchQuery]);

  // Multi-store filter: store mil gaya to SIRF usi store ke products dikhao.
  // store_id NULL wale purane/global products har store par dikhte hain.
  // Location unknown ho to filtering nahi (purana behaviour).
  const storeProducts = useMemo(() => {
    if (!servingStore) return filteredProducts;
    return filteredProducts.filter(
      (product) => product.store_id == null || String(product.store_id) === String(servingStore.id),
    );
  }, [filteredProducts, servingStore]);

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {!isOnline && (
        <div className="mx-auto mt-4 max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-bold text-amber-900" role="status">
            Store is currently closed, please check back later
          </div>
        </div>
      )}
      {/* Multi-store: area serviceable nahi — ordering band, sirf browsing */}
      {outOfService && (
        <div className="mx-auto mt-4 max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-center shadow-xs" role="alert">
            <p className="text-sm font-black text-rose-800">
              Sorry, we don't deliver to your area yet
            </p>
            <p className="mt-1 text-xs font-semibold text-rose-600">
              You can keep browsing, but you can't place an order from this location.
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={requestGpsLocation}
                disabled={gpsLoading}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-rose-600 px-4 text-xs font-bold text-white transition hover:bg-rose-700 active:scale-95 disabled:opacity-60"
              >
                <Navigation className="h-3.5 w-3.5" />
                {gpsLoading ? 'Getting location...' : 'Try my current location'}
              </button>
              <button
                type="button"
                onClick={refreshNearestStore}
                className="inline-flex min-h-[40px] items-center rounded-xl border border-rose-300 bg-white px-4 text-xs font-bold text-rose-700 transition hover:bg-rose-100 active:scale-95"
              >
                Check again
              </button>
            </div>
            {gpsError && <p className="mt-2 text-[11px] font-bold text-rose-600">{gpsError}</p>}
          </div>
        </div>
      )}
      {/* Location hi set nahi — nearest store check ke liye nudge */}
      {!hasLocation && (
        <div className="mx-auto mt-4 max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-center text-xs font-bold text-sky-900" role="status">
            <MapPin className="h-4 w-4 shrink-0" />
            <span>Select your delivery location from the header above to see products from the nearest store</span>
          </div>
        </div>
      )}
      {/* Offer banners (auto-sliding carousel) */}
      <OfferCarousel />

      {/* Products Grid Section */}
      <section id="products" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 scroll-mt-48">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-600" />
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              {searchQuery ? `Search Results for "${searchQuery}"` : 'Popular & Fresh Items'}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {(nearestLoading || gpsLoading) && hasLocation && (
              <span className="text-xs font-bold text-emerald-600">Finding nearest store...</span>
            )}
            {loading && <span className="text-xs font-bold text-emerald-600">Updating...</span>}
          </div>
        </div>

        {/* Out-of-service: products/order hide, sirf ye message */}
        {outOfService ? (
          <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center max-w-md mx-auto my-8 shadow-xs">
            <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center text-rose-500 mx-auto mb-4">
              <MapPin className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Sorry, we don't deliver to your area yet</h3>
            <p className="text-xs text-slate-500 mt-1 mb-6">
              We are coming to your area soon. Until then, you can browse products.
            </p>
            <button
              onClick={() => {
                setSelectedCategory('all');
              }}
              className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl shadow-xs transition"
            >
              Browse Products
            </button>
          </div>
        ) : (
        <>
        {/* Empty Search / Filter State */}
        {loading && products.length === 0 ? (
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm"><LoadingState label="Loading fresh products..." /></div>
        ) : error ? (
          <div className="bg-red-50 rounded-3xl border border-red-200 p-8 text-center max-w-lg mx-auto my-8">
            <h3 className="text-lg font-bold text-red-800">Unable to load products</h3>
            <p className="text-sm text-red-700 mt-2">{error}</p>
          </div>
        ) : storeProducts.length === 0 ? (
          <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center max-w-md mx-auto my-8 shadow-xs">
            <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-600 mx-auto mb-4">
              <ShoppingBag className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">No grocery items found</h3>
            <p className="text-xs text-slate-500 mt-1 mb-6">
              We couldn't find any products matching your search or category filter.
            </p>
            <button
              onClick={() => {
                setSelectedCategory('all');
              }}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition"
            >
              View All Products
            </button>
          </div>
        ) : (
          /* Products Grid */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-4 sm:gap-6">
            {storeProducts.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
        </>
        )}
        {usedOfflineFallback && <OfflineNotice />}
      </section>
    </div>
  );
};

export default Home;
