'use server'

import { createClient } from '../../../src/utils/supabase/server' // Use relative path
import { redirect } from 'next/navigation'

/**
 * Signs the user out and redirects them.
 */
export async function logout() {
  const supabase = await createClient();
  
  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error('Error logging out:', error.message);
  } else {
  }

  // Redirect to home page after logout
  redirect('/'); 
} 