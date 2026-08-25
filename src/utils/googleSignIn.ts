/**
 * Whether this build has a Google Sign-In client id at all.
 *
 * A dev checkout's `.env.local` usually carries only the Supabase keys, and
 * GSI is loud about the gap: its script logs a console error the moment it
 * scans a `g_id_onload` div (or takes an `initialize` call) with no
 * `client_id` — which Next's dev overlay then promotes to a full-screen error
 * badge on an otherwise working page. Every surface that renders the Google
 * button gates the WHOLE apparatus (the script tag included) on this, so an
 * unconfigured checkout simply shows email-only auth instead of an error.
 *
 * Inlined at build time (NEXT_PUBLIC_*), so deployments with the id configured
 * are byte-for-byte unaffected.
 */
export const GOOGLE_SIGNIN_ENABLED = !!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
