import React, { useEffect, useState } from 'react';
import { Camera, CheckCircle2, MapPin, Mic, X } from 'lucide-react';

const DISMISS_KEY = 'supercart_permission_notice_dismissed';

const permissionState = async (name) => {
  if (!navigator.permissions?.query) return 'default';
  try {
    const result = await navigator.permissions.query({ name });
    return result.state;
  } catch {
    return 'default';
  }
};

const PermissionNotice = () => {
  const [visible, setVisible] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) !== '1';
    } catch {
      return true;
    }
  });
  const [states, setStates] = useState({ geolocation: 'default', camera: 'default', microphone: 'default' });
  const [working, setWorking] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([
      permissionState('geolocation'),
      permissionState('camera'),
      permissionState('microphone'),
    ]).then(([geolocation, camera, microphone]) => {
      if (active) setStates({ geolocation, camera, microphone });
    });
    return () => {
      active = false;
    };
  }, []);

  const request = async (type) => {
    setWorking(type);
    try {
      if (type === 'geolocation') {
        await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 }));
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({ [type === 'camera' ? 'video' : 'audio']: true });
        stream.getTracks().forEach((track) => track.stop());
      }
      setStates((current) => ({ ...current, [type]: 'granted' }));
    } catch {
      setStates((current) => ({ ...current, [type]: 'denied' }));
    } finally {
      setWorking('');
    }
  };

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  if (!visible) return null;

  const items = [
    { key: 'geolocation', label: 'Location', icon: MapPin, text: 'Delivery address and nearest store' },
    { key: 'camera', label: 'Camera', icon: Camera, text: 'Barcode scanning' },
    { key: 'microphone', label: 'Microphone', icon: Mic, text: 'Voice search' },
  ];

  return (
    <div role="status" aria-live="polite" className="fixed left-1/2 top-4 z-[85] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 rounded-2xl border border-emerald-200 bg-white p-4 shadow-2xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-slate-900">Allow permissions for SuperCart</p>
          <p className="mt-1 text-xs font-semibold text-slate-500">Enable these only when you want to use the related feature.</p>
        </div>
        <button type="button" onClick={dismiss} aria-label="Close permissions notice" className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {items.map(({ key, label, icon: Icon, text }) => {
          const granted = states[key] === 'granted';
          return (
            <button key={key} type="button" onClick={() => request(key)} disabled={working === key || granted} className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-left transition hover:border-emerald-400 disabled:cursor-default disabled:opacity-70">
              <span className="flex items-center gap-1.5 text-xs font-black text-slate-800">{granted ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Icon className="h-4 w-4 text-emerald-600" />}{working === key ? 'Allowing…' : granted ? `${label} allowed` : `Allow ${label}`}</span>
              <span className="mt-1 block text-[10px] font-semibold text-slate-500">{text}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[10px] font-semibold text-slate-400">If blocked, tap the browser lock icon → Site settings → Allow, then try again.</p>
    </div>
  );
};

export default PermissionNotice;
