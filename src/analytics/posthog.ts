'use client'

import posthog, { type PostHog } from 'posthog-js'
import { ANALYTICS_OPTOUT_KEY } from './AnalyticsGate'

/**
 * PostHog runs alongside Vercel Web Analytics: Vercel owns top-line traffic,
 * PostHog owns product analytics - per-user timelines, funnels, and events
 * over time. Both are driven from the single track() seam in analytics.ts.
 *
 * Lazy singleton, initialised on first access on the client only. Returns null
 * when unconfigured (no NEXT_PUBLIC_POSTHOG_KEY, e.g. local dev) or when this
 * browser has opted out via /analytics-optout - so every call site stays a
 * safe no-op without its own guards.
 *
 *   person_profiles: 'identified_only' - anonymous editor sessions (our
 *   sign-in-to-save flow creates a Supabase user for everyone) don't burn a
 *   person profile; only signed-in users we identify() become people. That is
 *   exactly the "usage per real user" view we're after, and it keeps us far
 *   under the free-tier event cap.
 */
let instance: PostHog | null = null
let tried = false

export function getPostHog(): PostHog | null {
  if (tried) return instance
  tried = true

  if (typeof window === 'undefined') return null
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key) return null
  if (localStorage.getItem(ANALYTICS_OPTOUT_KEY)) return null

  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
    person_profiles: 'identified_only',
    capture_pageview: true,
    // The editor is one long-lived SPA route; also count client-side
    // navigations as pageviews so the funnel isn't just the first load.
    capture_pageleave: true,
  })
  instance = posthog
  return instance
}
