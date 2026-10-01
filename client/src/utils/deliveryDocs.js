import { useEffect, useState } from 'react';
import { supabase } from '../config/supabase';

// Delivery documents (private bucket) ke liye Signed URLs.
// - Public URLs ab kaam nahi karti (bucket private) — display ke liye
//   1 ghante valid temporary link mint karo (DB me saved public-style
//   URL se path nikal kar; DB format change NAHI hota).
// - Blob/data URLs (nayi upload ke local preview) waise hi pass-through.

const BUCKET = 'delivery-documents';
const EXPIRES_IN = 3600; // 1 ghanta
const CACHE_TTL_MS = 55 * 60 * 1000; // 55 min (expiry se pehle reuse)

const cache = new Map(); // storage path -> { url, exp }

/**
 * Stored value (public-style URL ya raw path) se storage path nikalo.
 * Signed (/object/sign/...) aur public (/object/public/...) dono formats chalte hain.
 * Non-storage http(s) URL ho to null (jaisa hai waisa use karo).
 */
export const docPathFromStored = (stored) => {
  if (!stored || typeof stored !== 'string') return null;
  if (stored.startsWith('blob:') || stored.startsWith('data:')) return null;
  const marker = `/${BUCKET}/`;
  const idx = stored.indexOf(marker);
  if (idx >= 0) {
    const path = stored.slice(idx + marker.length).split('?')[0].replace(/^\/+/, '');
    return path || null;
  }
  return null;
};

/**
 * Display-ready URL: blob/data passthrough, storage path → signed URL (cached).
 * Rejects (RLS/expired) par throw — caller placeholder dikhaye.
 */
export const signedDocUrl = async (stored, expiresIn = EXPIRES_IN) => {
  if (!stored || typeof stored !== 'string') return '';
  if (stored.startsWith('blob:') || stored.startsWith('data:')) return stored;
  const path = docPathFromStored(stored);
  // Storage URL nahi (external link) — jaisa hai waisa.
  if (!path) {
    if (/^https?:\/\//i.test(stored)) return stored;
    return '';
  }
  const now = Date.now();
  const hit = cache.get(path);
  if (hit && hit.exp - now > 60 * 1000) return hit.url;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) throw error || new Error('Could not create signed URL');
  cache.set(path, { url: data.signedUrl, exp: now + expiresIn * 1000 });
  return data.signedUrl;
};

/**
 * Hook: stored value → { url, loading, error }. Stored badalte hi re-resolve.
 */
export const useSignedUrl = (stored) => {
  const [state, setState] = useState({ url: '', loading: Boolean(stored), error: '' });
  useEffect(() => {
    let active = true;
    if (!stored) {
      setState({ url: '', loading: false, error: '' });
      return undefined;
    }
    setState({ url: '', loading: true, error: '' });
    signedDocUrl(stored)
      .then((url) => {
        if (active) setState({ url, loading: false, error: '' });
      })
      .catch((e) => {
        if (active) setState({ url: '', loading: false, error: e?.message || 'Could not load document' });
      });
    return () => {
      active = false;
    };
  }, [stored]);
  return state;
};
