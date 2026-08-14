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

## The middleware is on every page load's critical path

`src/middleware.ts` matches everything except `_next/static`, `_next/image`, `ingest`,
the favicon and image extensions — so `src/utils/supabase/middleware.ts` runs before a
single byte of HTML goes out on **every full page load**. Whatever it awaits is pure
serialized latency in front of the whole app, and it is invisible to client-side
navigation (Next has already prefetched the RSC payload by click time). That asymmetry
is the standard explanation for "fast when I navigate, slow when I refresh" — measure
the middleware before hunting in the page.

- It reads `getSession()` (cookie, local), **not** `getUser()` (unconditional round trip
  to the auth server, ~200-500ms). The redirect decision is the only thing it uses the
  value for, and every page re-derives auth client-side with RLS as the real gate. The
  full reasoning, and why the boilerplate's "DO NOT REMOVE auth.getUser()" does not apply
  here, is written at the call site.
- **Session rotation does not depend on which one you call.** It lives in
  `GoTrueClient.__loadSession()`, which both go through, and is *not* gated on the
  `autoRefreshToken: false` that `createServerClient` sets. A token within
  `EXPIRY_MARGIN_MS` (90s) of expiry is refreshed there and the new cookies ride out on
  `TOKEN_REFRESHED` through the `setAll` adapter.
- Never read `session.user` on the server: it is behind a Proxy that logs an "insecure"
  warning on property access. Truthiness of `session` is free.
- `getClaims()` (local JWT verify, no round trip) is **not** an option on this project yet
  — `/auth/v1/.well-known/jwks.json` returns `{"keys":[]}`, i.e. legacy HS256 shared
  secret, and `getClaims()` silently falls back to `getUser()` for HS256. It becomes
  available only after migrating the project to asymmetric JWT signing keys.
