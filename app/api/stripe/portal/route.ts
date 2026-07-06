import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { getStripe } from '@/utils/stripe'

// POST { returnTo? } → { url } — Stripe's hosted billing portal, where a Pro
// user updates their card or cancels. Kept honest and self-serve from day one.

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  let returnTo = '/projects'
  try {
    const body = await request.json()
    if (typeof body?.returnTo === 'string' && body.returnTo.startsWith('/') && !body.returnTo.startsWith('//')) {
      returnTo = body.returnTo
    }
  } catch { /* no body */ }

  // RLS scopes this select to the caller's own row.
  const { data: row } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .maybeSingle()
  if (!row?.stripe_customer_id) {
    return NextResponse.json({ error: 'No billing account yet' }, { status: 404 })
  }

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: row.stripe_customer_id,
      return_url: `${request.nextUrl.origin}${returnTo}`,
    })
    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('Billing portal session failed:', err)
    return NextResponse.json({ error: 'Could not open billing portal' }, { status: 500 })
  }
}
