'use client';

import { useEffect, useState, Suspense } from 'react';
import Script from 'next/script';
import { handleSignInWithGoogle, login } from './actions';
import Link from 'next/link';
import { useSearchParams, usePathname } from 'next/navigation';
import { stashAnonWork } from '../../../src/persistence/carryover';

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

  async function handleGoogleSignInCallback(response: any) {
    console.log("Google Sign-In CredentialResponse:", response);
    if (response.credential) {
      setIsLoading(true);
      setError(null);
      try {
        // Logging in replaces any anonymous session — stash its work first so
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

  // Stash any anonymous work as soon as the login page opens — the password
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

    window.handleGoogleSignInCallback = handleGoogleSignInCallback;

    if (window.google?.accounts?.id) {
        const buttonContainer = document.getElementById('google-signin-button-container');
        if (buttonContainer) {
             if (buttonContainer.childElementCount === 0) {
                console.log('Rendering Google Sign-In button (Login Page)');
                window.google.accounts.id.renderButton(
                    buttonContainer,
                    { theme: "outline", size: "large", type: "standard", text: "signin_with", shape: "rectangular", logo_alignment: "left"}
                );
            }
        } else {
             console.error('Google Sign-In button container not found');
        }
    }

    return () => {
      delete window.handleGoogleSignInCallback;
    };
  }, [pathname, searchParams, isLoading]);


  return (
    <div className="flex min-h-screen items-center justify-center bg-black text-white">
      <div className="w-full max-w-md rounded-lg bg-gray-900/50 p-8 shadow-md border border-gray-800">
        <h1 className="mb-6 text-center text-2xl font-bold text-white">
          Sign In
        </h1>

        {message && ( <div className="mb-4 rounded border border-green-600 bg-green-900/30 p-3 text-center text-sm text-green-300">{message}</div> )}
        {error && ( <div className="mb-4 rounded border border-red-600 bg-red-900/30 p-3 text-center text-sm text-red-300">{error}</div> )}

        <form action={login} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-300">Email</label>
            <input id="email" name="email" type="email" required className="mt-1 block w-full rounded-full border border-gray-700 bg-black/50 px-4 py-3 text-white shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500 sm:text-sm placeholder-gray-500" placeholder="Enter your email address"/>
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-300">Password</label>
            <input id="password" name="password" type="password" required className="mt-1 block w-full rounded-full border border-gray-700 bg-black/50 px-4 py-3 text-white shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500 sm:text-sm placeholder-gray-500" placeholder="Enter password"/>
          </div>

          <div className="text-center text-sm py-2">
            <Link href="/reset-password" legacyBehavior>
               <a className="font-medium text-indigo-400 hover:text-indigo-300">Forgot password?</a>
            </Link>
          </div>

          <div className="pt-2">
            <button type="submit" className="w-full justify-center rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
              Log in
            </button>
          </div>
        </form>

        <div className="my-6 flex items-center">
          <div className="flex-grow border-t border-gray-700"></div>
          <span className="mx-4 flex-shrink text-sm text-gray-500">Or</span>
          <div className="flex-grow border-t border-gray-700"></div>
        </div>

        <div className="flex flex-col items-center space-y-3">
           <div id="g_id_onload" data-client_id={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID} data-context="signin" data-ux_mode="popup" data-callback="handleGoogleSignInCallback" data-nonce="" data-itp_support="true" data-use_fedcm_for_prompt="false" style={{ display: 'none' }}></div>
           <div id="google-signin-button-container" className="g_id_signin"></div>
        </div>

        <div className="mt-6 text-center text-sm">
          <p className="text-gray-400">
            Don&apos;t have an account?
            <Link href="/signup" legacyBehavior>
               <a className="ml-1 font-medium text-indigo-400 hover:text-indigo-300">Sign up</a>
             </Link>
          </p>
        </div>

      </div>
       <Script src="https://accounts.google.com/gsi/client" async defer strategy="afterInteractive" onLoad={() => console.log('Google GSI script loaded.')}></Script>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginPageContent />
    </Suspense>
  );
} 