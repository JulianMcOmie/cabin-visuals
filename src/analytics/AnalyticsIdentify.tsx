'use client'

import { useEffect, useRef } from 'react'
import { useAuth } from '../persistence/hooks/useAuth'
import { getPostHog } from './posthog'

/**
 * Headless: bridges Supabase auth into PostHog so every event carries a stable
 * person. Mounted once in the root layout beside <AnalyticsGate />.
 *
 * Only real accounts are identified - an anonymous sign-in-to-save session
 * (user.is_anonymous) stays a nameless device, matching person_profiles:
 * 'identified_only'. The moment such a session converts to a real account,
 * onAuthStateChange updates useAuth and we identify() the same uuid, so the
 * pre-signup events already captured on this device stitch onto the new person.
 * On logout we reset() to start a fresh anonymous device id.
 */
export function AnalyticsIdentify() {
  const { user, loading, isAnonymous } = useAuth()
  const identified = useRef<string | null>(null)

  useEffect(() => {
    const ph = getPostHog()
    if (!ph || loading) return

    const realUserId = user && !isAnonymous ? user.id : null

    if (realUserId) {
      if (identified.current !== realUserId) {
        ph.identify(realUserId, user!.email ? { email: user!.email } : undefined)
        identified.current = realUserId
      }
    } else if (identified.current) {
      // Signed out (or dropped back to anonymous): forget the person.
      ph.reset()
      identified.current = null
    }
  }, [user, loading, isAnonymous])

  return null
}
