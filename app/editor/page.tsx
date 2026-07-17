'use client'

import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { LoadingCabin } from '@/components/LoadingScreen'

// The editor bundle is heavy (three.js + the instrument library), so the gap
// between navigation and first paint is real - fill it with a dark shell
// instead of a blank document. Used for BOTH the dynamic() chunk load and the
// Suspense boundary (useSearchParams requires one in the App Router).
function EditorLoadingShell() {
  return (
    <div className="w-screen h-screen flex flex-col items-center justify-center gap-4 bg-[var(--bg-app)]">
      <LoadingCabin />
      <p className="text-sm text-[var(--text-muted)] select-none">Loading the studio…</p>
    </div>
  )
}

const EditorApp = dynamic(() => import('@/editor/App'), {
  ssr: false,
  loading: () => <EditorLoadingShell />,
})

export default function EditorPage() {
  return (
    <Suspense fallback={<EditorLoadingShell />}>
      <EditorApp />
    </Suspense>
  )
}
