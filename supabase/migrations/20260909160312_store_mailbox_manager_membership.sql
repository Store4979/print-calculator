-- Second admin account for the store: store4979@theupsstore.com.
--
-- Evidence it is intentional, not stray: self-created 2026-09-09 15:12 with a
-- password via the email-confirmation flow (not invited, not a magic-link
-- stub), confirmed from the store's own mailbox, and signed in 16 seconds
-- later. It had no memberships row, so has_store_role() was false and the
-- admin panel rendered nothing.
--
-- Granted MANAGER, not owner: the personal account (bigtex989@gmail.com)
-- stays the sole owner; the shared store mailbox gets day-to-day admin.
-- Idempotent. Reversible by deleting the row.
insert into public.memberships (user_id, store_id, org_id, role)
select u.id, s.id, s.org_id, 'manager'
  from auth.users u
  cross join public.stores s
 where u.email = 'store4979@theupsstore.com'
   and s.slug  = 'store4979'
   and not exists (
     select 1 from public.memberships m
      where m.user_id = u.id and m.store_id = s.id
   );