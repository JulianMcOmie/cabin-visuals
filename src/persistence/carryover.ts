import { getSupabase } from './supabase'
import * as projectStorage from './projectStorage'
import type { ProjectDocument } from './types'

// Sign-in-to-save, phase 4 (docs/sign-in-to-save-architecture.html §5b): when
// an anonymous user logs into an EXISTING account, their session is replaced -
// there's no linking. So the auth pages stash the anonymous project before
// authentication, and the projects page redeems the stash into the real
// account afterward. Conversion-at-signup never needs this (same uuid), and
// the stored anonUserId guards against redeeming into the converted user.

const KEY = 'cabin.carryover.v1'

interface Carryover {
  anonUserId: string
  name: string
  document: ProjectDocument
}

/** Best-effort: if the current session is anonymous and owns a project, stash
 *  it for the account this browser is about to sign into. */
export async function stashAnonWork(): Promise<void> {
  try {
    const supabase = getSupabase()
    const { data } = await supabase.auth.getUser()
    if (!data.user?.is_anonymous) return
    const projects = await projectStorage.list()
    if (!projects.length) return
    const { name, document } = await projectStorage.load(projects[0].id)
    const stash: Carryover = { anonUserId: data.user.id, name, document }
    sessionStorage.setItem(KEY, JSON.stringify(stash))
  } catch {
    /* stashing is a courtesy - never block auth on it */
  }
}

/** The pending carryover for `currentUserId`, or null. Self-cleans when the
 *  "new" account IS the converted anonymous user (rows already theirs). */
export function takeCarryover(currentUserId: string): { name: string; document: ProjectDocument } | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const stash = JSON.parse(raw) as Carryover
    sessionStorage.removeItem(KEY)
    if (stash.anonUserId === currentUserId) return null // converted in place - nothing to carry
    return { name: stash.name, document: stash.document }
  } catch {
    return null
  }
}
