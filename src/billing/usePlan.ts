'use client'

import { useEffect, useState } from 'react'
import { beginNavigation } from '../components/instantNavigation'
import { getSupabase } from '../persistence/supabase'

// Client-side plan state. `isPro` gates UI niceties only (resolution picker,
// watermark toggle) - the source of truth is the RLS-guarded subscriptions row,
// and signed-out or row-less users are simply free tier.

export interface PlanState {
  /** True only during the initial fetch - gate "Upgrade" buttons on it so they don't flash at Pros. */
  loading: boolean
  isPro: boolean
}

function proFromStatus(status: string | null | undefined): boolean {
  return status === 'active' || status === 'trialing'
}

export function usePlan(): PlanState {
  const [state, setState] = useState<PlanState>({ loading: true, isPro: false })

  useEffect(() => {
    const supabase = getSupabase()
    let mounted = true

    const fetchPlan = async () => {
      // getSession(), not getUser(): this only needs to know whether there is a
      // session at all, and getUser() is a network round trip taken on the auth
      // lock that useAuth is also waiting on - so paying for it here delayed the
      // whole page's auth resolution, not just this hook's. The stored session
      // is enough because it isn't trusted for anything: the subscriptions row
      // is RLS-guarded, so a forged one still reads back nothing.
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        if (mounted) setState({ loading: false, isPro: false })
        return
      }
      const { data } = await supabase.from('subscriptions').select('status').maybeSingle()
      if (mounted) setState({ loading: false, isPro: proFromStatus(data?.status) })
    }

    void fetchPlan()
    const { data: sub } = supabase.auth.onAuthStateChange(() => void fetchPlan())
    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  return state
}

/** Kick off Stripe Checkout for Pro; sends signed-out users to /login. */
export async function startCheckout(): Promise<void> {
  const returnTo = window.location.pathname + window.location.search
  const res = await fetch('/api/stripe/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnTo }),
  })
  if (res.status === 401) {
    beginNavigation()
    window.location.href = '/login'
    return
  }
  if (res.status === 403) {
    // Anonymous session - a subscription needs a real account first.
    beginNavigation()
    window.location.href = '/signup'
    return
  }
  const body = await res.json()
  if (body.url) { beginNavigation(); window.location.href = body.url }
  else throw new Error(body.error ?? 'Checkout failed')
}

/** Open Stripe's billing portal (update card / cancel). */
export async function openBillingPortal(): Promise<void> {
  const returnTo = window.location.pathname + window.location.search
  const res = await fetch('/api/stripe/portal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnTo }),
  })
  const body = await res.json()
  if (body.url) { beginNavigation(); window.location.href = body.url }
  else throw new Error(body.error ?? 'Could not open billing portal')
}
