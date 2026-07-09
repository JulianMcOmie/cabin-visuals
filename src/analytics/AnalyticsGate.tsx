'use client'

import { Analytics } from '@vercel/analytics/next'

/**
 * Mounts Vercel Analytics with an opt-out gate so our own visits don't
 * pollute the funnel numbers. To exclude a browser, run this once in its
 * devtools console on the production site:
 *
 *   localStorage.setItem('cabin-analytics-optout', '1')
 *
 * The flag is per-browser-per-device and survives until site data is
 * cleared. beforeSend runs client-side for every pageview and custom
 * track() event, so returning null drops them all.
 */
export function AnalyticsGate() {
  return (
    <Analytics
      beforeSend={(event) =>
        localStorage.getItem('cabin-analytics-optout') ? null : event
      }
    />
  )
}
