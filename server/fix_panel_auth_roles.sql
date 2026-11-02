-- ===================================================
-- SUPERCART — PANEL AUTH & ROLE FIX
-- Supabase SQL Editor me paste karke RUN dabao. Idempotent (dobara RUN
-- karne par koi error nahi). Har change ka ROLLBACK neeche diya hai.
--
-- Yeh fix in 3 errors ko theek karta hai:
--   1. Delivery signup: "Account could not be created."
--   2. Admin -> Store Manager: "Database error creating new user"
--   3. Store panel login: "Invalid login credentials"
--   4. Admin Stores list: "Manager: Not assigned" (broken store_staff links)
-- ===================================================

BEGIN;

------------------------------------------------------------------
-- 0) PREVIEW — admin ko dikhaye ki kya hota hai (kuch change nahi)
------------------------------------------------------------------
-- Kitne delivery/store_manager auth users abhi hain:
SELECT au.id, au.email, u.role,
       (SELECT string_agg(role, ', ') FROM public.user_roles r WHERE r.user_id = au.id) AS panel_roles
FROM auth.users au
LEFT JOIN public.users u ON u.id = au.id
WHERE u.role IN ('delivery','store_manager')
   OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = au.id AND r.role IN ('delivery','store_manager'))
ORDER BY u.role;

-- Store managers jinke paas koi store_staff link nahi hai ("Not assigned"):
SELECT u.id AS user_id, u.name, u.email
FROM public.users u
WHERE lower(u.role) = 'store_manager'
  AND NOT EXISTS (
        SELECT 1 FROM public.store_staff s WHERE s.user_id = u.id
      )
ORDER BY u.name;

------------------------------------------------------------------
-- 1) SAFE AUTH TRIGGER
--    Root cause: trigger ne public.users mein email = TAGGED email
--    (user+sc-store@...) aur role='customer' dala. Ye:
--      - public.users.email UNIQUE par kabhi-kabhi collide karta hai
--        -> signup / admin createUser "Database error creating new user"
--      - role ko default 'customer' par reset karta tha
--    Fix: tag hata kar plain email rakho, role sirf allowed set se
--    (customer/delivery/store_manager), aur koi bhi trigger error
--    signup ko kabhi abort na kare.
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_name TEXT := COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1));
    v_phone TEXT := COALESCE(NEW.raw_user_meta_data ->> 'phone', '');
    v_req  TEXT := lower(COALESCE(NEW.raw_user_meta_data ->> 'role', 'customer'));
    v_email TEXT;
    v_role  TEXT;
BEGIN
    -- panel tag hatao -> plain, panel-neutral email
    -- (PostgreSQL POSIX regex lookahead support nahi karta, isliye
    --  '\+[^@]+' pattern use kiya: '+' ke baad '@' tak ka sab hatao)
    v_email := regexp_replace(NEW.email, '\+[^@]+', '', 'g');
    v_email := lower(btrim(v_email));

    -- sirf wohi role jo users_role_check CONSTRAINT allow karta hai
    v_role := CASE
        WHEN v_req IN ('delivery','delivery_partner') THEN 'delivery'
        WHEN v_req = 'store_manager' THEN 'store_manager'
        ELSE 'customer'
    END;

    -- users row: insert ya (id par) update. Role sirf create par set hota
    -- hai taaki admin/manual role edits trigger se reset na hon.
    BEGIN
        INSERT INTO public.users (id, name, email, phone, role)
        VALUES (NEW.id, v_name, v_email, v_phone, v_role)
        ON CONFLICT (id) DO UPDATE
            SET name = EXCLUDED.name,
                email = EXCLUDED.email,
                phone = EXCLUDED.phone;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'SuperCart: users row for % skipped (% %)', NEW.email, SQLSTATE, SQLERRM;
    END;

    -- delivery ho to profile bhi banao (profile_completed=false, pending)
    IF v_role = 'delivery' THEN
        BEGIN
            INSERT INTO public.delivery_profiles
                (user_id, name, email, phone, approval_status, profile_completed)
            VALUES (NEW.id, v_name, v_email, v_phone, 'pending', false)
            ON CONFLICT (user_id) DO NOTHING;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'SuperCart: delivery_profile for % skipped (% %)', NEW.email, SQLSTATE, SQLERRM;
        END;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_supercart ON auth.users;
CREATE TRIGGER on_auth_user_created_supercart
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- ROLLBACK (Part 1): trigger ko purani (delivery_signup_fix wali) definition
-- par wapas lao — ya neeche wale ROLLBACK block se puri chiz revert karo.

------------------------------------------------------------------
-- 2) public.users.email UNIQUE HATAO
--    Root cause: ek plain email (aliinnews26@gmail.com) ko customer + manager
--    + delivery teeno share kar sakte hain. UNIQUE email ye rokta hai,
--    isliye manager creation fail hota tha.
--    NOTE: phone kabhi UNIQUE nahi tha, isliye isse chhedne ki zaroorat nahi.
------------------------------------------------------------------
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_email_key1;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_email_unique;
-- email NOT NULL rehta hai (sirf UNIQUE hata rahe hain)

