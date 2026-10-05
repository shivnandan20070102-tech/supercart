// Store product access — pure helpers (Node-testable).
//
// Rule: manager SIRF apne store(s) ke products manage kare
// (product.store_id uske storeIds me ho). Global (store_id NULL) ya doosre
// store ke products read-only. DB-level RLS (supabase_store_product_policy.sql)
// yehi rule enforce karta hai — ye client-side same rule hai taaki UI pehle
// se sahi dikhe (bypass attempt RLS par fail hoga).

export const canManageProduct = (product, storeIds) => {
  const sid = product?.store_id;
  if (sid == null || sid === '') return false;
  const list = (storeIds || []).map((v) => Number(v)).filter((n) => !Number.isNaN(n));
  return list.includes(Number(sid));
};

// Add/Edit form validate + DB payload banao. GENERATED is_in_stock aur legacy
// mirrors kabhi mat bhejo (DB trigger khud banata hai).
// form: {name, category, unit, price, original_price, description, image,
//        stock_quantity, low_stock_threshold}
// storeId: jis store se link karna hai (manager ka apna — caller verify kare).
// Returns { payload } ya { error }.
export const buildProductPayload = (form, storeId) => {
  const sid = Number(storeId);
  if (!Number.isInteger(sid) || sid <= 0) return { error: 'Please select your store.' };
  const name = String(form?.name || '').trim();
  const category = String(form?.category || '').trim();
  const unit = String(form?.unit || '').trim();
  const description = String(form?.description || '').trim();
  const image = String(form?.image || '').trim();
  if (!name) return { error: 'Product name required.' };
  if (!category) return { error: 'Category required.' };
  if (!unit) return { error: 'Unit required (e.g. 1 kg, 500 ml).' };
  if (!description) return { error: 'Description required.' };
  if (!image) return { error: 'Product image required.' };
  const price = Number(form?.price);
  if (!Number.isFinite(price) || price <= 0) return { error: 'Price must be greater than 0.' };
  const originalRaw = Number(form?.original_price);
  const originalPrice = Number.isFinite(originalRaw) && originalRaw > 0 ? originalRaw : price;
  const sq = Number(form?.stock_quantity);
  const th = Number(form?.low_stock_threshold);
  return {
    payload: {
      name,
      category,
      unit,
      description,
      image,
      price,
      original_price: originalPrice,
      store_id: sid,
      stock_quantity: Number.isFinite(sq) ? Math.max(0, Math.floor(sq)) : 0,
      low_stock_threshold: Number.isFinite(th) ? Math.max(0, Math.floor(th)) : 5,
    },
  };
};
