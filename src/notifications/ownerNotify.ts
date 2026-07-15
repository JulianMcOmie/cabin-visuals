import 'server-only'
import { Resend } from 'resend'

/**
 * Owner notifications: "someone signed up" / "someone bought" pings to Julia's
 * inbox, sent via Resend. Server-only - the API key never ships to the browser.
 *
 * Deliberately never throws: these emails ride along on checkout webhooks and
 * auth actions, and a notification failure must never fail (or retry) the real
 * operation. Unconfigured (no RESEND_API_KEY / OWNER_NOTIFY_EMAIL) it logs and
 * no-ops, so every call site stays guard-free - same pattern as analytics.
 *
 * RESEND_FROM defaults to Resend's shared onboarding sender, which may only
 * deliver to the Resend account owner's own address - fine for self-pings
 * before a domain is verified. After verifying a domain in Resend, set
 * RESEND_FROM to e.g. "Cabin Visuals <notify@yourdomain.com>".
 */

let client: Resend | null | undefined

function getResend(): Resend | null {
  if (client !== undefined) return client
  const key = process.env.RESEND_API_KEY
  client = key ? new Resend(key) : null
  return client
}

export async function notifyOwner(subject: string, lines: string[]): Promise<void> {
  try {
    const resend = getResend()
    const to = process.env.OWNER_NOTIFY_EMAIL
    if (!resend || !to) {
      console.log(`[ownerNotify] (not configured) ${subject}\n${lines.join('\n')}`)
      return
    }
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM ?? 'Cabin Visuals <onboarding@resend.dev>',
      to,
      subject,
      text: lines.join('\n'),
    })
    if (error) console.error('[ownerNotify] send failed:', error)
  } catch (err) {
    console.error('[ownerNotify] send failed:', err)
  }
}
