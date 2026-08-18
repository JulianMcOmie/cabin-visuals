'use server'

import { createClient } from '../../../src/utils/supabase/server' // Updated path
// Don't need redirect here as we return error object

export async function updatePassword(newPassword: string) {
  const supabase = await createClient()

  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      return { error: 'Password must be at least 6 characters long.' };
  }

  // The user should be authenticated at this point via the link hash
  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  })

  if (error) {
    console.error('Supabase password update error:', error.message);
    let errorMessage = 'Failed to update password. The reset link may have expired or been used already.';
    if (error.message.includes('weak password')) {
        errorMessage = 'Password is too weak. Please choose a stronger password.';
    }
    // Return error for client-side display
    return { error: errorMessage };
  }

  return { error: null }; // Return success
} 