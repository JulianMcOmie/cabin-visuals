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

// One fetch per session, shared by every mount. Four+ components mount this
// hook at editor open (header, drop layer, media banks), and each used to run
// its own subscriptions query - twice, since onAuthStateChange replays
// INITIAL_SESSION to every new subscriber.
let cached: PlanState | null = null
let inflight: Promise<PlanState> | null = null
const listeners = new Set<(s: PlanState) => void>()

function publish(next: PlanState) {
  cached = next
  listeners.forEach((l) => l(next))
}

async function fetchPlan(): Promise<PlanState> {
  const supabase = getSupabase()
  // getSession(), not getUser(): this only needs to know whether there is a
  // session at all, and getUser() is a network round trip taken on the auth
  // lock that useAuth is also waiting on - so paying for it here delayed the
  // whole page's auth resolution, not just this hook's. The stored session
  // is enough because it isn't trusted for anything: the subscriptions row
  // is RLS-guarded, so a forged one still reads back nothing.
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { loading: false, isPro: false }
  const { data } = await supabase.from('subscriptions').select('status').maybeSingle()
  return { loading: false, isPro: proFromStatus(data?.status) }
}

function loadPlan(force = false): Promise<PlanState> {
  if (!force && cached) return Promise.resolve(cached)
  if (!inflight || force) {
    inflight = fetchPlan().then((s) => { publish(s); return s }).finally(() => { inflight = null })
  }
  return inflight
}

let authSubscribed = false
function subscribeAuthOnce() {
  if (authSubscribed) return
  authSubscribed = true
  getSupabase().auth.onAuthStateChange((event) => {
    // Sign-in/out changes the answer; token refreshes and the replayed
    // INITIAL_SESSION don't.
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') void loadPlan(true)
  })
}

export function usePlan(): PlanState {
  const [state, setState] = useState<PlanState>(cached ?? { loading: true, isPro: false })

  useEffect(() => {
    let mounted = true
    listeners.add(setState)
    subscribeAuthOnce()
    void loadPlan().then((s) => { if (mounted) setState(s) })
    return () => {
      mounted = false
      listeners.delete(setState)
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
