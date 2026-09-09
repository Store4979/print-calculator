-- Commission tracking — Phase 1
create table if not exists public.employees (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  pin         text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint employees_pin_4digit check (pin ~ '^\d{4}$'),
  constraint employees_pin_unique unique (pin)
);
create index if not exists employees_active_idx on public.employees (active);

create table if not exists public.transactions (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references public.employees(id),
  employee_name       text not null,
  total               numeric(10,2) not null,
  base_subtotal       numeric(10,2) not null,
  upsell_subtotal     numeric(10,2) not null,
  base_commission     numeric(10,2) not null,
  upsell_commission   numeric(10,2) not null,
  total_commission    numeric(10,2) not null,
  line_items          jsonb not null,
  service_type        text not null,
  notes               text,
  created_at          timestamptz not null default now()
);
create index if not exists transactions_employee_idx   on public.transactions (employee_id);
create index if not exists transactions_created_at_idx on public.transactions (created_at desc);

create table if not exists public.commission_settings (
  id                       int primary key default 1,
  base_rate                numeric(5,4)  not null default 0.0200,
  upsell_rate              numeric(5,4)  not null default 0.0800,
  monthly_bonus_threshold  numeric(10,2) not null default 5000.00,
  monthly_bonus_amount     numeric(10,2) not null default 50.00,
  updated_at               timestamptz   not null default now(),
  constraint commission_settings_singleton check (id = 1)
);
insert into public.commission_settings (id) values (1) on conflict (id) do nothing;

alter table public.employees           enable row level security;
alter table public.transactions        enable row level security;
alter table public.commission_settings enable row level security;

drop policy if exists "anon_rw_employees" on public.employees;
create policy "anon_rw_employees" on public.employees for all to anon, authenticated using (true) with check (true);
drop policy if exists "anon_rw_transactions" on public.transactions;
create policy "anon_rw_transactions" on public.transactions for all to anon, authenticated using (true) with check (true);
drop policy if exists "anon_rw_commission_settings" on public.commission_settings;
create policy "anon_rw_commission_settings" on public.commission_settings for all to anon, authenticated using (true) with check (true);
