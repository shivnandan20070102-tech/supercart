import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../config/supabase';

// Inactivity auto-logout — SIRF Admin + Store panels (sensitive data).
// - 20 min tak koi activity (click / keypress / scroll / touch) nahi →
//   1 min pehle warning popup (countdown ke saath).
// - Warning par "Continue" (ya kahin bhi click) → session continue.
// - Uske baad bhi kuch nahi → Supabase logout + login page.
// User/Delivery panels me mount MAT karo (wahan irritating lagega).

const INACTIVITY_LIMIT_MS = 20 * 60 * 1000; // 20 minute
const WARNING_BEFORE_MS = 60 * 1000; // 1 minute pehle warning

const InactivityGuard = ({ loginPath = '/admin/login' }) => {
  const navigate = useNavigate();
  const [showWarning, setShowWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const timersRef = useRef({ warn: null, logout: null, countdown: null });
  const loggingOutRef = useRef(false);
  const scheduleRef = useRef(null);

  const clearTimers = useCallback(() => {
    const t = timersRef.current;
    if (t.warn) window.clearTimeout(t.warn);
    if (t.logout) window.clearTimeout(t.logout);
    if (t.countdown) window.clearInterval(t.countdown);
    t.warn = null;
    t.logout = null;
    t.countdown = null;
  }, []);

  const doLogout = useCallback(async () => {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    clearTimers();
    try {
      await supabase.auth.signOut();
    } catch {
      /* ignore */
    }
    try {
      localStorage.removeItem('supercart_user');
      localStorage.removeItem('supercart_token');
    } catch {
      /* ignore */
    }
    navigate(loginPath, { replace: true });
  }, [clearTimers, loginPath, navigate]);

  // Har activity par timer reset (+ warning khula ho to band = continue)
  useEffect(() => {
    const schedule = () => {
      if (loggingOutRef.current) return;
      clearTimers();
      setShowWarning(false);
      setSecondsLeft(Math.round(WARNING_BEFORE_MS / 1000));
      timersRef.current.warn = window.setTimeout(() => {
        if (loggingOutRef.current) return;
        setShowWarning(true);
        setSecondsLeft(Math.round(WARNING_BEFORE_MS / 1000));
        timersRef.current.countdown = window.setInterval(() => {
          setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
        }, 1000);
        timersRef.current.logout = window.setTimeout(() => {
          doLogout();
        }, WARNING_BEFORE_MS);
      }, INACTIVITY_LIMIT_MS - WARNING_BEFORE_MS);
    };

    const onActivity = () => schedule();
    scheduleRef.current = schedule;
    schedule();
    window.addEventListener('click', onActivity);
    window.addEventListener('keydown', onActivity);
    window.addEventListener('scroll', onActivity, { passive: true });
    window.addEventListener('touchstart', onActivity, { passive: true });
    return () => {
      clearTimers();
      window.removeEventListener('click', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('scroll', onActivity);
      window.removeEventListener('touchstart', onActivity);
    };
  }, [clearTimers, doLogout]);

  // Popup ka button dabao → session continue (timer reset, popup band)
  const continueSession = () => {
    if (loggingOutRef.current) return;
    scheduleRef.current?.();
  };

  if (!showWarning) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4">
      <div role="alertdialog" aria-modal="true" aria-label="Inactivity warning" className="w-full max-w-sm rounded-3xl border border-amber-500/50 bg-slate-900 p-6 text-center shadow-2xl">
        <p className="text-4xl" aria-hidden>⏰</p>
        <h2 className="mt-3 text-lg font-black text-white">Aap inactive hain, 1 minute mein automatically logout ho jayenge</h2>
        <p className="mt-2 text-sm font-black tabular-nums text-amber-300">
          {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
        </p>
        <button
          type="button"
          onClick={continueSession}
          className="mt-5 flex min-h-[48px] w-full items-center justify-center rounded-2xl bg-emerald-500 text-sm font-black text-slate-950 transition hover:bg-emerald-400"
        >
          Continue Session
        </button>
        <button
          type="button"
          onClick={doLogout}
          className="mt-2 min-h-[44px] w-full rounded-2xl text-xs font-black text-slate-400 transition hover:text-white"
        >
          Logout Now
        </button>
      </div>
    </div>
  );
};

export default InactivityGuard;
