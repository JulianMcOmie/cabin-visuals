'use client'

// The preview window frame: full-bleed, fixed height, square-shouldered,
// near-black, bottom hairline only — depth reserved for meaning, per the
// guide. The frame is shared; the CONTENTS stay bespoke, because a preview
// must run the instrument's real math (its shaders, its resolve()) and that
// is the part that genuinely differs per panel.

import type { ReactNode } from 'react'

export function PreviewWindow({ height = 148, rounded = false, title, testId, className = '', children }: {
  /** Fixed design height in px — the guide's ~148 for a 3D room, ~120 for a
   *  signal window; never a percentage (the pane is user-resizable). */
  height?: number
  /** Round the top corners to sit inside a `bleed="full"` Console. */
  rounded?: boolean
  title?: string
  testId?: string
  /** Extra classes (cursor-grab for an orbitable room, …). */
  className?: string
  children: ReactNode
}) {
  return (
    <div
      data-testid={testId}
      title={title}
      style={{ height }}
      className={`relative overflow-hidden border-b border-white/[0.06] bg-[#05070c] ${rounded ? 'rounded-t-[9px]' : ''} ${className}`}
    >
      {children}
    </div>
  )
}
