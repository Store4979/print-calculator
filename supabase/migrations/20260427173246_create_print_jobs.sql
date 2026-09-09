-- Print job history table for The UPS Store #4979 print calculator.
-- Schema mirrors the calculator's per-job snapshot. Staff use only.

create table if not exists public.print_jobs (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),

  job_type          text not null,
  paper_type        text,
  paper_key         text,
  sheet_size        text,
  sku               text,
  print_size        text,
  orientation       text,
  color_mode        text,

  quantity          integer,
  sheets_needed     integer,
  sides             text,

  per_sheet_price   numeric(12,4),
  discount_percent  numeric(6,3),
  total_price       numeric(12,2),

  file_names        text[],

  customer_name     text,
  customer_email    text,
  customer_phone    text,
  notes             text,

  addons            jsonb,
  job_details       jsonb
);

create index if not exists print_jobs_created_at_idx
  on public.print_jobs (created_at desc);

create index if not exists print_jobs_job_type_idx
  on public.print_jobs (job_type);

create index if not exists print_jobs_customer_name_idx
  on public.print_jobs (lower(customer_name));

-- Enable Row Level Security and allow anon insert + select.
-- Access is gated client-side by the staff password (this is a
-- staff-only tool, not a public app).
alter table public.print_jobs enable row level security;

drop policy if exists "anon_can_insert_print_jobs" on public.print_jobs;
create policy "anon_can_insert_print_jobs"
  on public.print_jobs
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "anon_can_select_print_jobs" on public.print_jobs;
create policy "anon_can_select_print_jobs"
  on public.print_jobs
  for select
  to anon, authenticated
  using (true);
