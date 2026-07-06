'use client'

import Link from 'next/link'
import { Check } from 'lucide-react'
import { CabinLogo } from '../../src/components/CabinLogo'
import { startCheckout, usePlan } from '../../src/billing/usePlan'
import { useAuth } from '../../src/persistence/hooks/useAuth'

const FREE_FEATURES = [
  'The full editor - every instrument and template',
  '720p video export with a small watermark',
  '1 saved project',
  'Try templates instantly, no account needed',
]

const PRO_FEATURES = [
  'Watermark-free video export',
  'Full HD 1080p export quality',
  'Unlimited projects',
  'Support an independent visual music tool',
]

export default function PricingPage() {
  const { user } = useAuth()
  const plan = usePlan()

  return (
    <div className="min-h-screen bg-[#0b0b0f] text-zinc-200">
      <header className="flex items-center justify-between px-6 py-4 max-w-5xl mx-auto">
        <Link href="/" className="flex items-center gap-2 select-none">
          <CabinLogo className="h-10 w-auto" />
          <span className="text-lg text-zinc-200">Cabin Visuals</span>
        </Link>
        <nav className="flex items-center gap-5 text-sm">
          <Link href="/editor" className="text-zinc-400 hover:text-zinc-100 transition-colors">Editor</Link>
          {user ? (
            <Link href="/projects" className="text-zinc-400 hover:text-zinc-100 transition-colors">Projects</Link>
          ) : (
            <Link href="/login" className="text-zinc-400 hover:text-zinc-100 transition-colors">Log in</Link>
          )}
        </nav>
      </header>

      <main className="max-w-5xl mx-auto px-6 pb-24">
        <div className="text-center mt-12 mb-14">
          <h1 className="text-4xl font-extrabold text-white">Make music you can see</h1>
          <p className="mt-3 text-zinc-400 max-w-xl mx-auto">
            Start free. Upgrade when you want your exports clean and full-res.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
          {/* Free */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-8 flex flex-col">
            <h2 className="text-lg font-semibold text-zinc-100">Free</h2>
            <p className="mt-1 text-sm text-zinc-500">Everything you need to start creating.</p>
            <div className="mt-5 flex items-baseline gap-1">
              <span className="text-4xl font-extrabold text-white">$0</span>
            </div>
            <ul className="mt-6 space-y-3 text-sm flex-1">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex gap-2.5">
                  <Check size={16} className="text-zinc-500 shrink-0 mt-0.5" />
                  <span className="text-zinc-300">{f}</span>
                </li>
              ))}
            </ul>
            <Link
              href={user ? '/projects' : '/signup'}
              className="mt-8 h-10 rounded-lg border border-zinc-700 hover:border-zinc-500 text-zinc-200 text-sm font-semibold flex items-center justify-center transition-colors cursor-pointer"
            >
              {user ? 'Go to your projects' : 'Start creating'}
            </Link>
          </div>

          {/* Pro */}
          <div className="rounded-2xl border border-indigo-500/60 bg-indigo-950/20 p-8 flex flex-col relative">
            <span className="absolute -top-3 right-6 text-[11px] font-bold tracking-wide px-2.5 py-1 rounded-full bg-indigo-600 text-white">
              PRO
            </span>
            <h2 className="text-lg font-semibold text-zinc-100">Pro</h2>
            <p className="mt-1 text-sm text-zinc-500">For visuals you publish.</p>
            <div className="mt-5 flex items-baseline gap-1">
              <span className="text-4xl font-extrabold text-white">$9</span>
              <span className="text-zinc-500 text-sm">/ month</span>
            </div>
            <ul className="mt-6 space-y-3 text-sm flex-1">
              {PRO_FEATURES.map((f) => (
                <li key={f} className="flex gap-2.5">
                  <Check size={16} className="text-indigo-400 shrink-0 mt-0.5" />
                  <span className="text-zinc-200">{f}</span>
                </li>
              ))}
            </ul>
            {plan.isPro ? (
              <div className="mt-8 h-10 rounded-lg bg-zinc-800 text-zinc-400 text-sm font-semibold flex items-center justify-center">
                You&apos;re on Pro — thank you!
              </div>
            ) : (
              <button
                onClick={() => void startCheckout().catch(() => {})}
                className="mt-8 h-10 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-sm font-semibold transition-colors cursor-pointer"
              >
                Upgrade to Pro
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-zinc-600 mt-10">
          Cancel anytime from the billing portal, your projects stay yours either way.
        </p>
      </main>
    </div>
  )
}
