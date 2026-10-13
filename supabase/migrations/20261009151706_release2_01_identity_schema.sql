-- Release 2, migration 01 — identity schema. ADDITIVE.
--
-- Six tables, one SECURITY DEFINER function, explicit grants, RLS on with zero
-- policies. Applied to STAGING first (project lboajqihpsfrokqvjgnl); production
-- gets it only after the whole step order in docs/security/release-2-plan.md
-- Part 7 has been walked on staging.
--
-- WHEN THIS IS APPLIED TO PRODUCTION: read the assigned version back out of
-- supabase_migrations.schema_migrations and rename this file to
-- <version>_release2_01_identity_schema.sql under supabase/migrations/,
-- byte-identical to statements[1] (CLAUDE.md rule 4).
--
-- ── ONE DEVIATION FROM "NOTHING EXISTING IS TOUCHED", STATED UP FRONT ───────
-- Part 2.5 requires composite foreign keys so a session cannot name one
-- store's enrollment and another store's employee — three independently valid
-- FKs do not prove they agree. A composite FK needs a unique key on the
-- referenced columns, so this migration adds:
--
--   unique (id, store_id) on public.employees
--   unique (id, store_id) on public.device_enrollments   (new table, no issue)
--
-- The employees constraint touches an EXISTING table. It is additive and
-- cannot fail — `id` is already the primary key, so (id, store_id) is unique
-- by construction and no existing row can violate it. But it is a change to an
-- existing object, which step 2 otherwise avoids, so it is called out rather
-- than buried. The alternative was resolver-only consistency checks, which
-- Part 2.5 rejected on the grounds that they cannot prevent a bad row from
-- being written in the first place.

-- ── 1. Device enrollments ───────────────────────────────────────────────────
-- A browser an owner has paired to a store. The store is derived from THIS
-- row, never from a storeSlug in a request body.
create table public.device_enrollments (
  id                uuid primary key default gen_random_uuid(),
  store_id          uuid not null references public.stores(id) on delete cascade,
  org_id            uuid not null references public.organizations(id) on delete cascade,
  label             text not null,
  device_token_hash bytea not null unique,        -- sha256(token); token never stored
  csrf_secret       bytea not null,               -- compared server-side (Part 3.1)
  created_by        uuid not null references auth.users(id),
  created_at        timestamptz not null default now(),
  last_seen_at      timestamptz,
  revoked_at        timestamptz,
  revoked_by        uuid references auth.users(id),
  revoked_reason    text,
  constraint device_enrollments_id_store_uniq unique (id, store_id)
);
create index device_enrollments_store_active_idx
  on public.device_enrollments (store_id) where revoked_at is null;

-- ── 2. Pairing tickets — single use, enforced in SQL ────────────────────────
create table public.enrollment_tickets (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores(id) on delete cascade,
  ticket_hash   bytea not null unique,            -- sha256(ticket)
  created_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,             -- created_at + 15 min
  redeemed_at   timestamptz,
  redeemed_into uuid references public.device_enrollments(id),
  revoked_at    timestamptz
);
create index enrollment_tickets_open_idx
  on public.enrollment_tickets (store_id)
  where redeemed_at is null and revoked_at is null;

-- ── 2b. The one existing-object change — MUST precede staff_sessions ───────
-- Required by the composite FK in section 3. A composite FK needs a unique key
-- on the referenced columns, so this has to exist BEFORE the referencing table
-- is created — my first draft had it at the end of the file, which would have
-- failed on the FK. Cannot fail on data: `id` is already the primary key, so
-- (id, store_id) is unique by construction.
alter table public.employees
  add constraint employees_id_store_uniq unique (id, store_id);

