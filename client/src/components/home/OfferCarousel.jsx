import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BadgePercent, Check, Copy, Sparkles, Timer, Truck } from 'lucide-react';
import { supabase } from '../../config/supabase';

const AUTOPLAY_MS = 4000;

const OfferCarousel = () => {
  const [index, setIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const [posters, setPosters] = useState([]);
  const pausedRef = useRef(false);
  const touchStartXRef = useRef(null);
  const count = 4 + posters.length;

  const loadPosters = useCallback(async () => {
    const { data, error } = await supabase
      .from('homepage_banners')
      .select('id,image_url,display_order')
      .eq('is_active', true)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) {
      console.error('Failed to load homepage banners:', error);
      return;
    }
    setPosters(data || []);
  }, []);

  useEffect(() => {
    loadPosters();
    const channel = supabase
      .channel('homepage-banners-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'homepage_banners' }, loadPosters)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadPosters]);

  useEffect(() => {
    if (index >= count) setIndex(Math.max(0, count - 1));
  }, [count, index]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!pausedRef.current) setIndex((i) => (i + 1) % count);
    }, AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [count]);

  const copyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText('SAVE20');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = 'SAVE20';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, []);

  const go = (nextIndex) => {
    pausedRef.current = true;
    setIndex(nextIndex);
    window.setTimeout(() => {
      pausedRef.current = false;
    }, 8000);
  };

  const handleTouchStart = (event) => {
    pausedRef.current = true;
    touchStartXRef.current = event.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (event) => {
    const startX = touchStartXRef.current;
    const endX = event.changedTouches[0]?.clientX;
    touchStartXRef.current = null;
    if (startX == null || endX == null) return;
    const delta = endX - startX;
    if (Math.abs(delta) >= 45) {
      setIndex((current) => (delta < 0 ? (current + 1) % count : (current - 1 + count) % count));
    }
    window.setTimeout(() => {
      pausedRef.current = false;
    }, 5000);
  };

  return (
    <section aria-label="Offers" className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
      <div
        className="overflow-hidden rounded-3xl shadow-lg"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className="flex touch-pan-y transition-transform duration-500 ease-in-out"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          <div className="w-full shrink-0 bg-[linear-gradient(120deg,var(--brand-dark),var(--brand))] p-5 text-white sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-amber-300">
                  <BadgePercent className="h-3.5 w-3.5" /> Welcome offer
                </p>
                <p className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">20% OFF</p>
                <p className="mt-0.5 text-xs text-emerald-50">On grocery orders above ₹399</p>
              </div>
              <button type="button" onClick={copyCode} className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl border border-dashed border-white/50 bg-white/10 px-3.5 font-mono text-xs font-bold transition active:scale-95" aria-label="Copy coupon code SAVE20">
                {copied ? <Check className="h-4 w-4 text-amber-300" /> : <Copy className="h-4 w-4" />}
                {copied ? 'COPIED' : 'SAVE20'}
              </button>
            </div>
          </div>
          <div className="w-full shrink-0 bg-[linear-gradient(120deg,#0d9488,#059669)] p-5 text-white sm:p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15"><Timer className="h-6 w-6 text-amber-300" /></div>
              <div className="min-w-0"><p className="text-xl font-black tracking-tight sm:text-2xl">Farm-fresh, in minutes</p><p className="mt-0.5 truncate text-xs text-emerald-50">Vegetables, fruits, dairy & daily essentials</p></div>
            </div>
          </div>
          <div className="w-full shrink-0 bg-[linear-gradient(120deg,#047857,#0d9488)] p-5 text-white sm:p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15"><Truck className="h-6 w-6 text-amber-300" /></div>
              <div className="min-w-0"><p className="text-xl font-black tracking-tight sm:text-2xl">Free delivery over ₹399</p><p className="mt-0.5 truncate text-xs text-emerald-50">No minimum order • 100% quality checked</p></div>
            </div>
          </div>
          <div className="w-full shrink-0 bg-[linear-gradient(120deg,#9a3412,#d97706_55%,#f59e0b)] p-5 text-white sm:p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15"><Sparkles className="h-6 w-6 text-amber-100" /></div>
              <div className="min-w-0"><p className="text-xl font-black tracking-tight sm:text-2xl">Diwali Special - Flat 20% Off</p><p className="mt-0.5 truncate text-xs text-orange-50">Sweets, dry fruits & festive essentials</p></div>
            </div>
          </div>
          {posters.map((poster) => (
            <div key={poster.id} className="w-full shrink-0 bg-slate-100">
              <img src={poster.image_url} alt="SuperCart promotion" className="block aspect-[2/1] w-full object-cover" />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-center gap-1.5" role="tablist" aria-label="Banner selector">
        {Array.from({ length: count }, (_, dotIndex) => (
          <button key={dotIndex} type="button" role="tab" aria-selected={index === dotIndex} aria-label={`Banner ${dotIndex + 1}`} onClick={() => go(dotIndex)} className={`h-2 rounded-full transition-all duration-300 ${index === dotIndex ? 'w-6 bg-[var(--brand)]' : 'w-2 bg-slate-300 hover:bg-slate-400'}`} />
        ))}
      </div>
    </section>
  );
};

export default OfferCarousel;
