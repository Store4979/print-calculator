-- Release 2 — rollback companion for release2_04_staff_session_qualify_columns.sql.
-- NOT APPLIED. Reviewed before P1 and rehearsed inside P1
-- (docs/security/release-2-stage-0-production-plan.md §A6, §E3). Pinned by md5
-- in docs/security/stage0-production-manifest.json.
--
-- Run ONLY through the stage-0 wrapper (scripts/manual/assemble-stage0.mjs,
-- operation RB-43), which md5-checks these bytes, bounds the transaction with
-- lock/statement timeouts and writes the ledger row in the same transaction.
--
-- Reverses 04: puts back 03's release2_create_staff_session body (md5(prosrc)
-- bd6da6a2…, the 42702 defect) with 03's EXECUTE grants and comment. That
-- state alone has no use, so this file is the FIRST HALF of operation RB-43 and
-- refuses to run outside it; 03's rollback, in the same transaction, then drops
-- the function. The body below is 03's committed text, byte for byte.
--
-- What the guard below enforces, and nothing more:
--   - production's 20 ledger rows are present with their committed md5s;
--   - the staging seed store is absent and store4979 is present;
--   - release2_04_staff_session_qualify_columns is in the ledger with its manifest md5;
--   - the Release 2 functions are exactly the state it left;
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
    raise exception 'release2_04 rollback: % of production''s 20 ledger rows are absent or differ — not production; refusing', v_missing
      using errcode = 'P0001';
  end if;
  -- 2. The staging seed store is absent (it exists only on staging).
  if exists (select 1 from public.stores s where s.id = '5ee41000-0000-4000-8000-0000000000a1') then
    raise exception 'release2_04 rollback: the staging seed store exists — this is staging; refusing' using errcode = 'P0001';
  end if;
  -- 3. The production store is present.
  if not exists (select 1 from public.stores s where s.slug = 'store4979') then
    raise exception 'release2_04 rollback: store4979 is absent — not production; refusing' using errcode = 'P0001';
  end if;
  -- 4. The forward migration this file reverses is in the ledger with its manifest md5.
  if not exists (select 1 from supabase_migrations.schema_migrations m
                  where m.name = 'release2_04_staff_session_qualify_columns' and md5(m.statements[1]) = '2dcb03eb36e47c8404a29500151e8394') then
    raise exception 'release2_04 rollback: release2_04_staff_session_qualify_columns is not in the ledger with md5 2dcb03eb36e47c8404a29500151e8394; refusing' using errcode = 'P0001';
  end if;
  -- RB-43 only: this file is half of ONE operation (04rb then 03rb in one
  -- transaction). The marker is transaction-local; only the RB-43 wrapper sets it.
  if coalesce(current_setting('release2.rollback_op', true), '') <> 'RB-43' then
    raise exception 'release2_04 rollback: runs only inside operation RB-43 (04rb then 03rb, one transaction); refusing'
      using errcode = 'P0001';
  end if;
  -- state before: the Release 2 functions are EXACTLY the "after 04" set of
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
      ('release2_create_staff_session(uuid, uuid, bytea, bytea, timestamp with time zone, timestamp with time zone)', 'd30da6d0c7a4d14e1bcb1b9fcace37d9', 'postgres=EXECUTE,service_role=EXECUTE'),
      ('release2_prune_auth_attempts(integer)', 'ee254949f88474c58284b8a2c1ba3cb0', 'postgres=EXECUTE,service_role=EXECUTE')
    ) as w(ident, body_md5, acl))
      select count(*) from ((select * from have except select * from want)
                            union all (select * from want except select * from have)) d) <> 0 then
    raise exception 'release2_04 rollback: state before — Release 2 functions differ from the expected set' using errcode = 'P0001';
  end if;
  if exists (select 1 from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and (p.proname like 'release2\_%' or p.proname = 'redeem_enrollment_ticket')
                and (not p.prosecdef or p.proconfig is distinct from array['search_path=public']
                     or obj_description(p.oid, 'pg_proc') is null)) then
    raise exception 'release2_04 rollback: state before — a Release 2 function lost SECURITY DEFINER, its search_path or its comment' using errcode = 'P0001';
  end if;
end
$guard$;

create or replace function public.release2_create_staff_session(
  p_enrollment  uuid,
  p_employee    uuid,
  p_token_hash  bytea,
  p_csrf_secret bytea,
  p_absolute    timestamptz,
  p_idle        timestamptz
) returns table (session_id uuid, store_id uuid, employee_role text)
language plpgsql security definer set search_path = public as $fn$
declare v_enr public.device_enrollments; v_emp public.employees; v_id uuid;
begin
  -- SERIALIZE per enrollment. Concurrent sign-ins on the same device queue
  -- here instead of interleaving revoke/insert pairs and leaving two live
  -- sessions.
  select * into v_enr from public.device_enrollments
   where id = p_enrollment for update;
  if not found or v_enr.revoked_at is not null then
    raise exception 'enrollment not usable' using errcode = '28000';
  end if;

  -- The employee must belong to THIS enrollment's store and be active. Checked
  -- here rather than trusted from the caller, so the session cannot be created
  -- across tenants even if a handler passed the wrong pair.
  select * into v_emp from public.employees
   where id = p_employee and store_id = v_enr.store_id and active;
  if not found then
    raise exception 'employee not usable for this enrollment' using errcode = '28000';
  end if;

  update public.staff_sessions
     set revoked_at = now(), revoked_reason = 'rotated: new sign-in on this device'
   where enrollment_id = p_enrollment and revoked_at is null;

  insert into public.staff_sessions
    (enrollment_id, store_id, employee_id, employee_role, token_hash, csrf_secret,
     absolute_expires_at, idle_expires_at)
  values
    (p_enrollment, v_enr.store_id, p_employee, v_emp.role, p_token_hash, p_csrf_secret,
     p_absolute, p_idle)
  returning id into v_id;

  return query select v_id, v_enr.store_id, v_emp.role;
end
$fn$;

revoke execute on function public.release2_create_staff_session(uuid,uuid,bytea,bytea,timestamptz,timestamptz)
  from public, anon, authenticated, service_role;
grant  execute on function public.release2_create_staff_session(uuid,uuid,bytea,bytea,timestamptz,timestamptz)
  to service_role;

comment on function public.release2_create_staff_session(uuid,uuid,bytea,bytea,timestamptz,timestamptz) is
  'Release 2: revoke-then-create in ONE transaction, serialized per enrollment by a row '
  'lock. Two concurrent sign-ins on one device queue rather than interleaving into two '
  'live sessions. Re-checks enrollment and employee/store/active rather than trusting '
  'the caller. service_role only.';

-- ── Post-check: the state this file must leave ──────────────────────────────
do $post$
begin
  -- state after: the Release 2 functions are EXACTLY the "after 03" set of
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
    raise exception 'release2_04 rollback: state after — Release 2 functions differ from the expected set' using errcode = 'P0001';
  end if;
  if exists (select 1 from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and (p.proname like 'release2\_%' or p.proname = 'redeem_enrollment_ticket')
                and (not p.prosecdef or p.proconfig is distinct from array['search_path=public']
                     or obj_description(p.oid, 'pg_proc') is null)) then
    raise exception 'release2_04 rollback: state after — a Release 2 function lost SECURITY DEFINER, its search_path or its comment' using errcode = 'P0001';
  end if;
end
$post$;