-- ── 3. Staff sessions — opaque, server-owned ────────────────────────────────
-- employee_role is COPIED at issue time. A change that NARROWS authority
-- revokes the session (Part 2.3b); a change that widens it does not.
create table public.staff_sessions (
  id             uuid primary key default gen_random_uuid(),
  enrollment_id  uuid not null,
  store_id       uuid not null references public.stores(id) on delete cascade,
  employee_id    uuid not null,
  employee_role  text not null check (employee_role in ('staff','manager')),
  token_hash     bytea not null unique,           -- sha256(token)
  csrf_secret    bytea not null,
  created_at     timestamptz not null default now(),
  -- TWO clocks. last_used_at records ANY call, for audit. idle expiry advances
  -- only from last_active_at, which only INTERACTIVE calls set — otherwise a
  -- queue tab polling on a timer holds the session open forever and the idle
  -- limit never fires (Part 2.3a).
  last_used_at   timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  absolute_expires_at timestamptz not null,        -- created_at + 12h
  idle_expires_at     timestamptz not null,        -- last_active_at + 60m
  role_checked_at timestamptz not null default now(),
  revoked_at     timestamptz,
  revoked_reason text,
  -- COMPOSITE: the tenant is carried through, so a session naming one store's
  -- enrollment and another store's employee is not representable.
  constraint staff_sessions_enrollment_store_fkey
    foreign key (enrollment_id, store_id)
    references public.device_enrollments (id, store_id) on delete cascade,
  constraint staff_sessions_employee_store_fkey
    foreign key (employee_id, store_id)
    references public.employees (id, store_id) on delete cascade
);
create index staff_sessions_enrollment_live_idx
  on public.staff_sessions (enrollment_id) where revoked_at is null;
create index staff_sessions_employee_live_idx
  on public.staff_sessions (employee_id) where revoked_at is null;

-- ── 4. Upload capabilities — the customer path ──────────────────────────────
-- max_bytes/per_file_cap are OUR bookkeeping. The ceiling Storage actually
-- enforces is the bucket's file_size_limit, so per_file_cap must not exceed it
-- (Part 2.4 item 1) — a configuration check, not a constraint, because the
-- bucket limit lives outside this schema.
create table public.upload_capabilities (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores(id) on delete cascade,
  token_hash    bytea not null unique,
  csrf_secret   bytea not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,             -- created_at + 30 min
  max_files     int    not null default 10  check (max_files  > 0),
  max_bytes     bigint not null default 52428800 check (max_bytes > 0),
  per_file_cap  bigint not null default 52428800 check (per_file_cap > 0),
  used_files    int    not null default 0 check (used_files >= 0),
  used_bytes    bigint not null default 0 check (used_bytes >= 0),
  consumed_at   timestamptz,
  revoked_at    timestamptz
);
create index upload_capabilities_open_idx
  on public.upload_capabilities (store_id)
  where consumed_at is null and revoked_at is null;

-- Server-recorded file ownership. register-job may ONLY accept a path this
-- table says the same capability minted.
create table public.upload_capability_files (
  capability_id  uuid not null references public.upload_capabilities(id) on delete cascade,
  path           text not null,
  charged_bytes  bigint not null,                 -- the reservation actually taken
  token_expires_at timestamptz not null,          -- signed-URL permission, ~2h
  declared_size  bigint,
  actual_size    bigint,
  mime           text,
  minted_at      timestamptz not null default now(),
  registered_at  timestamptz,
  swept_at       timestamptz,
  primary key (capability_id, path)
);
-- The sweep needs "minted, never registered, token lapsed" to be decidable
-- server-side rather than guessed.
create index upload_capability_files_orphan_idx
  on public.upload_capability_files (token_expires_at)
  where registered_at is null and swept_at is null;

-- ── 5. Durable abuse limits ────────────────────────────────────────────────
-- Release 1's in-instance limiter cannot bound PIN guessing across Netlify
-- instances. Counted per enrollment and per store, NOT per employee: a failed
-- PIN guess resolves no employee, so there is no employee to charge it to
-- (Part 2.6).
create table public.auth_attempts (
  scope        text not null check (scope in ('pin','ticket','upload_cap','mail')),
  subject      text not null,
  window_start timestamptz not null,
  attempts     int not null default 0 check (attempts >= 0),
  locked_until timestamptz,
  first_at     timestamptz not null default now(),
  last_at      timestamptz not null default now(),
  primary key (scope, subject, window_start)
);
create index auth_attempts_locked_idx
  on public.auth_attempts (locked_until) where locked_until is not null;

