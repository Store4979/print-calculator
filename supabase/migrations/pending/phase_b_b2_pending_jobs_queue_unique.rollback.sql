-- ROLLBACK for phase_b_b2_pending_jobs_queue_unique (version assigned at apply time).
-- Drops the per-store uniqueness on the walk-up queue number. The deployed
-- register-job keeps working either way: its retry simply never fires.
begin;
alter table public.pending_jobs drop constraint if exists pending_jobs_store_day_queue_key;
commit;
