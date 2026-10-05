import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Apple,
  ChevronDown,
  Coffee,
  Croissant,
  Flame,
  MapPin,
  Mic,
  Milk,
  Search,
  ShoppingCart,
  Sparkles,
  Store,
  User,
  Wheat,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStore } from '../../context/StoreContext';
import useDeliveryAddress from '../../hooks/useDeliveryAddress';
import AddressPicker from '../grocery/AddressPicker';
import { CATEGORIES } from '../../data/mockGroceryData';
import {
  DELIVERY_ETA_MINUTES,
  SEARCH_SUGGESTIONS,
  formatDistance,
} from '../../config/store';

const CATEGORY_ICONS = {
  Sparkles,
  Apple,
  Milk,
  Croissant,
  Wheat,
  Coffee,
  Flame,
};

const shortName = (name) => (name === 'All Categories' ? 'All' : name);

/**
 * QuickCommerceHeader — SuperCart ka apna quick-commerce top section.
 * Row1: ETA + distance pill | profile • Row2: address • Row3: search • Row4: tabs.
 * Sticky: search + tabs hamesha dikhte hain, ETA/address scroll par collapse hote hain.
 */
const QuickCommerceHeader = ({ searchQuery, setSearchQuery, selectedCategory, setSelectedCategory }) => {
  const { user } = useAuth();
  const { savedAddress, saveAddress } = useDeliveryAddress();
  // Nearest-store badge: selected address/GPS se StoreContext jo nearest ACTIVE
  // store (5km rule) resolve karta hai, wahi reuse hota hai — koi duplicate
  // distance logic nahi. Address change par userCoords badalta hai aur ye
  // badge automatically re-render hota hai.
  const { nearestStore, serviceable, hasLocation, nearestLoading } = useStore();
  const servingStore = hasLocation && serviceable === true ? nearestStore : null;
  const distanceLabel =
    servingStore?.distanceKm != null ? formatDistance(servingStore.distanceKm) : '';
  const [pickerOpen, setPickerOpen] = useState(false);
  const [wordIndex, setWordIndex] = useState(0);
  const [searchFocused, setSearchFocused] = useState(false);
  // Voice search state — mic button, permission + recognition live here only
  // (no camera/barcode/QR logic anywhere in this component).
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const recognitionRef = useRef(null);
  const micStreamRef = useRef(null);
  const voiceErrorTimerRef = useRef(null);
  const searchInputRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const isHome = location.pathname === '/';

  // Header hamesha fully visible/static — scroll par koi collapse/expand nahi,
  // taaki scroll ke time koi blink/flicker na ho. (Pehle yahan scroll listener
  // se max-height toggle hota tha, wahi scroll-blink ka root cause tha.)

  const showFakePlaceholder = !searchFocused && !(searchQuery || '').trim();

  // Rotating placeholder har 2.5s — sirf jab search empty + focused nahi hai
  // (typing/focus ke time timer band taaki glitch/re-render na ho)
  useEffect(() => {
    if (!showFakePlaceholder) return undefined;
    const timer = window.setInterval(
      () => setWordIndex((i) => (i + 1) % SEARCH_SUGGESTIONS.length),
      2500,
    );
    return () => window.clearInterval(timer);
  }, [showFakePlaceholder]);

  // Voice recognition + mic stream cleanup on unmount (mic LED off rahe).
  useEffect(() => () => {
    try { recognitionRef.current?.abort?.(); } catch { /* ignore */ }
    recognitionRef.current = null;
    try { micStreamRef.current?.getTracks?.()?.forEach((t) => t.stop()); } catch { /* ignore */ }
    micStreamRef.current = null;
    if (voiceErrorTimerRef.current) window.clearTimeout(voiceErrorTimerRef.current);
  }, []);

  const showVoiceError = (message) => {
    setVoiceError(message);
    if (voiceErrorTimerRef.current) window.clearTimeout(voiceErrorTimerRef.current);
    voiceErrorTimerRef.current = window.setTimeout(() => setVoiceError(''), 6000);
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    // Mobile keyboard band karo taaki header jump/glitch na ho
    searchInputRef.current?.blur();
    if (location.pathname !== '/') {
      navigate('/');
    } else {
      requestAnimationFrame(() => {
        document.getElementById('products')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  };

  const handleSearchChange = (e) => {
    setSearchQuery?.(e.target.value);
    // Dusre page (cart/profile) par type karte hi home par lao taaki results dikhe
    if (location.pathname !== '/') navigate('/');
  };

  // Spoken text ko existing search me daal kar existing product search chalao.
  // (Home.jsx searchQuery se live filter karta hai — sirf home par lao + scroll.)
  const runVoiceSearch = (text) => {
    const clean = String(text || '').trim();
    if (!clean) return;
    setSearchQuery?.(clean);
    if (location.pathname !== '/') {
      navigate('/');
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById('products')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  };

  const stopVoiceRecognition = () => {
    try { recognitionRef.current?.stop?.(); } catch { /* ignore */ }
    try { micStreamRef.current?.getTracks?.()?.forEach((t) => t.stop()); } catch { /* ignore */ }
    micStreamRef.current = null;
  };

  const handleVoiceSearch = async () => {
    // Tap while listening = stop current session (phir tap = nayi search).
    if (listening) {
      stopVoiceRecognition();
      return;
    }
    setVoiceError('');
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) {
      showVoiceError('Voice search is not supported in this browser. Please use Chrome (Android/desktop) or type your search.');
      searchInputRef.current?.focus();
      return;
    }
    // 1) Microphone permission (zaroorat ho to prompt). Insecure origin par
    // ye step fail ho sakta hai — neeche error me HTTPS hint diya gaya hai.
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = stream;
      } catch (err) {
        const name = err?.name || '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          showVoiceError(
            window.isSecureContext === false
              ? 'Microphone permission is required for voice search. Permission was blocked — this address is not a secure context (HTTP LAN). Open the site over HTTPS or localhost, allow the microphone, then tap the mic again.'
              : 'Microphone permission is required for voice search. Please allow microphone access in the browser prompt (lock icon → Microphone → Allow), then tap the mic again.',
          );
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          showVoiceError('No microphone was found on this device. Please connect a microphone or type your search.');
        } else {
          showVoiceError('Could not access the microphone. Please check the microphone and try again, or type your search.');
        }
        return;
      }
    }
    // 2) Permission mil gayi (ya mediaDevices unavailable) — turant recognition start.
    try {
      try { recognitionRef.current?.abort?.(); } catch { /* ignore */ }
      const rec = new Rec();
      recognitionRef.current = rec;
      rec.lang = 'en-IN';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        const text = e.results?.[0]?.[0]?.transcript;
        if (text && String(text).trim()) runVoiceSearch(text);
        else showVoiceError("Didn't catch that. Please try again or type your search.");
      };
      rec.onerror = (e) => {
        const code = e?.error || '';
        if (code === 'aborted') return; // user ne dobara tap karke stop kiya
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          showVoiceError(
            window.isSecureContext === false
              ? 'Microphone permission is required for voice search. The browser blocked it on this insecure (HTTP LAN) address. Use HTTPS or localhost, allow the microphone, then tap the mic again.'
              : 'Microphone permission is required for voice search. Please allow microphone access, then tap the mic again.',
          );
        } else if (code === 'no-speech') {
          showVoiceError("Didn't hear anything. Please speak a product name (e.g. Banana) or type your search.");
        } else if (code === 'audio-capture') {
          showVoiceError('No microphone was found. Please connect a microphone or type your search.');
        } else if (code === 'network') {
          showVoiceError('Voice recognition needs an internet connection. Please check your connection or type your search.');
        } else {
          showVoiceError('Voice search failed. Please try again or type your search.');
        }
      };
      // 3) Recognition khatm → normal stop (mic release + Listening off).
      rec.onend = () => {
        setListening(false);
        recognitionRef.current = null;
        try { micStreamRef.current?.getTracks?.()?.forEach((t) => t.stop()); } catch { /* ignore */ }
        micStreamRef.current = null;
      };
      rec.start();
      // 4) Clear "Listening..." state while mic active.
      setListening(true);
    } catch {
      showVoiceError('Could not start voice search. Please try again or type your search.');
      searchInputRef.current?.focus();
    }
  };

  const handleSelectCategory = (cat) => {
    const next = cat.id === 'all' ? 'all' : cat.name;
    setSelectedCategory?.(next);
    if (isHome) {
      requestAnimationFrame(() => {
        document.getElementById('products')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    } else {
      navigate('/');
    }
  };


  return (
    <>
      <header className="sticky top-0 z-50 bg-[linear-gradient(155deg,var(--brand-dark)_0%,var(--brand)_70%)] text-white shadow-lg">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {/* Top rows: ETA + address — hamesha visible, koi scroll animation nahi */}
          <div>
            {/* Row 1: ETA left, profile right */}
            <div className="flex items-center justify-between gap-3 pt-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  aria-label="Go to home"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 transition active:scale-95"
                >
                  <ShoppingCart className="h-6 w-6 -rotate-6" />
                </button>
                <div className="min-w-0 leading-tight">
                  <p className="text-[11px] font-semibold text-emerald-50">SuperCart</p>
                  <p className="whitespace-nowrap text-xl font-black tracking-tight">
                    <span className="text-amber-300">{DELIVERY_ETA_MINUTES}</span> minutes
                  </p>
                  {/* Nearest-store distance badge — selected address se dynamic
                      store name + actual calculated distance (5km rule ke andar
                      hi dikhta hai). Desktop/mobile dono par visible. */}
                  {servingStore ? (
                    <span
                      data-testid="nearest-store-badge"
                      aria-live="polite"
                      title={distanceLabel}
                      className="mt-1 inline-flex max-w-[52vw] items-center gap-1 truncate rounded-full border border-emerald-200/40 bg-emerald-500 px-2.5 py-[3px] text-[11px] font-bold leading-none text-white shadow sm:max-w-[280px]"
                    >
                      <Store className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">
                        {distanceLabel}
                      </span>
                    </span>
                  ) : nearestLoading && hasLocation ? (
                    <span
                      data-testid="nearest-store-badge-loading"
                      aria-live="polite"
                      className="mt-1 inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/15 px-2.5 py-[3px] text-[11px] font-bold leading-none text-emerald-50"
                    >
                      Finding nearest store…
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Right: profile -> tap par seedha Account Center (/profile) */}
              <div className="flex shrink-0 items-center gap-2">
                {user ? (
                  <button
                    type="button"
                    onClick={() => navigate('/profile')}
                    aria-label="Open account center"
                    className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-white font-black text-[var(--brand-dark)] shadow transition active:scale-95"
                  >
                    {user.avatar ? (
                      <img src={user.avatar} alt={user.name} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-base">{user.name ? user.name.charAt(0).toUpperCase() : 'U'}</span>
                    )}
                  </button>
                ) : (
                  <Link
                    to="/login"
                    aria-label="Login"
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-[var(--brand-dark)] shadow transition active:scale-95"
                  >
                    <User className="h-5 w-5" />
                  </Link>
                )}
              </div>
            </div>

            {/* Row 2: delivery address */}
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="mt-1 flex min-h-[44px] w-full items-center gap-1.5 rounded-xl text-left transition active:opacity-80"
              aria-label="Change delivery address"
            >
              {savedAddress ? (
                <>
                  <MapPin className="h-4 w-4 shrink-0 text-amber-300" />
                  <span className="text-sm font-black">{savedAddress.label}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-emerald-50">
                    {savedAddress.address}
                  </span>
                </>
              ) : (
                <>
                  <MapPin className="h-4 w-4 shrink-0 text-amber-300" />
                  <span className="text-sm font-bold">Select delivery location</span>
                </>
              )}
              <ChevronDown className="h-4 w-4 shrink-0" />
            </button>
          </div>

          {/* Row 3: search */}
          <div className="pt-2">
            <form onSubmit={handleSearchSubmit} className="relative" role="search">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchInputRef}
                type="search"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                value={searchQuery || ''}
                onChange={handleSearchChange}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder={showFakePlaceholder ? '' : 'Search products...'}
                aria-label="Search products"
                className="min-h-[48px] w-full appearance-none rounded-2xl bg-white pl-11 pr-12 text-sm text-slate-800 shadow outline-none transition placeholder:text-slate-400 focus:ring-2 focus:ring-amber-300 [&::-webkit-search-cancel-button]:hidden"
              />
              {showFakePlaceholder && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 left-11 flex select-none items-center overflow-hidden text-sm text-slate-400"
                >
                  <span key={wordIndex} className="qc-word-in truncate">
                    Search &ldquo;{SEARCH_SUGGESTIONS[wordIndex]}&rdquo;
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={handleVoiceSearch}
                aria-label={listening ? 'Stop voice search' : 'Voice search'}
                aria-pressed={listening}
                title={listening ? 'Listening… tap to stop' : 'Voice search'}
                className={`absolute right-1.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl transition active:scale-95 ${
                  listening
                    ? 'animate-pulse bg-red-100 text-red-600'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-[var(--brand-dark)]'
                }`}
              >
                <Mic className="h-5 w-5" />
              </button>
            </form>
            {/* Listening state + voice errors — search bar ke neeche, design unchanged */}
            {listening && (
              <p role="status" aria-live="polite" className="mt-1.5 flex items-center gap-2 text-xs font-bold text-amber-200">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
                </span>
                Listening… speak a product name (e.g. Banana, Milk, Bread) — tap mic to stop
              </p>
            )}
            {voiceError && !listening && (
              <p role="alert" className="mt-1.5 rounded-lg bg-black/25 px-2.5 py-1.5 text-xs font-semibold text-amber-100">
                {voiceError}
              </p>
            )}
          </div>

          {/* Row 4: category tabs (sirf home par) */}
          {isHome && (
            <nav aria-label="Categories" className="qc-no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1 pb-1 pt-1">
              {CATEGORIES.map((cat) => {
                const Icon = CATEGORY_ICONS[cat.icon] || Sparkles;
                const isActive = selectedCategory === cat.id || selectedCategory === cat.name;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => handleSelectCategory(cat)}
                    aria-pressed={isActive}
                    className={`flex min-h-[52px] min-w-[64px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-3 transition ${
                      isActive ? 'text-white' : 'text-emerald-50/80 hover:text-white'
                    }`}
                  >
                    <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
                    <span className={`whitespace-nowrap text-[11px] ${isActive ? 'font-black' : 'font-medium'}`}>
                      {shortName(cat.name)}
                    </span>
                    <span
                      className={`mt-0.5 h-0.5 w-8 rounded-full bg-white transition-all ${
                        isActive ? 'opacity-100' : 'opacity-0'
                      }`}
                    />
                  </button>
                );
              })}
            </nav>
          )}
          <div className="pb-2.5" />
        </div>
      </header>

      <AddressPicker
        open={pickerOpen}
        initial={savedAddress}
        onClose={() => setPickerOpen(false)}
        onSave={saveAddress}
      />
    </>
  );
};

export default QuickCommerceHeader;
