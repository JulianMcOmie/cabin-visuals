import type Stripe from 'stripe'
import { createAdminClient } from '../utils/supabase/admin'

// The single write path for billing state: mirror a Stripe subscription into
// the `subscriptions` row. Called from the webhook AND the post-checkout
// confirm redirect, so a paid user goes Pro even if webhooks aren't set up yet.

/** current_period_end lives on the subscription in older Stripe API versions
 *  and on its items in newer ones — read whichever is present. */
function periodEnd(sub: Stripe.Subscription): string | null {
  const legacy = (sub as unknown as { current_period_end?: number }).current_period_end
  const fromItem = sub.items?.data?.[0]?.current_period_end
  const epoch = legacy ?? fromItem
  return epoch ? new Date(epoch * 1000).toISOString() : null
}

export async function syncSubscriptionRow(sub: Stripe.Subscription, fallbackUserId?: string): Promise<void> {
  const admin = createAdminClient()
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
  let userId = (sub.metadata?.user_id as string | undefined) ?? fallbackUserId

  // Renewal/cancellation events on subs created before metadata existed: find
  // the owner by customer id.
  if (!userId) {
    const { data } = await admin
      .from('subscriptions')
      .select('user_id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle()
    userId = data?.user_id as string | undefined
  }
  if (!userId) throw new Error(`No user found for Stripe customer ${customerId}`)

  const { error } = await admin.from('subscriptions').upsert(
    {
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      status: sub.status,
      price_id: sub.items?.data?.[0]?.price?.id ?? null,
      current_period_end: periodEnd(sub),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (error) throw new Error(`Failed to sync subscription: ${error.message}`)
}

/** True for statuses that should unlock Pro features. */
export function isProStatus(status: string | null | undefined): boolean {
  return status === 'active' || status === 'trialing'
}
