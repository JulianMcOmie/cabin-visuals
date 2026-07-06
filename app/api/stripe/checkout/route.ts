import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { getStripe, getProPriceId } from '@/utils/stripe'

// POST { returnTo? } → { url } — a Stripe Checkout session for the Pro
// subscription. Requires a signed-in user (401 otherwise; the client redirects
// to /login). Success bounces through /api/stripe/confirm so the subscription
// row is written even before webhooks are configured.

/** Only same-site paths — a raw returnTo in a redirect is an open-redirect hole. */
function safeReturnTo(raw: unknown): string {
  return typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/projects'
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to upgrade' }, { status: 401 })

  let returnTo = '/projects'
  try {
    const body = await request.json()
    returnTo = safeReturnTo(body?.returnTo)
  } catch { /* no body — default returnTo */ }

  try {
    const stripe = getStripe()

    // Reuse the user's Stripe customer if one exists; create + record it if not.
    const { data: row } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id, status')
      .maybeSingle()

    let customerId = row?.stripe_customer_id as string | undefined

    // A stored id can be stale: created in the other Stripe mode (a test-mode
    // checkout while developing writes a test customer into the shared DB) or
    // deleted in the dashboard. Verify it lives in THIS mode; recreate if not.
    if (customerId) {
      try {
        const existing = await stripe.customers.retrieve(customerId)
        if ((existing as { deleted?: boolean }).deleted) customerId = undefined
      } catch {
        customerId = undefined
      }
    }

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { user_id: user.id },
      })
      customerId = customer.id
      const admin = createAdminClient()
      await admin.from('subscriptions').upsert(
        { user_id: user.id, stripe_customer_id: customerId, status: 'inactive', updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      )
    }

    const origin = request.nextUrl.origin
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: await getProPriceId(), quantity: 1 }],
      allow_promotion_codes: true, // founding-user discount codes work day one
      metadata: { user_id: user.id },
      subscription_data: { metadata: { user_id: user.id } },
      success_url: `${origin}/api/stripe/confirm?session_id={CHECKOUT_SESSION_ID}&return_to=${encodeURIComponent(returnTo)}`,
      cancel_url: `${origin}${returnTo}`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('Checkout session failed:', err)
    const message = err instanceof Error ? err.message : 'Checkout failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
