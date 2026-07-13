import Link from "next/link"
import { CabinLogo } from "./CabinLogo"

/**
 * The projects page's loading state, rendered by BOTH the route's loading.tsx
 * (Next's instant navigation boundary) and the client page while auth/list
 * resolve. Same header + background as the loaded page, so navigating in shows
 * the chrome immediately instead of a blank flash or a bare spinner, and the
 * top bar never disappears. Static and server-safe (no client hooks).
 */
export function ProjectsSkeleton() {
  return (
    <div className="min-h-screen bg-[var(--bg-page)] font-sans text-[var(--text)]">
      <header className="border-b border-[var(--border-subtle)]">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
          <Link href="/" className="flex select-none items-center gap-2.5">
            <CabinLogo className="h-[30px] w-auto" />
            <span className="translate-y-[5px] text-[15px] font-semibold text-[var(--text)]">Cabin Visuals</span>
          </Link>
          <nav className="flex items-center gap-5">
            <span className="text-[13px] text-[var(--text-3)]">Pricing</span>
            {/* Same 32px square footprint as the ProfileMenu avatar, so no shift
                when the real icon takes its place. */}
            <div className="h-8 w-8 rounded-[5px] border border-[var(--border)] bg-[var(--bg-elevated)]" />
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-6 pb-24 pt-10">
        <div className="mb-6 flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-[-0.01em]">Projects</h1>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-panel)]"
            >
              <div className="h-[120px] animate-pulse border-b border-[var(--border-subtle)] bg-[var(--bg-app)]" />
              <div className="flex items-center justify-between gap-3 px-3.5 pb-[13px] pt-3">
                <div className="h-3 w-24 animate-pulse rounded bg-[var(--bg-elevated)]" />
                <div className="h-2.5 w-10 animate-pulse rounded bg-[var(--bg-elevated)]" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
