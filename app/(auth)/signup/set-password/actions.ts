'use server'

import { redirect } from 'next/navigation'
import { createClient } from '../../../../src/utils/supabase/server' // Updated path
import { notifyOwner } from '../../../../src/notifications/ownerNotify'

export async function completeSignup(formData: FormData) {
  const supabase = await createClient();

  // Extract data from formData
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const confirmPassword = formData.get('confirmPassword') as string; // Also get confirm password

  // *** DEBUG LOGGING START ***
  // *** DEBUG LOGGING END ***

  // Rebuild params for potential redirects
  const params = new URLSearchParams();
  if (email) params.set('email', email);

  // --- Validation ---
  if (!email || !password || !confirmPassword) {
    console.error('CompleteSignup: Missing form data. Received:',
        { email, passwordExists: !!password, confirmPasswordExists: !!confirmPassword }
    );
    return redirect('/signup?message=Something went wrong, please start over.');
  }

  if (password !== confirmPassword) {
    console.warn('CompleteSignup: Passwords do not match.');
    params.set('message', 'Passwords do not match.');
    return redirect(`/signup/set-password?${params.toString()}`);
  }

  if (password.length < 6) {
    console.warn('CompleteSignup: Password too short.');
    params.set('message', 'Password must be at least 6 characters long');
    return redirect(`/signup/set-password?${params.toString()}`);
  }
  // --- End Validation ---

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    // emailRedirectTo: `${origin}/auth/callback` // Optional: Specify explicit redirect
  });

  if (error) {
    console.error('CompleteSignup supabase.auth.signUp Error:', error.message);
    let errorMessage = 'Could not create account. Please try again.';
    if (error.message.includes('User already registered')) {
        errorMessage = 'An account with this email already exists. Please log in instead.';
    } else if (error.message.includes('weak password')) {
        errorMessage = 'Password is too weak. Please choose a stronger one.';
    } // Add more specific error checks if needed
    
    params.set('message', errorMessage);
    // Redirect back to set-password path with error
    return redirect(`/signup/set-password?${params.toString()}`);
  }

  // Owner ping (never throws). Guarded on identities: signUp with an email that
  // already has an account "succeeds" but returns an identity-less stub user -
  // only a real new signup carries an identity.
  if (data.user && (data.user.identities?.length ?? 0) > 0) {
    await notifyOwner('🎉 New Cabin Visuals signup', [
      `Email: ${email}`,
      `Method: email/password`,
      `User id: ${data.user.id}`,
    ])
  }

  // On successful signup initiation, redirect to login with a confirmation message
  return redirect('/projects');//redirect('/login?message=Please check your email to confirm your account.');
} 