'use client';

import { completeSignup } from './actions';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useFormStatus } from 'react-dom';
import { getSupabase } from '../../../../src/persistence/supabase';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button 
      type="submit" 
      className="w-full justify-center rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50"
      disabled={pending}
      aria-disabled={pending}
    >
      {pending ? 'Creating Account...' : 'Complete Sign Up'}
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
        setErrorMessage('An account with this email already exists. Log in instead — your current work will follow you.');
      } else {
        setErrorMessage(error.message);
      }
      return;
    }
    // Same uuid — their projects are already theirs. Profiles row is new though.
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
      return (<div className="flex min-h-screen items-center justify-center bg-black text-white"><p>Loading user details...</p></div>);
  }

  // Conversion succeeded: the email is pending confirmation; the session (and
  // every project it owns) keeps working in the meantime.
  if (convertedEmail) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        <div className="w-full max-w-md rounded-lg bg-gray-900/50 p-8 shadow-md border border-gray-800 text-center">
          <h1 className="mb-4 text-2xl font-bold text-white">Check your inbox</h1>
          <p className="text-sm text-gray-300">
            We sent a confirmation link to <strong className="text-white">{convertedEmail}</strong>.
            Click it to finish creating your account.
          </p>
          <p className="mt-3 text-sm text-gray-400">
            Your work is saved and stays right here in the meantime.
          </p>
          <Link
            href="/editor"
            className="mt-6 inline-block rounded-full bg-indigo-600 px-6 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            Back to the editor
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-black text-white">
      <div className="w-full max-w-md rounded-lg bg-gray-900/50 p-8 shadow-md border border-gray-800">
        <h1 className="mb-2 text-center text-2xl font-bold text-white">Sign Up</h1>
        <p className="mb-6 text-center text-sm text-gray-400">Setting password for: {email}</p>
        {anonUid && (
          <p className="mb-4 text-center text-xs text-emerald-300/90">
            Your in-progress work will stay with this account.
          </p>
        )}
        {errorMessage && ( <div className="mb-4 rounded border border-red-600 bg-red-900/30 p-3 text-center text-sm text-red-300">{errorMessage}</div> )}

        <form
          action={anonUid ? undefined : completeSignup}
          onSubmit={anonUid ? handleConvert : undefined}
          className="space-y-4"
        >
          <input type="hidden" name="email" value={email || ''} />
          <input type="hidden" name="firstName" value={firstName || ''} />
          <input type="hidden" name="lastName" value={lastName || ''} />

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-300">Create Password (min. 6 characters)</label>
            <input id="password" name="password" type="password" required minLength={6} className="mt-1 block w-full rounded-full border border-gray-700 bg-black/50 px-4 py-3 text-white shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500 sm:text-sm placeholder-gray-500" placeholder="Create password" />
          </div>
          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-300">Confirm Password</label>
            <input id="confirmPassword" name="confirmPassword" type="password" required minLength={6} className="mt-1 block w-full rounded-full border border-gray-700 bg-black/50 px-4 py-3 text-white shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500 sm:text-sm placeholder-gray-500" placeholder="Confirm password" />
          </div>
          <div className="pt-2">
            {anonUid ? (
              <button
                type="submit"
                disabled={converting}
                className="w-full justify-center rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 cursor-pointer"
              >
                {converting ? 'Creating Account...' : 'Complete Sign Up'}
              </button>
            ) : (
              <SubmitButton />
            )}
          </div>
        </form>
        <div className="mt-6 text-center text-sm">
           <Link href="/signup" legacyBehavior>
             <a className="font-medium text-indigo-400 hover:text-indigo-300">&lt; Back</a>
           </Link>
        </div>
      </div>
    </div>
  );
}

export default function SetPasswordPage() {
    return (
        <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-black text-white"><p>Loading...</p></div>}> 
            <SetPasswordFormInternal />
        </Suspense>
    );
} 