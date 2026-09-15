-- Release 2, migration 02 — atomic attempt accounting. ADDITIVE.
--
-- STAGING FIRST (lboajqihpsfrokqvjgnl). When this reaches production, read the
-- assigned ledger version back and rename the file to match, byte-identical to
-- statements[1] (CLAUDE.md rule 4).
--
-- ── WHY THIS IS A FUNCTION AND NOT HANDLER CODE ────────────────────────────
-- Part 2.6 requires the counter to be durable AND to bound concurrent guessing.
-- Read-then-increment from a Netlify handler cannot do that: N concurrent PIN
-- attempts each read the same stale count, each decide they are under the
-- limit, and the limit is never reached. The check and the increment have to be
-- one statement, which means the database.
--
-- ── WHAT IS COUNTED, AND WHY NOT PER EMPLOYEE ──────────────────────────────
-- A failed PIN guess resolves NO employee — EmployeeLogin sends a PIN and
-- nothing else (src/lib/supabase.js findEmployeeByPin -> verify_employee_pin
-- takes only store_id and pin). So there is no employee to charge a failure to,
-- and an earlier draft of the plan that keyed the budget on
-- (enrollment, employee) was describing a key that does not exist at the moment
-- it is needed. Counting is therefore per ENROLLMENT and per STORE — both known
-- before the PIN is examined.
--
-- ── BUDGETS ARE SCOPED SO ONE ATTACKER CANNOT LOCK OUT A SHOP ──────────────
-- A single per-store counter would turn this limiter into a denial-of-service
-- tool: burn the budget, and the counter cannot take orders. So the enrollment
-- is the primary subject (the attacker must come through a device, and cannot
-- rotate it), the store is a wider backstop, and neither locks the other out.
-- The residual — a device-wide lockout does deny that device — is unavoidable
-- while login is PIN-only and is recorded in the plan rather than designed
-- around with a key that cannot exist.

create function public.release2_record_attempt(
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

-- CLAUDE.md rule 4. `public` FIRST and never dropped: the CREATE-time ACL on
-- this project grants EXECUTE to PUBLIC (=X/postgres) as well as to anon,
-- authenticated and service_role, and PUBLIC is the widest of the four. A list
-- that names the other three looks complete and leaves the broadest grant in
-- place. Measured, not assumed — see the rehearsal proacl diff.
revoke execute on function public.release2_record_attempt(text,text,int,int,int)
  from public, anon, authenticated, service_role;
grant  execute on function public.release2_record_attempt(text,text,int,int,int)
  to service_role;

comment on function public.release2_record_attempt(text,text,int,int,int) is
  'Release 2: atomic check-and-increment for PIN, ticket, upload-capability and mail '
  'abuse budgets. service_role only. Counts per enrollment and per store — never per '
  'employee, because a failed PIN guess resolves no employee. Does not extend an '
  'existing lock, so an attacker cannot hold a device locked indefinitely.';

-- ── Clearing a lockout ─────────────────────────────────────────────────────
-- An owner must be able to release a device their staff are locked out of, and
-- must be able to SEE that it happened. Both are owner actions, so this is
-- gated on has_store_role rather than being service_role-only.
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
