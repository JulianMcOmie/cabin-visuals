'use client'

import dynamic from 'next/dynamic'
import { notFound } from 'next/navigation'

// Dev-only capture harness for the instrument library's preview clips - the
// page `npm run previews:instruments` drives. Hard-404s in production so the
// capture hooks (and the whole instrument-registry bundle) never ship. Client
// + ssr:false like the editor page: the registry and the capture path are
// browser-only (WebGL, WebCodecs).
const InstrumentPreviewCapture = dynamic(
  () => import('@/editor/components/InstrumentPreviewCapture').then((m) => m.InstrumentPreviewCapture),
  { ssr: false },
)

export default function InstrumentPreviewsPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <InstrumentPreviewCapture />
}
