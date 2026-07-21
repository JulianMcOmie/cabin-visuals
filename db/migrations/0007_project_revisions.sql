-- Automatic version history for project documents: before a project row is
-- overwritten, the OLD document is copied into project_revisions.
--
-- This lives in the database, not the app, on purpose. A snapshot written by
-- the client is one refactor away from being silently dropped - and the whole
-- point of this table is to survive bugs we haven't written yet. As a trigger,
-- EVERY write to projects is covered: autosave, a future code path, a script
-- run by hand in the SQL editor.
--
-- Hand-written (like the storage buckets in 0001/0003/0005) because tables with
-- triggers aren't expressible in db/schema.ts; project_revisions is outside
-- drizzle.config.ts's tablesFilter, so drizzle-kit leaves it alone.
CREATE TABLE IF NOT EXISTS "project_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "auth"."users"("id") ON DELETE CASCADE,
  -- The document as it was BEFORE the update that triggered this snapshot.
  "data" jsonb NOT NULL,
  -- The projects.rev this document was at, so a restore can be reasoned about.
  "rev" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
-- Every query here is "the newest N for one project".
CREATE INDEX IF NOT EXISTS "project_revisions_project_created_idx"
  ON "project_revisions" ("project_id", "created_at" DESC);--> statement-breakpoint
ALTER TABLE "project_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Read-only to the browser, and only your own. There are deliberately no
-- insert/update/delete policies: the trigger below is SECURITY DEFINER, so it
-- is the ONLY writer. A client cannot forge or erase its own history.
DROP POLICY IF EXISTS "project_revisions_select_own" ON "project_revisions";--> statement-breakpoint
CREATE POLICY "project_revisions_select_own" ON "project_revisions" FOR SELECT TO authenticated
  USING ((select auth.uid()) = "user_id");--> statement-breakpoint

CREATE OR REPLACE FUNCTION "snapshot_project_revision"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  last_at timestamptz;
BEGIN
  -- Renames and rev-only touches aren't document history.
  IF NEW.data IS NOT DISTINCT FROM OLD.data THEN
    RETURN NEW;
  END IF;

  -- Everything below is best-effort. This trigger sits in the path of EVERY
  -- write to projects, so a fault in it would fail the user's save - the
  -- safety net must never be the thing that drowns them. A failed snapshot
  -- costs one missing history entry; a failed save costs the user's work.
  BEGIN
    -- Autosave fires on a ~1s debounce during active editing, so snapshotting
    -- every update would be thousands of rows an hour. One every 5 minutes of
    -- editing is the useful granularity: enough to bound what a bad overwrite
    -- can cost, cheap enough to keep forever.
    SELECT created_at INTO last_at
    FROM project_revisions
    WHERE project_id = OLD.id
    ORDER BY created_at DESC
    LIMIT 1;

    IF last_at IS NOT NULL AND last_at > now() - interval '5 minutes' THEN
      RETURN NEW;
    END IF;

    -- `- 'thumbnail'` drops the captured JPEG data URL that rides in the
    -- document for the projects-page card (see autosave.ts). It's the single
    -- biggest field and it's worthless in history - keeping it would multiply
    -- this table's size for no recovery value.
    INSERT INTO project_revisions (project_id, user_id, data, rev)
    VALUES (OLD.id, OLD.user_id, OLD.data - 'thumbnail', OLD.rev);

    -- Keep the newest 20 per project.
    DELETE FROM project_revisions
    WHERE project_id = OLD.id
      AND id NOT IN (
        SELECT id FROM project_revisions
        WHERE project_id = OLD.id
        ORDER BY created_at DESC
        LIMIT 20
      );
  EXCEPTION WHEN OTHERS THEN
    -- Log it and let the save through. Anything reaching here (a missing
    -- table, a permissions change, a bad document shape) is a bug worth
    -- fixing, but never at the cost of the write the user is waiting on.
    RAISE WARNING 'project revision snapshot failed for %: %', OLD.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS "projects_snapshot_revision" ON "projects";--> statement-breakpoint
CREATE TRIGGER "projects_snapshot_revision"
  BEFORE UPDATE ON "projects"
  FOR EACH ROW
  EXECUTE FUNCTION "snapshot_project_revision"();
