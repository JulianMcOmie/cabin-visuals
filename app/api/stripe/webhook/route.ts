import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getStripe } from '@/utils/stripe'
import { syncSubscriptionRow } from '@/billing/syncSubscription'

// Stripe → DB, the durable path: renewals, cancellations, payment failures all
// land here long after the user closed the tab. Signature-verified against the
// raw body; unhandled event types are acknowledged and ignored.
//
// Local dev:  stripe listen --forward-to localhost:3000/api/stripe/webhook
// Production: add an endpoint in the Stripe dashboard pointing at this route
//             with events checkout.session.completed,
//             customer.subscription.updated, customer.subscription.deleted.

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  const signature = request.headers.get('stripe-signature')
  if (!secret || secret.includes('REPLACE_ME') || !signature) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    const body = await request.text()
    event = getStripe().webhooks.constructEvent(body, signature, secret)
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        if (session.subscription) {
          const sub = await getStripe().subscriptions.retrieve(
            typeof session.subscription === 'string' ? session.subscription : session.subscription.id,
          )
          await syncSubscriptionRow(sub, session.metadata?.user_id ?? undefined)
        }
        break
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await syncSubscriptionRow(event.data.object)
        break
      }
      default:
        break // acknowledged, ignored
    }
  } catch (err) {
    console.error(`Webhook handler failed for ${event.type}:`, err)
    // 500 → Stripe retries with backoff, which is what we want for DB hiccups.
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
