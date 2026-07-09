'use client'

import { Analytics } from '@vercel/analytics/next'

/**
 * Mounts Vercel Analytics with an opt-out gate so our own visits don't
 * pollute the funnel numbers. Visit /analytics-optout to toggle the flag
 * for a browser (it just sets this localStorage key).
 *
 * The flag is per-browser-per-device and survives until site data is
 * cleared. beforeSend runs client-side for every pageview and custom
 * track() event, so returning null drops them all.
 */
export const ANALYTICS_OPTOUT_KEY = 'cabin-analytics-optout'

export function AnalyticsGate() {
  return (
    <Analytics
      beforeSend={(event) =>
        localStorage.getItem(ANALYTICS_OPTOUT_KEY) ? null : event
      }
    />
  )
}
