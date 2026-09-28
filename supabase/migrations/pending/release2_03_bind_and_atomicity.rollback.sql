-- Release 2 — rollback companion for release2_03_bind_and_atomicity.sql.
-- NOT APPLIED. Reviewed before P1 and rehearsed inside P1
-- (docs/security/release-2-stage-0-production-plan.md §A6, §E3). Pinned by md5
-- in docs/security/stage0-production-manifest.json.
--
-- Run ONLY through the stage-0 wrapper (scripts/manual/assemble-stage0.mjs,
-- operation RB-43), which md5-checks these bytes, bounds the transaction with
-- lock/statement timeouts and writes the ledger row in the same transaction.
--
-- Reverses 03: drops release2_create_staff_session, release2_prune_auth_attempts
-- and the four-argument release2_clear_lockout; re-creates 02's three-argument
-- release2_clear_lockout (DROP+CREATE resets ACL and comment, so both are
-- re-issued, PUBLIC revoked first) and restores 02's release2_record_attempt body
-- and comment by CREATE OR REPLACE (which keeps the ACL; the grants are re-issued
-- anyway). Every restored body is 02's committed text, byte for byte. SECOND
-- HALF of operation RB-43.
--
-- What the guard below enforces, and nothing more:
--   - production's 20 ledger rows are present with their committed md5s;
--   - the staging seed store is absent and store4979 is present;
--   - release2_03_bind_and_atomicity is in the ledger with its manifest md5;
--   - the Release 2 functions are exactly the state it left (03's staff-session body
--     included, so 04's rollback must already have run in this transaction);
--   - the transaction-local marker release2.rollback_op is 'RB-43'.
-- Every check raises P0001; through the wrapper, the transaction rolls back.

-- ── Guard: positive production identity (plan §E2), the forward row, the state ──
do $guard$
declare v_missing int;
begin
  -- 1. Production's 20 ledger rows, each with the md5 of its committed file.
  --    The ledger is append-only, so this holds on production at any later
  --    time; staging stored these migrations under other versions.
  select count(*) into v_missing
    from (values
      ('20260427173246', 'create_print_jobs', '6e95fdfcc19ed4609dceb5cb7a1b70b4'),
      ('20260429150059', 'commission_tracking_phase1', '32a4007b31ab9017d9a2295aeb1e1fad'),
      ('20260506182251', 'add_file_urls_to_print_jobs', 'dd68267d571f0fa83e84bd98e34aaef0'),
      ('20260506182304', 'create_job_files_bucket', '09778bf9538ac1006c2de22d071351fd'),
      ('20260506182318', 'add_job_files_storage_policies', '98eb0e6feefae1565c520481efebcaab'),
      ('20260629173251', 'customer_self_serve_uploads_pending_jobs', 'e1831d7d341311a6a9e8411f0c275218'),
      ('20260722003606', 'phase_a_store_config_tables', '3467ab4b647fa6d26d1c7d488d04d116'),
      ('20260728181654', 'phase_b_01_org_tenant_columns', '226c89fb10f237ce5c57872d3c787238'),
      ('20260728181739', 'phase_b_02_backfill_ups_org', '30c30dcad55e0446f5ccd97b96e1aba5'),
      ('20260729001046', 'phase_b_03a_verify_employee_pin_rpc', 'c4d02a90c77f26fd22703f32ecc89996'),
      ('20260729010209', 'phase_b_03c_rotate_bootstrap_secret', '6d254552ca95ea4ca96f366e05ad6351'),
      ('20260729171101', 'phase_b_03b_employees_lockdown', 'c07c369aa93bdbc71827a9258245d546'),
      ('20260831161900', 'revoke_anon_pin_verification', 'bca0a8920296f73a28651560e8f1f75b'),
      ('20260908180945', 'phase_d1a_orders_compat', 'f2dabab07458a179f113a5216069481c'),
      ('20260909160307', 'restore_pin_rpc_execute_for_app_roles', '032c06a8bd6a6e561a1492f7edce40c0'),
      ('20260909160312', 'store_mailbox_manager_membership', 'a7fe4fc45038bdb34c12cb794ed42c2e'),
      ('20260909164923', 'phase_d1b_decommission', 'bf0de438ff5b570169a63dccc654df46'),
      ('20260909224658', 'phase_e_01_employee_roles', '068d409a57f632246892ee8d6e3f370f'),
      ('20260909225652', 'phase_e_02_cost_model', '83c1094e151208d3a28b54deba4e2f4a'),
      ('20260909232836', 'phase_e_03_order_margin_snapshot', 'b7a8e54c99432c5e0ddb60be4c46505f')
    ) as want(version, name, body_md5)
   where not exists (select 1 from supabase_migrations.schema_migrations m
                      where m.version = want.version and m.name = want.name
                        and md5(m.statements[1]) = want.body_md5);
  if v_missing <> 0 then
    raise exception 'release2_03 rollback: % of production''s 20 ledger rows are absent or differ — not production; refusing', v_missing
      using errcode = 'P0001';
  end if;
  -- 2. The staging seed store is absent (it exists only on staging).
  if exists (select 1 from public.stores s where s.id = '5ee41000-0000-4000-8000-0000000000a1') then
    raise exception 'release2_03 rollback: the staging seed store exists — this is staging; refusing' using errcode = 'P0001';
  end if;
  -- 3. The production store is present.
  if not exists (select 1 from public.stores s where s.slug = 'store4979') then
    raise exception 'release2_03 rollback: store4979 is absent — not production; refusing' using errcode = 'P0001';
  end if;
  -- 4. The forward migration this file reverses is in the ledger with its manifest md5.
  if not exists (select 1 from supabase_migrations.schema_migrations m
                  where m.name = 'release2_03_bind_and_atomicity' and md5(m.statements[1]) = '302e05c6a4939eb8021234cbc7325473') then
    raise exception 'release2_03 rollback: release2_03_bind_and_atomicity is not in the ledger with md5 302e05c6a4939eb8021234cbc7325473; refusing' using errcode = 'P0001';
  end if;
  -- RB-43 only: this file is half of ONE operation (04rb then 03rb in one
  -- transaction). The marker is transaction-local; only the RB-43 wrapper sets it.
  if coalesce(current_setting('release2.rollback_op', true), '') <> 'RB-43' then
    raise exception 'release2_03 rollback: runs only inside operation RB-43 (04rb then 03rb, one transaction); refusing'
      using errcode = 'P0001';
  end if;
  -- RB-43 order: 04's rollback must already have run in THIS transaction, i.e.
  -- the staff-session body must be 03's (checked by the state set above).
  -- state before: the Release 2 functions are EXACTLY the "after 03" set of
  -- plan §A1a — signature, md5(prosrc) and effective EXECUTE grantees.
  if (with have as (
        select p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as ident,
               md5(p.prosrc) as body_md5,
               (select string_agg(coalesce(r.rolname, 'PUBLIC') || '=' || a.privilege_type, ','
                                  order by coalesce(r.rolname, 'PUBLIC'), a.privilege_type)
                  from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  left join pg_roles r on r.oid = a.grantee) as acl
          from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and (p.proname like 'release2\_%' or p.proname = 'redeem_enrollment_ticket')),
      want as (select * from (values
      ('redeem_enrollment_ticket(bytea, bytea, bytea, text)', 'c024388886897f01a1154d8d12dc8996', 'postgres=EXECUTE,service_role=EXECUTE'),
      ('release2_clear_lockout(text, text, uuid, uuid)', 'b7f602cde969f2f2622c0d2343b1c249', 'authenticated=EXECUTE,postgres=EXECUTE,service_role=EXECUTE'),
      ('release2_record_attempt(text, text, integer, integer, integer)', 'e67957595afcc7a51d7f8673000d9302', 'postgres=EXECUTE,service_role=EXECUTE'),
      ('release2_create_staff_session(uuid, uuid, bytea, bytea, timestamp with time zone, timestamp with time zone)', 'bd6da6a2f80e13c7b20deab3b2c76e63', 'postgres=EXECUTE,service_role=EXECUTE'),
      ('release2_prune_auth_attempts(integer)', 'ee254949f88474c58284b8a2c1ba3cb0', 'postgres=EXECUTE,service_role=EXECUTE')
    ) as w(ident, body_md5, acl))
      select count(*) from ((select * from have except select * from want)
                            union all (select * from want except select * from have)) d) <> 0 then
    raise exception 'release2_03 rollback: state before — Release 2 functions differ from the expected set' using errcode = 'P0001';
  end if;
  if exists (select 1 from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and (p.proname like 'release2\_%' or p.proname = 'redeem_enrollment_ticket')
                and (not p.prosecdef or p.proconfig is distinct from array['search_path=public']
                     or obj_description(p.oid, 'pg_proc') is null)) then
    raise exception 'release2_03 rollback: state before — a Release 2 function lost SECURITY DEFINER, its search_path or its comment' using errcode = 'P0001';
  end if;
end
$guard$;

drop function public.release2_create_staff_session(uuid, uuid, bytea, bytea, timestamptz, timestamptz);
drop function public.release2_prune_auth_attempts(integer);
drop function public.release2_clear_lockout(text, text, uuid, uuid);

create function public.release2_clear_lockout(p_scope text, p_subject text, p_store uuid)
returns int
language plpgsql security definer set search_path = public as $fn$
declare v_n int;
begin
  if not public.has_store_role(p_store, array['owner','manager']) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  update public.auth_attempts
     set locked_until = null
   where scope = p_scope and subject = p_subject and locked_until is not null;
  get diagnostics v_n = row_count;
  return v_n;
end
$fn$;
revoke execute on function public.release2_clear_lockout(text,text,uuid)
  from public, anon, authenticated, service_role;
grant  execute on function public.release2_clear_lockout(text,text,uuid)
  to authenticated, service_role;

comment on function public.release2_clear_lockout(text,text,uuid) is
  'Release 2: owner/manager clears an abuse lockout for a subject. Gated on '
  'has_store_role, so authenticated callers can only clear their own store.';

create or replace function public.release2_record_attempt(
  p_scope        text,
  p_subject      text,
  p_window_secs  int,
  p_max_attempts int,
  p_lock_secs    int
) returns table (allowed boolean, attempts int, locked_until timestamptz)
language plpgsql security definer set search_path = public as $fn$
declare
  v_window timestamptz;
  v_row    public.auth_attempts;
begin
  if p_window_secs <= 0 or p_max_attempts <= 0 or p_lock_secs < 0 then
    raise exception 'invalid limiter parameters' using errcode = '22023';
  end if;

  -- Fixed windows, so the row key is deterministic and the upsert below is a
  -- single statement rather than a read followed by a decision.
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_secs) * p_window_secs);

  -- ONE statement: insert-or-increment, returning the post-increment state.
  -- Concurrent callers serialise on the primary key, so each sees a count that
  -- already includes every attempt committed before it.
  insert into public.auth_attempts as a (scope, subject, window_start, attempts, first_at, last_at)
  values (p_scope, p_subject, v_window, 1, now(), now())
  on conflict (scope, subject, window_start) do update
    set attempts = a.attempts + 1,
        last_at  = now(),
        -- Lock on the transition, and do not extend an existing lock on every
        -- subsequent attempt — otherwise a persistent attacker holds a device
        -- locked indefinitely, which is the denial-of-service shape this is
        -- supposed to avoid.
        locked_until = case
          when a.locked_until is not null and a.locked_until > now() then a.locked_until
          when a.attempts + 1 >= p_max_attempts then now() + make_interval(secs => p_lock_secs)
          else a.locked_until
        end
  returning a.* into v_row;

  return query select
    (v_row.locked_until is null or v_row.locked_until <= now()),
    v_row.attempts,
    v_row.locked_until;
