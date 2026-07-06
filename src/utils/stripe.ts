import Stripe from 'stripe'

// Server-only Stripe client + the one price the app sells. Lazy singletons so
// importing this module never throws at build time when env vars are absent.

let stripeClient: Stripe | null = null

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key || key.includes('REPLACE_ME')) {
    throw new Error('STRIPE_SECRET_KEY is not configured (.env.local)')
  }
  if (!stripeClient) stripeClient = new Stripe(key)
  return stripeClient
}

const PRO_LOOKUP_KEY = 'cabin_pro_monthly'
let cachedPriceId: string | null = null

/**
 * The Pro price to sell at checkout. Self-provisioning: if STRIPE_PRICE_ID is
 * set it wins; otherwise look up (or create, first run) a $9/mo "Cabin Visuals
 * Pro" price by lookup key — so a fresh Stripe account needs only API keys.
 */
export async function getProPriceId(): Promise<string> {
  if (process.env.STRIPE_PRICE_ID) return process.env.STRIPE_PRICE_ID
  if (cachedPriceId) return cachedPriceId

  const stripe = getStripe()
  const existing = await stripe.prices.list({ lookup_keys: [PRO_LOOKUP_KEY], active: true, limit: 1 })
  if (existing.data[0]) {
    cachedPriceId = existing.data[0].id
    return cachedPriceId
  }

  const price = await stripe.prices.create({
    currency: 'usd',
    unit_amount: 900, // $9/mo
    recurring: { interval: 'month' },
    lookup_key: PRO_LOOKUP_KEY,
    product_data: { name: 'Cabin Visuals Pro' },
  })
  cachedPriceId = price.id
  return cachedPriceId
}
