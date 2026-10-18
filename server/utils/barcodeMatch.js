// Barcode match helpers (server-side) — client/src/utils/barcodeVerify.js ka
// same logic (Node-testable, koi dependency nahi).
//
// Product ka `barcode_number` (products table) vs store ne scan kiya hua code
// match karta hai ya nahi. Code128 / EAN-13 / UPC-A sab plain text hote hain.
// UPC-A (12 digit) scanners aksar EAN-13 (13 digit, aage 0 laga kar) dete hain —
// isliye digits ko leading-zero pad karke bhi compare karte hain.

export const normalizeBarcode = (value) =>
  String(value ?? '').replace(/\s+/g, '').trim();

export const barcodesMatch = (scanned, expected) => {
  const a = normalizeBarcode(scanned);
  const b = normalizeBarcode(expected);
  if (!a || !b) return false;
  if (a === b) return true;
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    const max = Math.max(a.length, b.length);
    return a.padStart(max, '0') === b.padStart(max, '0');
  }
  return false;
};

// Order item se productId nikalo (multiple legacy shapes supported).
export const itemProductId = (item) => {
  const raw = item?.productId ?? item?.product_id ?? null;
  if (raw == null || String(raw).trim() === '' || Number.isNaN(Number(raw))) return null;
  return Number(raw);
};

export default { normalizeBarcode, barcodesMatch, itemProductId };
