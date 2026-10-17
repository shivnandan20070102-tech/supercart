// Barcode verification — pure helpers (Node-testable).
//
// Product ka `barcode_number` (products table) vs scan kiya hua code match
// karta hai ya nahi. Code128 / EAN-13 / UPC-A sab plain text digits/letters
// hote hain — normalize karke compare karte hain.
//
// UPC-A (12 digit) scanners aksar EAN-13 (13 digit, aage 0 laga kar) dete
// hain — isliye digits ko leading-zero pad karke bhi compare karte hain.

// Trim + andar ke spaces hata do (kuch scanners beech me space dete hain).
export const normalizeBarcode = (value) =>
  String(value ?? '').replace(/\s+/g, '').trim();

export const barcodesMatch = (scanned, expected) => {
  const a = normalizeBarcode(scanned);
  const b = normalizeBarcode(expected);
  if (!a || !b) return false;
  if (a === b) return true;
  // GTIN quirk: UPC-A <-> EAN-13 (leading zero) — dono digits ho to pad karke dekho.
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    const max = Math.max(a.length, b.length);
    return a.padStart(max, '0') === b.padStart(max, '0');
  }
  return false;
};

export default { normalizeBarcode, barcodesMatch };
