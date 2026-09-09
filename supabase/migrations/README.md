# supabase/migrations — the source of truth

Every migration ever applied to project `gmxyisjjaxtpycsmmzef` has a file here,
named `<version>_<name>.sql` where `<version>` is the value assigned by the
ledger (`supabase_migrations.schema_migrations`) at apply time, and whose bytes
are **identical** to `statements[1]` for that row. Nothing else goes in this
directory:

- `*.rollback.sql` — hand-written inverse for the migration of the same
  version. Not in the ledger. Not every migration has one.
- `pending/` — written but NOT applied. Kept out of the top level so the
  Supabase CLI can never apply it by accident. Moves up (and gets its real
  version) when applied.

**Check for drift** before any DB work: run `supabase/drift-check.sql` against
the project and `scripts/migration-md5.sh` in the repo, and diff. Every ledger
row must have a file with a matching md5; every top-level file must have a
ledger row.

## Why this exists (2026-09-09 reconciliation)

An audit found **eight** migrations applied to production with no file in the
repo, plus eight files whose names carried made-up version numbers instead of
the ledger's. One of the missing eight (`20260831161900`) had revoked EXECUTE
on `verify_employee_pin` on the stated grounds that the app never called it —
false: `findEmployeeByPin` had called it since PR #35 — and staff PIN sign-in
was down for nine days before anyone could see why. A repo that is the source
of truth is what makes that class of failure visible at review time.

## Ledger, with notes

| version | name | notes |
|---|---|---|
| 20260427173246 | create_print_jobs | pre-repo history, reconciled from ledger |
| 20260429150059 | commission_tracking_phase1 | created `employees`, `transactions`, `commission_settings`. Superseded by D1 (orders); kept as history |
| 20260506182251 | add_file_urls_to_print_jobs | |
| 20260506182304 | create_job_files_bucket | |
| 20260506182318 | add_job_files_storage_policies | |
| 20260629173251 | customer_self_serve_uploads_pending_jobs | |
| 20260722003606 | phase_a_store_config_tables | Phase A DB side; the frontend landed later as PR #34 |
| 20260728181654 | phase_b_01_org_tenant_columns | purely additive; advisors unchanged |
| 20260728181739 | phase_b_02_backfill_ups_org | verified 0 null tenant keys after apply |
| 20260729001046 | phase_b_03a_verify_employee_pin_rpc | verified as anon: right store+PIN→1, wrong store→0, bad PIN→0 |
| 20260729010209 | phase_b_03c_rotate_bootstrap_secret | applied before 03b (true order); hash only, plaintext never shared |
| 20260729171101 | phase_b_03b_employees_lockdown | applied 2026-07-29 after the 03a client deployed and PIN/kiosk/admin were confirmed on production. Post-apply: anon `select employees` 2→0; RPC still 1. Its header points at a rollback under the OLD filename — the companion is `20260729171101_…rollback.sql`. Note the test artifact: a PIN fetched *after* `set local role anon` is NULL and yields a false "sign-in broken" result; capture inputs while privileged |
| 20260831161900 | revoke_anon_pin_verification | **rationale was wrong** — the app did call the RPC. Took staff sign-in down. Reverted by 20260909160307. Its two other changes (has_store_role anon revoke, set_updated_at search_path pin) are harmless and stand |
| 20260908180945 | phase_d1a_orders_compat | zero-downtime rename via compat view; verified both old-client (11-col insert via view, RETURNING) and new-client shapes as anon |
| 20260909160307 | restore_pin_rpc_execute_for_app_roles | hotfix; verified anon→1, authenticated→1 |
| 20260909160312 | store_mailbox_manager_membership | verified has_store_role manager=true, owner=false |
| *pending* | phase_d1b_decommission | apply only after a production Save Order is confirmed in `orders`; point of no return for incentive values (archive table makes the rollback honest) |
