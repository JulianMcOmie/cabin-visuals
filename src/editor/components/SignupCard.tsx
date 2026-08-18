'use client'

import { useEffect, useState } from 'react'
import { InstantLink as Link } from '../../components/instantNavigation'
import Script from 'next/script'
import { Loader2 } from 'lucide-react'
import { track } from '../../analytics/analytics'
import { initiateSignup } from '../../../app/(auth)/signup/actions'
import { handleSignInWithGoogle } from '../../../app/(auth)/login/actions'
import { stashAnonWork } from '../../persistence/carryover'

/**
 * The signup form as it appears INSIDE the editor - email, Google, log-in
 * link. The body of a dialog; the invitation itself is the dialog's title
 * (EditorDialog renders that), so this component never repeats it.
 *
 * Two callers today: the export gate (clicking Export without an account) and
 * Save to cloud in the top bar. They differ only in `page` and `blurb`, which
 * is the point - one signup surface, so a fix to the Google path or the
 * carry-over reaches both.
 *
 * `page` names the surface in analytics AND keys the GSI button's container
 * id: Google renders its button imperatively into a real DOM node, so two
 * mounted cards would otherwise fight over one id.
 */
export function SignupCard({ page }: { page: string }) {
  // Bumped by the GSI <Script>'s onLoad so the render-button effect re-runs
  // once the script is actually available.
  const [gsiReady, setGsiReady] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const emailId = `${page}-signup-email`
  const googleId = `${page}-google-btn`

  // Mirror /signup's arrival behavior: stash anonymous work on open so the
  // Google path (which lands in a new session) can carry this project over.
  useEffect(() => { void stashAnonWork() }, [])

  // Imperative initialize + renderButton: the declarative g_id_onload path
  // only scans the DOM at script load, and the script may already be loaded
  // by the time this card opens.
  useEffect(() => {
    const google = (window as unknown as { google?: any }).google
    const container = document.getElementById(googleId)
    if (!google?.accounts?.id || !container || container.childElementCount > 0) return
    google.accounts.id.initialize({
      client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
      callback: async (response: { credential?: string }) => {
        if (!response?.credential) return
        track('google_signin_submitted', { page })
        setGoogleBusy(true)
        try {
          await stashAnonWork()
          await handleSignInWithGoogle(response.credential)
        } catch (err) {
          // Next.js signals a server-action redirect by throwing - let it fly.
          if (err instanceof Error && err.message.includes('NEXT_REDIRECT')) throw err
          console.error('Google sign-in failed:', err)
          setGoogleBusy(false)
        }
      },
    })
    google.accounts.id.renderButton(container, {
      theme: 'filled_black', size: 'large', type: 'standard', text: 'signup_with',
      shape: 'rectangular', logo_alignment: 'left',
      width: Math.min(342, Math.max(200, container.clientWidth || 342)),
    })
  }, [googleId, page, gsiReady])

  return (
    <>
      <form action={initiateSignup} onSubmit={() => track('signup_started', { page })} className="flex flex-col gap-[14px]">
        <div>
          <label htmlFor={emailId} className="mb-[6px] block font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Email</label>
          <input id={emailId} name="email" type="email" required placeholder="you@example.com" className="block h-[40px] w-full rounded-[8px] border border-[var(--border)] bg-[var(--bg-app)] px-3 text-[13px] text-[var(--text)] outline-none transition-colors duration-100 placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]" />
        </div>
        <button type="submit" className="mt-1 h-[42px] w-full cursor-pointer rounded-[99px] bg-[var(--accent)] text-[14px] font-bold text-[var(--on-accent)] transition-colors duration-100 hover:bg-[var(--accent-hover)]">
          Continue
        </button>
      </form>

      <div className="my-4 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
        <span className="flex-1 border-t border-[var(--border)]" />
        or
        <span className="flex-1 border-t border-[var(--border)]" />
      </div>

      <div id={googleId} className="gsi-host flex w-full justify-center" />

      <p className="mt-4 text-center text-[13px] text-[var(--text-3)]">
        Already have an account?{' '}
        <Link
          href="/login"
          onClick={() => track('nav_clicked', { from: page, to: 'login' })}
          className="cursor-pointer text-[var(--accent)] transition-colors duration-100 hover:text-[var(--accent-hover)]"
        >
          Log in
        </Link>
      </p>

      {googleBusy && (
        <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-[14px] bg-[rgba(15,17,24,0.85)] text-[13px] text-[var(--text-2)]">
          <Loader2 size={14} className="animate-spin" />
          Signing you in…
        </div>
      )}

      <Script src="https://accounts.google.com/gsi/client" async defer strategy="afterInteractive" onLoad={() => setGsiReady(true)} />
    </>
  )
}
