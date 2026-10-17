import React, { useState } from 'react';
import { ScanBarcode } from 'lucide-react';
import BarcodeScannerModal from './BarcodeScannerModal';

/**
 * BarcodeField — Product Add/Edit forms ke liye reusable field:
 * - Text input: barcode number manually type kar sakte hain
 * - "Scan Barcode" button: camera se scan (Code128 / EAN-13 ...)
 * Value format: plain string (products.barcode_number). Optional field hai.
 */
const BarcodeField = ({ value = '', onChange, disabled = false, className = '' }) => {
  const [scanning, setScanning] = useState(false);

  return (
    <div className={`sm:col-span-2 ${className}`}>
      <label className="text-xs font-bold text-slate-400">
        🏷️ Barcode Number <span className="font-semibold text-slate-500">(Product verification ke liye — optional)</span>
        <div className="mt-1.5 flex items-stretch gap-2">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            disabled={disabled}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Scan karo ya number type karo (e.g. 8901234567890)"
            className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-500 disabled:opacity-60"
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => setScanning(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-emerald-600 bg-emerald-950/60 px-3.5 text-xs font-black text-emerald-300 transition hover:bg-emerald-900/60 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ScanBarcode className="h-4 w-4" />
            Scan Barcode
          </button>
        </div>
      </label>

      {scanning && (
        <BarcodeScannerModal
          title="Scan Barcode"
          hint="Product packet ka lamba barcode (Code128 / EAN-13) camera ke saamne rakho."
          onDetected={(text) => {
            onChange(text);
            setScanning(false);
          }}
          onClose={() => setScanning(false)}
        />
      )}
    </div>
  );
};

export default BarcodeField;
