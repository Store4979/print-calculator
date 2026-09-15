-- Release 2, migration 03 — fixes three findings in migration 02 and adds
-- atomic session rotation. STAGING FIRST.
--
-- ═══ P1-1. release2_clear_lockout AUTHORIZED ONE THING AND ACTED ON ANOTHER ══
-- The shipped function was:
--
--   if not has_store_role(p_store, ...) then raise; end if;
--   update auth_attempts set locked_until = null
--    where scope = p_scope and subject = p_subject ...;
--
-- p_store appears ONLY in the authorization check. p_subject appears ONLY in
-- the UPDATE. NOTHING JOINS THEM. Any owner or manager of any store could clear
-- the lockout on any other store's enrollment by naming their own store and
-- someone else's subject — the exact shape of get-download-url, which signs any
-- path it is handed after checking nothing about the caller's relationship to
-- it. Authorizing X and acting on Y is not authorization.
--
-- Fixed by making the subject TYPED and resolving it back to a store INSIDE
-- the SECURITY DEFINER body, then requiring that store to equal the authorized
-- one. A free-text subject cannot be bound to anything, which is why the
-- signature changes rather than the body gaining a check.
--
-- ═══ P2-3. QUOTA vs COOLDOWN, AND AN OFF-BY-ONE ═════════════════════════════
-- Defined explicitly, because "5 attempts" meant two different things:
--   * QUOTA   — p_max_attempts is the number of ADMITTED EVALUATIONS. With
--               max=5, attempts 1..5 are evaluated and the 6th is refused.
--               The old test `attempts + 1 >= p_max_attempts` locked ON the
--               5th, so max=5 admitted only FOUR evaluations.
--   * COOLDOWN — once locked, refuse until locked_until passes, regardless of
--               how many further attempts arrive. Not extended by them.
-- Both apply. They are not alternatives.
--
-- WINDOW ROLLOVER could previously escape a live cooldown: the lock lives on a
-- row keyed by window_start, so the next window began a fresh row with
-- locked_until null and admitted the caller again. With window 900s and lock
-- 300s the lock expired first so it was not exploitable — but the semantics
-- were wrong and would become exploitable the moment lock > window. The lock is
-- now checked across ALL windows for the subject, so a cooldown outlives the
-- window that created it.
--
-- ═══ P1-4. ROTATION WAS NOT ATOMIC ══════════════════════════════════════════
-- staff-login revoked prior sessions and then inserted the new one as two
-- separate statements. Two concurrent sign-ins on one enrollment could
-- interleave so that both revokes ran before both inserts, leaving TWO live
-- sessions — rotation defeated, and the second employee's work attributable to
-- either. Checking the UPDATE's error does not fix an interleaving; only
-- serialization does. release2_create_staff_session takes a row lock on the
-- enrollment, so concurrent sign-ins queue rather than interleave, and returns
-- only after the commit that makes the new session the only live one.

-- ── 1. Typed, bound lockout clearing ───────────────────────────────────────
-- DROP + CREATE: the signature changes, and CREATE OR REPLACE cannot do that.
-- DROP also resets the ACL to the project default and discards the comment, so
-- both are re-issued below (CLAUDE.md rule 4).
drop function if exists public.release2_clear_lockout(text, text, uuid);

create function public.release2_clear_lockout(
  p_scope        text,
  p_subject_kind text,   -- 'enr' | 'store' — no free text
  p_subject_id   uuid,   -- typed, so it can be resolved and bound
  p_store        uuid
) returns int
language plpgsql security definer set search_path = public as $fn$
declare v_n int; v_subject text; v_owner_store uuid;
begin
  if p_scope not in ('pin','ticket','upload_cap','mail') then
    raise exception 'unsupported scope' using errcode = '22023';
  end if;
  if p_subject_kind not in ('enr','store') then
    raise exception 'unsupported subject kind' using errcode = '22023';
  end if;
  if p_store is null or p_subject_id is null then
    raise exception 'store and subject required' using errcode = '22023';
  end if;

  -- Authorize the caller for the store they named.
  if not public.has_store_role(p_store, array['owner','manager']) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  -- BIND: resolve the subject back to a store, and require it to be the one
  -- just authorized. This is the step whose absence was the finding.
  if p_subject_kind = 'enr' then
    select de.store_id into v_owner_store
      from public.device_enrollments de where de.id = p_subject_id;
    if v_owner_store is null then
      -- Unknown enrollment and wrong-store enrollment answer identically, so a
      -- caller cannot probe which enrollments exist in other stores.
      raise exception 'not authorised' using errcode = '42501';
    end if;
  else
    v_owner_store := p_subject_id;
  end if;

  if v_owner_store <> p_store then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  v_subject := p_subject_kind || ':' || p_subject_id::text;

  update public.auth_attempts
     set locked_until = null
   where scope = p_scope and subject = v_subject and locked_until is not null;
  get diagnostics v_n = row_count;
  return v_n;
