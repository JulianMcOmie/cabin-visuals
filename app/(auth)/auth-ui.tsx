// Shared building blocks for the auth pages ("Console" redesign).
// Reference: design_handoff_console_redesign/redesign/Login.dc.html - a centered
// column on --bg-page: 56px logo linking home, a 400px flat card (--bg-panel,
// 1px --border, 28px padding, 8px radius), and optional mono microcopy below.
// Pure presentation - no auth logic lives here.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { CabinLogo } from '../../src/components/CabinLogo';
import { Appear } from '../../src/components/motionPresets';

/* Class strings shared by every form on these pages. */
export const authLabelClass =
  'font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]';

export const authInputClass =
  'block h-[38px] w-full rounded-[5px] border border-[var(--border)] bg-[var(--bg-app)] px-3 text-[13px] text-[var(--text)] outline-none transition-colors duration-100 placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] disabled:opacity-50';

export const authSubmitClass =
  'h-[38px] w-full cursor-pointer rounded-[5px] bg-[var(--accent)] text-[13px] font-bold text-[var(--on-accent)] transition-colors duration-100 hover:bg-[var(--accent-hover)] disabled:cursor-default disabled:opacity-50';

export const authLinkClass =
  'cursor-pointer text-[var(--accent)] transition-colors duration-100 hover:text-[var(--accent-hover)]';

/**
 * The submit button for every auth form, with its own busy state.
 *
 * AuthShell already smokes the logo while a submission is in flight, but that
 * sits above the card - people are looking at the button they just pressed, and
 * a button that still says "Sign in" and still takes clicks reads as a frozen
 * page. This says so where the click happened, and stops a second submission
 * landing on top of the first.
 *
 * Purely presentational: `busy` is the caller's existing form-busy state, which
 * stays true until the action's redirect unmounts the page.
 */
export function AuthSubmit({
  busy,
  busyLabel,
  children,
}: {
  busy?: boolean;
  busyLabel: string;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={busy}
      aria-busy={busy}
      className={`mt-1 flex items-center justify-center gap-2 ${authSubmitClass}`}
    >
      {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
      {busy ? busyLabel : children}
    </button>
  );
}

/** Full-page centered column: logo above the card, optional microcopy below.
 *  `loading` sets the page's own logo smoking (the busy indicator for form
 *  submissions and OAuth waits - no separate transition page). */
export function AuthShell({ children, footnote, loading }: { children: ReactNode; footnote?: string; loading?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--bg-page)] px-6 py-10 font-sans text-[var(--text)]">
      <Link href="/" className="mb-7 flex cursor-pointer select-none flex-col items-center" aria-label="Cabin Visuals home">
        <CabinLogo className={`h-14 w-auto ${loading ? 'cabin-logo-loading' : ''}`} />
      </Link>
      <Appear className="w-full max-w-[400px] rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-7">
        {children}
      </Appear>
      {footnote && (
        <p className="mt-5 text-center font-mono text-[11px] text-[var(--text-muted)]">{footnote}</p>
      )}
    </div>
  );
}

/** Card heading: 20px/600 title + 13px --text-3 subtitle. */
export function AuthTitle({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <>
      <h1 className={`text-[20px] font-semibold text-[var(--text)] ${sub ? 'mb-1' : 'mb-[22px]'}`}>{title}</h1>
      {sub && <p className="mb-[22px] text-[13px] text-[var(--text-3)]">{sub}</p>}
    </>
  );
}

/** Flat 1px-bordered message panel - green/red TEXT on --bg-panel, no tinted bg. */
export function AuthBanner({ kind, children }: { kind: 'success' | 'error'; children: ReactNode }) {
  return (
    <div
      className={`mb-4 rounded-[5px] border border-[var(--border)] bg-[var(--bg-panel)] px-3 py-2.5 text-center text-[12px] ${
        kind === 'error' ? 'text-[#d16969]' : 'text-[#6a9955]'
      }`}
    >
      {children}
    </div>
  );
}

/** "── OR ──" divider, mono 10px. */
export function OrDivider() {
  return (
    <div className="my-[18px] flex items-center gap-3">
      <div className="h-px flex-1 bg-[var(--border)]" />
      <span className="font-mono text-[10px] text-[var(--text-muted)]">OR</span>
      <div className="h-px flex-1 bg-[var(--border)]" />
    </div>
  );
}
