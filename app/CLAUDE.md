# app/ — Next.js App Router routes

Thin shell around `src/`. Pages are mostly small; the product lives in `src/editor` and `src/components`.

- `page.tsx` — landing. Landing pages are swappable "covers" in `src/components/landing/`: each cover is a complete page, registered in its `index.tsx`, and the one-line `ACTIVE_LANDING` const picks which ships (`editorial` = the 2026 serif/cyan redesign, `classic` = the previous design, kept intact for instant revert). The editorial look extends to pricing/auth/start/projects via `<EditorialSkin>` (`editorialTheme.tsx`) — a scoped `.editorial-skin` class in `globals.css` that remaps the global design tokens (and reroutes `font-sans`/`font-mono` onto Manrope/DM Mono), so those screens restyle without markup rewrites and un-skin by removing the wrapper. The editor is never skinned. `layout.tsx` — root layout + analytics gate (PostHog, opt-out at `/analytics-optout`).
- `editor/page.tsx` — client-only `dynamic()` import of `src/editor/App` (three.js bundle is heavy; `EditorLoadingShell` fills both the chunk load and the required Suspense boundary for `useSearchParams`). Query params: `?project=<id>` (persisted project), `?template=<id>` (account-free demo). **No project id / no Supabase env = fully in-memory editor** — the smoke-test path, no login needed.
- `projects/` — project grid (list/create/delete; `src/persistence/hooks/useProjectList`, thumbnails from autosave captures).
- `start/`, `lyric-setup/`, `photo-setup/` — onboarding funnels into templates (lyric flow: upload audio → transcribe → pick a style; screens live in `src/editor/components/*SetupScreen.tsx`).
- `(auth)/` — login/signup/confirm/reset/update-password/logout on Supabase auth (`src/utils/supabase`, `src/components/AuthButtons`). Anonymous-session work created pre-auth is adopted after sign-in (`src/persistence/adoptionHandoff.ts`).
- `pricing/`, `account/` — plans and account management; plan state via `src/billing/usePlan.ts`.
- `api/` route handlers:
  - `stripe/checkout|portal|confirm|webhook` — billing (`src/utils/stripe.ts`, `src/billing/syncSubscription.ts`; webhook syncs subscription rows).
  - `transcribe` — proxy to ElevenLabs Scribe: signed URL of the uploaded song in (never bytes — Vercel body caps), word-level timestamps out (feeds `lyricTiming`). `align` — ElevenLabs Forced Alignment: known lyric text + audio → tight word onsets. Both need `ELEVENLABS_API_KEY` (503 with a user-visible message without it).
  - `add-email` — marketing capture to Airtable (owner notify via Resend in `src/notifications`).
- `dev/` — internal playgrounds (`landing-lab` A/B/C prototypes, `instrument-previews` capture rig used by `scripts/generate-instrument-previews.mjs`). `spike/` — scratch. Neither is linked from the product.

DB schema for Drizzle lives in `db/` (`drizzle.config.ts`, migrations in `db/migrations`); Supabase envs in `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, plus `DATABASE_URL` for migrations, Stripe keys for billing).
