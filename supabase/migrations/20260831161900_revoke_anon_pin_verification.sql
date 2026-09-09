-- Priority 4: verify_employee_pin was an anonymous brute-force target AND a
-- SECURITY DEFINER bypass around correctly-configured RLS.
--
-- The employees table has RLS enabled with four policies, all requiring an
-- authenticated owner/manager (has_store_role). This function is SECURITY
-- DEFINER, so it sidestepped all of that and answered PIN lookups for
-- anonymous callers. PINs are 4 digits stored as plain text -- 10,000
-- possibilities, exhaustible in seconds, with no rate limiting anywhere in
-- the project.
--
-- Safe to revoke: the app never calls it. There are zero .rpc() calls in the
-- entire source tree, and the name appears nowhere in the repo (it was created
-- in the dashboard and forgotten). The real PIN keypad (EmployeeLogin.jsx)
-- queries the employees table directly, which requires a signed-in
-- owner/manager -- the same model as ClockWork's /station kiosk.
--
-- NOT dropped: dropping is the cleaner end state and is recommended, but it is
-- irreversible, so it stays a separate decision.
REVOKE ALL ON FUNCTION public.verify_employee_pin(uuid, text) FROM PUBLIC, anon, authenticated;

-- has_store_role: reads auth.uid() internally and returns false when signed
-- out, so anon access was harmless -- but there is no reason to expose it.
-- Kept for authenticated: the RLS policies on employees call it.
REVOKE EXECUTE ON FUNCTION public.has_store_role(uuid, text[]) FROM PUBLIC, anon;

-- set_updated_at: trigger function. Pin its search_path and take it off the
-- API surface; triggers run under the table owner and need no grants.
ALTER FUNCTION public.set_updated_at() SET search_path = public;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;