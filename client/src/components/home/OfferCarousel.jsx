import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BadgePercent, Check, Copy, Sparkles } from 'lucide-react';
import { supabase } from '../../config/supabase';

const AUTOPLAY_MS = 4000;

const OfferCarousel = () => {
  const [index, setIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const [banners, setBanners] = useState([]);
  const pausedRef = useRef(false);

  const loadBanners = useCallback(async () => {
    const { data, error } = await supabase
      .from('banners')
      .select('id,title,subtitle,image_url,background_color,coupon_code,display_order')
      .eq('is_active', true)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) {
      console.error('Failed to load banners:', error);
      return;
    }
    setBanners(data || []);
  }, []);

  useEffect(() => {
    loadBanners();
    const channel = supabase
      .channel('banners-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'banners' }, loadBanners)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [loadBanners]);

  useEffect(() => {
    if (index >= banners.length) setIndex(Math.max(0, banners.length - 1));
  }, [banners.length, index]);

  useEffect(() => {
    if (banners.length < 2) return undefined;
    const timer = window.setInterval(() => {
      if (!pausedRef.current) setIndex((current) => (current + 1) % banners.length);
    }, AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [banners.length]);

  const copyCode = useCallback(async (code) => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = code;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, []);

  if (banners.length === 0) return null;

  return (
    <section aria-label="Offers" className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
      <div className="overflow-hidden rounded-3xl shadow-lg">
        <div className="flex transition-transform duration-500 ease-in-out" style={{ transform: `translateX(-${index * 100}%)` }}>
          {banners.map((banner) => (
            <div key={banner.id} className="w-full shrink-0" style={{ background: banner.image_url ? undefined : banner.background_color || '#047857' }}>
              {banner.image_url ? (
                <img src={banner.image_url} alt={banner.title || 'SuperCart promotion'} className="block aspect-[2/1] w-full object-cover" />
              ) : (
                <div className="flex min-h-[150px] items-center justify-between gap-4 p-5 text-white sm:min-h-[170px] sm:p-6">
                  <div className="min-w-0">
                    <p className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-amber-300">
                      {banner.coupon_code ? <BadgePercent className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                      SuperCart offer
                    </p>
                    <p className="mt-2 text-xl font-black tracking-tight sm:text-2xl">{banner.title}</p>
                    {banner.subtitle && <p className="mt-1 text-xs text-white/85 sm:text-sm">{banner.subtitle}</p>}
                  </div>
                  {banner.coupon_code && (
                    <button type="button" onClick={() => copyCode(banner.coupon_code)} className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl border border-dashed border-white/50 bg-white/10 px-3.5 font-mono text-xs font-bold">
                      {copied ? <Check className="h-4 w-4 text-amber-300" /> : <Copy className="h-4 w-4" />}
                      {copied ? 'COPIED' : banner.coupon_code}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {banners.length > 1 && (
        <div className="mt-2.5 flex items-center justify-center gap-1.5" role="tablist" aria-label="Banner selector">
          {banners.map((banner, bannerIndex) => (
            <button key={banner.id} type="button" role="tab" aria-selected={index === bannerIndex} aria-label={`Banner ${bannerIndex + 1}`} onClick={() => { pausedRef.current = true; setIndex(bannerIndex); window.setTimeout(() => { pausedRef.current = false; }, 8000); }} className={`h-2 rounded-full transition-all duration-300 ${index === bannerIndex ? 'w-6 bg-[var(--brand)]' : 'w-2 bg-slate-300 hover:bg-slate-400'}`} />
          ))}
        </div>
      )}
    </section>
  );
};

export default OfferCarousel;
