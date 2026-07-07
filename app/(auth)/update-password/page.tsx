'use client'

import { useState, useEffect, Suspense } from 'react'
import { updatePassword } from './actions'
import { createClient } from '../../../src/utils/supabase/client'
import Link from 'next/link';
import {
  AuthShell,
  AuthTitle,
  AuthBanner,
  authLabelClass,
  authInputClass,
  authSubmitClass,
  authLinkClass,
} from '../auth-ui';

function UpdatePasswordFormInternal() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPage, setShowPage] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setShowPage(true)
      } else if (session) {
        setShowPage(true)
      }
    })

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
          const hashParams = new URLSearchParams(window.location.hash.substring(1));
          if (hashParams.has('access_token') && hashParams.get('type') === 'recovery') {
              setShowPage(true);
          } else {
             // User has session but didn't come from recovery link? Allow for now.
             setShowPage(true);
          }
      }
    });

    return () => { subscription.unsubscribe() }
  }, [])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (password !== confirmPassword) {
      setError('Passwords do not match.'); return;
    }
    if (password.length < 6) {
        setError('Password must be at least 6 characters long.'); return;
    }
    setIsSubmitting(true); setMessage(null); setError(null);

    const result = await updatePassword(password);

    if (result?.error) {
      setError(result.error)
    } else {
      setMessage('Password updated successfully! You will be redirected to login shortly.')
      setTimeout(() => {
         // Redirect to new login path
         window.location.href = '/login';
      }, 3000);
    }
    setIsSubmitting(false)
  }

  if (!showPage) {
     return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-page)] text-[13px] text-[var(--text-3)]"><p>Verifying access…</p></div>
    );
  }

  return (
    <AuthShell>
      <AuthTitle title="Update password" sub="Choose a new password for your account." />

      {message && <AuthBanner kind="success">{message}</AuthBanner>}
      {error && <AuthBanner kind="error">{error}</AuthBanner>}

      <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
        <div>
          <div className="mb-[6px] flex items-baseline justify-between">
            <label htmlFor="password" className={authLabelClass}>New password</label>
            <span className="text-[11px] text-[var(--text-muted)]">Min. 6 characters</span>
          </div>
          <input id="password" name="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className={authInputClass} placeholder="••••••••" disabled={isSubmitting || !!message} />
        </div>
        <div>
          <label htmlFor="confirmPassword" className={`mb-[6px] block ${authLabelClass}`}>Confirm new password</label>
          <input id="confirmPassword" name="confirmPassword" type="password" required minLength={6} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={authInputClass} placeholder="••••••••" disabled={isSubmitting || !!message} />
        </div>

        <button type="submit" className={`mt-1 ${authSubmitClass}`} disabled={isSubmitting || !password || password !== confirmPassword || password.length < 6 || !!message}>
          {isSubmitting ? 'Updating…' : 'Update password'}
        </button>
      </form>
      {!message && (
        <p className="mt-5 text-center text-[13px] text-[var(--text-3)]">
          <Link href="/login" className={authLinkClass}>Cancel and go to sign in</Link>
        </p>
      )}
    </AuthShell>
  );
}

export default function UpdatePasswordPage() {
    return (
        <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[var(--bg-page)] text-[13px] text-[var(--text-3)]"><p>Loading…</p></div>}>
            <UpdatePasswordFormInternal />
        </Suspense>
    );
}
