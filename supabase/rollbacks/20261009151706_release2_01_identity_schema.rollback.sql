-- Release 2 — rollback companion for release2_01_identity_schema.sql.
-- NOT APPLIED. Reviewed before P1 and rehearsed inside P1
-- (docs/security/release-2-stage-0-production-plan.md §A6, §E3). Pinned by md5
-- in docs/security/stage0-production-manifest.json.
--
-- Run ONLY through the stage-0 wrapper (scripts/manual/assemble-stage0.mjs,
-- operation RB-1), which md5-checks these bytes, bounds the transaction with
-- lock/statement timeouts and writes the ledger row in the same transaction.
--
-- Reverses 01: drops redeem_enrollment_ticket, the six Release 2 tables (no
-- CASCADE: an unexpected dependent must stop this, not vanish) and
-- employees_id_store_uniq. LOCKS: dropping the constraint takes ACCESS
-- EXCLUSIVE on public.employees, and dropping the tables locks the tables their
-- foreign keys reference (stores, organizations, employees, auth.users) — the
-- counter is closed for RB-1 exactly as for 01 (plan §E0). Available only
-- BEFORE P6 (plan §F4); after P6 the data is never dropped.
--
-- What the guard below enforces, and nothing more:
--   - production's 20 ledger rows are present with their committed md5s;
--   - the staging seed store is absent and store4979 is present;
--   - release2_01_identity_schema is in the ledger with its manifest md5;
--   - the Release 2 functions are exactly the state it left;
--   - the five identity/capability tables are EMPTY.
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
    raise exception 'release2_01 rollback: % of production''s 20 ledger rows are absent or differ — not production; refusing', v_missing
      using errcode = 'P0001';
  end if;
  -- 2. The staging seed store is absent (it exists only on staging).
  if exists (select 1 from public.stores s where s.id = '5ee41000-0000-4000-8000-0000000000a1') then
    raise exception 'release2_01 rollback: the staging seed store exists — this is staging; refusing' using errcode = 'P0001';
  end if;
  -- 3. The production store is present.
  if not exists (select 1 from public.stores s where s.slug = 'store4979') then
    raise exception 'release2_01 rollback: store4979 is absent — not production; refusing' using errcode = 'P0001';
  end if;
  -- 4. The forward migration this file reverses is in the ledger with its manifest md5.
  if not exists (select 1 from supabase_migrations.schema_migrations m
                  where m.name = 'release2_01_identity_schema' and md5(m.statements[1]) = 'e97a5fd7c346a3b0a39bc6180dcfde46') then
    raise exception 'release2_01 rollback: release2_01_identity_schema is not in the ledger with md5 e97a5fd7c346a3b0a39bc6180dcfde46; refusing' using errcode = 'P0001';
  end if;
  -- F-7: a destructive rollback only over EMPTY Release 2 state. The five
  -- identity/capability tables must hold no rows. auth_attempts holds limiter
  -- counters only (no identity, no credential) and is disposable; its row count
  -- is reported, not required to be zero. "No active consumers" (P6 not merged,
  -- the published deploy's endpoints answering 404) is an operator precondition
  -- recorded at the stop point: SQL cannot see it.
  if (select count(*) from public.device_enrollments) + (select count(*) from public.enrollment_tickets)
     + (select count(*) from public.staff_sessions) + (select count(*) from public.upload_capabilities)
     + (select count(*) from public.upload_capability_files) <> 0 then
    raise exception 'release2_01 rollback: Release 2 identity/capability tables are not empty — not disposable; refusing'
      using errcode = 'P0001';
  end if;
  raise notice 'release2_01 rollback: auth_attempts rows dropped with the table: %', (select count(*) from public.auth_attempts);
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = 'public.employees'::regclass and c.conname = 'employees_id_store_uniq'
                    and pg_get_constraintdef(c.oid) = 'UNIQUE (id, store_id)') then
    raise exception 'release2_01 rollback: employees_id_store_uniq is not the constraint 01 created; refusing' using errcode = 'P0001';
  end if;
  -- state before: the Release 2 functions are EXACTLY the "after 01" set of
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
      ('redeem_enrollment_ticket(bytea, bytea, bytea, text)', 'c024388886897f01a1154d8d12dc8996', 'postgres=EXECUTE,service_role=EXECUTE')
    ) as w(ident, body_md5, acl))
      select count(*) from ((select * from have except select * from want)
                            union all (select * from want except select * from have)) d) <> 0 then
    raise exception 'release2_01 rollback: state before — Release 2 functions differ from the expected set' using errcode = 'P0001';
  end if;
  if exists (select 1 from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and (p.proname like 'release2\_%' or p.proname = 'redeem_enrollment_ticket')
                and (not p.prosecdef or p.proconfig is distinct from array['search_path=public']
                     or obj_description(p.oid, 'pg_proc') is null)) then
    raise exception 'release2_01 rollback: state before — a Release 2 function lost SECURITY DEFINER, its search_path or its comment' using errcode = 'P0001';
  end if;
end
$guard$;

drop function public.redeem_enrollment_ticket(bytea, bytea, bytea, text);

drop table public.staff_sessions;
drop table public.upload_capability_files;
drop table public.upload_capabilities;
drop table public.enrollment_tickets;
drop table public.device_enrollments;
drop table public.auth_attempts;

alter table public.employees drop constraint employees_id_store_uniq;

-- ── Post-check: the state this file must leave ──────────────────────────────
do $post$
begin
  -- state after: the Release 2 functions are EXACTLY the "none" set of
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
      want as (select * from (select null::text, null::text, null::text where false) as w(ident, body_md5, acl))
      select count(*) from ((select * from have except select * from want)
                            union all (select * from want except select * from have)) d) <> 0 then
    raise exception 'release2_01 rollback: state after — Release 2 functions differ from the expected set' using errcode = 'P0001';
  end if;
  if exists (select 1 from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and (p.proname like 'release2\_%' or p.proname = 'redeem_enrollment_ticket')
                and (not p.prosecdef or p.proconfig is distinct from array['search_path=public']
                     or obj_description(p.oid, 'pg_proc') is null)) then
    raise exception 'release2_01 rollback: state after — a Release 2 function lost SECURITY DEFINER, its search_path or its comment' using errcode = 'P0001';
  end if;
  if exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace
              and c.relname in ('device_enrollments','enrollment_tickets','staff_sessions',
                                'upload_capabilities','upload_capability_files','auth_attempts')) then
    raise exception 'release2_01 rollback: a Release 2 table survived' using errcode = 'P0001';
  end if;
  if exists (select 1 from pg_constraint c where c.conname = 'employees_id_store_uniq') then
    raise exception 'release2_01 rollback: employees_id_store_uniq survived' using errcode = 'P0001';
  end if;
end
$post$;
