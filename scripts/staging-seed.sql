-- scripts/staging-seed.sql — STAGING ONLY. Idempotent RESET + seed.
--
-- REFUSES TO RUN AGAINST PRODUCTION. The first statement aborts the whole
-- script if the connected database is the production project, so a pasted
-- command in the wrong SQL editor tab destroys nothing. Run it whole; do not
-- run fragments, because the guard is the first statement.
--
-- WHY A RESET AND NOT `ON CONFLICT DO NOTHING`: the previous seed was
-- described in prose and written with ON CONFLICT DO NOTHING, which cannot
-- restore a fixture a test has altered — it silently leaves the mutated row in
-- place and the next run reports success. Adversarial tests mutate fixtures by
-- design (revoked sessions, demoted employees, drained queues), so the seed
-- has to be able to put them back. This deletes the synthetic tenants and
-- recreates them.
--
-- It deletes ONLY rows belonging to the two synthetic staging stores, matched
-- by slug. It never touches rows it did not create.

do $guard$
declare v_ref text;
begin
  -- Supabase exposes the project ref as the database name and in the JWT
  -- issuer; the database name is the reliable one from a SQL session.
  select current_database() into v_ref;
  if current_setting('server_version_num')::int < 0 then null; end if;

  -- Production identity, spelled out so this file is self-contained.
  if exists (select 1 from public.stores where slug = 'store4979') then
    raise exception
      'REFUSED: this database contains store4979 — it is PRODUCTION (or a copy of it). '
      'scripts/staging-seed.sql only runs against the synthetic staging project.'
      using errcode = '42501';
  end if;

  if exists (select 1 from public.organizations where slug = 'ups-4979'
             and exists (select 1 from public.stores s where s.org_id = organizations.id)) then
    raise exception 'REFUSED: ups-4979 org has stores attached — this looks like production.'
      using errcode = '42501';
  end if;
end
$guard$;

-- ── RESET ───────────────────────────────────────────────────────────────────
-- Ordered by dependency. Everything is scoped to the two synthetic stores.
with t as (select id from public.stores where slug in ('staging-t1-store','staging-t2-store'))
delete from public.orders        where store_id in (select id from t);
with t as (select id from public.stores where slug in ('staging-t1-store','staging-t2-store'))
delete from public.print_jobs    where store_id in (select id from t);
with t as (select id from public.stores where slug in ('staging-t1-store','staging-t2-store'))
delete from public.pending_jobs  where store_id in (select id from t);
with t as (select id from public.stores where slug in ('staging-t1-store','staging-t2-store'))
delete from public.sheet_prices  where store_id in (select id from t);
with t as (select id from public.stores where slug in ('staging-t1-store','staging-t2-store'))
delete from public.paper_types   where store_id in (select id from t);
with t as (select id from public.stores where slug in ('staging-t1-store','staging-t2-store'))
delete from public.employees     where store_id in (select id from t);
with t as (select id from public.stores where slug in ('staging-t1-store','staging-t2-store'))
delete from public.memberships   where store_id in (select id from t);
delete from public.stores        where slug in ('staging-t1-store','staging-t2-store');
delete from public.organizations where slug in ('staging-t1','staging-t2');

-- ── SEED ────────────────────────────────────────────────────────────────────
-- Two tenants, seeded symmetrically on purpose: any asymmetry in a
-- cross-tenant test result is then a real finding, not a seeding artifact.
insert into public.organizations (name, slug, plan, status) values
  ('Staging Tenant One', 'staging-t1', 'pro',   'active'),
  ('Staging Tenant Two', 'staging-t2', 'trial', 'active');

insert into public.stores (slug, name, address, phone, email, timezone, org_id, bootstrap_secret_hash)
select v.slug, v.name, v.addr, v.phone, v.email, 'America/Detroit', o.id,
       encode(sha256(('staging-'||v.slug||'-secret-not-production')::bytea),'hex')
from (values
  ('staging-t1-store','Staging T1 Print Shop','1 Test Way','555-0101','t1@example.invalid','staging-t1'),
  ('staging-t2-store','Staging T2 Copy Centre','2 Test Way','555-0202','t2@example.invalid','staging-t2')
) as v(slug,name,addr,phone,email,org)
join public.organizations o on o.slug = v.org;

