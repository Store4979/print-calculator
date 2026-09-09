-- ROLLBACK for 20260909160312: remove the store mailbox's manager membership.
-- The auth user itself is untouched; the account simply loses admin access
-- (and the app now says so on screen instead of rendering nothing).
delete from public.memberships m
 using auth.users u, public.stores s
 where m.user_id = u.id and m.store_id = s.id
   and u.email = 'store4979@theupsstore.com' and s.slug = 'store4979'
   and m.role = 'manager';
