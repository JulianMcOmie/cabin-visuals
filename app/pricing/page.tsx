'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, Loader2 } from 'lucide-react'
import { CabinLogo } from '../../src/components/CabinLogo'
import { ProfileMenu } from '../../src/components/ProfileMenu'
import { startCheckout, usePlan } from '../../src/billing/usePlan'
import { track } from '../../src/analytics/analytics'
import { useAuth } from '../../src/persistence/hooks/useAuth'

const FREE_FEATURES = [
  'The full editor - every instrument and template',
  '720p video export with a small watermark',
  '1 saved project',
  '50 MB per video, 1 GB total video storage',
  'Try templates instantly, no account needed',
]

const PRO_FEATURES = [
  'Watermark-free video export',
  'Full HD 1080p export quality',
  'Unlimited projects',
  '250 MB per video, unlimited video storage',
  'Support an independent visual music tool',
]

export default function PricingPage() {
  const { user, isAnonymous } = useAuth()
  // Anonymous sessions count as "no account" for every CTA on this page.
  const hasAccount = !!user && !isAnonymous
  const plan = usePlan()
  const [opening, setOpening] = useState(false)

  const handleUpgrade = () => {
    if (opening) return
    track('pricing_upgrade_clicked')
    setOpening(true)
    // Success navigates away (Stripe or /login); only a failure needs a reset.
    void startCheckout().catch(() => setOpening(false))
  }

  // Browser-back from Stripe restores this page from the back/forward cache
  // with the pending state frozen in - reset it so the button is usable again.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setOpening(false)
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)] font-sans">
      {/* Nav - 64px, hairline border (same as Landing) */}
      <header className="border-b border-[var(--border-subtle)]">
        <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5 select-none cursor-pointer">
            <CabinLogo className="h-[30px] w-auto" />
            <span className="translate-y-[5px] text-[15px] font-semibold text-[var(--text)]">Cabin Visuals</span>
          </Link>
          <nav className="flex items-center gap-5 text-[13px]">
            <Link href="/editor" className="text-[var(--text-3)] transition-colors hover:text-[var(--text)] cursor-pointer">Editor</Link>
            {hasAccount ? (
              <Link href="/projects" className="text-[var(--text-3)] transition-colors hover:text-[var(--text)] cursor-pointer">Projects</Link>
            ) : (
              <Link href="/login" className="text-[var(--text-3)] transition-colors hover:text-[var(--text)] cursor-pointer">Log in</Link>
            )}
            <ProfileMenu />
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1200px] px-6 pb-24">
        <div className="mt-16 mb-12 text-center">
          <h1 className="m-0 text-[36px] font-bold tracking-[-0.02em] text-[var(--text)]">Make music you can see</h1>
          <p className="mx-auto mt-3 max-w-[560px] text-[15px] text-[var(--text-3)]">
            Start free. Upgrade when you want your exports clean and full-res.
          </p>
        </div>

        <div className="mx-auto grid max-w-[760px] gap-5 md:grid-cols-2">
          {/* Free */}
          <div className="flex flex-col rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-7">
            <span className="font-mono text-[11px] tracking-[0.08em] text-[var(--text-muted)]">FREE</span>
            <p className="mt-1.5 mb-0 text-[13px] text-[var(--text-3)]">Everything you need to start creating.</p>
            <div className="mt-[18px] flex items-baseline gap-1">
              <span className="text-[36px] font-bold text-[var(--text)]">$0</span>
            </div>
            <ul className="m-0 mt-[22px] flex flex-1 list-none flex-col gap-[11px] p-0 text-[13px]">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex gap-2.5">
                  <Check size={15} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
                  <span className="text-[var(--text-2)]">{f}</span>
                </li>
              ))}
            </ul>
            <Link
              href={hasAccount ? '/projects' : '/editor'}
              className="mt-7 flex h-[38px] items-center justify-center rounded-[5px] border border-[var(--border)] text-[13px] font-semibold text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)] cursor-pointer"
            >
              {hasAccount ? 'Go to your projects' : 'Start creating'}
            </Link>
          </div>

          {/* Pro */}
          <div className="relative flex flex-col rounded-lg border border-[rgba(53,167,230,0.5)] bg-[var(--bg-panel)] p-7">
            <span className="absolute -top-2.5 right-5 rounded px-[9px] py-[3px] font-mono text-[10px] font-bold tracking-[0.08em] bg-[var(--accent)] text-[var(--on-accent)]">
              PRO
            </span>
            <span className="font-mono text-[11px] tracking-[0.08em] text-[var(--accent)]">PRO</span>
            <p className="mt-1.5 mb-0 text-[13px] text-[var(--text-3)]">For visuals you publish.</p>
            <div className="mt-[18px] flex items-baseline gap-1.5">
              <span className="text-[36px] font-bold text-[var(--text)]">$9</span>
              <span className="font-mono text-[13px] text-[var(--text-muted)]">/ month</span>
            </div>
            <ul className="m-0 mt-[22px] flex flex-1 list-none flex-col gap-[11px] p-0 text-[13px]">
              {PRO_FEATURES.map((f) => (
                <li key={f} className="flex gap-2.5">
                  <Check size={15} className="mt-0.5 shrink-0 text-[var(--accent)]" />
                  <span className="text-[var(--text)]">{f}</span>
                </li>
              ))}
            </ul>
            {plan.isPro ? (
              <div className="mt-7 flex h-[38px] items-center justify-center rounded-[5px] bg-[var(--bg-elevated)] text-[13px] font-semibold text-[var(--text-3)]">
                You&apos;re on Pro - thank you!
              </div>
            ) : (
              <button
                onClick={handleUpgrade}
                disabled={opening}
                className="mt-7 flex h-[38px] items-center justify-center gap-2 rounded-[5px] border-0 bg-[var(--accent)] text-[13px] font-bold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-60 disabled:hover:bg-[var(--accent)] cursor-pointer"
              >
                {opening ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    Opening secure checkout…
                  </>
                ) : (
                  'Upgrade to Pro'
                )}
              </button>
            )}
          </div>
        </div>

        <p className="mt-9 text-center text-[12px] text-[var(--text-muted)]">
          Cancel anytime from the billing portal, your projects stay yours either way.
        </p>
      </main>
    </div>
  )
}