-- Manager + staff PIN per store. PINs are globally unique
-- (employees_pin_unique), so the two tenants cannot share values.
insert into public.employees (name, pin, active, role, store_id, org_id)
select v.name, v.pin, true, v.role, s.id, s.org_id
from (values
  ('staging-t1-store','T1 Manager','1101','manager'),
  ('staging-t1-store','T1 Staff',  '1102','staff'),
  ('staging-t2-store','T2 Manager','2201','manager'),
  ('staging-t2-store','T2 Staff',  '2202','staff')
) as v(slug,name,pin,role)
join public.stores s on s.slug = v.slug;

-- NOTE: paper_types / sheet_prices and the other Phase A config tables have
-- store_id but NO org_id — Phase B only added org_id to the operational
-- tables. Do not "fix" this by adding it to the insert; it will fail.
insert into public.paper_types (store_id, kind, key, label, sheet_keys, markup_percent, pricing_mode, sort_order)
select s.id, 'sheet', '28lb', '28 lb Bond', array['8.5x11','11x17'], 700, 'cost_up', 1
from public.stores s where s.slug in ('staging-t1-store','staging-t2-store');

insert into public.sheet_prices (store_id, paper_type_id, sheet_key, base_cost_color, base_cost_bw,
                                 price_color, price_bw, paper_cost, click_color, click_bw, sku)
select s.id, pt.id, v.k, 0.0630, 0.0269, 0.5040, 0.2152, 0.0269, 0.0361, 0, 'SKU-'||v.k
from public.stores s
join public.paper_types pt on pt.store_id = s.id and pt.key = '28lb'
cross join (values ('8.5x11'), ('11x17')) as v(k)
where s.slug in ('staging-t1-store','staging-t2-store');

insert into public.orders (employee_id, employee_name, total, base_subtotal, line_items,
                           service_type, store_id, org_id, cost_subtotal, margin_pct)
select e.id, e.name, 42.00, 42.00, '[{"desc":"synthetic"}]'::jsonb, 'print',
       e.store_id, e.org_id, 8.40, 80.00
from public.employees e where e.pin in ('1101','2201');

-- files[].path MUST match the objects uploaded into customer-uploads by the
-- storage seed (staging.md §5 item 5). A queue row pointing at a nonexistent
-- object is not a negative fixture — it cannot distinguish "denied" from
-- "absent", so authorized access has to be provable first.
insert into public.pending_jobs (customer_name, job_date, queue_number, files, source, store_id, org_id)
select 'Synthetic Customer '||s.slug, to_char(now(),'YYYY-MM-DD'), 1,
       jsonb_build_array(jsonb_build_object(
         'name','synthetic.pdf',
         'path', s.slug||'/synthetic.pdf',
         'size', 1024,
         'type','application/pdf')),
       'upload', s.id, s.org_id
from public.stores s where s.slug in ('staging-t1-store','staging-t2-store');

insert into public.print_jobs (job_type, quantity, total_price, customer_name, customer_email,
                               customer_phone, file_urls, store_id, org_id)
select 'sheet', 10, 12.34, 'Synthetic '||s.slug, 'synthetic@example.invalid', '555-0000',
       jsonb_build_array(jsonb_build_object(
         'name','synthetic-job.pdf',
         'path','jobs/'||s.slug||'/synthetic-job.pdf')),
       s.id, s.org_id
from public.stores s where s.slug in ('staging-t1-store','staging-t2-store');

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Both rows must be identical apart from the slug. Asymmetry means the seed
-- did not fully apply, and a cross-tenant test run on it would be unsound.
select s.slug,
  (select count(*) from public.employees    x where x.store_id = s.id) as employees,
  (select count(*) from public.paper_types  x where x.store_id = s.id) as papers,
  (select count(*) from public.sheet_prices x where x.store_id = s.id) as prices,
  (select count(*) from public.orders       x where x.store_id = s.id) as orders,
  (select count(*) from public.pending_jobs x where x.store_id = s.id) as queue,
  (select count(*) from public.print_jobs   x where x.store_id = s.id) as jobs
from public.stores s
where s.slug in ('staging-t1-store','staging-t2-store')
order by s.slug;
