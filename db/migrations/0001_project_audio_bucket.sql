-- Audio bytes live in a private Storage bucket, addressed as
-- {userId}/{projectId}/{clipId}. Buckets and storage.objects policies aren't
-- expressible in db/schema.ts (Drizzle has no Storage concept), so this is a
-- hand-written migration in the same chain. RLS keys on the first path folder
-- equalling auth.uid() — the standard Supabase Storage ownership pattern.
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-audio', 'project-audio', false)
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
DROP POLICY IF EXISTS "project_audio_select_own" ON storage.objects;--> statement-breakpoint
DROP POLICY IF EXISTS "project_audio_insert_own" ON storage.objects;--> statement-breakpoint
DROP POLICY IF EXISTS "project_audio_update_own" ON storage.objects;--> statement-breakpoint
DROP POLICY IF EXISTS "project_audio_delete_own" ON storage.objects;--> statement-breakpoint
CREATE POLICY "project_audio_select_own" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'project-audio' AND (storage.foldername(name))[1] = (select auth.uid())::text);--> statement-breakpoint
CREATE POLICY "project_audio_insert_own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'project-audio' AND (storage.foldername(name))[1] = (select auth.uid())::text);--> statement-breakpoint
CREATE POLICY "project_audio_update_own" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'project-audio' AND (storage.foldername(name))[1] = (select auth.uid())::text)
  WITH CHECK (bucket_id = 'project-audio' AND (storage.foldername(name))[1] = (select auth.uid())::text);--> statement-breakpoint
CREATE POLICY "project_audio_delete_own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'project-audio' AND (storage.foldername(name))[1] = (select auth.uid())::text);
