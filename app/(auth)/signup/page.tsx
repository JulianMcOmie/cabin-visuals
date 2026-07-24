'use client';

import { initiateSignup } from './actions'; // Updated import
import Link from 'next/link';
import { useSearchParams, usePathname } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react'; // Import Suspense
import Script from 'next/script';
import { handleSignInWithGoogle } from '../login/actions'; // Updated import
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
    // Use any to resolve the type conflict
    google?: any;
    handleGoogleSignInCallback?: (response: any) => void;
  }
}

// Extracted content component
function SignupPageContent() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Smokes the logo while the Google server action authenticates + redirects.
  const [googleBusy, setGoogleBusy] = useState(false);
  // Same, from email-form submit until navigation (or the error effect resets it).
  const [formBusy, setFormBusy] = useState(false);
  // Bumped by the GSI <Script>'s onLoad so the render-button effect re-runs
  // once the script is actually available (it usually loads after mount).
  const [gsiReady, setGsiReady] = useState(false);

  async function handleGoogleSignInCallback(response: any) {
    console.log("Google Sign-In CredentialResponse (Signup Page):", response);
    if (response.credential) {
      track('google_signin_submitted', { page: 'signup' });
      setGoogleBusy(true);
      try {
        // Google sign-in replaces any anonymous session - stash its work so
        // the projects page can carry it into the resulting account.
        await stashAnonWork();
        await handleSignInWithGoogle(response.credential);
        // Assuming successful handleSignInWithGoogle navigates or updates state elsewhere
      } catch (error) {
        // Next.js throws NEXT_REDIRECT as a mechanism to perform redirects in Server Actions
        // This is expected behavior, not an error - don't catch it
        if (error instanceof Error && error.message === 'NEXT_REDIRECT') {
          throw error; // Re-throw to allow redirect to proceed
        }
        console.error("Error calling handleSignInWithGoogle server action:", error);
        setErrorMessage('Google sign-in failed. Please try again.');
        setGoogleBusy(false);
      }
    } else {
      console.error("Google Sign-In failed: No credential received.");
       setErrorMessage('Google sign-in failed: No credential received.');
    }
  }

  // Effect for handling URL messages
  useEffect(() => {
    const message = searchParams.get('message');
    if (message) setErrorMessage(message);
    // A validation redirect brings us back with ?message - stop the smoke.
    if (message) setFormBusy(false);
  }, [searchParams]);

  // Stash any anonymous work on arrival: covers the Google path and the
  // "email already exists → log in" handoff. (Email/password conversion never
  // needs it - same uuid - and takeCarryover self-cleans in that case.)
  useEffect(() => {
    void stashAnonWork();
  }, []);

  // Effect for Google Sign-In setup and rendering
  useEffect(() => {
    window.handleGoogleSignInCallback = handleGoogleSignInCallback;
    if (window.google?.accounts?.id) {
        const buttonContainer = document.getElementById('google-signin-button-container');
        if (buttonContainer && buttonContainer.childElementCount === 0) {
            console.log('Rendering Google Sign-In button (Signup Page)');
            window.google.accounts.id.renderButton(
                buttonContainer,
                // "Console" restyle: filled_black is the darkest surface GSI
                // offers (its exact bg/radius can't be overridden). Width
                // follows the card's MEASURED inner width - a fixed 342
                // overflowed the card on small phones.
                { theme: "filled_black", size: "large", type: "standard", text: "signup_with", shape: "rectangular", logo_alignment: "left", width: Math.min(342, Math.max(200, buttonContainer.clientWidth || 342)) }
            );
        }
    }
    return () => {
      delete window.handleGoogleSignInCallback;
    };
    // Note: pathname dependency might not be necessary unless GSI logic depends on path
  }, [pathname, gsiReady]);

  return (
    <AuthShell footnote="Anonymous work carries over when you sign up" loading={googleBusy || formBusy}>
      <AuthTitle title="Sign up" sub="Make music you can see." />

      {errorMessage && <AuthBanner kind="error">{errorMessage}</AuthBanner>}

      <form action={initiateSignup} onSubmit={() => { track('signup_started'); setFormBusy(true) }} className="flex flex-col gap-[14px]">
        <div className="flex gap-3">
          <div className="flex-1">
            <label htmlFor="firstName" className={`mb-[6px] block ${authLabelClass}`}>First name</label>
            <input id="firstName" name="firstName" type="text" required className={authInputClass} placeholder="First name" />
          </div>
          <div className="flex-1">
            <label htmlFor="lastName" className={`mb-[6px] block ${authLabelClass}`}>Last name</label>
            <input id="lastName" name="lastName" type="text" required className={authInputClass} placeholder="Last name" />
          </div>
        </div>
        <div>
          <label htmlFor="email" className={`mb-[6px] block ${authLabelClass}`}>Email</label>
          <input id="email" name="email" type="email" required className={authInputClass} placeholder="you@example.com" />
        </div>
        <AuthSubmit busy={formBusy} busyLabel="Checking…">Continue</AuthSubmit>
      </form>

      <OrDivider />

      <div className="flex flex-col items-center">
         <div id="g_id_onload" data-client_id={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID} data-context="signup" data-ux_mode="popup" data-callback="handleGoogleSignInCallback" data-nonce="" data-itp_support="true" data-use_fedcm_for_prompt="false" style={{ display: 'none' }}></div>
         {/* GSI draws its own (dark, filled_black) button via the imperative
             renderButton call - no g_id_signin class (that triggers GSI's
             declarative auto-render with WHITE defaults, overriding our theme)
             and no styled wrapper (a mismatched container strip looks wrong
             behind whatever width GSI decides to render). */}
         {/* w-full so the empty container measures the card's inner width -
             renderButton reads clientWidth before anything is in it. */}
         <div id="google-signin-button-container" className="flex w-full justify-center"></div>
      </div>

      <p className="mt-5 text-center text-[13px] text-[var(--text-3)]">
        Already have an account?{' '}
        <Link href="/login" className={authLinkClass}>Log in</Link>
      </p>

      <Script src="https://accounts.google.com/gsi/client" async defer strategy="afterInteractive" onLoad={() => setGsiReady(true)}></Script>
    </AuthShell>
  );
}

// Default export wraps the content component with Suspense
export default function SignupPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[var(--bg-page)] text-[13px] text-[var(--text-3)]">Loading…</div>}>
      <SignupPageContent />
    </Suspense>
  );
}
