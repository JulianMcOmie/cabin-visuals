'use client'

import { track as vercelTrack } from '@vercel/analytics'

/**
 * One thin seam over the analytics vendor (Vercel Web Analytics today): the
 * rest of the app only ever calls track() with a name from the curated event
 * list below - the funnel steps we actually chart. Outside a Vercel deployment
 * (local dev) the underlying call is a debug no-op, so this is always safe to
 * call. Swapping vendors later means rewriting this file and nothing else.
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
}
