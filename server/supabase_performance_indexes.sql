-- ===================================================
-- SUPERCART PERFORMANCE INDEXES (query speed ke liye)
-- Supabase SQL Editor me ek baar RUN karo (sab migrations ke BAAD).
--
-- Ye script idempotent hai (dobara RUN karna safe hai):
--  - Har index IF NOT EXISTS se banta hai
--  - Har index se pehle column-exists check hai, taaki purane DB
--    (jisme koi migration abhi RUN nahi hua) par error na aaye
--
-- INDEX = kitaab ki vishay-soochi (table of contents) jaisa:
-- bina index ke DB ko poori table scan karni padti hai (slow),
-- index ke saath seedha sahi rows milti hain (fast). Data badhne
-- par farak aur bada dikhta hai. Likhte waqt (INSERT/UPDATE)
-- halka extra cost hota hai, par is app me reads >> writes hain,
-- isliye ye tradeoff sahi hai.
--
-- NOTE (zaroori): aapne "orders.delivery_partner_id" bola tha, lekin
-- is codebase me delivery partner ka column "orders.delivery_boy_id"
-- (TEXT) hai — assign logic, triggers aur delivery dashboard sab isi
-- par chalte hain. Isliye index delivery_boy_id par ban raha hai.
-- ===================================================

-- ---------------------------------------------------
-- 1. ORDERS — sabse zyada query hone wali table
-- ---------------------------------------------------

-- 1a. Har user apne orders dekhta hai (Profile > My Orders,
--     getMyOrdersApi: .eq('user_id', userId)). Bina index ke
--     har request par FULL table scan hota.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'orders'
               AND column_name = 'user_id') THEN
    CREATE INDEX IF NOT EXISTS idx_orders_user_id
      ON public.orders (user_id);
  END IF;
END $$;

-- 1b. Upar wali query hamesha "naye orders pehle"
--     (.order('created_at', DESC)) mangti hai. Ye composite index
--     filter + sorting dono ek saath fast karta hai (extra sort nahi).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'orders'
               AND column_name = 'user_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'orders'
               AND column_name = 'created_at') THEN
    CREATE INDEX IF NOT EXISTS idx_orders_user_created
      ON public.orders (user_id, created_at DESC);
  END IF;
END $$;

-- 1c. Multi-store: har store-manager/dashboard apne store ke orders
--     nikalta hai (.eq('store_id', ...)). Pehle se
--     supabase_multi_store.sql me bana hai — yahan sirf re-confirm
--     (dobara RUN par kuch nahi hoga).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'orders'
               AND column_name = 'store_id') THEN
    CREATE INDEX IF NOT EXISTS idx_orders_store_id
      ON public.orders (store_id);
  END IF;
END $$;

-- 1d. Status par filter har jagah hai: store dashboard
--     (Placed/packed/assigned), 30s pending-assignment worker
--     (sirf 'packed' rows uthata hai), delivery dashboard.
--     Low-cardinality column hai, phir bhi store_id ke saath
--     milkar bahut kaam ka hai (neeche 1e dekho).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'orders'
               AND column_name = 'status') THEN
    CREATE INDEX IF NOT EXISTS idx_orders_status
      ON public.orders (status);
  END IF;
END $$;

-- 1e. COMPOSITE (sabse important): "mere store ke packed orders"
--     jaisi queries (store_id + status dono par filter) ek hi
--     index se resolve hoti hain — store dashboard ki main query.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'orders'
               AND column_name = 'store_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'orders'
               AND column_name = 'status') THEN
    CREATE INDEX IF NOT EXISTS idx_orders_store_status
      ON public.orders (store_id, status);
  END IF;
END $$;

