'use client';

import { completeSignup } from './actions';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useFormStatus } from 'react-dom';
import { getSupabase } from '../../../../src/persistence/supabase';
import {
  AuthShell,
  AuthTitle,
  AuthBanner,
  authLabelClass,
  authInputClass,
  authSubmitClass,
  authLinkClass,
} from '../../auth-ui';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={`mt-1 ${authSubmitClass}`}
      disabled={pending}
      aria-disabled={pending}
    >
      {pending ? 'Creating account…' : 'Complete sign up'}
    </button>
  );
}

function SetPasswordFormInternal() {
  const searchParams = useSearchParams();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Sign-in-to-save phase 3: when the browser holds an ANONYMOUS session, we
  // convert it in place (same uuid keeps all their projects) instead of
  // creating a fresh user via the server action.
  const [anonUid, setAnonUid] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [convertedEmail, setConvertedEmail] = useState<string | null>(null);

  const email = searchParams.get('email');
  const firstName = searchParams.get('firstName');
  const lastName = searchParams.get('lastName');

  useEffect(() => {
    let mounted = true;
    getSupabase().auth.getUser().then(({ data }) => {
      if (mounted && data.user?.is_anonymous) setAnonUid(data.user.id);
    });
    return () => { mounted = false; };
  }, []);

  const handleConvert = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (converting || !email || !firstName || !lastName) return;
    const form = new FormData(e.currentTarget);
    const password = form.get('password') as string;
    const confirmPassword = form.get('confirmPassword') as string;
    if (password !== confirmPassword) { setErrorMessage('Passwords do not match.'); return; }
    if (!password || password.length < 6) { setErrorMessage('Password must be at least 6 characters long'); return; }

    setConverting(true);
    setErrorMessage(null);
    const supabase = getSupabase();
    const { error } = await supabase.auth.updateUser({
      email,
      password,
      data: { given_name: firstName, family_name: lastName },
    });
    if (error) {
      setConverting(false);
      if (/already/i.test(error.message)) {
        setErrorMessage('An account with this email already exists. Log in instead - your current work will follow you.');
      } else {
        setErrorMessage(error.message);
      }
      return;
    }
    // Same uuid - their projects are already theirs. Profiles row is new though.
    await supabase.from('profiles').upsert(
      { user_id: anonUid, first_name: firstName, last_name: lastName, email },
      { onConflict: 'user_id', ignoreDuplicates: true },
    );
    setConverting(false);
    setConvertedEmail(email);
  };

  useEffect(() => {
    const message = searchParams.get('message');
    setErrorMessage(null);
    if (message) {
        setErrorMessage(message);
    }
    if (!email || !firstName || !lastName) {
      console.error('Missing user details on password page, redirecting.');
      if (typeof window !== 'undefined') {
         window.location.href = '/signup?message=Something went wrong, please try again.';
      }
    }
  }, [searchParams, email, firstName, lastName]);

  if (!email || !firstName || !lastName) {
      return (<div className="flex min-h-screen items-center justify-center bg-[var(--bg-page)] text-[13px] text-[var(--text-3)]"><p>Loading user details…</p></div>);
  }

  // Conversion succeeded: the email is pending confirmation; the session (and
  // every project it owns) keeps working in the meantime.
  if (convertedEmail) {
    return (
      <AuthShell>
        <AuthTitle
          title="Check your inbox"
          sub={
            <>
              We sent a confirmation link to <strong className="font-semibold text-[var(--text)]">{convertedEmail}</strong>.
              Click it to finish creating your account.
            </>
          }
        />
        <p className="mb-[22px] text-[13px] text-[var(--text-3)]">
          Your work is saved and stays right here in the meantime.
        </p>
        <Link
          href="/editor"
          className="flex h-[38px] w-full cursor-pointer items-center justify-center rounded-[5px] bg-[var(--accent)] text-[13px] font-bold text-[var(--on-accent)] transition-colors duration-100 hover:bg-[var(--accent-hover)] hover:text-[var(--on-accent)]"
        >
          Back to the editor
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthTitle title="Sign up" sub={<>Setting a password for <span className="text-[var(--text-2)]">{email}</span>.</>} />

      {anonUid && (
        <AuthBanner kind="success">Your in-progress work will stay with this account.</AuthBanner>
      )}
      {errorMessage && <AuthBanner kind="error">{errorMessage}</AuthBanner>}

      <form
        action={anonUid ? undefined : completeSignup}
        onSubmit={anonUid ? handleConvert : undefined}
        className="flex flex-col gap-[14px]"
      >
        <input type="hidden" name="email" value={email || ''} />
        <input type="hidden" name="firstName" value={firstName || ''} />
        <input type="hidden" name="lastName" value={lastName || ''} />

        <div>
          <div className="mb-[6px] flex items-baseline justify-between">
            <label htmlFor="password" className={authLabelClass}>Password</label>
            <span className="text-[11px] text-[var(--text-muted)]">Min. 6 characters</span>
          </div>
          <input id="password" name="password" type="password" required minLength={6} className={authInputClass} placeholder="••••••••" />
        </div>
        <div>
          <label htmlFor="confirmPassword" className={`mb-[6px] block ${authLabelClass}`}>Confirm password</label>
          <input id="confirmPassword" name="confirmPassword" type="password" required minLength={6} className={authInputClass} placeholder="••••••••" />
        </div>

        {anonUid ? (
          <button
            type="submit"
            disabled={converting}
            className={`mt-1 ${authSubmitClass}`}
          >
            {converting ? 'Creating account…' : 'Complete sign up'}
          </button>
        ) : (
          <SubmitButton />
        )}
      </form>

      <p className="mt-5 text-center text-[13px] text-[var(--text-3)]">
        <Link href="/signup" className={authLinkClass}>&lsaquo; Back</Link>
      </p>
    </AuthShell>
  );
}

export default function SetPasswordPage() {
    return (
        <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[var(--bg-page)] text-[13px] text-[var(--text-3)]"><p>Loading…</p></div>}>
            <SetPasswordFormInternal />
        </Suspense>
    );
}
