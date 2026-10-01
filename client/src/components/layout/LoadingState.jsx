import React from 'react';
import { LoaderCircle, Wifi } from 'lucide-react';

const LoadingState = ({ label = 'Loading your SuperCart...' }) => (
  <div className="flex flex-col items-center justify-center gap-3 py-10 text-center" role="status" aria-live="polite">
    <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 shadow-inner">
      <span className="absolute inset-0 animate-ping rounded-2xl bg-emerald-200/50" />
      <LoaderCircle className="relative h-7 w-7 animate-spin" />
    </div>
    <div>
      <p className="text-sm font-black text-slate-800">{label}</p>
      <div className="mt-2 flex justify-center gap-1">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-500" />
      </div>
    </div>
  </div>
);

export const OfflineNotice = () => (
  <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
    <Wifi className="h-3.5 w-3.5 text-amber-500" /> Slow connection — continuing with the local catalog.
  </p>
);

export default LoadingState;