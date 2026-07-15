'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '../../../src/utils/supabase/server' // Updated path
import { notifyOwner } from '../../../src/notifications/ownerNotify'

export async function login(formData: FormData) {
  const supabase = await createClient()
  const data = {
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  }

  const { error } = await supabase.auth.signInWithPassword(data)

  if (error) {
    console.error("Login Error:", error.message);
    // Redirect back to new login path with error
    return redirect('/login?error=Could not authenticate user');
  }

  revalidatePath('/', 'layout')
  // Redirect to the projects page after successful email/password login
  redirect('/projects');
}

export async function handleSignInWithGoogle(idToken: string) {
  const supabase = await createClient()

  if (!idToken) {
    console.error("handleSignInWithGoogle called without an ID token!");
    // Redirect back to new login path with error
    return redirect('/login?error=Google sign-in failed: No token received.');
  }

  console.log("Attempting signInWithIdToken...");
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });

  if (error) {
    console.error("signInWithIdToken error:", error);
    // Redirect back to new login path with error
    return redirect('/login?error=Could not authenticate with Google.');
  }

  console.log("signInWithIdToken success!");

  // Owner ping for FIRST-TIME Google users only (never throws). This action
  // serves login and signup alike, so "new" = the auth row was created within
  // the last minute - a returning login carries an old created_at.
  const user = data?.user
  if (user?.created_at && Date.now() - new Date(user.created_at).getTime() < 60_000) {
    const meta = user.user_metadata ?? {}
    await notifyOwner('🎉 New Cabin Visuals signup', [
      `Name: ${meta.name ?? ([meta.given_name, meta.family_name].filter(Boolean).join(' ') || 'unknown')}`,
      `Email: ${user.email ?? 'unknown'}`,
      `Method: Google`,
      `User id: ${user.id}`,
    ])
  }
  revalidatePath('/', 'layout')
  // Redirect to the projects page after successful Google Sign-In
  redirect('/projects');
} 