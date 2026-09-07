import { useId, type ReactNode } from 'react'
import { gradientStops } from '../../utils/oklch'
import { trackChromeColor } from '../../utils/trackChromeColor'

/**
 * The instrument mark at the left of every track row.
 *
 * The mark's SHAPE says which instrument (trackGlyphs.tsx); its COLOR is the
 * track's identity color, re-voiced through `trackChromeColor`. Colored
 * identities gain saturation; neutrals keep their lightness differences,
 * lifted enough for dark identities to remain readable on the label.
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
  /** The track's identity color (including neutrals - re-voiced here). */
  color: string
  /** Sub-rows (automation / envelope / ability) sit quieter than their object. */
  muted?: boolean
  gradient?: [string, string]
}

export function TrackIcon({ glyph, color, muted, gradient }: TrackIconProps) {
  const gradientId = useId()
  const tint = trackChromeColor(color)
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
        stroke={gradient ? `url(#${gradientId})` : "currentColor"}
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="relative"
      >
        {gradient && <defs><linearGradient id={gradientId}>{gradientStops(gradient[0], gradient[1], 9).map((color, i) => <stop key={i} offset={`${i * 12.5}%`} stopColor={color} />)}</linearGradient></defs>}
        {glyph}
      </svg>
    </span>
  )
}
