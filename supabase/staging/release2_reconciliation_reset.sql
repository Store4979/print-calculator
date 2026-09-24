-- STAGING ONLY (lboajqihpsfrokqvjgnl). NEVER APPLY TO PRODUCTION.
-- Release 2 reconciliation, step 1 of 6: remove every Release 2 object so the
-- COMMITTED files 01–05 can be applied verbatim and become the tested code.
--
-- Why this exists (docs/security/release-2-staging-reconciliation.md): staging's
-- ledger holds compact, comment-free bodies for release2_01, 02 and 03 that were
-- sent to apply_migration and never committed; the committed files differ in
-- layout, comments and split COMMENT literals. Semantically equal (normalized
-- hashes agree in Python and Postgres), but PL/pgSQL bodies are stored verbatim,
-- so staging's functions are not the bytes production would receive.
--
-- This file edits NO applied migration. The five existing ledger rows stay as
-- history — and they hold the old bodies exactly, so the pre-reset state can be
-- restored byte for byte from supabase_migrations.schema_migrations if needed.
--
-- The guard refuses to run anywhere the staging seed store does not exist. That
-- id is synthetic (scripts/staging-seed.sql) and exists in no other project.
do $$
begin
  if not exists (select 1 from public.stores where id = '5ee41000-0000-4000-8000-0000000000a1') then
    raise exception 'release2 reconciliation reset: staging seed store absent — this is not staging; refusing'
      using errcode = 'P0001';
  end if;
end $$;

-- Functions first (none of the tables depend on them), exact signatures.
drop function public.release2_revoke_enrollment(uuid, uuid, text);
drop function public.release2_prune_auth_attempts(integer);
drop function public.release2_create_staff_session(uuid, uuid, bytea, bytea, timestamptz, timestamptz);
drop function public.release2_clear_lockout(text, text, uuid, uuid);
drop function public.release2_record_attempt(text, text, integer, integer, integer);
drop function public.redeem_enrollment_ticket(bytea, bytea, bytea, text);

-- Tables in dependency order. No object outside this set depends on them
-- (checked 2026-09-24: no views, policies, triggers or foreign keys from
-- elsewhere). No CASCADE: an unexpected dependent must stop this, not vanish.
drop table public.staff_sessions;
drop table public.upload_capability_files;
drop table public.upload_capabilities;
drop table public.enrollment_tickets;
drop table public.device_enrollments;
drop table public.auth_attempts;

-- The one change to a pre-existing table (release2_01).
alter table public.employees drop constraint employees_id_store_uniq;
