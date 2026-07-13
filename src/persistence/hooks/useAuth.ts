import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { getSupabase } from '../supabase'

// Module-level cache of the last-known user. Every client navigation rebuilds
// each page's header (and its ProfileMenu), so without this each remount would
// flash null -> user while getUser() resolves. Seeding state from the cache
// makes the second-and-later mounts render the signed-in user synchronously; a
// live onAuthStateChange subscription keeps every mounted instance in sync.
let cachedUser: User | null = null
let resolvedOnce = false

/** The signed-in user (RLS row owner), kept live via onAuthStateChange.
 *  `loading` is true only for the initial fetch. `isAnonymous` marks a
 *  sign-in-to-save session: signed in for persistence, but not a real
 *  identity yet - surfaces that mean "has an account" must check
 *  `user && !isAnonymous`, not just `user`. */
export function useAuth() {
  const [user, setUser] = useState<User | null>(cachedUser)
  const [loading, setLoading] = useState(!resolvedOnce)

  useEffect(() => {
    const supabase = getSupabase()
    let mounted = true

    // Only pay the network cost once; later mounts already have the cache and
    // stay fresh through the subscription below.
    if (!resolvedOnce) {
      supabase.auth.getUser().then(({ data }) => {
        cachedUser = data.user
        resolvedOnce = true
        if (mounted) { setUser(data.user); setLoading(false) }
      })
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      cachedUser = session?.user ?? null
      resolvedOnce = true
      if (mounted) { setUser(session?.user ?? null); setLoading(false) }
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  return { user, loading, isAnonymous: !!user?.is_anonymous }
}
