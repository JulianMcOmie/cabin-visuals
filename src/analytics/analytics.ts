'use client'

import { track as vercelTrack } from '@vercel/analytics'
import { getPostHog } from './posthog'

/**
 * One thin seam over the analytics vendors: the rest of the app only ever calls
 * track() with a name from the curated event list below - the funnel steps we
 * actually chart. It fans out to Vercel Web Analytics (top-line traffic) and
 * PostHog (per-user timelines, funnels, events over time). Both underlying
 * calls no-op safely when unconfigured (local dev) or opted out, so this is
 * always safe to call. Swapping vendors later means rewriting this file only.
 */

export type AnalyticsEvent =
  // Landing
  | 'try_it_out_clicked'
  | 'continue_creating_clicked' // props: { destination: 'editor' | 'projects' }
  | 'watch_demo_clicked'
  | 'demo_video_engaged' // props: { video } - clicked into the demo iframe (cross-origin, so this is the only play signal)
  | 'demo_video_switched' // props: { method: 'arrow' | 'dot' | 'thumb', video }
  // Header/nav + CTA links that navigate. props: { from, to }
  | 'nav_clicked'
  // Pricing
  | 'pricing_upgrade_clicked'
  | 'pricing_start_creating_clicked' // props: { destination: 'editor' | 'projects' }
  // Projects
  | 'new_project_clicked'
  | 'project_created' // props: { source: 'blank' | 'template' | 'carryover', template? }
  | 'project_opened'
  | 'project_deleted'
  // Auth
  | 'signup_started'
  | 'signup_password_set'
  | 'login_submitted'
  | 'google_signin_submitted' // props: { page: 'login' | 'signup' }
  | 'password_reset_requested'
  | 'password_update_submitted'
  | 'sign_out_clicked'
  // Account / billing
  | 'manage_billing_clicked'
  // Editor
  | 'editor_upgrade_clicked'
  | 'editor_discord_clicked'
  | 'export_clicked'
  | 'lyrics_clicked'
  | 'lyrics_transcribe_clicked'
  | 'lyrics_align_clicked'
  | 'lyrics_applied' // props: { source: 'transcription' | 'aligned' | 'pasted', words }
  | 'template_applied' // props: { template } - switched onto a template from the editor library
  | 'tutorial_completed'
  | 'tutorial_skipped'

export function track(event: AnalyticsEvent, props?: Record<string, string | number | boolean | null>) {
  vercelTrack(event, props)
  getPostHog()?.capture(event, props ?? undefined)
}
