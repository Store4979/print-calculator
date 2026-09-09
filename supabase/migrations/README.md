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
- `../rehearsals/` — rolled-back dry runs of destructive migrations (the
  migration body verbatim + proofs + the rollback file, ending in ROLLBACK).
  Not in the ledger. Re-runnable only while the migration is still pending.

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
| 20260909160307 | restore_pin_rpc_execute_for_app_roles | hotfix; verified anon→1, authenticated→1. Reopens the brute-force surface on purpose; Phase S1 (server-side PIN verification) is what closes it again — beta blocker, not a store launch blocker |
| 20260909160312 | store_mailbox_manager_membership | verified has_store_role manager=true, owner=false |
| 20260909164923 | phase_d1b_decommission | applied 2026-09-09 after PR #39 merged and a production Save Order ("test one") was confirmed in `orders`. Rehearsed first in a rolled-back transaction (`supabase/rehearsals/phase_d1b_rehearsal.sql`, 8/8), then re-verified live: anon 9-column insert, offline-queue drain of a pre-D1 row after the whitelist, view gone, archive 2 rows with the 0.01 value preserved. The header still says "NOT YET APPLIED" because the file must stay byte-identical to the ledger. **`_archive_commission_columns` stays until the owner says otherwise** — it is the only source for the rollback's commission values |
| 20260909224658 | phase_e_01_employee_roles | Phase E. Additive: `employees.role` (staff/manager, default staff), `verify_employee_pin` now returns `role` (DROP+CREATE; proacl proven byte-identical before/after), Ryan's counter PIN set to manager (owner confirmed), owner-only role trigger. Rehearsed 11/11 in a rolled-back txn (`supabase/rehearsals/phase_e_01_rehearsal.sql`), re-verified live. Found while rehearsing: this project's default privileges grant EXECUTE on every new `public` function to anon/authenticated/service_role at CREATE time — see CLAUDE.md rule 4 |
| 20260909225652 | phase_e_02_cost_model | Phase E. Additive: `sheet_prices.paper_cost/click_color/click_bw` with the lossless backfill (sheet: paper=base_cost_bw, click_bw=0, click_color=0.0361; LF: media only, zero clicks) and `paper_types.pricing_mode`. No base cost or price changed (proven: 0 rows). Rehearsed 9/9 (`supabase/rehearsals/phase_e_02_rehearsal.sql`), re-verified live. click_bw=0 is a placeholder until the owner enters the true B&W click — the pricing editor must say so |
| *pending* | phase_e_03_order_margin_snapshot | `orders.cost_subtotal` + `orders.margin_pct`, both nullable. Rehearsed 7/7 against the live post-E-02 schema: pre-D1 7-key, current 9-key and new 11-key queued rows all drain as anon; legacy commission keys still rejected; history stays NULL |
