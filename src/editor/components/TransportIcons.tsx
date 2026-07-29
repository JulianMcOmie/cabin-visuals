/**
 * Transport glyphs drawn on a shared 12px grid.
 *
 * Lucide's stroke-first icons turned to mush with `fill` applied (a solid
 * shape wearing a 2px rounded outline) and each button used a different size.
 * These bake the optical corrections in instead: the play triangle sits a
 * shade right of geometric center, the stop square is drawn under-size (a
 * filled square reads larger than a triangle of the same box), and the loop
 * glyph - necessarily a line drawing - carries a heavier stroke than lucide's
 * scaled default so its weight sits with the solids. Solids take a 1px
 * same-color stroke purely for the rounded joins.
 */

type IconProps = { size?: number }

export function PlayIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M4.4 3 L4.4 9 L10 6 Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function StopIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <rect
        x="3.85"
        y="3.85"
        width="4.3"
        height="4.3"
        rx="0.8"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function SkipBackIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <rect x="3" y="3.1" width="1.2" height="5.8" rx="0.6" fill="currentColor" />
      <path
        d="M9.3 3.4 L9.3 8.6 L5.4 6 Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function LoopIcon({ size = 12 }: IconProps) {
  // Lucide Repeat's geometry scaled onto the 12 grid, redrawn at 1.3px stroke.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m8.5 1 2 2-2 2" />
      <path d="M1.5 5.5v-.5a2 2 0 0 1 2-2h7" />
      <path d="m3.5 11-2-2 2-2" />
      <path d="M10.5 6.5v.5a2 2 0 0 1-2 2h-7" />
    </svg>
  )
}
