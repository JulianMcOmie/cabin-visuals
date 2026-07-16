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
 *   person_profiles: 'always' - every visitor becomes a person, so PostHog's
 *   "active users" tracks real traffic (like Vercel's unique visitors) instead
 *   of only the handful of signed-in users we identify(). Costs more of the
 *   free-tier event cap than 'identified_only'; flip back if volume ever bites.
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
    // Same-origin proxy (rewrites in next.config.ts) so ad blockers that
    // blacklist *.posthog.com don't eat the events; ui_host keeps toolbar
    // and deep links pointed at the real PostHog UI.
    api_host: '/ingest',
    ui_host: 'https://us.posthog.com',
    person_profiles: 'always',
    // 'history_change' captures client-side route changes too (App Router
    // navigations, e.g. landing -> /projects) - plain `true` only fires on
    // full page loads.
    capture_pageview: 'history_change',
    capture_pageleave: true,
  })
  instance = posthog
  return instance
}
