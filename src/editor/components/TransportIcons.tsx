/**
 * Transport glyphs: Tabler's player icons, path data inlined verbatim from
 * @tabler/icons so we don't carry the package for four glyphs. Play, stop and
 * skip-back use the FILLED variants (solid shapes read better as transport
 * controls); repeat has no filled variant - necessarily a line drawing - so
 * the loop glyph keeps the outline set's uniform 2px stroke. The metronome
 * (tap tempo's opener, beside the BPM readout) and the tapping hand (its
 * prompt) are Tabler's outline glyphs too.
 * All share Tabler's 24 grid, so they sit at one optical weight without the
 * per-glyph corrections the old hand-drawn set needed. Default size matches the 15px
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

export function PauseIcon(props: IconProps) {
  return (
    <FilledIcon {...props}>
      <path d="M9 4h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h2a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2z" />
      <path d="M17 4h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h2a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2z" />
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

export function MetronomeIcon({ size = 15 }: IconProps) {
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
      <path d="M14.153 8.188l-.72 -3.236a2.493 2.493 0 0 0 -4.867 0l-3.025 13.614a2 2 0 0 0 1.952 2.434h7.014a2 2 0 0 0 1.952 -2.434l-.524 -2.357m-4.935 1.791l9 -13" />
      <path d="M19 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
    </svg>
  )
}

export function HandTapIcon({ size = 15 }: IconProps) {
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
      <path d="M8 13v-8.5a1.5 1.5 0 0 1 3 0v7.5" />
      <path d="M11 11.5v-2a1.5 1.5 0 0 1 3 0v2.5" />
      <path d="M14 10.5a1.5 1.5 0 0 1 3 0v1.5" />
      <path d="M17 11.5a1.5 1.5 0 0 1 3 0v4.5a6 6 0 0 1 -6 6h-2h.208a6 6 0 0 1 -5.012 -2.7l-.196 -.3c-.312 -.479 -1.407 -2.388 -3.286 -5.728a1.5 1.5 0 0 1 .536 -2.022a1.867 1.867 0 0 1 2.28 .28l1.47 1.47" />
      <path d="M5 3l-1 -1" />
      <path d="M4 7h-1" />
      <path d="M14 3l1 -1" />
      <path d="M15 6h1" />
    </svg>
  )
}
