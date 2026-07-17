'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { CabinLogo } from './CabinLogo'

/** The site's top bar (the landing page's header, extracted): logo + name on
 *  the left, whatever nav the page needs on the right. */
export function SiteHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="border-b border-[var(--border-subtle)]">
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5 select-none cursor-pointer">
          <CabinLogo className="h-[30px] w-auto" />
          <span className="translate-y-[5px] text-[15px] font-semibold text-[var(--text)]">Cabin Visuals</span>
        </Link>
        <nav className="flex items-center gap-2 text-[13px]">{children}</nav>
      </div>
    </header>
  )
}
