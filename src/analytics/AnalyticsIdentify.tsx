'use client'

import { useEffect, useRef } from 'react'
import { useAuth } from '../persistence/hooks/useAuth'
import { usePathname } from 'next/navigation'
import { syncSessionRecording, withPostHog } from './posthog'

/**
 * Headless: bridges Supabase auth into PostHog so every event carries a stable
 * person. Mounted once in the root layout beside <AnalyticsGate />.
 *
 * Only real accounts are identified - an anonymous sign-in-to-save session
 * (user.is_anonymous) stays a nameless device person (person_profiles:
 * 'always'). The moment such a session converts to a real account,
 * onAuthStateChange updates useAuth and we identify() the same uuid, so the
 * pre-signup events already captured on this device stitch onto the new person.
 * On logout we reset() to start a fresh anonymous device id.
 */
export function AnalyticsIdentify() {
  const { user, loading, isAnonymous } = useAuth()
  const identified = useRef<string | null>(null)
  // Replay is paused inside the editor (see posthog.ts) - re-evaluated on
  // every client-side route change.
  const pathname = usePathname()
  useEffect(() => { syncSessionRecording(pathname ?? '/') }, [pathname])

  useEffect(() => {
    if (loading) return
    const realUserId = user && !isAnonymous ? user.id : null
    const email = user?.email
    withPostHog((ph) => {
      if (realUserId) {
        if (identified.current !== realUserId) {
          ph.identify(realUserId, email ? { email } : undefined)
          identified.current = realUserId
        }
      } else if (identified.current) {
        // Signed out (or dropped back to anonymous): forget the person.
        ph.reset()
        identified.current = null
      }
    })
  }, [user, loading, isAnonymous])

  return null
}
