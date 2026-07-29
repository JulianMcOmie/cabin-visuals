/**
 * Transport glyphs: Tabler's outline player icons (player-play, player-stop,
 * player-skip-back, repeat), path data inlined verbatim from
 * @tabler/icons/outline so we don't carry the package for four glyphs.
 * Tabler's set is drawn as uniform 2px outlines on one 24 grid, so the four
 * read at the same optical weight without the per-glyph corrections the old
 * hand-drawn set needed. Default size matches the 15px the band's mockups
 * were balanced at (band is 36px tall).
 */

type IconProps = { size?: number }

function TablerIcon({ size = 15, children }: IconProps & { children: React.ReactNode }) {
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
      {children}
    </svg>
  )
}

export function PlayIcon(props: IconProps) {
  return (
    <TablerIcon {...props}>
      <path d="M7 4v16l13 -8z" />
    </TablerIcon>
  )
}

export function StopIcon(props: IconProps) {
  return (
    <TablerIcon {...props}>
      <path d="M5 5m0 2a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z" />
    </TablerIcon>
  )
}

export function SkipBackIcon(props: IconProps) {
  return (
    <TablerIcon {...props}>
      <path d="M20 5v14l-12 -7z" />
      <path d="M4 5l0 14" />
    </TablerIcon>
  )
}

export function LoopIcon(props: IconProps) {
  return (
    <TablerIcon {...props}>
      <path d="M4 12v-3a3 3 0 0 1 3 -3h13m-3 -3l3 3l-3 3" />
      <path d="M20 12v3a3 3 0 0 1 -3 3h-13m3 3l-3 -3l3 -3" />
    </TablerIcon>
  )
}
