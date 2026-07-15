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
  | 'try_it_out_clicked'
  | 'pricing_upgrade_clicked'
  | 'editor_upgrade_clicked'
  | 'export_clicked'
  | 'signup_started'
  | 'tutorial_completed'
  | 'tutorial_skipped'

export function track(event: AnalyticsEvent, props?: Record<string, string | number | boolean | null>) {
  vercelTrack(event, props)
  getPostHog()?.capture(event, props ?? undefined)
}
