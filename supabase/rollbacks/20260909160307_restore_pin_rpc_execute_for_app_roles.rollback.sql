-- ROLLBACK for 20260909160307. Re-applies the 2026-08-31 revoke.
-- WARNING: this takes staff PIN sign-in DOWN again — the app has no other PIN
-- path. Only run it together with a client that no longer calls the RPC
-- (i.e. after PIN verification moves into a rate-limited Netlify function).
revoke execute on function public.verify_employee_pin(uuid, text) from anon, authenticated;
