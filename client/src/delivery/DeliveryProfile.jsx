import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, ChevronDown, Crosshair, FileText, Flag, LoaderCircle, MapPin, Save, Settings, ShieldCheck, Upload, UserRound, BriefcaseBusiness, Route, Gift, Copy, Share2, CircleHelp, Headphones, TicketCheck, LogOut, Wallet } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../config/supabase';
import { SignedDocImage, SignedDocLink } from '../components/SignedDoc';
import StoreMapPicker from '../admin/StoreMapPicker';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || '';
// Home Store auto-assign radius — pinned location se isse door koi store ho
// to samjho area me service nahi hai (User wale flow jaisa block).
const HOME_SERVICE_RADIUS_KM = 15;

const numOrNull = (v) => {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return null;
};

// Haversine distance (km) — server (utils/storeAssign.js) wala same formula
const haversineKm = (lat1, lon1, lat2, lon2) => {
  const nums = [lat1, lon1, lat2, lon2];
  if (nums.some((v) => typeof v !== 'number' || Number.isNaN(v))) return null;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);
  const h = s1 * s1 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * s2 * s2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const documents = [
  { key: 'aadhar_card_url', label: 'Aadhar Card', accept: 'image/*,.pdf' },
  { key: 'driving_license_url', label: 'Driving License', accept: 'image/*,.pdf' },
  { key: 'pan_card_url', label: 'PAN Card', accept: 'image/*,.pdf' },
  { key: 'bike_image_url', label: 'Bike Image', accept: 'image/*' },
];
const MAX_FILE_SIZE = 3 * 1024 * 1024;
const inputClass = 'mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-800 p-3 text-sm text-white outline-none focus:border-emerald-500';

