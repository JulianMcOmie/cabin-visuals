'use client';

import { useEffect, useState, Suspense } from 'react';
import Script from 'next/script';
import { handleSignInWithGoogle, login } from './actions';
import Link from 'next/link';
import { useSearchParams, usePathname } from 'next/navigation';
import { stashAnonWork } from '../../../src/persistence/carryover';
import { track } from '../../../src/analytics/analytics';
import {
  AuthShell,
  AuthTitle,
  AuthBanner,
  AuthSubmit,
  OrDivider,
  authLabelClass,
  authInputClass,
  authLinkClass,
} from '../auth-ui';

declare global {
  interface Window {
    // google?: typeof import('google-one-tap');
    google?: any; // Use any to bypass type error for GSI script
    handleGoogleSignInCallback?: (response: any) => void;
  }
}

function LoginPageContent() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // True from password-form submit until the action's redirect unmounts the
  // page (or an error redirect brings back searchParams, which resets it).
  const [formBusy, setFormBusy] = useState(false);
  // Bumped by the GSI <Script>'s onLoad so the render-button effect re-runs
  // once the script is actually available (it usually loads after mount).
  const [gsiReady, setGsiReady] = useState(false);

  async function handleGoogleSignInCallback(response: any) {
    console.log("Google Sign-In CredentialResponse:", response);
    if (response.credential) {
      track('google_signin_submitted', { page: 'login' });
      setIsLoading(true);
      setError(null);
      try {
        // Logging in replaces any anonymous session - stash its work first so
        // the projects page can carry it into this account.
        await stashAnonWork();
        await handleSignInWithGoogle(response.credential);
      } catch (error) {
        // Next.js throws NEXT_REDIRECT as a mechanism to perform redirects in Server Actions
        // This is expected behavior, not an error - don't catch it
        if (error instanceof Error && error.message === 'NEXT_REDIRECT') {
          throw error; // Re-throw to allow redirect to proceed
        }
        console.error("Error calling handleSignInWithGoogle server action:", error);
        setError('Could not authenticate with Google.');
        setIsLoading(false);
      }
    } else {
      console.error("Google Sign-In failed: No credential received.");
      setError('Google Sign-In failed. Please try again.');
      setIsLoading(false);
    }
  }

  // Stash any anonymous work as soon as the login page opens - the password
  // form posts to a server action, so this is the reliable pre-auth moment.
  useEffect(() => {
    void stashAnonWork();
  }, []);

  useEffect(() => {
    const msg = searchParams.get('message');
    const errMsg = searchParams.get('error');
    if (msg) setMessage(msg);
    if (errMsg && !isLoading) setError(errMsg);
    else if (!errMsg) setError(null);
    // A failed login redirects back here with ?error - stop the logo smoking.
    if (errMsg) setFormBusy(false);

    window.handleGoogleSignInCallback = handleGoogleSignInCallback;

    if (window.google?.accounts?.id) {
        const buttonContainer = document.getElementById('google-signin-button-container');
        if (buttonContainer) {
             if (buttonContainer.childElementCount === 0) {
                console.log('Rendering Google Sign-In button (Login Page)');
                window.google.accounts.id.renderButton(
                    buttonContainer,
                    // "Console" restyle: filled_black is the darkest surface GSI
                    // offers (its exact bg/radius can't be overridden), width
                    // pinned to the card's inner width.
                    { theme: "filled_black", size: "large", type: "standard", text: "signin_with", shape: "rectangular", logo_alignment: "left", width: 342 }
                );
            }
        } else {
             console.error('Google Sign-In button container not found');
        }
    }

    return () => {
      delete window.handleGoogleSignInCallback;
    };
  }, [pathname, searchParams, isLoading, gsiReady]);


  return (
    <AuthShell footnote="Anonymous work carries over when you sign in" loading={isLoading || formBusy}>
      <AuthTitle title="Sign in" sub="Your projects are waiting." />

      {message && <AuthBanner kind="success">{message}</AuthBanner>}
      {error && <AuthBanner kind="error">{error}</AuthBanner>}

      <form action={login} onSubmit={() => { track('login_submitted'); setFormBusy(true) }} className="flex flex-col gap-[14px]">
        <div>
          <label htmlFor="email" className={`mb-[6px] block ${authLabelClass}`}>Email</label>
          <input id="email" name="email" type="email" required className={authInputClass} placeholder="you@example.com" />
        </div>
        <div>
          <div className="mb-[6px] flex items-baseline justify-between">
            <label htmlFor="password" className={authLabelClass}>Password</label>
            <Link href="/reset-password" className="cursor-pointer text-[11px] text-[var(--text-muted)] transition-colors duration-100 hover:text-[var(--text-3)]">
              Forgot?
            </Link>
          </div>
          <input id="password" name="password" type="password" required className={authInputClass} placeholder="••••••••" />
        </div>

        <AuthSubmit busy={formBusy} busyLabel="Signing in…">Sign in</AuthSubmit>
      </form>

      <OrDivider />

      <div className="flex flex-col items-center">
         <div id="g_id_onload" data-client_id={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID} data-context="signin" data-ux_mode="popup" data-callback="handleGoogleSignInCallback" data-nonce="" data-itp_support="true" data-use_fedcm_for_prompt="false" style={{ display: 'none' }}></div>
         {/* GSI draws its own (dark, filled_black) button via the imperative
             renderButton call - no g_id_signin class (that triggers GSI's
             declarative auto-render with WHITE defaults, overriding our theme)
             and no styled wrapper (a mismatched container strip looks wrong
             behind whatever width GSI decides to render). */}
         <div id="google-signin-button-container" className="flex justify-center"></div>
      </div>

      <p className="mt-5 text-center text-[13px] text-[var(--text-3)]">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className={authLinkClass}>Sign up</Link>
      </p>

      <Script src="https://accounts.google.com/gsi/client" async defer strategy="afterInteractive" onLoad={() => setGsiReady(true)}></Script>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[var(--bg-page)] text-[13px] text-[var(--text-3)]">Loading…</div>}>
      <LoginPageContent />
    </Suspense>
  );
}