-- 1f. Delivery partner apne assigned orders nikalta hai
--     (.eq('delivery_boy_id', ...)) + auto-assign triggers andar
--     "kiske paas active order hai" (NOT EXISTS subquery) chalate
--     hain — dono isi column par hain. (Naam ka confusion: codebase
--     me column delivery_boy_id hai, delivery_partner_id nahi.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'orders'
               AND column_name = 'delivery_boy_id') THEN
    CREATE INDEX IF NOT EXISTS idx_orders_delivery_boy_id
      ON public.orders (delivery_boy_id);
  END IF;
END $$;

-- 1g. Admin "saare orders, naye pehle" list (.order('created_at', DESC))
--     bina filter ke — sorting fast hoti hai.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'orders'
               AND column_name = 'created_at') THEN
    CREATE INDEX IF NOT EXISTS idx_orders_created
      ON public.orders (created_at DESC);
  END IF;
END $$;

-- ---------------------------------------------------
-- 2. PRODUCTS — Home page ki sabse hot query
-- ---------------------------------------------------

-- 2a. Multi-store: "is store ke products dikhao"
--     (.eq('store_id', ...)). Pehle se multi-store migration me
--     bana hai — yahan re-confirm.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'products'
               AND column_name = 'store_id') THEN
    CREATE INDEX IF NOT EXISTS idx_products_store_id
      ON public.products (store_id);
  END IF;
END $$;

-- 2b. Category filter (Home page chips: Fruits, Dairy...).
--     Imaandaar note: `ilike '%dairy%'` (dono taraf %) me B-Tree
--     index poora kaam nahi karta (trigram/pg_trgm chahiye hota),
--     lekin exact/prefix match + category-wise grouping/sorting me
--     madad karta hai aur future trgm index ki neev hai.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'products'
               AND column_name = 'category') THEN
    CREATE INDEX IF NOT EXISTS idx_products_category
      ON public.products (category);
  END IF;
END $$;

-- 2c. COMPOSITE: Home page ki asli query shape =
--     "SERVING store + selected category" — dono ek index se.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'products'
               AND column_name = 'store_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'products'
               AND column_name = 'category') THEN
    CREATE INDEX IF NOT EXISTS idx_products_store_category
      ON public.products (store_id, category);
  END IF;
END $$;

-- 2d. Stock range scans: "low stock / out of stock kaun hai"
--     (stock_quantity <= threshold), admin inventory alerts.
--     (id se single-row lookup PK se pehle hi fast hai.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'products'
               AND column_name = 'stock_quantity') THEN
    CREATE INDEX IF NOT EXISTS idx_products_stock_quantity
      ON public.products (stock_quantity);
  END IF;
END $$;

-- ---------------------------------------------------
-- 3. DELIVERY_PROFILES — assign + approval queries
-- ---------------------------------------------------

-- 3a. Auto-assign logic "kaun Online hai" (is_available = true)
--     scan karta hai — sabse pehle ye filter lagta hai.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'delivery_profiles'
               AND column_name = 'is_available') THEN
    CREATE INDEX IF NOT EXISTS idx_delivery_profiles_is_available
      ON public.delivery_profiles (is_available);
  END IF;
END $$;

-- 3b. Admin approval queue: "pending approvals dikhao"
--     (.eq('approval_status', 'pending')). Sirf kuch rows match
--     karti hain — index perfect hai.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'delivery_profiles'
               AND column_name = 'approval_status') THEN
    CREATE INDEX IF NOT EXISTS idx_delivery_profiles_approval_status
      ON public.delivery_profiles (approval_status);
  END IF;
END $$;

-- 3c. COMPOSITE: assign eligibility = "approved AUR online"
--     dono ek saath — trigger/worker queries isi shape ki hain.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'delivery_profiles'
               AND column_name = 'is_available')
     AND EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'delivery_profiles'
               AND column_name = 'approval_status') THEN
    CREATE INDEX IF NOT EXISTS idx_delivery_profiles_avail_approval
      ON public.delivery_profiles (is_available, approval_status);
  END IF;
END $$;

