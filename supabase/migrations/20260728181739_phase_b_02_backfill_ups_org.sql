-- Phase B, migration 2 of N — BACKFILL ONLY. No schema changes, no RLS,
-- no NOT NULL. Idempotent: safe to re-run. Every existing row belongs to
-- the single existing store (store4979), so attribution is unambiguous.

-- 1. The org for the live store.
--    plan='pro' deliberately (NOT 'trial'): this is the owner's own
--    production store and must never be gated by a trial expiry in Phase C.
insert into public.organizations (name, slug, plan, status)
select 'The UPS Store #4979', 'ups-4979', 'pro', 'active'
where not exists (select 1 from public.organizations where slug = 'ups-4979');

-- 2. Point store4979 at it + install the bootstrap secret hash.
--    Only the SHA-256 hash is stored; the plaintext lives solely in the
--    store's Netlify deploy env (STORE_BOOTSTRAP_SECRET).
update public.stores s
   set org_id = o.id,
       bootstrap_secret_hash = 'bea7d25367fe31459ef518148b76d2cc1dd6d54a8dec07b5d7c029c1f0943217'
  from public.organizations o
 where o.slug = 'ups-4979'
   and s.slug = 'store4979'
   and (s.org_id is distinct from o.id or s.bootstrap_secret_hash is null);

-- 3. Memberships inherit the org from their store (preserves the Phase A
--    admin gate: has_store_role still resolves via store_id).
update public.memberships m
   set org_id = s.org_id
  from public.stores s
 where m.store_id = s.id
   and m.org_id is distinct from s.org_id;

-- 4. Operational tables: all pre-existing rows are store4979's.
update public.employees           t set org_id = s.org_id, store_id = s.id from public.stores s where s.slug='store4979' and (t.store_id is null or t.org_id is null);
update public.transactions        t set org_id = s.org_id, store_id = s.id from public.stores s where s.slug='store4979' and (t.store_id is null or t.org_id is null);
update public.commission_settings t set org_id = s.org_id, store_id = s.id from public.stores s where s.slug='store4979' and (t.store_id is null or t.org_id is null);
update public.print_jobs          t set org_id = s.org_id, store_id = s.id from public.stores s where s.slug='store4979' and (t.store_id is null or t.org_id is null);
update public.pending_jobs        t set org_id = s.org_id, store_id = s.id from public.stores s where s.slug='store4979' and (t.store_id is null or t.org_id is null);