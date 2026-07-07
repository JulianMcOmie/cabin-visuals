'use client'

import Link from 'next/link'
import { AuthShell, AuthTitle, authLinkClass } from '../auth-ui'

export default function ErrorPage() {
  return (
    <AuthShell>
      <AuthTitle
        title="Something went wrong"
        sub="Sorry — we couldn't complete that. Please try again."
      />
      <p className="text-center text-[13px] text-[var(--text-3)]">
        <Link href="/login" className={authLinkClass}>Back to sign in</Link>
      </p>
    </AuthShell>
  )
}