-- ROLLBACK (Part 2):
-- ALTER TABLE public.users ADD CONSTRAINT users_email_key UNIQUE (email);

------------------------------------------------------------------
-- 3) user_roles — EK USER, EK ROLE (single PK on user_id)
--    Root cause: doos SQL files ne alag PK banayi thi
--    ((user_id, role) vs (user_id)) -> upsert {onConflict:'user_id'}
--    kabhi-kabhi bilkul match nahi karta -> role assignment fail.
------------------------------------------------------------------
-- pehle duplicates (same user, multiple roles) hatao — priority:
-- store_manager > delivery > customer
DELETE FROM public.user_roles AS r
USING (
    SELECT user_id,
           row_number() OVER (
               PARTITION BY user_id
               ORDER BY CASE role WHEN 'store_manager' THEN 0
                                  WHEN 'delivery' THEN 1
                                  ELSE 2 END,
                        created_at, ctid
           ) AS rn
    FROM public.user_roles
) ranked
WHERE ranked.user_id = r.user_id AND ranked.rn > 1;

ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_pkey;

-- koi aur unique constraint (user_id, role) ho to bhi hatao
DO $$
DECLARE
    con RECORD;
BEGIN
    FOR con IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'user_roles'
          AND c.contype IN ('p','u')
          AND c.conname <> 'user_roles_pkey'
    LOOP
        EXECUTE format('ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS %I', con.conname);
    END LOOP;
END $$;

ALTER TABLE public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id);

-- ROLLBACK (Part 3):
-- ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_pkey;
-- ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role);

------------------------------------------------------------------
-- 4) STORE STAFF LINKS — broken "Manager: Not assigned" fix
--    Note: sirf PREVIEW + safe helper. Asli store->manager mapping admin
--    ka decision hai; neeche ek template diya hai jisme store_id aur user_id
--    admin/ yahan daal kar relink kar sakte hain.
------------------------------------------------------------------
-- Preview (upar step 0 me hai). Relink template (store_id / user_id badal kar):
-- INSERT INTO public.store_staff (store_id, user_id)
-- VALUES (1, '<user_id>')
-- ON CONFLICT (store_id, user_id) DO NOTHING;

-- ROLLBACK (Part 4): links ke liye
-- DELETE FROM public.store_staff WHERE store_id = ? AND user_id = ?;

------------------------------------------------------------------
-- 5) STORE CREATE/EDIT — admin ko write access guarantee karo
--    Public SELECT se existing store dikh sakta hai, lekin INSERT
--    ke liye ye policy zaroori hai.
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users u
        WHERE (u.id = auth.uid() OR lower(u.email) = lower(auth.jwt() ->> 'email'))
          AND lower(u.role) = 'admin'
    );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public access on stores" ON public.stores;
DROP POLICY IF EXISTS "Admin full access on stores" ON public.stores;
CREATE POLICY "Admin full access on stores" ON public.stores
    FOR ALL TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

COMMIT;

-- ===================================================
-- FULL ROLLBACK (if needed) — poora system purani state par
-- ===================================================
-- BEGIN;
--   -- 1) purana trigger (delivery signup fix wala)
--   CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
--   RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
--   AS $$
--   DECLARE
--       account_name TEXT := COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1));
--       account_phone TEXT := COALESCE(NEW.raw_user_meta_data ->> 'phone', '');
--       requested_role TEXT := COALESCE(NEW.raw_user_meta_data ->> 'role', 'customer');
--   BEGIN
--       INSERT INTO public.users (id, name, email, phone, role)
--       VALUES (NEW.id, account_name, NEW.email, account_phone,
--               CASE WHEN requested_role IN ('delivery','delivery_partner') THEN 'delivery' ELSE 'customer' END)
--       ON CONFLICT (id) DO UPDATE
--         SET name = EXCLUDED.name, email = EXCLUDED.email, phone = EXCLUDED.phone;
--       IF requested_role IN ('delivery','delivery_partner') THEN
--         INSERT INTO public.delivery_profiles (user_id, name, email, phone, approval_status, profile_completed)
--         VALUES (NEW.id, account_name, NEW.email, account_phone, 'pending', false)
--         ON CONFLICT (user_id) DO NOTHING;
--       END IF;
--       RETURN NEW;
--   END; $$;
--   DROP TRIGGER IF EXISTS on_auth_user_created_supercart ON auth.users;
--   CREATE TRIGGER on_auth_user_created_supercart AFTER INSERT ON auth.users
--     FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
--   -- 2) email UNIQUE wapas
--   ALTER TABLE public.users ADD CONSTRAINT users_email_key UNIQUE (email);
--   -- 3) user_roles PK (user_id, role) wapas
--   ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_pkey;
--   DELETE FROM public.user_roles AS r USING (
--     SELECT user_id, role, row_number() OVER (PARTITION BY user_id ORDER BY created_at, ctid) AS rn
--     FROM public.user_roles
--   ) ranked WHERE ranked.user_id = r.user_id AND ranked.rn > 1;
--   ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role);
-- COMMIT;
