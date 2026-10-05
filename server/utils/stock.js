// Real-time stock helpers — order create ke waqt atomic reserve/release.
//
// Design:
// - Sirf numeric DB ids (BIGSERIAL) par stock enforce hota hai. Seed/mock ids
//   ('p1', uuid, ...) DB me nahi hain — unhe skip karo (order na toote).
// - Pehle decrement_product_stock RPC (atomic single-statement UPDATE ...
//   WHERE stock >= qty). Concurrent orders me sirf ek jeetega, stock kabhi
//   negative nahi hoga.
// - Migration abhi run na hui ho to fallback: gte-guarded direct update
//   (best-effort, phir bhi race me loser ko 0 rows milte hain).
// - Koi item insufficient ho to pehle reserve ki hui qty wapas karo.

const toDbId = (raw) => {
  if (raw == null || raw === '') return null;
  // '12', 12 -> 12 | 'p1', uuid, 'abc' -> null (non-DB product, skip)
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
};

const toQty = (raw) => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return 0;
  return n;
};

// order_items JSONB snapshot ke alag-alag shapes:
// {productId} (client), {product_id}, {id} — sab support karo.
export const normalizeStockItems = (items) => {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const rawId = it.productId ?? it.product_id ?? it.id ?? null;
    const qty = toQty(it.quantity ?? it.qty);
    if (!qty) continue;
    out.push({
      productId: rawId,
      dbId: toDbId(rawId),
      qty,
      name: String(it.name || `Product #${rawId ?? '?'}`),
    });
  }
  // Same product do baar aaye to merge karo (double-decrement ban).
  const merged = new Map();
  for (const e of out) {
    const key = e.dbId != null ? `db:${e.dbId}` : `raw:${String(e.productId)}`;
    const prev = merged.get(key);
    if (prev) prev.qty += e.qty;
    else merged.set(key, { ...e });
  }
  return [...merged.values()];
};

// Pure check — DB read ke baad: kaunsi line me kitna kam hai.
export const findInsufficient = (stockById, normalized) => {
  const short = [];
  for (const e of normalized) {
    if (e.dbId == null) continue; // non-DB product — no stock concept
    const row = stockById.get(e.dbId);
    if (!row) continue; // product DB me nahi (legacy) — block mat karo
    const available = Number(row.stock ?? 0);
    const flaggedOut = row.in_stock === false;
    if (flaggedOut || available <= 0 || available < e.qty) {
      short.push({ dbId: e.dbId, name: e.name, requested: e.qty, available: Math.max(0, available) });
    }
  }
  return short;
};

const readRpcResult = (data) => {
  const row = Array.isArray(data) ? data[0] : data;
  return { success: row?.success === true, remaining: row?.remaining ?? null };
};

const isMissingRpc = (err) => {
  const msg = String(err?.message || err || '');
  return /function|does not exist|42883|PGRST202/i.test(msg);
};

// Single product atomic decrement (RPC preferred, guarded-update fallback).
const decrementOne = async (supabase, dbId, qty) => {
  try {
    const { data, error } = await supabase.rpc('decrement_product_stock', {
      p_product_id: dbId,
      p_qty: qty,
    });
    if (!error) {
      const r = readRpcResult(data);
      return { ok: r.success, missingRpc: false, remaining: r.remaining };
    }
    if (!isMissingRpc(error)) return { ok: false, missingRpc: false, error };
    // else fall through to guarded update
  } catch (e) {
    if (!isMissingRpc(e)) return { ok: false, missingRpc: false, error: e };
  }

  // Fallback (migration pending): current padho, gte-guard ke saath likho.
  try {
    const { data: cur, error: readErr } = await supabase
      .from('products')
      .select('id,stock')
      .eq('id', dbId)
      .maybeSingle();
    if (readErr) return { ok: false, missingRpc: true, error: readErr };
    if (!cur) return { ok: true, missingRpc: true, skipped: true }; // legacy row
    const available = Number(cur.stock ?? 0);
    if (available < qty) return { ok: false, missingRpc: true, remaining: available };
    const next = available - qty;
    const { data: updated, error: updErr } = await supabase
      .from('products')
      .update({ stock: next })
      .eq('id', dbId)
      .gte('stock', qty)
      .select('id,stock');
    if (updErr) return { ok: false, missingRpc: true, error: updErr };
    if (!updated || updated.length === 0) {
      // Race haar gaye — kisi aur ne beech me stock le liya.
      return { ok: false, missingRpc: true, raced: true, remaining: 0 };
    }
    return { ok: true, missingRpc: true, remaining: next };
  } catch (e) {
    return { ok: false, missingRpc: true, error: e };
  }
};

const incrementOne = async (supabase, dbId, qty) => {
  try {
    const { error } = await supabase.rpc('increment_product_stock', {
      p_product_id: dbId,
      p_qty: qty,
    });
    if (!error) return;
  } catch { /* fallback neeche */ }
  try {
    const { data: cur } = await supabase.from('products').select('id,stock').eq('id', dbId).maybeSingle();
    if (!cur) return;
    await supabase.from('products').update({ stock: Number(cur.stock ?? 0) + qty }).eq('id', dbId);
  } catch { /* best-effort */ }
};

// Poore order ki stock reserve karo. Fail ho to reserved wapas + short list.
export const reserveStockForOrder = async (supabase, items) => {
  const normalized = normalizeStockItems(items).filter((e) => e.dbId != null);
  if (normalized.length === 0) return { ok: true, reserved: [], insufficient: [] };

  // Friendly error ke liye naam + stock ek saath lao (single query).
  let stockById = new Map();
  let nameById = new Map();
  try {
    const { data: rows } = await supabase
      .from('products')
      .select('id,name,stock,in_stock')
      .in('id', normalized.map((e) => e.dbId));
    for (const r of rows || []) {
      stockById.set(Number(r.id), r);
      if (r?.name) nameById.set(Number(r.id), r.name);
    }
  } catch { /* decrement step khud handle karega */ }

  const reserved = [];
  for (const e of normalized) {
    const label = nameById.get(e.dbId) || e.name;
    const r = await decrementOne(supabase, e.dbId, e.qty);
    if (r.ok) {
      reserved.push({ dbId: e.dbId, qty: e.qty });
      continue;
    }
    // Rollback: ab tak reserve hua wapas karo, phir 409-worthy short list do.
    await releaseStockReservation(supabase, reserved);
    let available = null;
    try {
      const { data: cur } = await supabase.from('products').select('stock').eq('id', e.dbId).maybeSingle();
      available = cur ? Math.max(0, Number(cur.stock ?? 0)) : 0;
    } catch { available = stockById.get(e.dbId) ? Math.max(0, Number(stockById.get(e.dbId).stock ?? 0)) : 0; }
    return {
      ok: false,
      reserved: [],
      insufficient: [{ dbId: e.dbId, name: label, requested: e.qty, available: available ?? 0 }],
    };
  }
  return { ok: true, reserved, insufficient: [] };
};

export const releaseStockReservation = async (supabase, reserved) => {
  if (!Array.isArray(reserved) || reserved.length === 0) return;
  for (const r of reserved) {
    try {
      await incrementOne(supabase, r.dbId, r.qty);
    } catch { /* best-effort */ }
  }
};
