import type { User } from '@supabase/supabase-js'
import { getSupabase } from './supabase'

// Sign-in-to-save, phase 1 (docs/sign-in-to-save-architecture.html §2): the
// one place anonymous sessions are created. Flag-gated - with the flag off,
// ensureSession never signs anyone in and the editor behaves exactly as before.

export function anonSessionsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ANON_SESSIONS === '1'
}

let inflight: Promise<User | null> | null = null

/**
 * The current user if a session exists; otherwise a freshly created anonymous
 * user (when the flag allows). Returns null when no session can be had - the
 * caller falls back to in-memory mode. Single-flight so racing triggers (two
 * tabs, double events) share one sign-in attempt.
 */
export async function ensureSession(): Promise<User | null> {
  const supabase = getSupabase()
  const { data } = await supabase.auth.getUser()
  if (data.user) return data.user
  if (!anonSessionsEnabled()) return null

  if (!inflight) {
    inflight = (async () => {
      try {
        const { data: anon, error } = await supabase.auth.signInAnonymously()
        if (error) {
          console.warn('Anonymous sign-in unavailable (staying in-memory):', error.message)
          return null
        }
        return anon.user
      } catch {
        return null
      } finally {
        inflight = null
      }
    })()
  }
  return inflight
}
