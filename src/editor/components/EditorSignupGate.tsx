'use client'

import { useEffect, useRef } from 'react'
import { AnimatePresence } from 'framer-motion'
import { EditorDialog } from './EditorDialog'
import { SignupCard } from './SignupCard'
import { useAuth } from '../../persistence/hooks/useAuth'
import { track } from '../../analytics/analytics'
import { DEV_GATES_OFF } from '../devGates'

/**
 * The editor is for people with accounts. Anyone without one meets this card
 * the moment the editor mounts, over the loaded project rather than instead of
 * it - they can see the thing they are signing up for, which is the whole
 * reason the gate lives here and not on the button that sent them.
 *
 * There is NO way past it: no close square, no Escape, no scrim click, no
 * "look around first". Every route in leads here - the /start template pick,
 * the pricing CTA, a bare /editor, a ?template= demo link - so a dismissable
 * gate would just be a slow door. The only exits are the ones the card offers:
 * sign up, or log in.
 *
 * Consequences worth knowing before you change this:
 * - It supersedes the guest-cap prompt on /projects and the export gate inside
 *   ExportDialog, which can no longer be reached by anyone. Both are left in
 *   place deliberately: deleting this component restores them.
 */

export function EditorSignupGate() {
  const { user, loading, isAnonymous } = useAuth()
  // An anonymous session is signed in for persistence only - it is not an
  // account, so it meets the gate like anyone else.
  const open = !DEV_GATES_OFF && !loading && !(user && !isAnonymous)

  // Once per mount, not once per render: `open` settles a tick after auth
  // resolves and would otherwise log on every re-render of the shell.
  const logged = useRef(false)
  useEffect(() => {
    if (!open || logged.current) return
    logged.current = true
    track('editor_gate_shown')
  }, [open])

  return (
    <AnimatePresence>
      {open && (
        <EditorDialog
          title="Sign up to start composing."
          variant="prompt"
          width="w-[400px]"
          dismissible={false}
        >
          <SignupCard page="editor-gate" />
        </EditorDialog>
      )}
    </AnimatePresence>
  )
}
