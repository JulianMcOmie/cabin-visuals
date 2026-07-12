-- Photo bytes live in a private Storage bucket, addressed as
-- {userId}/{projectId}/{photoId} - the same ownership scheme as project-videos
-- (see 0003) and project-audio (see 0001). Hand-written for the same reason:
-- buckets and storage.objects policies aren't expressible in db/schema.ts.
-- The per-file cap is pinned to PHOTO_MAX_MB (photoUploads.ts = 25 MB); if that
-- changes, change both. Requires the project-wide Storage upload limit
-- (dashboard: Storage -> Settings) to be >= 25 MB.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('project-photos', 'project-photos', false, 26214400)
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
UPDATE storage.buckets SET file_size_limit = 26214400 WHERE id = 'project-photos';
--> statement-breakpoint
DROP POLICY IF EXISTS "project_photos_select_own" ON storage.objects;--> statement-breakpoint
DROP POLICY IF EXISTS "project_photos_insert_own" ON storage.objects;--> statement-breakpoint
DROP POLICY IF EXISTS "project_photos_update_own" ON storage.objects;--> statement-breakpoint
DROP POLICY IF EXISTS "project_photos_delete_own" ON storage.objects;--> statement-breakpoint
CREATE POLICY "project_photos_select_own" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'project-photos' AND (storage.foldername(name))[1] = (select auth.uid())::text);--> statement-breakpoint
CREATE POLICY "project_photos_insert_own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'project-photos' AND (storage.foldername(name))[1] = (select auth.uid())::text);--> statement-breakpoint
CREATE POLICY "project_photos_update_own" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'project-photos' AND (storage.foldername(name))[1] = (select auth.uid())::text)
  WITH CHECK (bucket_id = 'project-photos' AND (storage.foldername(name))[1] = (select auth.uid())::text);--> statement-breakpoint
CREATE POLICY "project_photos_delete_own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'project-photos' AND (storage.foldername(name))[1] = (select auth.uid())::text);
