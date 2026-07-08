-- Video bytes live in a private Storage bucket, addressed as
-- {userId}/{projectId}/{clipId} - the same ownership scheme as project-audio
-- (see 0001). Hand-written for the same reason: buckets and storage.objects
-- policies aren't expressible in db/schema.ts.
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-videos', 'project-videos', false)
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
DROP POLICY IF EXISTS "project_videos_select_own" ON storage.objects;--> statement-breakpoint
DROP POLICY IF EXISTS "project_videos_insert_own" ON storage.objects;--> statement-breakpoint
DROP POLICY IF EXISTS "project_videos_update_own" ON storage.objects;--> statement-breakpoint
DROP POLICY IF EXISTS "project_videos_delete_own" ON storage.objects;--> statement-breakpoint
CREATE POLICY "project_videos_select_own" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'project-videos' AND (storage.foldername(name))[1] = (select auth.uid())::text);--> statement-breakpoint
CREATE POLICY "project_videos_insert_own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'project-videos' AND (storage.foldername(name))[1] = (select auth.uid())::text);--> statement-breakpoint
CREATE POLICY "project_videos_update_own" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'project-videos' AND (storage.foldername(name))[1] = (select auth.uid())::text)
  WITH CHECK (bucket_id = 'project-videos' AND (storage.foldername(name))[1] = (select auth.uid())::text);--> statement-breakpoint
CREATE POLICY "project_videos_delete_own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'project-videos' AND (storage.foldername(name))[1] = (select auth.uid())::text);
