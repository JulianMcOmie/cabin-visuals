'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useInstantNavigation } from '@/components/instantNavigation'
import { PhotoSetupScreen } from '@/editor/components/PhotoSetupScreen'
import { LoadingScreen } from '@/components/LoadingScreen'
import { useUIStore } from '@/editor/store/UIStore'
import { useProjectPersistence } from '@/editor/hooks/useProjectPersistence'
import { waitForSaved } from '@/persistence/autosave'

// The photo templates' add-your-photos step as its OWN route (the same shape
// as /lyric-setup): the projects page sends a fresh Crazy Edit project here;
// the user pours photos into the slot banks (or skips - the step is optional),
// autosave lands the document, and the page replaces itself with the editor.

function PhotoSetupContent() {
  // Hydrates ?project= into the stores and arms autosave - the exact same
  // binding the editor itself uses, so the pad writes persist.
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

  return <PhotoSetupScreen projectLoading={projectLoading} onClose={() => void done()} />
}

export default function PhotoSetupPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <PhotoSetupContent />
    </Suspense>
  )
}
