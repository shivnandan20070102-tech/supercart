import React from 'react';
import { useSignedUrl } from '../utils/deliveryDocs';

// Private-bucket documents ke liye display components — hamesha Signed URL
// se load hote hain. Ready hone tak placeholder (kabhi broken image nahi).

export const SignedDocImage = ({ stored, alt = 'Document', className = '', placeholderClassName = '' }) => {
  const { url, loading } = useSignedUrl(stored);
  if (!stored) return null;
  if (!url) {
    return (
      <div className={placeholderClassName || className} aria-label={`${alt} loading`}>
        <span className="text-[11px] font-bold text-slate-500">{loading ? 'Loading…' : 'Unavailable'}</span>
      </div>
    );
  }
  return <img src={url} alt={alt} className={className} loading="lazy" />;
};

export const SignedDocLink = ({ stored, children = 'View document', className = '' }) => {
  const { url, loading, error } = useSignedUrl(stored);
  if (!stored) return null;
  if (!url) {
    return <span className="mt-2 block text-xs font-bold text-slate-500">{loading ? 'Loading…' : error || 'Unavailable'}</span>;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className={className}>
      {children}
    </a>
  );
};

export const SignedDocPreviewButton = ({ stored, label = 'Document', onPreview }) => {
  const { url, loading } = useSignedUrl(stored);
  if (!stored) return null;
  if (!url) {
    return (
      <div className="flex h-28 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-xs font-bold text-slate-500">
        {loading ? 'Loading…' : 'Unavailable'}
      </div>
    );
  }
  return (
    <button type="button" onClick={() => onPreview?.(url)} className="block w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-800 text-left hover:border-emerald-500">
      <img src={url} alt={label} className="h-28 w-full object-cover" loading="lazy" />
      <span className="block p-2 text-[11px] font-bold text-emerald-300">Click to view full size</span>
    </button>
  );
};

export default SignedDocImage;
