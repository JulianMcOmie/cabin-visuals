-- Baseline migration, hand-tuned: projects + profiles already exist in the live
-- database (created via the dashboard), so every statement is written to be
-- correct both there (adopt + extend in place) and on a fresh database.
CREATE TABLE IF NOT EXISTS "profiles" (
	"user_id" uuid PRIMARY KEY DEFAULT (select auth.uid()) NOT NULL,
	"first_name" text,
	"last_name" text,
	"email" text
);
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"data" jsonb DEFAULT '{"schemaVersion":1,"bpm":120,"beatsPerBar":4,"totalBars":32,"tracks":{},"rootTrackIds":[]}'::jsonb NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Live DB: the table pre-exists without the document columns; the defaults
-- backfill the existing rows with an empty v1 document.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "data" jsonb DEFAULT '{"schemaVersion":1,"bpm":120,"beatsPerBar":4,"totalBars":32,"tracks":{},"rootTrackIds":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "schema_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- Live DB: equivalent FKs already exist under their dashboard-era names
-- (profiles_user_id_fkey / projects_user_id_fkey) — only add if absent.
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conrelid = 'public.profiles'::regclass AND contype = 'f'
	) THEN
		ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conrelid = 'public.projects'::regclass AND contype = 'f'
	) THEN
		ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
-- Replace the dashboard-created policies with the ones declared in db/schema.ts
-- (same behavior; code becomes the single source of truth).
DROP POLICY IF EXISTS "Enable users to view their own data only" ON "profiles";--> statement-breakpoint
DROP POLICY IF EXISTS "Enable insert for users based on user_id" ON "profiles";--> statement-breakpoint
DROP POLICY IF EXISTS "Enable update for users based on email" ON "profiles";--> statement-breakpoint
DROP POLICY IF EXISTS "Enable delete for users based on user_id" ON "profiles";--> statement-breakpoint
DROP POLICY IF EXISTS "Allow authenticated read access" ON "projects";--> statement-breakpoint
DROP POLICY IF EXISTS "Allow authenticated insert access" ON "projects";--> statement-breakpoint
DROP POLICY IF EXISTS "Allow authenticated update access" ON "projects";--> statement-breakpoint
DROP POLICY IF EXISTS "Allow authenticated delete access" ON "projects";--> statement-breakpoint
CREATE POLICY "profiles_select_own" ON "profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "profiles"."user_id");--> statement-breakpoint
CREATE POLICY "profiles_insert_own" ON "profiles" AS PERMISSIVE FOR INSERT TO public WITH CHECK ((select auth.uid()) = "profiles"."user_id");--> statement-breakpoint
CREATE POLICY "profiles_update_own_email" ON "profiles" AS PERMISSIVE FOR UPDATE TO public USING (((select auth.jwt()) ->> 'email') = "profiles"."email") WITH CHECK (((select auth.jwt()) ->> 'email') = "profiles"."email");--> statement-breakpoint
CREATE POLICY "profiles_delete_own" ON "profiles" AS PERMISSIVE FOR DELETE TO public USING ((select auth.uid()) = "profiles"."user_id");--> statement-breakpoint
CREATE POLICY "projects_select_own" ON "projects" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "projects"."user_id");--> statement-breakpoint
CREATE POLICY "projects_insert_own" ON "projects" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.uid()) = "projects"."user_id");--> statement-breakpoint
CREATE POLICY "projects_update_own" ON "projects" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.uid()) = "projects"."user_id") WITH CHECK ((select auth.uid()) = "projects"."user_id");--> statement-breakpoint
CREATE POLICY "projects_delete_own" ON "projects" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.uid()) = "projects"."user_id");
