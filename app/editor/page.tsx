'use client'

import { Suspense, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { LoadingCabin } from '@/components/LoadingScreen'
import { preloadProject } from '@/persistence/projectStorage'

// The editor bundle is heavy (three.js + the instrument library), so the gap
// between navigation and first paint is real - fill it with a dark shell
// instead of a blank document. Used for BOTH the dynamic() chunk load and the
// Suspense boundary (useSearchParams requires one in the App Router).
function EditorLoadingShell() {
  return (
    <div className="w-screen h-screen flex items-center justify-center bg-[var(--bg-page)]">
      <LoadingCabin />
    </div>
  )
}

const EditorApp = dynamic(() => import('@/editor/App'), {
  ssr: false,
  loading: () => <EditorLoadingShell />,
})

/** Kicks the project fetch off from the tiny route shell, so the round trip
 *  runs WHILE the editor chunk downloads instead of after it has parsed and
 *  mounted (useProjectPersistence's load() then finds it already in flight). */
function ProjectPreload() {
  const projectId = useSearchParams().get('project')
  useEffect(() => {
    if (projectId) preloadProject(projectId)
  }, [projectId])
  return null
}

export default function EditorPage() {
  return (
    <Suspense fallback={<EditorLoadingShell />}>
      <ProjectPreload />
      <EditorApp />
    </Suspense>
  )
}
