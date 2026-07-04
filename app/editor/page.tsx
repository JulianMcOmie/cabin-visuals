'use client'

import { Suspense } from 'react'
import dynamic from 'next/dynamic'

const EditorApp = dynamic(() => import('@/editor/App'), { ssr: false })

// Suspense: the editor reads useSearchParams (its ?project binding), which
// requires a boundary on the page in the App Router.
export default function EditorPage() {
  return (
    <Suspense fallback={null}>
      <EditorApp />
    </Suspense>
  )
}
