ALTER TABLE public.print_jobs
  ADD COLUMN IF NOT EXISTS file_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.print_jobs.file_urls IS
  'Array of {name, path, size, type, side, qty, rotation} records pointing at job-files storage bucket. Populated when files are uploaded alongside a job.';