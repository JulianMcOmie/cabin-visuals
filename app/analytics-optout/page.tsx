'use client'

import { useEffect, useState } from 'react'
import { AuthShell, AuthTitle, authSubmitClass } from '../(auth)/auth-ui'
import { ANALYTICS_OPTOUT_KEY } from '../../src/analytics/AnalyticsGate'

// Unlisted toggle for the AnalyticsGate opt-out flag, so excluding a phone
// doesn't require remote devtools. Per-browser: visit this URL on each
// device whose visits shouldn't count.
export default function AnalyticsOptoutPage() {
  // null until mounted - localStorage doesn't exist during SSR.
  const [optedOut, setOptedOut] = useState<boolean | null>(null)

  useEffect(() => {
    setOptedOut(Boolean(localStorage.getItem(ANALYTICS_OPTOUT_KEY)))
  }, [])

  const toggle = () => {
    if (optedOut) {
      localStorage.removeItem(ANALYTICS_OPTOUT_KEY)
    } else {
      localStorage.setItem(ANALYTICS_OPTOUT_KEY, '1')
    }
    setOptedOut(!optedOut)
  }

  return (
    <AuthShell footnote="The flag lives in this browser's localStorage and is cleared with site data.">
      <AuthTitle
        title="Analytics opt-out"
        sub="Exclude this browser's visits from Vercel Analytics."
      />
      <p className="mb-[22px] text-center font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
        This browser:{' '}
        <span className={optedOut ? 'text-[#6a9955]' : 'text-[var(--text)]'}>
          {optedOut === null ? '...' : optedOut ? 'excluded' : 'tracked'}
        </span>
      </p>
      <button type="button" className={authSubmitClass} onClick={toggle} disabled={optedOut === null}>
        {optedOut ? 'Resume tracking' : 'Exclude this browser'}
      </button>
    </AuthShell>
  )
}
