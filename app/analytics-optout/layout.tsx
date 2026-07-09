import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// The page below is a client component, so the noindex hint lives here.
export const metadata: Metadata = {
  title: 'Analytics opt-out',
  robots: { index: false, follow: false },
}

export default function AnalyticsOptoutLayout({ children }: { children: ReactNode }) {
  return children
}
