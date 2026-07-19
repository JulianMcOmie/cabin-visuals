'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { CabinLogo } from '../../src/components/CabinLogo'
import { ProfileMenu } from '../../src/components/ProfileMenu'
import { usePlan, openBillingPortal } from '../../src/billing/usePlan'
import { useAuth } from '../../src/persistence/hooks/useAuth'
import { track } from '../../src/analytics/analytics'

// Account settings: the home for plan/billing. Console card style, same nav
// skeleton as /pricing. Grows real settings later; today it answers "how do I
// manage my subscription?".

const label = 'font-mono text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-muted)]'

export default function AccountPage() {
  const { user, loading, isAnonymous } = useAuth()
  const plan = usePlan()
  const hasAccount = !!user && !isAnonymous
  const [opening, setOpening] = useState(false)

  const manageBilling = () => {
    if (opening) return
    track('manage_billing_clicked')
    setOpening(true)
    void openBillingPortal().catch(() => setOpening(false))
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-2)]">
      <header className="flex h-16 items-center justify-between border-b border-[var(--border-subtle)] px-6 max-w-5xl mx-auto">
        <Link href="/" className="flex items-center gap-2.5 select-none cursor-pointer">
          <CabinLogo className="h-[30px] w-auto" />
          <span className="translate-y-[5px] text-[15px] font-semibold text-[var(--text)]">Cabin Visuals</span>
        </Link>
        <nav className="flex items-center gap-5 text-[13px]">
          <Link href="/editor" className="text-[var(--text-3)] hover:text-[var(--text)] transition-colors cursor-pointer">Editor</Link>
          <Link href="/projects" className="text-[var(--text-3)] hover:text-[var(--text)] transition-colors cursor-pointer">Projects</Link>
          <ProfileMenu />
        </nav>
      </header>

      <main className="mx-auto max-w-xl px-6 pt-16 pb-24">
        <h1 className="text-2xl font-semibold text-[var(--text)]">Account</h1>

        {loading ? null : !hasAccount ? (
          <div className="mt-8 rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-7">
            <p className="text-[13px] text-[var(--text-3)]">
              {isAnonymous
                ? 'You’re working on a temporary session. Create an account to manage your plan.'
                : 'Sign in to manage your account.'}
            </p>
            <Link
              href={isAnonymous ? '/signup' : '/login'}
              onClick={() => track('nav_clicked', { from: 'account', to: isAnonymous ? 'signup' : 'login' })}
              className="mt-5 inline-flex h-[38px] items-center rounded-[5px] bg-[var(--accent)] px-4 text-[13px] font-bold text-[var(--on-accent)] hover:bg-[var(--accent-hover)] transition-colors cursor-pointer"
            >
              {isAnonymous ? 'Create an account' : 'Sign in'}
            </Link>
          </div>
        ) : (
          <div className="mt-8 rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-7 space-y-6">
            <div>
              <div className={label}>Email</div>
              <div className="mt-1.5 text-[13px] text-[var(--text)]">{user.email}</div>
            </div>

            <div className="border-t border-[var(--border)] pt-6">
              <div className={label}>Plan</div>
              <div className="mt-1.5 flex items-center justify-between gap-4">
                <div>
                  <div className="text-[13px] text-[var(--text)]">
                    {plan.loading ? '…' : plan.isPro ? 'Pro - $9/month' : 'Free'}
                  </div>
                  <div className="mt-0.5 text-[12px] text-[var(--text-muted)]">
                    {plan.loading
                      ? ''
                      : plan.isPro
                        ? 'Full HD 1080p exports, unlimited projects.'
                        : '720p exports, 1 project.'}
                  </div>
                </div>
                {!plan.loading && (plan.isPro ? (
                  <button
                    onClick={manageBilling}
                    disabled={opening}
                    className="inline-flex h-[34px] shrink-0 items-center gap-2 rounded-[5px] border border-[var(--border)] px-3.5 text-[12px] font-semibold text-[var(--text-2)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)] transition-colors cursor-pointer disabled:opacity-60"
                  >
                    {opening && <Loader2 size={13} className="animate-spin" />}
                    {opening ? 'Opening portal…' : 'Manage subscription'}
                  </button>
                ) : (
                  <Link
                    href="/pricing"
                    className="inline-flex h-[34px] shrink-0 items-center rounded-[5px] bg-[var(--accent)] px-3.5 text-[12px] font-bold text-[var(--on-accent)] hover:bg-[var(--accent-hover)] transition-colors cursor-pointer"
                  >
                    Upgrade to Pro
                  </Link>
                ))}
              </div>
              {plan.isPro && (
                <p className="mt-3 text-[11px] text-[var(--text-muted)]">
                  Update your card or cancel anytime - changes take effect through Stripe&apos;s billing portal.
                </p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
