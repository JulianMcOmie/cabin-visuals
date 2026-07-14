'use client'

import { useState } from 'react'

// A looping clip of the template's real render, served from the public Supabase
// bucket (see PreviewCaptureButton for how the clips are generated). This is the
// faithful-but-cheap preview: it IS the actual output, muted and looping, with no
// engine coupling and one <video> per card. Until a clip exists for a template,
// the card's gradient backdrop simply shows through.
const BUCKET_BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/template-previews`

export function TemplatePreviewVideo({ id }: { id: string }) {
  const [ok, setOk] = useState(true)
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !ok) return null
  return (
    <video
      src={`${BUCKET_BASE}/${id}.mp4`}
      autoPlay
      loop
      muted
      playsInline
      preload="metadata"
      onError={() => setOk(false)}
      // Bleed 1px past every edge (clipped by the card's overflow-hidden) so a
      // subpixel rounding gap can't let the gradient behind peek through - it
      // showed as a thin accent-coloured line on the right of some cards.
      className="absolute -inset-px h-[calc(100%+2px)] w-[calc(100%+2px)] object-cover"
    />
  )
}