const AccordionSection = ({ id, title, icon: Icon, openSection, setOpenSection, children, accent = false }) => {
  const isOpen = openSection === id;
  return (
    <section className="mb-4 overflow-hidden rounded-2xl">
      <button
        type="button"
        onClick={() => setOpenSection(isOpen ? '' : id)}
        aria-expanded={isOpen}
        className={`flex w-full items-center justify-between rounded-2xl border p-4 text-left text-sm font-black transition-colors ${accent ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-300' : 'border-slate-800 bg-slate-900 text-white'} hover:border-emerald-500`}
      >
        <span className="flex items-center gap-3"><Icon className="h-5 w-5 text-emerald-400" />{title}</span>
        <ChevronDown className={`h-5 w-5 text-emerald-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="min-h-0 overflow-hidden pt-3">{children}</div>
      </div>
    </section>
  );
};

const DeliveryProfile = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [profilePhoto, setProfilePhoto] = useState(null);
  const [profilePhotoPreview, setProfilePhotoPreview] = useState('');
  const [files, setFiles] = useState({});
  const [previews, setPreviews] = useState({});
  const [savedFiles, setSavedFiles] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState({ type: '', text: '' });
  const [activity, setActivity] = useState({ gigs: 0, trips: 0, offers: 0 });
  const [referralCode, setReferralCode] = useState('');
  const [referralMessage, setReferralMessage] = useState('');
  const [openSection, setOpenSection] = useState('activity');
  // Home Area (auto Home Store): pinned lat/lng + resolved nearest store.
  // existingHomeStore = DB me pehle se saved (dobara pin na kare to wahi rahega).
  const [homeCoords, setHomeCoords] = useState({ lat: '', lng: '' });
  const [homeStore, setHomeStore] = useState(null);
  const [existingHomeStore, setExistingHomeStore] = useState(null);
  const [homeResolving, setHomeResolving] = useState(false);
  const [homeGpsLoading, setHomeGpsLoading] = useState(false);
  const [homeMsg, setHomeMsg] = useState({ type: '', text: '' });
  const homeResolveSeq = useRef(0);
  // Home Area step SIRF pehli-baari setup (signup) me dikhta hai —
  // approve ke baad wale Profile page par ye section hota hi nahi.
  const [isFirstSetup, setIsFirstSetup] = useState(true);
  const [settings, setSettings] = useState({
    darkTheme: true,
    appLanguage: 'English',
    audioLanguage: 'English',
    supportLanguage: 'English',
    orderAlertSound: 'Default',
  });

  useEffect(() => {
    let mounted = true;
    const loadProfile = async () => {
      const { data: { user: current }, error: authError } = await supabase.auth.getUser();
      if (authError || !current) { navigate('/delivery/login', { replace: true }); return; }
      const { data: role } = await supabase.from('users').select('role').eq('id', current.id).maybeSingle();
      if (!['delivery', 'delivery_partner'].includes(String(role?.role || '').toLowerCase())) { navigate('/', { replace: true }); return; }
      const { data: profile } = await supabase.from('delivery_profiles').select('*').eq('user_id', current.id).maybeSingle();
      const [{ count: trips }, { count: gigs }, { data: offerRows }] = await Promise.all([
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('delivery_boy_id', current.id).in('status', ['delivered', 'Delivered', 'completed', 'Completed']),
        supabase.from('delivery_gigs').select('id', { count: 'exact', head: true }).eq('delivery_partner_id', current.id),
        supabase.from('delivery_offers').select('id, expires_at').eq('is_active', true),
      ]);
      const activeOffers = (offerRows || []).filter((offer) => !offer.expires_at || new Date(offer.expires_at) > new Date());
      if (!mounted) return;
      setUser(current);
      // Pehli baar setup (profile_completed !== true) → Home Area step dikhega.
      // Approve ke baad ka Profile page → section hidden rahega.
      if (mounted) setIsFirstSetup(profile?.profile_completed !== true);
      setForm({ name: profile?.name || current.user_metadata?.full_name || '', email: profile?.email || current.email || '', phone: profile?.phone || current.user_metadata?.phone || '' });
      setProfilePhotoPreview(profile?.profile_photo_url || '');
      setSavedFiles({ aadhar_card_url: profile?.aadhar_card_url || '', driving_license_url: profile?.driving_license_url || '', pan_card_url: profile?.pan_card_url || '', bike_image_url: profile?.bike_image_url || '' });
      // Pehle se auto-assigned Home Store ho to naam dikhao (column SQL se
      // pehle na bani ho to profile.home_store_id undefined — tab skip).
      const savedHomeId = profile?.home_store_id != null ? Number(profile.home_store_id) : null;
      if (savedHomeId != null && !Number.isNaN(savedHomeId)) {
        try {
          const { data: homeRow } = await supabase.from('stores').select('id, store_name').eq('id', savedHomeId).maybeSingle();
          if (mounted && homeRow) setExistingHomeStore({ id: homeRow.id, store_name: homeRow.store_name });
          else if (mounted) setExistingHomeStore({ id: savedHomeId, store_name: '' });
        } catch {
          if (mounted) setExistingHomeStore({ id: savedHomeId, store_name: '' });
        }
      } else if (mounted && profile?.profile_completed !== true) {
        // Signup flow me Home Store abhi tak nahi hai — Area step khula rakho
        setOpenSection('home-area');
      }
      if (String(profile?.approval_status || '').toLowerCase() === 'rejected') {
        const reason = profile?.rejection_reason ? ` Reason: ${profile.rejection_reason}` : '';
        setNotice({ type: 'error', text: `Your previous application was rejected. Please check your documents and resubmit.${reason}` });
      }
      setActivity({ trips: trips || 0, gigs: gigs || 0, offers: activeOffers.length });
      const savedSettings = profile?.settings && typeof profile.settings === 'object' ? profile.settings : {};
      const nextSettings = { ...settings, ...savedSettings };
      setSettings(nextSettings);
      document.documentElement.classList.toggle('dark', Boolean(nextSettings.darkTheme));
      const savedReferralCode = profile?.referral_code || `SC${current.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
      setReferralCode(savedReferralCode);
      if (!profile?.referral_code) {
        await supabase.from('delivery_profiles').upsert({
          user_id: current.id,
          name: profile?.name || current.user_metadata?.full_name || '',
          email: profile?.email || current.email || '',
          phone: profile?.phone || current.user_metadata?.phone || '',
          referral_code: savedReferralCode,
        }, { onConflict: 'user_id' });
      }
      const pendingReferral = String(current.user_metadata?.referral_code || '').trim().toUpperCase();
      if (pendingReferral && pendingReferral !== savedReferralCode) {
        const { data: referrer } = await supabase.from('delivery_profiles').select('user_id').eq('referral_code', pendingReferral).maybeSingle();
        if (referrer?.user_id && referrer.user_id !== current.id) {
          await supabase.from('referrals').upsert({
            referrer_id: referrer.user_id,
            referred_user_id: current.id,
            referral_code: pendingReferral,
            bonus_amount: 0,
          }, { onConflict: 'referred_user_id' });
        }
      }
      setLoading(false);
    };
    loadProfile();
    return () => { mounted = false; };
  }, [navigate]);

  const choosePhoto = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setNotice({ type: 'error', text: 'File size must be smaller than 3MB' });
      event.target.value = '';
      return;
    }
    setProfilePhoto(file);
    setProfilePhotoPreview(URL.createObjectURL(file));
  };

  const chooseDocument = (key, event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setNotice({ type: 'error', text: 'File size must be smaller than 3MB' });
      event.target.value = '';
      return;
    }
    setFiles((current) => ({ ...current, [key]: file }));
    setPreviews((current) => ({ ...current, [key]: file.type.startsWith('image/') ? URL.createObjectURL(file) : '' }));
  };

  const uploadFile = async (file, folder, previousUrl) => {
    if (!file) return previousUrl || null;
    const extension = file.name.split('.').pop()?.toLowerCase() || 'bin';
    const path = `${user.id}/${folder}-${Date.now()}.${extension}`;
    const { error } = await supabase.storage.from('delivery-documents').upload(path, file, { upsert: false, contentType: file.type });
    if (error) throw error;
    return supabase.storage.from('delivery-documents').getPublicUrl(path).data.publicUrl;
  };

  // Pinned location se sabse nazdeek store nikalo (Haversine) aur Home Store
  // auto-assign ke liye rakho. Partner ko kuch select nahi karna — system
  // khud decide karta hai. 15km ke andar koi store na ho to block.
  const resolveHomeStore = async (lat, lng) => {
    const seq = (homeResolveSeq.current += 1);
    setHomeResolving(true);
    setHomeMsg({ type: '', text: '' });
    try {
      const { data: storeRows, error } = await supabase
        .from('stores')
        .select('id, store_name, address, latitude, longitude');
      if (error) throw new Error(`Could not load stores: ${error.message}`);
      const ranked = (storeRows || [])
        .map((s) => {
          const sLat = numOrNull(s.latitude);
          const sLng = numOrNull(s.longitude);
          if (sLat == null || sLng == null) return null;
          const km = haversineKm(lat, lng, sLat, sLng);
          return km == null ? null : { id: s.id, store_name: s.store_name, address: s.address, km };
        })
        .filter(Boolean)
        .sort((a, b) => a.km - b.km);
      if (seq !== homeResolveSeq.current) return;
      if (ranked.length === 0) {
        setHomeStore(null);
        setHomeMsg({ type: 'error', text: 'No stores found. Please ask the admin to add stores.' });
        return;
      }
      const nearest = ranked[0];
      if (nearest.km > HOME_SERVICE_RADIUS_KM) {
        setHomeStore(null);
        setHomeMsg({ type: 'error', text: `No store currently serves your area (nearest store is ~${nearest.km.toFixed(1)} km away, limit ${HOME_SERVICE_RADIUS_KM} km).` });
        return;
      }
      setHomeStore(nearest);
      setHomeMsg({ type: 'success', text: `Your Home Store was assigned automatically: ${nearest.store_name} (~${nearest.km.toFixed(1)} km)` });
    } catch (e) {
      if (seq !== homeResolveSeq.current) return;
      setHomeStore(null);
      setHomeMsg({ type: 'error', text: e.message || 'Could not find the nearest store.' });
    } finally {
      if (seq === homeResolveSeq.current) setHomeResolving(false);
    }
  };

  const onHomePick = (lat, lng) => {
    setHomeCoords({ lat: String(lat), lng: String(lng) });
    resolveHomeStore(Number(lat), Number(lng));
  };

  const onHomeManualCoords = (key, value) => {
    const next = { ...homeCoords, [key]: value };
    setHomeCoords(next);
    const lat = numOrNull(next.lat);
    const lng = numOrNull(next.lng);
    if (lat != null && lng != null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      resolveHomeStore(lat, lng);
    }
  };

  const useGpsForHome = () => {
    if (!('geolocation' in navigator)) {
      setHomeMsg({ type: 'error', text: 'Location is not supported on this device.' });
      return;
    }
    setHomeGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setHomeGpsLoading(false);
        onHomePick(Number(pos.coords.latitude.toFixed(6)), Number(pos.coords.longitude.toFixed(6)));
      },
      () => {
        setHomeGpsLoading(false);
        setHomeMsg({ type: 'error', text: 'Could not get your location. Please allow permission and try again.' });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    setSaving(true);
    setNotice({ type: '', text: '' });
    // Home Store REQUIRED — SIRF pehli-baari setup me: naya pin ya pehle se
    // saved, koi ek hona chahiye, warna signup aage nahi badhega
    // (service-area ke bahar block). Baad ke Profile edits par section hidden
    // hai — wahan null se existing value wipe mat karo (key hi mat bhejo).
    const finalHomeStoreId = homeStore?.id ?? existingHomeStore?.id ?? null;
    if (finalHomeStoreId == null && isFirstSetup) {
      setSaving(false);
      setNotice({ type: 'error', text: 'First pin your location in the "Your Area / Home Store" section — a store within 15 km is required.' });
      setOpenSection('home-area');
      return;
    }
    try {
      const profilePhotoUrl = await uploadFile(profilePhoto, 'profile-photo', profilePhotoPreview);
      const urls = {};
      for (const document of documents) urls[document.key] = await uploadFile(files[document.key], document.key.replace('_url', ''), savedFiles[document.key]);
      const payload = { user_id: user.id, ...form, referral_code: referralCode, settings, profile_photo_url: profilePhotoUrl, ...urls, profile_completed: true, approval_status: 'pending', rejection_reason: null };
      if (finalHomeStoreId != null) payload.home_store_id = finalHomeStoreId;
      const { error } = await supabase.from('delivery_profiles').upsert(payload, { onConflict: 'user_id' });
      if (error) throw error;
      await supabase.from('users').update({ name: form.name, email: form.email, phone: form.phone }).eq('id', user.id);
      setSavedFiles(urls);
      setProfilePhoto(null);
      setFiles({});
      setNotice({ type: 'success', text: 'Profile saved. Your application has been sent for approval.' });
      window.setTimeout(() => navigate('/delivery/approval-pending', { replace: true }), 900);
    } catch (error) {
      // home_store_id column abhi Supabase me na bani ho (SQL pending) to
      // profile save hona na ruke — bina home store ke save karo, Admin
      // baad me Home Store set kar dega.
      if (/home_store_id|schema cache|column/i.test(error?.message || '')) {
        try {
          const retryPayload = { user_id: user.id, ...form, referral_code: referralCode, settings, profile_photo_url: profilePhotoPreview, profile_completed: true, approval_status: 'pending', rejection_reason: null };
          delete retryPayload.home_store_id;
          const retry = await supabase.from('delivery_profiles').upsert(retryPayload, { onConflict: 'user_id' });
          if (retry.error) throw retry.error;
          setNotice({ type: 'error', text: 'Profile saved, but Home Store was not saved — run server/supabase_delivery_home_store.sql in Supabase, then pin your area again.' });
          window.setTimeout(() => navigate('/delivery/approval-pending', { replace: true }), 2500);
          return;
        } catch (retryError) {
          setNotice({ type: 'error', text: retryError.message || 'Could not save profile.' });
          return;
        } finally {
          setSaving(false);
        }
      }
      setNotice({ type: 'error', text: error.message || 'Could not save profile.' });
    } finally { setSaving(false); }
  };

  const updateSetting = (key, value) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    if (key === 'darkTheme') document.documentElement.classList.toggle('dark', value);
  };

  const saveSettings = async () => {
    if (!user) return;
    setSaving(true);
    setNotice({ type: '', text: '' });
    const { error } = await supabase
      .from('delivery_profiles')
      .update({ settings })
      .eq('user_id', user.id);
    if (error) {
      setNotice({ type: 'error', text: `Could not save settings: ${error.message}` });
    } else {
      setNotice({ type: 'success', text: 'App settings saved successfully.' });
    }
    setSaving(false);
  };

  const referralLink = `${window.location.origin}/delivery/signup?ref=${referralCode}`;
  const copyReferralLink = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(referralLink);
      } else {
        const input = document.createElement('textarea');
        input.value = referralLink;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        input.remove();
      }
      setReferralMessage('Referral link copied!');
    } catch (error) {
      setReferralMessage(`Copy failed. Link: ${referralLink}`);
    }
    window.setTimeout(() => setReferralMessage(''), 2200);
  };

  const shareReferralLink = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join SuperCart Delivery', text: 'Refer a friend and earn', url: referralLink });
        setReferralMessage('Referral link shared!');
      } catch (error) {
        if (error?.name !== 'AbortError') await copyReferralLink();
      }
    } else {
      await copyReferralLink();
    }
  };

  const logout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      setNotice({ type: 'error', text: error.message || 'Could not log out.' });
      return;
    }
    navigate('/delivery/login', { replace: true });
  };

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-emerald-300"><LoaderCircle className="h-6 w-6 animate-spin" /></div>;

  return <div className="min-h-screen bg-slate-950 px-4 py-8 text-white sm:px-8"><div className="mx-auto max-w-4xl">
    <header className="mb-8 flex flex-wrap items-center justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-emerald-400">SuperCart Delivery</p><h1 className="mt-2 text-3xl font-black">Delivery Profile</h1></div><div className="flex flex-wrap items-center gap-2"><Link to="/delivery" className="flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-slate-300 hover:border-emerald-500 hover:text-white"><ArrowLeft className="h-4 w-4" /> Back to orders</Link><button type="button" onClick={logout} className="flex items-center gap-2 rounded-xl border border-rose-800 bg-rose-950/40 px-3 py-2 text-sm font-bold text-rose-300 hover:bg-rose-900 hover:text-white"><LogOut className="h-4 w-4" /> Logout</button></div></header>
    {notice.text && <div className={`mb-5 flex items-center gap-2 rounded-xl p-3 text-sm font-bold ${notice.type === 'error' ? 'bg-rose-950 text-rose-300' : 'bg-emerald-950 text-emerald-300'}`}>{notice.type === 'success' && <CheckCircle2 className="h-4 w-4" />}{notice.text}</div>}
    <AccordionSection id="activity" title="Activity & Earnings" icon={Wallet} openSection={openSection} setOpenSection={setOpenSection}>
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {[
        { key: 'gigs', label: 'Gigs History', value: activity.gigs, icon: BriefcaseBusiness, text: 'Extra tasks completed' },
        { key: 'trips', label: 'Trips History', value: activity.trips, icon: Route, text: 'Orders delivered' },
        { key: 'offers', label: 'Offers', value: activity.offers, icon: Gift, text: 'Active incentives' },
      ].map(({ key, label, value, icon: CardIcon, text }) => (
        <Link key={key} to={`/delivery/activity/${key}`} className="group rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-500 hover:bg-slate-800">
          <div className="flex items-center justify-between"><div className="rounded-xl bg-emerald-500/15 p-2.5 text-emerald-400"><CardIcon className="h-5 w-5" /></div><span className="text-2xl font-black text-white">{value}</span></div>
          <h2 className="mt-4 text-sm font-black text-white">{label}</h2><p className="mt-1 text-xs text-slate-400">{text}</p>
        </Link>
      ))}
    </section>
    </AccordionSection>
    <AccordionSection id="referrals" title="Referral Rewards" icon={Gift} accent openSection={openSection} setOpenSection={setOpenSection}>
    <section className="mb-6 rounded-2xl border border-emerald-700/60 bg-gradient-to-r from-emerald-950 to-slate-900 p-5 sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">Referral rewards</p>
          <h2 className="mt-2 text-xl font-black sm:text-2xl">Refer a friend and earn</h2>
          <p className="mt-1 text-sm text-slate-300">Share your code and track your referral bonus.</p>
        </div>
        <div className="w-full max-w-md">
          <div className="flex items-center gap-2 rounded-xl border border-emerald-700 bg-slate-950/70 p-2">
            <span className="min-w-0 flex-1 truncate px-2 text-sm font-black tracking-widest text-emerald-300">{referralCode}</span>
            <button type="button" onClick={copyReferralLink} className="flex min-h-10 items-center gap-1.5 rounded-lg bg-slate-700 px-3 text-xs font-bold text-white hover:bg-slate-600"><Copy className="h-4 w-4" /> Copy</button>
            <button type="button" onClick={shareReferralLink} className="flex min-h-10 items-center gap-1.5 rounded-lg bg-emerald-500 px-3 text-xs font-black text-slate-950 hover:bg-emerald-400"><Share2 className="h-4 w-4" /> Share</button>
          </div>
          {referralMessage && <p className="mt-2 text-xs font-bold text-emerald-300">{referralMessage}</p>}
        </div>
      </div>
    </section>
    </AccordionSection>
    <AccordionSection id="support" title="Support" icon={Headphones} openSection={openSection} setOpenSection={setOpenSection}>
    <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
      <div className="mb-4"><p className="text-xs font-bold uppercase tracking-widest text-emerald-400">Support</p><h2 className="mt-1 text-xl font-black">Need help?</h2></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Link to="/delivery/help" className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-800 p-4 transition hover:border-emerald-500"><CircleHelp className="h-6 w-6 text-emerald-400" /><div><h3 className="font-black">Help Center</h3><p className="mt-1 text-xs text-slate-400">FAQs and quick answers</p></div></Link>
        <Link to="/delivery/support-tickets" className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-800 p-4 transition hover:border-emerald-500"><TicketCheck className="h-6 w-6 text-emerald-400" /><div><h3 className="font-black">Support Tickets</h3><p className="mt-1 text-xs text-slate-400">Raise and track an issue</p></div></Link>
        <Link to="/delivery/complaints" className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-800 p-4 transition hover:border-emerald-500"><Flag className="h-6 w-6 text-emerald-400" /><div><h3 className="font-black">Raise a Complaint</h3><p className="mt-1 text-xs text-slate-400">Grievance with photo proof</p></div></Link>
      </div>
    </section>
    </AccordionSection>
    <AccordionSection id="settings" title="App Settings" icon={Settings} openSection={openSection} setOpenSection={setOpenSection}>
    <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
      <div className="mb-5"><p className="text-xs font-bold uppercase tracking-widest text-emerald-400">Preferences</p><h2 className="mt-1 text-xl font-black">App Settings</h2><p className="mt-1 text-xs text-slate-400">Choose how the delivery app communicates with you.</p></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex min-h-12 items-center justify-between rounded-xl border border-slate-700 bg-slate-800 p-3 text-sm font-bold"><span>Dark Theme</span><button type="button" role="switch" aria-checked={settings.darkTheme} onClick={() => updateSetting('darkTheme', !settings.darkTheme)} className={`relative h-6 w-11 rounded-full transition ${settings.darkTheme ? 'bg-emerald-500' : 'bg-slate-600'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${settings.darkTheme ? 'left-6' : 'left-1'}`} /></button></label>
        {[
          ['appLanguage', 'App Language', ['English']],
          ['audioLanguage', 'Audio Language', ['English']],
          ['supportLanguage', 'Support Language', ['English']],
          ['orderAlertSound', 'Order Alert Sound', ['Default', 'Chime', 'Bell', 'Vibrate only']],
        ].map(([key, label, options]) => (
          <label key={key} className="rounded-xl border border-slate-700 bg-slate-800 p-3 text-sm font-bold">{label}<select value={settings[key]} onChange={(event) => updateSetting(key, event.target.value)} className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm font-normal text-white outline-none focus:border-emerald-500">{options.map((option) => <option key={option}>{option}</option>)}</select></label>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={saveSettings} disabled={saving} className="rounded-xl bg-emerald-500 px-4 py-3 text-sm font-black text-slate-950 hover:bg-emerald-400 disabled:opacity-60">Save App Settings</button>
        <p className="text-xs text-slate-400">Settings will be saved in the Supabase <code className="text-emerald-300">settings</code> JSON column.</p>
      </div>
    </section>
    </AccordionSection>
    <form onSubmit={saveProfile} className="space-y-6">
      <AccordionSection id="personal" title="Personal Details" icon={UserRound} openSection={openSection} setOpenSection={setOpenSection}>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6"><div className="mb-5 flex items-center gap-3"><UserRound className="h-5 w-5 text-emerald-400" /><div><h2 className="font-black">Personal details</h2><p className="text-xs text-slate-400">Keep your delivery partner information current.</p></div></div><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold text-slate-300">Name<input name="name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={inputClass} /></label><label className="text-xs font-bold text-slate-300">Email<input type="email" name="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className={inputClass} /></label><label className="text-xs font-bold text-slate-300">Phone Number<input required name="phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className={inputClass} /></label><label className="text-xs font-bold text-slate-300">Profile Photo<input type="file" accept="image/*" onChange={choosePhoto} className="mt-1.5 block w-full text-xs text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-500 file:px-3 file:py-2 file:font-bold file:text-slate-950" /></label></div>{profilePhotoPreview && <SignedDocImage stored={profilePhotoPreview} alt="Profile preview" className="mt-5 h-24 w-24 rounded-2xl border border-slate-700 object-cover" placeholderClassName="mt-5 flex h-24 w-24 items-center justify-center rounded-2xl border border-slate-700" />}</section>
      </AccordionSection>
      {/* Home Area step SIRF pehli-baari setup me — approve ke baad wale Profile page par hidden */}
      {isFirstSetup && (
      <AccordionSection id="home-area" title="Your Area / Home Store" icon={MapPin} openSection={openSection} setOpenSection={setOpenSection}>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
        <div className="mb-4 flex items-start gap-3">
          <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
          <div>
            <h2 className="font-black">Pin Your Area / Location *</h2>
            <p className="mt-1 text-xs text-slate-400">
              Pin your area on the map — the system will automatically find the nearest store and
              set it as your <b className="text-emerald-300">Home Store</b>. You don't need to select anything.
              (A store within {HOME_SERVICE_RADIUS_KM}km is required.)
            </p>
          </div>
        </div>
        {existingHomeStore && !homeStore && (
          <p className="mb-3 rounded-xl bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200">
            Your Home Store: <span className="text-emerald-300">{existingHomeStore.store_name || `Store #${existingHomeStore.id}`}</span>
            <span className="font-normal text-slate-400"> (to change it, pin again below)</span>
          </p>
        )}
        {MAPBOX_TOKEN ? (
          <StoreMapPicker
            latitude={homeCoords.lat}
            longitude={homeCoords.lng}
            onPick={onHomePick}
          />
        ) : (
          <div className="space-y-3">
            <button
              type="button"
              onClick={useGpsForHome}
              disabled={homeGpsLoading}
              className="flex min-h-[44px] items-center gap-2 rounded-xl bg-slate-800 px-4 text-xs font-black text-emerald-300 transition hover:bg-slate-700 disabled:opacity-60"
            >
              {homeGpsLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}
              {homeGpsLoading ? 'Locating...' : 'Use my current location'}
            </button>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-bold text-slate-300">
                Latitude
                <input inputMode="decimal" value={homeCoords.lat} onChange={(e) => onHomeManualCoords('lat', e.target.value)} placeholder="28.613900" className={inputClass} />
              </label>
              <label className="text-xs font-bold text-slate-300">
                Longitude
                <input inputMode="decimal" value={homeCoords.lng} onChange={(e) => onHomeManualCoords('lng', e.target.value)} placeholder="77.209000" className={inputClass} />
              </label>
            </div>
          </div>
        )}
        {homeResolving && (
          <p className="mt-3 flex items-center gap-2 text-xs font-bold text-slate-300">
            <LoaderCircle className="h-4 w-4 animate-spin text-emerald-400" /> Finding the nearest store...
          </p>
        )}
        {homeMsg.text && (
          <div className={`mt-3 rounded-xl p-3 text-xs font-bold ${homeMsg.type === 'error' ? 'bg-rose-950 text-rose-300' : 'bg-emerald-950 text-emerald-300'}`}>
            {homeMsg.text}
          </div>
        )}
        {homeStore && (
          <div className="mt-3 rounded-xl border border-emerald-700/60 bg-emerald-950/40 p-3">
            <p className="text-[10px] font-black uppercase tracking-wider text-emerald-300">Home Store (automatic — you don't need to select anything)</p>
            <p className="mt-1 text-sm font-black text-white">{homeStore.store_name}</p>
            {homeStore.address && <p className="mt-0.5 text-xs text-slate-300">{homeStore.address}</p>}
            <p className="mt-1 text-xs font-bold text-emerald-300">~{homeStore.km.toFixed(1)} km from your pin</p>
          </div>
        )}
      </section>
      </AccordionSection>
      )}
      <AccordionSection id="documents" title="Documents" icon={FileText} openSection={openSection} setOpenSection={setOpenSection}>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
        <div className="mb-5 flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
          <div>
            <h2 className="font-black">Documents</h2>
            <p className="mt-1 text-xs text-slate-400">Upload your Aadhar, driving license and PAN securely to Supabase Storage.</p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {documents.map((document) => {
            const selected = files[document.key];
            const url = previews[document.key] || savedFiles[document.key];
            return (
              <div key={document.key} className="rounded-xl border border-slate-700 bg-slate-800 p-4">
                <div className="flex items-center justify-between gap-2">
                  <FileText className="h-5 w-5 text-emerald-400" />
                  {(selected || url) && <span className="rounded-full bg-emerald-950 px-2 py-1 text-[10px] font-black uppercase text-emerald-300">{selected ? 'Ready to save' : 'Uploaded'}</span>}
                </div>
                <h3 className="mt-3 text-sm font-black">{document.label}</h3>
                <p className="mt-1 text-[11px] text-slate-400">JPG, PNG or PDF</p>
                <label className="mt-4 flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-slate-700 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-emerald-600 hover:text-slate-950">
                  <Upload className="h-3.5 w-3.5" />{selected || url ? 'Replace document' : 'Upload document'}
                  <input type="file" accept={document.accept} onChange={(event) => chooseDocument(document.key, event)} className="hidden" />
                </label>
                {selected && <p className="mt-3 truncate text-[11px] text-emerald-300" title={selected.name}>{selected.name} — click Save Profile</p>}
                {!selected && url && (
                  <SignedDocLink stored={url} className="mt-3 block truncate text-[11px] font-bold text-emerald-300 hover:underline">
                    View uploaded {document.label}
                  </SignedDocLink>
                )}
                {url?.match(/\.(png|jpe?g|webp)(\?|$)/i) && (
                  <SignedDocImage
                    stored={url}
                    alt={`${document.label} preview`}
                    className="mt-3 h-20 w-full rounded-lg object-cover"
                    placeholderClassName="mt-3 flex h-20 w-full items-center justify-center rounded-lg bg-slate-700/50"
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>
      </AccordionSection>
      <button type="submit" disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3.5 text-sm font-black text-slate-950 hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60"><Save className="h-4 w-4" />{saving ? 'Saving profile...' : 'Save Profile'}</button>
    </form>
  </div></div>;
};

export default DeliveryProfile;