end
$fn$;
revoke execute on function public.release2_record_attempt(text,text,int,int,int)
  from public, anon, authenticated, service_role;
grant  execute on function public.release2_record_attempt(text,text,int,int,int)
  to service_role;

comment on function public.release2_record_attempt(text,text,int,int,int) is
  'Release 2: atomic check-and-increment for PIN, ticket, upload-capability and mail '
  'abuse budgets. service_role only. Counts per enrollment and per store — never per '
  'employee, because a failed PIN guess resolves no employee. Does not extend an '
  'existing lock, so an attacker cannot hold a device locked indefinitely.';

-- ── Post-check: the state this file must leave ──────────────────────────────
do $post$
begin
  -- state after: the Release 2 functions are EXACTLY the "after 02" set of
  -- plan §A1a — signature, md5(prosrc) and effective EXECUTE grantees.
  if (with have as (
        select p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as ident,
               md5(p.prosrc) as body_md5,
               (select string_agg(coalesce(r.rolname, 'PUBLIC') || '=' || a.privilege_type, ','
                                  order by coalesce(r.rolname, 'PUBLIC'), a.privilege_type)
                  from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  left join pg_roles r on r.oid = a.grantee) as acl
          from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and (p.proname like 'release2\_%' or p.proname = 'redeem_enrollment_ticket')),
      want as (select * from (values
      ('redeem_enrollment_ticket(bytea, bytea, bytea, text)', 'c024388886897f01a1154d8d12dc8996', 'postgres=EXECUTE,service_role=EXECUTE'),
      ('release2_record_attempt(text, text, integer, integer, integer)', 'fa208910f744eead2bdd14445d1d89d8', 'postgres=EXECUTE,service_role=EXECUTE'),
      ('release2_clear_lockout(text, text, uuid)', 'f06f2b206a8f6675668ec43f1b6ec384', 'authenticated=EXECUTE,postgres=EXECUTE,service_role=EXECUTE')
    ) as w(ident, body_md5, acl))
      select count(*) from ((select * from have except select * from want)
                            union all (select * from want except select * from have)) d) <> 0 then
    raise exception 'release2_03 rollback: state after — Release 2 functions differ from the expected set' using errcode = 'P0001';
  end if;
  if exists (select 1 from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and (p.proname like 'release2\_%' or p.proname = 'redeem_enrollment_ticket')
                and (not p.prosecdef or p.proconfig is distinct from array['search_path=public']
                     or obj_description(p.oid, 'pg_proc') is null)) then
    raise exception 'release2_03 rollback: state after — a Release 2 function lost SECURITY DEFINER, its search_path or its comment' using errcode = 'P0001';
  end if;
end
$post$;
