import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/utils/stripe'
import { syncSubscriptionRow } from '@/billing/syncSubscription'

// Checkout success lands here (session_id filled in by Stripe). Verify the
// session with Stripe directly and mirror the subscription into the DB, then
// bounce back to where the user upgraded from. This is the webhook-independent
// path: dev without `stripe listen` still flips users to Pro instantly.
// Writing from the session's own metadata is safe — session ids are
// unguessable and come from Stripe's redirect, and the only effect is marking
// that session's already-paid user as subscribed.

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('session_id')
  const rawReturn = request.nextUrl.searchParams.get('return_to') ?? '/projects'
  const returnTo = rawReturn.startsWith('/') && !rawReturn.startsWith('//') ? rawReturn : '/projects'
  const dest = new URL(returnTo, request.nextUrl.origin)

  if (sessionId) {
    try {
      const stripe = getStripe()
      const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['subscription'] })
      const sub = session.subscription
      if (sub && typeof sub !== 'string') {
        await syncSubscriptionRow(sub, session.metadata?.user_id ?? undefined)
      }
    } catch (err) {
      // Don't strand the user on an API route — the webhook will still sync.
      console.error('Checkout confirm failed (webhook will catch up):', err)
    }
  }

  return NextResponse.redirect(dest)
}
