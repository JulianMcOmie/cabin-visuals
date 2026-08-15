import type { ReactNode } from 'react'
import { midiNoteBaseColor } from '../../utils/midiEditorPalette'

/**
 * The instrument mark at the left of every track row.
 *
 * The mark's SHAPE says which instrument (trackGlyphs.tsx); its COLOR is the
 * track's display color, re-voiced through `midiNoteBaseColor` - the same OKLCH
 * recipe (L .82 / C .16) the blocks and piano-roll notes wear, so the icon and
 * the row's blocks are literally the same color, and a dim or muddy identity
 * color cannot produce an unreadable mark on the near-black label.
 *
 * The LOOK is "glow": the tinted glyph over its own soft bloom, chosen from six
 * candidates built into the live editor 2026-08-15 (bare / chip / solid / well /
 * stripe / glow). It speaks the timeline's neon voice - the same lit-mark-on-a
 * -dark-pane language as a resting MIDI block - where the container looks
 * (chip, solid, well) each added a second rectangle to a row that already has
 * M/S/tag/transform squares in it.
 */

/** Horizontal room the slot takes (icon + its gap). Feeds the label column's
 *  fader threshold so the strip stays honest about its width. */
export const TRACK_ICON_WIDTH = 22

interface TrackIconProps {
  glyph: ReactNode
  /** The track's display color (raw identity hex - re-voiced here). */
  color: string
  /** Sub-rows (automation / envelope / ability) sit quieter than their object. */
  muted?: boolean
}

export function TrackIcon({ glyph, color, muted }: TrackIconProps) {
  const tint = midiNoteBaseColor(color)
  return (
    <span
      className="relative flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center"
      style={{ color: tint, opacity: muted ? 0.62 : 1 }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-[5px] rounded-full"
        style={{ background: `radial-gradient(circle, color-mix(in srgb, ${tint} 34%, transparent) 0%, transparent 68%)` }}
      />
      <svg
        width="15"
        height="15"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="relative"
      >
        {glyph}
      </svg>
    </span>
  )
}
