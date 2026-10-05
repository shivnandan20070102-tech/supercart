// Real-time stock — client helpers (pure + Supabase read/guard).
//
// - ProductCard/Home/Cart me stock display + gating ke liye.
// - Decrement ka single source of truth SERVER hai (createOrder me atomic
//   reserve). Ye file sirf READ + pre-check karti hai, taaki double-cut na ho.
// - Sirf exception: backend-down supabase_direct fallback (api.js) — wahan
//   best-effort guarded decrement isi file se hota hai.

export const LOW_STOCK_AT = 5;

const numOrNull = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// DB row ya normalized product se available qty (null = unknown/legacy).
export const stockOf = (p) => {
  if (!p || typeof p !== 'object') return null;
  const s = numOrNull(p.stock ?? p.stock_quantity ?? p.qty);
  return s == null ? null : Math.max(0, Math.floor(s));
};

export const isOutOfStock = (p) => {
  if (!p || typeof p !== 'object') return false;
  if (p.in_stock === false || p.inStock === false || p.inStock === 'false') return true;
  const s = stockOf(p);
  return s != null && s <= 0;
};

export const stockLabel = (p) => {
  if (isOutOfStock(p)) return 'Out of Stock';
  const s = stockOf(p);
  if (s == null) return '';
  if (s <= LOW_STOCK_AT) return `Only ${s} left`;
  return `In Stock (${s})`;
};

// Stepper/ADD cap — stock pata ho to usse zyada mat badhao.
export const capQuantity = (wanted, product) => {
  const w = Math.max(1, Math.floor(Number(wanted) || 1));
  const s = stockOf(product);
  if (s == null) return w;
  return Math.max(1, Math.min(w, Math.max(1, s)));
};

// Cart (id/qty snapshot) vs fresh DB rows -> short list.
export const validateCartStock = (cartItems, stockRows) => {
  const byId = new Map();
  for (const r of stockRows || []) {
    const id = r?.id;
    if (id != null) byId.set(String(id), r);
  }
  const problems = [];
  for (const item of cartItems || []) {
    const row = byId.get(String(item?.id));
    if (!row) continue; // legacy/seed product ya row missing — block mat karo
    const available = Math.max(0, Math.floor(Number(row.stock ?? 0) || 0));
    const flaggedOut = row.in_stock === false;
    const need = Math.max(1, Math.floor(Number(item?.quantity) || 1));
    if (flaggedOut || available <= 0 || available < need) {
      problems.push({
        id: item.id,
        name: item.name || row.name || `Product #${item.id}`,
        requested: need,
        available,
      });
    }
  }
  return problems;
};

// Fresh stock map — checkout se pehle + realtime refresh ke liye.
export const fetchStockMap = async (supabase, ids) => {
  const list = [...new Set((ids || []).filter((v) => v != null && String(v).trim() !== '' && !Number.isNaN(Number(v)) && Number(v) > 0).map((v) => Number(v)))];
  if (list.length === 0) return [];
  const { data, error } = await supabase.from('products').select('id,name,stock,in_stock').in('id', list);
  if (error) throw error;
  return data || [];
};

// Backend-down fallback (api.js supabase_direct): guarded best-effort cut.
// RPC mile to atomic, warna gte-guarded update. Fail ho to {ok:false}.
export const decrementStockDirect = async (supabase, items) => {
  const norm = [];
  const seen = new Map();
  for (const it of items || []) {
    const raw = it?.productId ?? it?.product_id ?? it?.id;
    const n = Number(raw);
    const qty = Math.floor(Number(it?.quantity ?? it?.qty) || 0);
    if (!Number.isInteger(n) || n <= 0 || qty <= 0) continue;
    const prev = seen.get(n) || 0;
    seen.set(n, prev + qty);
  }
  for (const [dbId, qty] of seen) norm.push({ dbId, qty });
  if (norm.length === 0) return { ok: true, skipped: true };

  const reserved = [];
  for (const { dbId, qty } of norm) {
    let done = false;
    try {
      const { data, error } = await supabase.rpc('decrement_product_stock', { p_product_id: dbId, p_qty: qty });
      if (!error) {
        const row = Array.isArray(data) ? data[0] : data;
        if (row?.success === true) {
          reserved.push({ dbId, qty });
          done = true;
        } else {
          return { ok: false, shortId: dbId, available: row?.remaining ?? 0 };
        }
      }
    } catch { /* fallback neeche */ }
    if (done) continue;
    // Fallback: gte-guarded update (migration pending / RPC blocked).
    try {
      const { data: cur } = await supabase.from('products').select('id,stock').eq('id', dbId).maybeSingle();
      if (!cur) continue; // legacy row
      const available = Math.max(0, Math.floor(Number(cur.stock ?? 0) || 0));
      if (available < qty) return { ok: false, shortId: dbId, available };
      const { data: updated } = await supabase
        .from('products')
        .update({ stock: available - qty })
        .eq('id', dbId)
        .gte('stock', qty)
        .select('id');
      if (!updated || updated.length === 0) return { ok: false, shortId: dbId, available: 0 };
      reserved.push({ dbId, qty });
    } catch {
      return { ok: false, shortId: dbId, available: 0 };
    }
  }
  return { ok: true, reserved };
};
