/**
 * Transport glyphs: Tabler's player icons, path data inlined verbatim from
 * @tabler/icons so we don't carry the package for four glyphs. Play, stop and
 * skip-back use the FILLED variants (solid shapes read better as transport
 * controls); repeat has no filled variant - necessarily a line drawing - so
 * the loop glyph keeps the outline set's uniform 2px stroke. All four share
 * Tabler's 24 grid, so they sit at one optical weight without the per-glyph
 * corrections the old hand-drawn set needed. Default size matches the 15px
 * the band's mockups were balanced at (band is 36px tall).
 */

type IconProps = { size?: number }

function FilledIcon({ size = 15, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      {children}
    </svg>
  )
}

export function PlayIcon(props: IconProps) {
  return (
    <FilledIcon {...props}>
      <path d="M6 4v16a1 1 0 0 0 1.524 .852l13 -8a1 1 0 0 0 0 -1.704l-13 -8a1 1 0 0 0 -1.524 .852z" />
    </FilledIcon>
  )
}

export function StopIcon(props: IconProps) {
  return (
    <FilledIcon {...props}>
      <path d="M17 4h-10a3 3 0 0 0 -3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3 -3v-10a3 3 0 0 0 -3 -3z" />
    </FilledIcon>
  )
}

export function SkipBackIcon(props: IconProps) {
  return (
    <FilledIcon {...props}>
      <path d="M19.496 4.136l-12 7a1 1 0 0 0 0 1.728l12 7a1 1 0 0 0 1.504 -.864v-14a1 1 0 0 0 -1.504 -.864z" />
      <path d="M4 4a1 1 0 0 1 .993 .883l.007 .117v14a1 1 0 0 1 -1.993 .117l-.007 -.117v-14a1 1 0 0 1 1 -1z" />
    </FilledIcon>
  )
}

export function LoopIcon({ size = 15 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 12v-3a3 3 0 0 1 3 -3h13m-3 -3l3 3l-3 3" />
      <path d="M20 12v3a3 3 0 0 1 -3 3h-13m3 3l-3 -3l3 -3" />
    </svg>
  )
}
