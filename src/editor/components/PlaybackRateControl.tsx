'use client'

import { useTimeStore } from '../store/TimeStore'
import { PLAYBACK_RATES, type PlaybackRate } from '../core/playbackRate'

/**
 * Monitoring speed, sitting beside the tempo readout at the bottom-right of the
 * canvas bar. Chosen from four mocked candidates (the transport cluster, here,
 * the scene bar's zoom pill, the timeline ruler's corner): speed and tempo are
 * the two numbers that decide how fast the playhead moves, so they share a
 * corner, and the centered transport cluster stays three quiet glyphs.
 *
 * ONE chip that cycles rather than a segment per speed: three speeds is a short
 * enough ring to click through, and a single cell keeps the corner as quiet as
 * the tempo readout it sits next to. It borrows the aspect selector's anatomy
 * (same height, radius, elevated fill, mono type) - that control is the bar's
 * established "click this value to change it", and the two now bookend the bar.
 * The "×" is what makes a bare numeral legible beside a BPM figure.
 *
 * It is not the tempo. BPM is the document; this is a lens on it - session-only,
 * never persisted, and exports ignore it entirely (see TimeStore.playbackRate).
 */

const RATE_LABEL: Record<PlaybackRate, string> = { 1: '1×', 0.5: '½×', 0.25: '¼×' }

// Slowing the transport resamples the audio rather than time-stretching it, so
// each halving is a real octave down. Say so - a user who hears it without
// warning reads it as a bug.
const RATE_TITLE: Record<PlaybackRate, string> = {
  1: 'Normal speed',
  0.5: 'Half speed - audio slows with the visuals, an octave lower',
  0.25: 'Quarter speed - audio slows with the visuals, two octaves lower',
}

export function PlaybackRateControl() {
  const rate = useTimeStore((s) => s.playbackRate)
  const setRate = useTimeStore((s) => s.setPlaybackRate)

  const next = PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(rate) + 1) % PLAYBACK_RATES.length]
  const slowed = rate !== 1

  return (
    <button
      type="button"
      onClick={() => setRate(next)}
      // Enter must not bubble to the transport keys' window listener, which
      // would return playback to the start (same guard as the position readout
      // and BpmControl).
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.stopPropagation()
      }}
      // The visible label is the CURRENT speed, so the accessible name has to
      // carry what the click does - otherwise the button announces as "½×".
      aria-label={`Playback speed: ${RATE_TITLE[rate]}. Click for ${RATE_LABEL[next]}`}
      title={`${RATE_TITLE[rate]} - click for ${RATE_LABEL[next]}`}
      className={`flex h-7 cursor-pointer items-center rounded-md px-2.5 font-mono text-[10px] leading-none tabular-nums transition-colors focus-visible:outline-1 focus-visible:outline-[var(--accent)] ${
        slowed
          ? 'bg-[var(--accent)]/15 text-[var(--accent)] hover:bg-[var(--accent)]/20'
          : 'bg-[var(--bg-elevated)] text-[var(--text-3)] hover:text-[var(--text)]'
      }`}
    >
      {RATE_LABEL[rate]}
    </button>
  )
}
