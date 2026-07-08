import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { getSupabase } from '../supabase'

/** The signed-in user (RLS row owner), kept live via onAuthStateChange.
 *  `loading` is true only for the initial fetch. `isAnonymous` marks a
 *  sign-in-to-save session: signed in for persistence, but not a real
 *  identity yet - surfaces that mean "has an account" must check
 *  `user && !isAnonymous`, not just `user`. */
export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = getSupabase()
    let mounted = true

    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return
      setUser(data.user)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) setUser(session?.user ?? null)
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  return { user, loading, isAnonymous: !!user?.is_anonymous }
}
