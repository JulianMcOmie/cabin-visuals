'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, Loader2 } from 'lucide-react'
import { CabinLogo } from '../../src/components/CabinLogo'
import { ProfileMenu } from '../../src/components/ProfileMenu'
import { startCheckout, usePlan } from '../../src/billing/usePlan'
import { track } from '../../src/analytics/analytics'
import { useAuth } from '../../src/persistence/hooks/useAuth'
import { MotionConfig } from 'framer-motion'
import { Appear } from '../../src/components/motionPresets'

const FREE_FEATURES = [
  'The full editor - every instrument and template',
  '720p video export',
  '5 saved projects',
  '1 GB video storage',
  'Free AI lyric transcription',
]

const PRO_FEATURES = [
  'The full editor - every instrument and template',
  '4k video export',
  'Unlimited projects',
  'Unlimited video storage',
  'Support some random guy you don\'t know',
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
    <MotionConfig reducedMotion="user">
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)] font-sans">
      {/* Nav - 64px, hairline border (same as Landing) */}
      <header className="border-b border-[var(--border-subtle)]">
        <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5 select-none cursor-pointer">
            <CabinLogo className="h-[30px] w-auto" />
            <span className="translate-y-[5px] text-[15px] font-semibold text-[var(--text)]">Cabin Visuals</span>
          </Link>
          <nav className="flex items-center gap-5 text-[13px]">
            <Link href="/editor" onClick={() => track('nav_clicked', { from: 'pricing', to: 'editor' })} className="text-[var(--text-3)] transition-colors hover:text-[var(--text)] cursor-pointer">Editor</Link>
            {hasAccount ? (
              <Link href="/projects" onClick={() => track('nav_clicked', { from: 'pricing', to: 'projects' })} className="text-[var(--text-3)] transition-colors hover:text-[var(--text)] cursor-pointer">Projects</Link>
            ) : (
              <Link href="/login" onClick={() => track('nav_clicked', { from: 'pricing', to: 'login' })} className="text-[var(--text-3)] transition-colors hover:text-[var(--text)] cursor-pointer">Log in</Link>
            )}
            <ProfileMenu />
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1200px] px-6 pb-24">
        <Appear className="mt-16 mb-3 text-center">
          <h1 className="m-0 text-[36px] font-bold tracking-[-0.02em] text-[var(--text)]">Seriously, just use it for free (it&apos;s great).</h1>
          <p className="mx-auto mt-3 max-w-[560px] text-[15px] text-[var(--text-3)]">
            The whole editor - the instruments, templates, and AI lyric videos - is free.
            Pro is for the person who wants to use it seriously and professionally.
          </p>
        </Appear>
        <Appear delay={0.05} className="mb-12 text-center">
          <span className="font-mono text-[12px] text-[var(--text-muted)]">
          </span>
        </Appear>

        <div className="mx-auto grid max-w-[760px] gap-5 md:grid-cols-2">
          {/* Free */}
          <Appear delay={0.05} className="flex flex-col rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-7">
            <span className="font-mono text-[11px] tracking-[0.08em] text-[var(--text-muted)]">FREE</span>
            <p className="mt-1.5 mb-0 text-[13px] text-[var(--text-3)]">Pretty dang good, more than enough for most people.</p>
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
            {/* Cold visitors get the accent path INTO the product; people
                with accounts already know it - their accent lives on Pro. */}
            <Link
              href={hasAccount ? '/projects' : '/editor'}
              onClick={() => track('pricing_start_creating_clicked', { destination: hasAccount ? 'projects' : 'editor' })}
              className={`mt-7 flex h-[38px] items-center justify-center rounded-[5px] text-[13px] transition-colors cursor-pointer ${
                hasAccount
                  ? 'border border-[var(--border)] font-semibold text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-[var(--text)]'
                  : 'bg-[var(--accent)] font-bold text-[var(--on-accent)] hover:bg-[var(--accent-hover)]'
              }`}
            >
              {hasAccount ? 'Go to your projects' : 'Start creating'}
            </Link>
          </Appear>

          {/* Pro */}
          <Appear delay={0.1} className="relative flex flex-col rounded-lg border border-[rgba(53,167,230,0.5)] bg-[var(--bg-panel)] p-7">
            <span className="absolute -top-2.5 right-5 rounded px-[9px] py-[3px] font-mono text-[10px] font-bold tracking-[0.08em] bg-[var(--accent)] text-[var(--on-accent)]">
              PRO
            </span>
            <span className="font-mono text-[11px] tracking-[0.08em] text-[var(--accent)]">PRO</span>
            <p className="mt-1.5 mb-0 text-[13px] text-[var(--text-3)]">If you want to dedicate yourself to the craft.</p>
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
                className={`mt-7 flex h-[38px] items-center justify-center gap-2 rounded-[5px] text-[13px] transition-colors disabled:opacity-60 cursor-pointer ${
                  hasAccount
                    ? 'border-0 bg-[var(--accent)] font-bold text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:hover:bg-[var(--accent)]'
                    : 'border border-[rgba(53,167,230,0.5)] bg-transparent font-semibold text-[var(--accent)] hover:bg-[rgba(53,167,230,0.08)]'
                }`}
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
          </Appear>
        </div>
      </main>
    </div>
    </MotionConfig>
  )
}
