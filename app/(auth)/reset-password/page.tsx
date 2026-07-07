'use client';

import { requestPasswordReset } from './actions';
import { useState } from 'react';
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

export default function ResetPasswordPage() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (formData: FormData) => {
    setIsSubmitting(true);
    setMessage(null);
    setError(null);
    const result = await requestPasswordReset(formData);
    if (result?.error) {
      setError(result.error);
    } else {
      setMessage('Password reset email sent. Please check your inbox (and spam folder).');
      const form = document.getElementById('reset-password-form') as HTMLFormElement;
      form?.reset();
    }
    setIsSubmitting(false);
  };

  return (
    <AuthShell>
      <AuthTitle title="Reset password" sub="We'll email you a link to set a new one." />

      {message && <AuthBanner kind="success">{message}</AuthBanner>}
      {error && <AuthBanner kind="error">{error}</AuthBanner>}

      <form id="reset-password-form" action={handleSubmit} className="flex flex-col gap-[14px]">
        <div>
          <label htmlFor="email" className={`mb-[6px] block ${authLabelClass}`}>Email</label>
          <input id="email" name="email" type="email" required className={authInputClass} placeholder="you@example.com" disabled={isSubmitting || !!message} />
        </div>

        <button type="submit" className={`mt-1 ${authSubmitClass}`} disabled={isSubmitting || !!message}>
          {isSubmitting ? 'Sending…' : 'Send reset link'}
        </button>
      </form>

      <p className="mt-5 text-center text-[13px] text-[var(--text-3)]">
        <Link href="/login" className={authLinkClass}>Back to sign in</Link>
      </p>
    </AuthShell>
  );
}
