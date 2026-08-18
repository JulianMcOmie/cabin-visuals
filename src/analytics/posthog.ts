'use client'

import type { PostHog } from 'posthog-js'
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
let loading: Promise<PostHog | null> | null = null

/** Resolve the initialised client, loading posthog-js on demand. The library
 *  is ~70 KB gzipped and used to sit in the root layout's shared bundle on
 *  every route; now it arrives as its own chunk after hydration and the
 *  first events wait for it (in order) instead of the page waiting for it. */
export function loadPostHog(): Promise<PostHog | null> {
  if (loading) return loading
  loading = (async () => {
    if (typeof window === 'undefined') return null
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
    if (!key) return null
    if (localStorage.getItem(ANALYTICS_OPTOUT_KEY)) return null

    const { default: posthog } = await import('posthog-js')
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
  })()
  return loading
}

/** Run `fn` against the client - now if it is loaded, else once it is (calls
 *  queue in order behind the same promise). A no-op when unconfigured/opted out. */
export function withPostHog(fn: (ph: PostHog) => void): void {
  if (instance) { fn(instance); return }
  void loadPostHog().then((ph) => { if (ph) fn(ph) })
}
