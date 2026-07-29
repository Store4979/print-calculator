-- Phase B, migration 3c — rotate store4979's bootstrap secret.
-- Named 03c to avoid colliding with 03a (RPC, applied) and 03b (employees
-- lockdown, written but not yet applied). Independent of that sequence.
--
-- UNCONDITIONAL by design: migration 02 guarded on
--   (org_id is distinct from ... or bootstrap_secret_hash is null)
-- which would make this a silent no-op now that the column is populated.
-- The only predicate here is which store to target.
--
-- The prior hash (bea7d253…) is dead on replacement. Plaintext lives only
-- in the store's Netlify env as STORE_BOOTSTRAP_SECRET and was never shared
-- with the assistant — the owner generated and hashed it locally.
-- Nothing consumes it yet — mint-store-token is not built.
--
-- Applied to project gmxyisjjaxtpycsmmzef as `phase_b_03c_rotate_bootstrap_secret`.
-- Verified after apply: stored hash matches the expected value, is not the
-- old hash, is 64 chars, and matches ^[0-9a-f]{64}$.
--
-- FUTURE ROTATIONS: copy this file, swap the hash, re-apply. Do NOT reuse
-- migration 02's guarded update — it will silently do nothing.

update public.stores
   set bootstrap_secret_hash = 'b14b900fe398d1cee73cabc7e48cbb9692e9de43607f87052cc93116709702d9',
       updated_at = now()
 where slug = 'store4979';