-- ── 6. Ticket redemption — ONE transaction ─────────────────────────────────
-- Burn and enrol together, or neither. Two round trips would let a crash
-- between them either pair a second device on the same ticket, or burn a
-- ticket with no enrolment to show for it (Part 2.2).
create function public.redeem_enrollment_ticket(
  p_ticket_hash bytea,
  p_token_hash  bytea,
  p_csrf_secret bytea,
  p_label       text
) returns table (enrollment_id uuid, store_id uuid)
language plpgsql security definer set search_path = public as $fn$
declare v_ticket public.enrollment_tickets; v_enroll uuid; v_org uuid;
begin
  -- Burn first. FOR UPDATE via the UPDATE itself: a concurrent redemption
  -- blocks here, then finds redeemed_at set and matches no row.
  update public.enrollment_tickets t
     set redeemed_at = now()
   where t.ticket_hash = p_ticket_hash
     and t.redeemed_at is null
     and t.revoked_at  is null
     and t.expires_at  > now()
  returning t.* into v_ticket;

  if not found then
    -- Deliberately indistinguishable: replay, expiry and revocation all look
    -- the same, so a probe cannot enumerate live tickets.
    raise exception 'ticket not redeemable' using errcode = '28000';
  end if;

  select s.org_id into v_org from public.stores s where s.id = v_ticket.store_id;
  if v_org is null then
    raise exception 'store has no org' using errcode = '23502';
  end if;

  insert into public.device_enrollments
    (store_id, org_id, label, device_token_hash, csrf_secret, created_by)
  values
    (v_ticket.store_id, v_org, p_label, p_token_hash, p_csrf_secret, v_ticket.created_by)
  returning id into v_enroll;

  update public.enrollment_tickets set redeemed_into = v_enroll where id = v_ticket.id;

  return query select v_enroll, v_ticket.store_id;
end
$fn$;

-- CLAUDE.md rule 4. This project's default privileges grant EXECUTE on every
-- new public function to anon, authenticated AND service_role at CREATE time —
-- confirmed present in pg_default_acl on a brand-new project — so a SECURITY
-- DEFINER function that redeems enrolment tickets is anon-callable the instant
-- it exists unless this revoke runs in the same migration.
revoke execute on function public.redeem_enrollment_ticket(bytea,bytea,bytea,text)
  from public, anon, authenticated, service_role;
grant  execute on function public.redeem_enrollment_ticket(bytea,bytea,bytea,text)
  to service_role;

comment on function public.redeem_enrollment_ticket(bytea,bytea,bytea,text) is
  'Release 2: atomically burns a pairing ticket and creates the device enrollment. '
  'SECURITY DEFINER; service_role only. Raises 28000 for replay, expiry and revocation '
  'alike so a caller cannot distinguish them. Never returns key material.';

-- ── 7. Grants and RLS — the opposite of the project default ─────────────────
revoke all on public.device_enrollments,      public.enrollment_tickets,
              public.staff_sessions,          public.upload_capabilities,
              public.upload_capability_files, public.auth_attempts
  from public, anon, authenticated;

grant select, insert, update, delete on
  public.device_enrollments,      public.enrollment_tickets,
  public.staff_sessions,          public.upload_capabilities,
  public.upload_capability_files, public.auth_attempts
  to service_role;

-- RLS on with ZERO policies: the _archive_commission_columns pattern, already
-- proven in this project to deny everything to non-owner roles. service_role
-- reaches these by its BYPASSRLS role attribute — NOT by owner bypass, which
-- is a different mechanism (Part 0.3).
alter table public.device_enrollments      enable row level security;
alter table public.enrollment_tickets      enable row level security;
alter table public.staff_sessions          enable row level security;
alter table public.upload_capabilities     enable row level security;
alter table public.upload_capability_files enable row level security;
alter table public.auth_attempts           enable row level security;