-- 3d. Home-store preference (HOME-FIRST assign) — pehle se
--     supabase_delivery_home_store.sql me bana hai, re-confirm.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'delivery_profiles'
               AND column_name = 'home_store_id') THEN
    CREATE INDEX IF NOT EXISTS idx_delivery_profiles_home_store_id
      ON public.delivery_profiles (home_store_id);
  END IF;
END $$;

-- ---------------------------------------------------
-- 4. STORE_STAFF — dono direction ke lookups
-- ---------------------------------------------------

-- 4a/4b. "Is store ka staff kaun" (store_id) + "ye user kis
--     store ka staff hai" (user_id) — dono queries roz chalti
--     hain (pack-permission check, store dashboard). Pehle se
--     multi-store migration me bane hain — re-confirm. (UNIQUE
--     (store_id, user_id) bhi hai jo store_id-prefix queries
--     cover karta hai; user_id wala alag isliye kyunki reverse
--     lookup me kaam aata hai.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'store_staff'
               AND column_name = 'store_id') THEN
    CREATE INDEX IF NOT EXISTS idx_store_staff_store_id
      ON public.store_staff (store_id);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'store_staff'
               AND column_name = 'user_id') THEN
    CREATE INDEX IF NOT EXISTS idx_store_staff_user_id
      ON public.store_staff (user_id);
  END IF;
END $$;

-- ---------------------------------------------------
-- 5. COMPLAINTS — admin grievance queue
-- ---------------------------------------------------

-- 5a. COMPOSITE (pehle se supabase_complaints.sql me bana hai,
--     re-confirm): "customer ki pending complaints" /
--     "delivery_partner ki in_progress" — admin ke main filters.
--     Leftmost rule: ye index akela complainant_type filter ko
--     bhi cover karta hai, isliye type par ALAG single index
--     banane ki zaroorat NAHI (duplicate hota).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'complaints'
               AND column_name = 'complainant_type')
     AND EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'complaints'
               AND column_name = 'status') THEN
    CREATE INDEX IF NOT EXISTS idx_complaints_type_status
      ON public.complaints (complainant_type, status);
  END IF;
END $$;

-- 5b. "Saari pending complaints (chahe kisi ki bhi hon)" — status
--     akela filter ho to upar wala composite kaam NAHI aata
--     (leftmost complainant_type hai), isliye status par alag index.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'complaints'
               AND column_name = 'status') THEN
    CREATE INDEX IF NOT EXISTS idx_complaints_status
      ON public.complaints (status);
  END IF;
END $$;

-- 5c/5d. Pehle se complaints migration me bane hain, re-confirm:
--     apni complaints (complainant_id) + nayi-pehle sorting (created_at).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'complaints'
               AND column_name = 'complainant_id') THEN
    CREATE INDEX IF NOT EXISTS idx_complaints_complainant
      ON public.complaints (complainant_id);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'complaints'
               AND column_name = 'created_at') THEN
    CREATE INDEX IF NOT EXISTS idx_complaints_created
      ON public.complaints (created_at DESC);
  END IF;
END $$;

-- ===================================================
-- VERIFY (RUN ke baad alag se chalao — sab dikhna chahiye):
--
--   SELECT tablename, indexname
--   FROM pg_indexes
--   WHERE schemaname = 'public'
--     AND tablename IN ('orders','products','delivery_profiles',
--                       'store_staff','complaints')
--   ORDER BY tablename, indexname;
--
-- Usage check (index lagne ke BAAD query plan dekho):
--   EXPLAIN SELECT * FROM public.orders
--     WHERE user_id = '00000000-0000-0000-0000-000000000000'
--     ORDER BY created_at DESC LIMIT 20;
--   -- "Index Scan using idx_orders_user_created" aana chahiye
--   -- (Seq Scan aaye to samjho table abhi chhoti hai — data badhne
--   -- par planner khud index chun lega; ye normal hai).
-- ===================================================
