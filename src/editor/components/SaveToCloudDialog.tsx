'use client'

import { EditorDialog } from './EditorDialog'
import { SignupCard } from './SignupCard'

/**
 * "Save to cloud" from the top bar. The chip offers a destination; this is
 * where the account gets named, which is the only place the words "sign up"
 * appear in the flow.
 *
 * Same shell, same form, same voice as the export gate - see EditorDialog /
 * SignupCard. The title carries the whole message; there is no body copy.
 */
export function SaveToCloudDialog({ onClose }: { onClose: () => void }) {
  return (
    <EditorDialog
      title="Sign up to save this project to the cloud."
      onClose={onClose}
      variant="prompt"
      width="w-[400px]"
    >
      <SignupCard page="save-to-cloud" />
    </EditorDialog>
  )
}
