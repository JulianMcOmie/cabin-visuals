'use server'

import { redirect } from 'next/navigation'

export async function initiateSignup(formData: FormData) {
  const email = formData.get('email') as string;

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return redirect('/signup?message=Please enter a valid email address.'); // Updated path
  }

  const params = new URLSearchParams();
  params.set('email', email.trim());

  // Redirect to the new password page path
  return redirect(`/signup/set-password?${params.toString()}`);
}
