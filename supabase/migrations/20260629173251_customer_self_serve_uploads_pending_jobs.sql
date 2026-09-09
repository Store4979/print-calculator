create table if not exists public.pending_jobs (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  customer_name text not null,
  job_date      text not null,
  queue_number  int  not null,
  files         jsonb not null default '[]'::jsonb,
  notes         text,
  source        text not null default 'upload'
);

create index if not exists pending_jobs_created_at_idx on public.pending_jobs (created_at);
create index if not exists pending_jobs_job_date_idx    on public.pending_jobs (job_date);

alter table public.pending_jobs enable row level security;
alter table public.pending_jobs replica identity full;

drop policy if exists "anon_select_pending_jobs" on public.pending_jobs;
create policy "anon_select_pending_jobs"
  on public.pending_jobs
  for select
  to anon, authenticated
  using (true);

-- Idempotent realtime publication add.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pending_jobs'
  ) then
    alter publication supabase_realtime add table public.pending_jobs;
  end if;
end $$;

-- Private bucket for customer files.
insert into storage.buckets (id, name, public)
values ('customer-uploads', 'customer-uploads', false)
on conflict (id) do nothing;