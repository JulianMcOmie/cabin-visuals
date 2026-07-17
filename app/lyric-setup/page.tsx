'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { LyricSetupScreen } from '@/editor/components/LyricSetupScreen'
import { LoadingScreen } from '@/components/LoadingScreen'
import { useUIStore } from '@/editor/store/UIStore'
import { useProjectPersistence } from '@/editor/hooks/useProjectPersistence'
import { waitForSaved } from '@/persistence/autosave'

// The Lyric Video template's setup pipeline as its OWN route - not state
// inside /editor, so leaving (landing page, "Continue creating", back button)
// can never resurrect it. The projects page and the editor's Templates tab
// both send the fresh project here; when the lyrics are in, this page waits
// for autosave to land the document (the editor re-hydrates from the row on
// mount) and replaces itself with the editor.

function LyricSetupContent() {
  // Hydrates ?project= into the stores and arms autosave - the exact same
  // binding the editor itself uses, so the pipeline's writes persist.
  useProjectPersistence()
  const router = useRouter()
  const projectId = useSearchParams().get('project')
  const projectName = useUIStore((s) => s.projectName)
  const projectLoading = !!projectId && projectName === null

  const done = async () => {
    if (projectId) await waitForSaved()
    router.replace(projectId ? `/editor?project=${projectId}` : '/editor')
  }

  return <LyricSetupScreen projectLoading={projectLoading} onClose={() => void done()} />
}

export default function LyricSetupPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <LyricSetupContent />
    </Suspense>
  )
}
