'use client';

import { initiateSignup } from './actions'; // Updated import
import Link from 'next/link';
import { useSearchParams, usePathname } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react'; // Import Suspense
import Script from 'next/script';
import { handleSignInWithGoogle } from '../login/actions'; // Updated import
import { stashAnonWork } from '../../../src/persistence/carryover';

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

  async function handleGoogleSignInCallback(response: any) {
    console.log("Google Sign-In CredentialResponse (Signup Page):", response);
    if (response.credential) {
      try {
        // Google sign-in replaces any anonymous session — stash its work so
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
  }, [searchParams]);

  // Stash any anonymous work on arrival: covers the Google path and the
  // "email already exists → log in" handoff. (Email/password conversion never
  // needs it — same uuid — and takeCarryover self-cleans in that case.)
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
                { theme: "outline", size: "large", type: "standard", text: "signup_with", shape: "rectangular", logo_alignment: "left"}
            );
        }
    }
    return () => {
      delete window.handleGoogleSignInCallback;
    };
    // Note: pathname dependency might not be necessary unless GSI logic depends on path
  }, [pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-black text-white">
      <div className="w-full max-w-md rounded-lg bg-gray-900/50 p-8 shadow-md border border-gray-800">
        <h1 className="mb-6 text-center text-2xl font-bold text-white">
          Sign Up
        </h1>
        {errorMessage && ( <div className="mb-4 rounded border border-red-600 bg-red-900/30 p-3 text-center text-sm text-red-300">{errorMessage}</div> )}
        <form action={initiateSignup} className="space-y-4">
          <div className="flex space-x-4">
            <div className="flex-1">
              <label htmlFor="firstName" className="block text-sm font-medium text-gray-300">First Name</label>
              <input id="firstName" name="firstName" type="text" required className="mt-1 block w-full rounded-full border border-gray-700 bg-black/50 px-4 py-3 text-white shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500 sm:text-sm placeholder-gray-500" placeholder="Your first name" />
            </div>
            <div className="flex-1">
              <label htmlFor="lastName" className="block text-sm font-medium text-gray-300">Last Name</label>
              <input id="lastName" name="lastName" type="text" required className="mt-1 block w-full rounded-full border border-gray-700 bg-black/50 px-4 py-3 text-white shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500 sm:text-sm placeholder-gray-500" placeholder="Your last name" />
            </div>
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-300">Email</label>
            <input id="email" name="email" type="email" required className="mt-1 block w-full rounded-full border border-gray-700 bg-black/50 px-4 py-3 text-white shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500 sm:text-sm placeholder-gray-500" placeholder="Enter your email address" />
          </div>
          <div className="pt-2">
            <button type="submit" className="w-full justify-center rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">Continue</button>
          </div>
        </form>
        <div className="my-6 flex items-center">
          <div className="flex-grow border-t border-gray-700"></div>
          <span className="mx-4 flex-shrink text-sm text-gray-500">Or</span>
          <div className="flex-grow border-t border-gray-700"></div>
        </div>
        <div className="flex flex-col items-center space-y-3">
           <div id="g_id_onload" data-client_id={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID} data-context="signup" data-ux_mode="popup" data-callback="handleGoogleSignInCallback" data-nonce="" data-itp_support="true" data-use_fedcm_for_prompt="false" style={{ display: 'none' }}></div>
           <div id="google-signin-button-container" className="g_id_signin"></div>
        </div>
        <div className="mt-6 text-center text-sm">
          <p className="text-gray-400">
            Already have an account?
            <Link href="/login" legacyBehavior>
              <a className="ml-1 font-medium text-indigo-400 hover:text-indigo-300">Log in</a>
            </Link>
          </p>
        </div>
      </div>
       <Script src="https://accounts.google.com/gsi/client" async defer strategy="afterInteractive" onLoad={() => console.log('Google GSI script loaded.')}></Script>
    </div>
  );
}

// Default export wraps the content component with Suspense
export default function SignupPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <SignupPageContent />
    </Suspense>
  );
} 