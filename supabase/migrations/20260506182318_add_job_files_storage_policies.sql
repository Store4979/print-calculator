DROP POLICY IF EXISTS job_files_anon_insert ON storage.objects;
DROP POLICY IF EXISTS job_files_anon_select ON storage.objects;
DROP POLICY IF EXISTS job_files_anon_delete ON storage.objects;

CREATE POLICY job_files_anon_insert ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'job-files');

CREATE POLICY job_files_anon_select ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'job-files');

CREATE POLICY job_files_anon_delete ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (bucket_id = 'job-files');