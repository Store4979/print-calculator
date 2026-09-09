-- HOTFIX: staff PIN sign-in has been down since 2026-08-31.
--
-- Migration 20260831161900 (revoke_anon_pin_verification) revoked EXECUTE on
-- verify_employee_pin from anon AND authenticated on the stated grounds that
-- "the app never calls it, zero .rpc() calls in the source tree". That was
-- wrong: PR #35 (efc9437, merged 2026-07-29) moved findEmployeeByPin onto this
-- RPC, and 03b closed the direct employees-table fallback the same day. With
-- the RPC unreachable there is no PIN path at all.
--
-- Restores exactly the 03a grant set. BOTH roles are required, not just anon:
-- a browser where the owner is signed in sends every request as
-- `authenticated`, so an anon-only grant would leave staff sign-in broken on
-- any machine with an admin session (persistSession is on).
grant execute on function public.verify_employee_pin(uuid, text) to anon;
grant execute on function public.verify_employee_pin(uuid, text) to authenticated;

comment on function public.verify_employee_pin(uuid, text) is
  'Store-scoped counter-staff PIN check. SECURITY DEFINER so the employees '
  'table can stay closed to anon. Returns id/name/active only, never the pin. '
  'IS CALLED BY THE APP: src/lib/supabase.js findEmployeeByPin() -> '
  'EmployeeLogin (staff sign-in) and the kiosk exit dialog. Do not revoke '
  'EXECUTE from anon/authenticated without replacing the client call path. '
  'KNOWN RISK, BETA BLOCKER: a 4-digit PIN behind an anon-callable RPC is '
  '10k-guess brute-forceable. Accepted short-term (single tenant, physical '
  'counter). Before the first external tenant: move verification into a '
  'rate-limited Netlify function using service_role and revoke these grants.';