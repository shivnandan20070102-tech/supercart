import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { CameraOff, Loader2, ScanBarcode, X } from 'lucide-react';

// Sirf 1D product barcodes (packet wale lamba barcode) — QR nahi.
// Code128 / EAN-13 / EAN-8 / UPC-A / UPC-E / Code39 / ITF (jaise kurkure,
// dairy, grocery packets par hote hain).
const BARCODE_FORMATS = [
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.ITF,
];

let scannerSeq = 0;

const cameraErrorMessage = (err) => {
  const name = String(err?.name || '');
  const raw = err?.message || '';
  if (name === 'NotAllowedError' || /permission|denied/i.test(raw)) {
    return 'Camera permission blocked hai. Browser ke lock icon → Camera → Allow karo, phir dobara try karo. (Ya number manually type kar lo.)';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || /no camera|not found/i.test(raw)) {
    return 'Is device par camera nahi mila. Number manually type kar lo.';
  }
  if (name === 'NotReadableError' || /in use|busy/i.test(raw)) {
    return 'Camera kisi aur app/tab me use ho raha hai. Wo band karke dobara try karo.';
  }
  return raw || 'Camera start nahi ho paya. Number manually type kar lo.';
};

/**
 * BarcodeScannerModal — Camera se 1D barcode scan karta hai (html5-qrcode).
 * - Single-shot NahI: jab tak band na ho, scan karta rehta hai (retry ke liye).
 * - onDetected(text) har decode par (same code 1.5s ke andar dobara nahi).
 * - Parent match/fail decide karta hai; errorText prop se wahi error yahan dikhta hai.
 */
const BarcodeScannerModal = ({ title = 'Scan Barcode', hint = '', errorText = '', onDetected, onClose }) => {
  const [starting, setStarting] = useState(true);
  const [camError, setCamError] = useState('');
  const [elId] = useState(() => `barcode-reader-${++scannerSeq}`);
  const scannerRef = useRef(null);
  const onDetectedRef = useRef(onDetected);
  const lastHitRef = useRef({ text: '', at: 0 });

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    let cancelled = false;
    let stopped = false;
    const scanner = new Html5Qrcode(elId, {
      formatsToSupport: BARCODE_FORMATS,
      useBarCodeDetectorIfSupported: true,
      verbose: false,
    });
    scannerRef.current = scanner;

    const onScan = (decodedText) => {
      const text = String(decodedText || '').trim();
      if (!text) return;
      const now = Date.now();
      // Same code bar-bar fire hota hai (har frame) — 1.5s me same skip.
      if (lastHitRef.current.text === text && now - lastHitRef.current.at < 1500) return;
      lastHitRef.current = { text, at: now };
      try { onDetectedRef.current?.(text); } catch { /* parent handle karega */ }
    };

    const start = async () => {
      const camConfigs = [{ facingMode: 'environment' }, { facingMode: 'user' }];
      let started = false;
      let lastErr = null;
      for (const cam of camConfigs) {
        try {
          await scanner.start(
            cam,
            {
              fps: 10,
              // Lamba barcode: chaudi patti wala box (QR jaisa square nahi).
              qrbox: (w, h) => ({
                width: Math.max(160, Math.min(Math.floor(w * 0.9), 340)),
                height: Math.max(80, Math.min(Math.floor(h * 0.35), 160)),
              }),
            },
            onScan,
            () => { /* per-frame decode miss — ignore */ },
          );
          started = true;
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      try {
        if (!started) throw lastErr || new Error('Camera start failed');
        if (cancelled) {
          try { await scanner.stop(); scanner.clear(); } catch { /* ignore */ }
          return;
        }
        setStarting(false);
      } catch (err) {
        if (!cancelled) {
          setCamError(cameraErrorMessage(err));
          setStarting(false);
        }
      }
    };
    start();

    return () => {
      cancelled = true;
      if (stopped) return;
      stopped = true;
      const s = scannerRef.current;
      scannerRef.current = null;
      try {
        if (s) {
          s.stop()
            .then(() => { try { s.clear(); } catch { /* ignore */ } })
            .catch(() => { /* not running — clear directly */ try { s.clear(); } catch { /* ignore */ } });
        }
      } catch { /* ignore */ }
    };
  }, [elId]);

  const shownError = camError || errorText;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-black text-white">
            <ScanBarcode className="h-4 w-4 text-emerald-400" />
            {title}
          </p>
          <button type="button" onClick={onClose} aria-label="Close scanner" className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4">
          <div className="relative overflow-hidden rounded-xl bg-black">
            <div id={elId} className="min-h-[220px] w-full [&_video]:w-full [&_video]:rounded-xl" />
            {starting && !camError && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 text-xs font-bold text-slate-200">
                <Loader2 className="h-4 w-4 animate-spin text-emerald-400" /> Camera starting…
              </div>
            )}
          </div>

          <p className="mt-3 text-center text-[11px] font-semibold text-slate-400">
            {hint || 'Packet ka lamba barcode camera ke saamne rakho (10–15 cm door).'}
          </p>

          {shownError && (
            <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-rose-800 bg-rose-950/60 p-3 text-xs font-bold text-rose-200">
              <CameraOff className="mt-0.5 h-4 w-4 shrink-0" />
              {shownError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default BarcodeScannerModal;
