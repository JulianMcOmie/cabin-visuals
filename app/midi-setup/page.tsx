'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useInstantNavigation } from '@/components/instantNavigation'
import { MidiSetupScreen } from '@/editor/components/MidiSetupScreen'
import { LoadingScreen } from '@/components/LoadingScreen'
import { useUIStore } from '@/editor/store/UIStore'
import { useProjectPersistence } from '@/editor/hooks/useProjectPersistence'
import { waitForSaved } from '@/persistence/autosave'

// The Midi Roll template's add-your-MIDI-and-song step as its OWN route (the
// same shape as /photo-setup): the projects page sends a fresh Midi Roll
// project here; the user drops a MIDI file (which restyles onto the template's
// roll track) and optionally the song it plays, autosave lands the document,
// and the page replaces itself with the editor.

function MidiSetupContent() {
  // Hydrates ?project= into the stores and arms autosave - the exact same
  // binding the editor itself uses, so the imported notes persist.
  useProjectPersistence()
  const { go } = useInstantNavigation()
  const search = useSearchParams()
  const projectId = search.get('project')
  const projectName = useUIStore((s) => s.projectName)
  const projectLoading = !!projectId && projectName === null

  const done = async () => {
    if (projectId) await waitForSaved()
    go(projectId ? `/editor?project=${projectId}` : '/editor', { replace: true })
  }

  return <MidiSetupScreen projectLoading={projectLoading} onClose={() => void done()} />
}

export default function MidiSetupPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <MidiSetupContent />
    </Suspense>
  )
}