end
$fn$;

revoke execute on function public.release2_clear_lockout(text,text,uuid,uuid)
  from public, anon, authenticated, service_role;
grant  execute on function public.release2_clear_lockout(text,text,uuid,uuid)
  to authenticated, service_role;

comment on function public.release2_clear_lockout(text,text,uuid,uuid) is
  'Release 2: owner/manager clears an abuse lockout. The subject is TYPED and resolved '
  'back to a store inside this function, which must equal the authorized store — the '
  'previous signature authorized one store and modified an arbitrary subject. Unknown '
  'and wrong-store subjects answer identically so neither can be probed.';

-- ── 2. Quota + cooldown, corrected ─────────────────────────────────────────
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
  v_lock   timestamptz;
begin
  if p_window_secs <= 0 or p_max_attempts <= 0 or p_lock_secs < 0 then
    raise exception 'invalid limiter parameters' using errcode = '22023';
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_secs) * p_window_secs);

  -- COOLDOWN spans windows. Looked up across every row for this subject, so a
  -- window rollover cannot hand back a fresh allowance while a lock is live.
  select max(a.locked_until) into v_lock
    from public.auth_attempts a
   where a.scope = p_scope and a.subject = p_subject and a.locked_until > now();

  insert into public.auth_attempts as a (scope, subject, window_start, attempts, first_at, last_at)
  values (p_scope, p_subject, v_window, 1, now(), now())
  on conflict (scope, subject, window_start) do update
    set attempts = a.attempts + 1,
        last_at  = now(),
        -- QUOTA: p_max_attempts ADMITTED evaluations, so lock only once the
        -- count EXCEEDS it. `>=` locked on the max-th attempt, admitting one
        -- fewer than the name promised.
        locked_until = case
          when a.locked_until is not null and a.locked_until > now() then a.locked_until
          when a.attempts + 1 > p_max_attempts then now() + make_interval(secs => p_lock_secs)
          else a.locked_until
        end
  returning a.* into v_row;

  -- The effective cooldown is the later of any cross-window lock and this
  -- row's own, computed in a variable rather than inline so the expression is
  -- readable and cannot be mis-parenthesised.
  if v_lock is null then
    v_lock := v_row.locked_until;
  elsif v_row.locked_until is not null and v_row.locked_until > v_lock then
    v_lock := v_row.locked_until;
  end if;

  -- EXACTLY ONE ROW, and `allowed` is always a strict boolean — never null,
  -- never absent. A caller that cannot get a well-formed decision must fail
  -- closed, so there is nothing here for it to misread as permission.
  return query select
    ((v_lock is null or v_lock <= now()) and v_row.attempts <= p_max_attempts),
    v_row.attempts,
    v_lock;
end
$fn$;

comment on function public.release2_record_attempt(text,text,int,int,int) is
  'Release 2: atomic check-and-increment. QUOTA = p_max_attempts ADMITTED evaluations '
  '(the count must EXCEED it to lock). COOLDOWN is checked across ALL windows for the '
  'subject, so a window rollover cannot escape a live lock. service_role only.';

-- ── 3. Atomic session rotation ─────────────────────────────────────────────
create function public.release2_create_staff_session(
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

-- ── 4. Retention ───────────────────────────────────────────────────────────
-- auth_attempts grows one row per subject per window forever. Unbounded growth
-- is its own availability problem, and rows past their usefulness are just
-- retained metadata about who tried to sign in.
create function public.release2_prune_auth_attempts(p_older_than_secs int default 604800)
returns int
language plpgsql security definer set search_path = public as $fn$
declare v_n int;
begin
  delete from public.auth_attempts
   where window_start < now() - make_interval(secs => p_older_than_secs)
     and (locked_until is null or locked_until <= now());
  get diagnostics v_n = row_count;
  return v_n;
end
$fn$;

revoke execute on function public.release2_prune_auth_attempts(int)
  from public, anon, authenticated, service_role;
grant  execute on function public.release2_prune_auth_attempts(int) to service_role;

comment on function public.release2_prune_auth_attempts(int) is
  'Release 2: drop attempt rows older than the retention window, never one holding a '
  'live lock. service_role only.';
