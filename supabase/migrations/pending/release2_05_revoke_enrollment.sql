-- Release 2, migration 05 — owner revokes a device enrollment, and every
-- session on it, in one transaction. STAGING FIRST.
--
-- ═══ WHY A FUNCTION ═════════════════════════════════════════════════════════
-- Revoking a device is two writes: the enrollment row and every live session
-- on it. Done as two statements from a handler, a concurrent staff-login can
-- interleave between them and mint a session on an enrollment that is already
-- revoked — the same interleaving migration 03 closed for rotation. The row
-- lock taken here makes release2_create_staff_session queue behind this call
-- (it locks the same row) and then fail its own revoked_at check.
--
-- ═══ THE HANDLER IS THE WHOLE AUTHORIZATION BOUNDARY ════════════════════════
-- release2_clear_lockout binds through has_store_role(), which reads
-- auth.uid() and so can be checked by the database itself. The Release 2
-- handlers run as service_role, under which auth.uid() is null, so this
-- function cannot do that. It takes p_owner EXPLICITLY and trusts it. That is
-- safe only because (a) EXECUTE is granted to service_role alone, and (b) the
-- one caller, netlify/functions/enroll-revoke.js, derives p_owner from
-- supabase.auth.getUser() on the caller's JWT and from nothing else — a
-- property scripts/tests/release2-endpoints.test.js pins by assertion. Do not
-- widen the grant; do not add a second caller that takes the id from a body.
--
-- ═══ BIND BEFORE ANYTHING ELSE, INCLUDING THE IDEMPOTENT RETURN ═════════════
-- Unknown enrollment, an enrollment in a store the caller does not own, and a
-- caller who is a manager rather than an owner all raise the SAME 42501 with
-- the SAME message, before any write. And that check runs BEFORE the
-- "already revoked → return 0" branch: if it ran after, a wrong-store caller
-- would get 42501 for a live device and a quiet success for a revoked one,
-- and revoked-vs-live in another tenant would be enumerable by status code.
--
-- ═══ THE REASON IS AUDIT DATA ═══════════════════════════════════════════════
-- It lands on the enrollment row, is copied into every cascaded session's
-- reason, and is returned by enroll-list. Bounded to 200 printable
-- characters; anything else is 22023. Defaulted when absent.
--
-- OUT columns are named so they cannot collide with any table column in the
-- body (migration 04's lesson): o_enrollment_id / o_store_id /
-- o_sessions_revoked. Every table reference is aliased anyway.

create function public.release2_revoke_enrollment(
  p_enrollment uuid,
  p_owner      uuid,
  p_reason     text default null
) returns table (o_enrollment_id uuid, o_store_id uuid, o_sessions_revoked int)
language plpgsql security definer set search_path = public as $fn$
declare
  v_enr    public.device_enrollments;
  v_reason text;
  v_n      int := 0;
begin
  if p_enrollment is null or p_owner is null then
    raise exception 'enrollment and owner required' using errcode = '22023';
  end if;
  if p_reason is not null and (length(p_reason) > 200 or p_reason !~ '^[[:print:]]*$') then
    raise exception 'reason must be at most 200 printable characters' using errcode = '22023';
  end if;
  v_reason := coalesce(nullif(btrim(p_reason), ''), 'owner revoked device');

  -- Lock the enrollment so a concurrent sign-in queues behind this call.
  select de.* into v_enr from public.device_enrollments de
   where de.id = p_enrollment for update;

  -- BIND. One message for every refusal, evaluated before the revoked check.
  if not found
     or not exists (
       select 1 from public.memberships m
        where m.user_id = p_owner and m.store_id = v_enr.store_id and m.role = 'owner')
  then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  -- Idempotent: the owner's intent is already satisfied. Nothing changes.
  if v_enr.revoked_at is not null then
    return query select v_enr.id, v_enr.store_id, 0;
    return;
  end if;

  update public.device_enrollments de
     set revoked_at = now(), revoked_by = p_owner, revoked_reason = v_reason
   where de.id = p_enrollment;

  -- The cascade names the device revocation so a session's audit row says
  -- WHY it died, not merely that it did.
  update public.staff_sessions ss
     set revoked_at = now(), revoked_reason = 'device revoked: ' || v_reason
   where ss.enrollment_id = p_enrollment and ss.revoked_at is null;
  get diagnostics v_n = row_count;

  return query select v_enr.id, v_enr.store_id, v_n;
end
$fn$;

-- CLAUDE.md rule 4: public FIRST, then exactly the role that needs it.
revoke execute on function public.release2_revoke_enrollment(uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant  execute on function public.release2_revoke_enrollment(uuid,uuid,text)
  to service_role;

comment on function public.release2_revoke_enrollment(uuid,uuid,text) is
  'Release 2: owner revokes a device enrollment and cascades to every live session on it, '
  'in one transaction under a row lock. p_owner is TRUSTED — service_role only; the sole '
  'caller derives it from auth.getUser(). Unknown, wrong-store and non-owner all raise the '
  'same 42501 before any write and before the idempotent already-revoked return. Reason is '
  'bounded to 200 printable chars and copied into the cascade as "device revoked: <reason>".';
