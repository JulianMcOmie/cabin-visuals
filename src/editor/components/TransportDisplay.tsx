'use client'

import { useState } from 'react'
import { useTimeStore } from '../store/TimeStore'
import { useProjectStore } from '../store/ProjectStore'
import { BpmControl } from './BpmControl'

/**
 * The transport readout as a piece of gear: a recessed screen sitting beside
 * the (untouched) transport band. Position and tempo are the only two values -
 * project length now lives in the timeline, not up here.
 *
 * Surface colours are bespoke rather than token greys: the face is a step
 * darker than --bg-canvas so it reads as glass sunk into the bar, and the
 * numerals carry a cool cast (#b8c4cc / #dff0fa) - the one place outside
 * --accent that's allowed off-grey, because the screen lives in the accent's
 * temperature. Keep the glow at threshold level; it only appears during
 * playback.
 */

// Shared "LCD" text metrics - BpmControl mirrors these so both cells match.
const LCD_VALUE = 'font-mono text-[15px] leading-[1.2] tabular-nums'
const LCD_CAPTION =
  'font-mono text-[8px] font-semibold uppercase tracking-[0.12em] leading-none text-[#4a4a4a] select-none'

const MODE_KEY = 'cabin:transport-display-mode'

function formatBars(beat: number, beatsPerBar: number): string {
  const bar = Math.floor(beat / beatsPerBar) + 1
  const beatInBar = Math.floor(beat % beatsPerBar) + 1
  return `${bar.toString().padStart(3, '0')}:${beatInBar}`
}

function formatMinSec(beat: number, bpm: number): string {
  const sec = Math.max(0, (beat * 60) / Math.max(1, bpm))
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function TransportDisplay() {
  return (
    <div className="flex h-9 select-none items-stretch overflow-hidden rounded-md border border-[#202020] bg-[#0a0a0a] shadow-[inset_0_1px_4px_rgba(0,0,0,0.7)]">
      <PositionCell />
      <div className="my-1.5 w-px bg-[#1c1c1c]" />
      <BpmControl />
    </div>
  )
}

/** Playhead readout; click flips bars:beats ↔ min:sec (musicians think in
 *  bars, export thinks in seconds). The choice is remembered across sessions. */
function PositionCell() {
  const currentBeat = useTimeStore((s) => s.currentBeat)
  const isPlaying = useTimeStore((s) => s.isPlaying)
  const beatsPerBar = useProjectStore((s) => s.beatsPerBar)
  const bpm = useProjectStore((s) => s.bpm)
  const [mode, setMode] = useState<'bars' | 'time'>(() => {
    if (typeof window === 'undefined') return 'bars'
    return window.localStorage.getItem(MODE_KEY) === 'time' ? 'time' : 'bars'
  })

  const toggle = () => {
    const next = mode === 'bars' ? 'time' : 'bars'
    setMode(next)
    try {
      window.localStorage.setItem(MODE_KEY, next)
    } catch {
      /* private mode - the toggle still works for this session */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      // Enter must not bubble to the transport keys' window listener (which
      // would reset playback instead of toggling the display).
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.stopPropagation()
      }}
      title={mode === 'bars' ? 'Show time (min:sec)' : 'Show bars & beats'}
      className="flex cursor-pointer flex-col items-start justify-center px-3.5 text-left outline-none transition-colors hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]"
    >
      <span
        className={`${LCD_VALUE} inline-block min-w-[5ch] [transition:color_200ms,text-shadow_200ms] ${
          isPlaying ? 'text-[#dff0fa]' : 'text-[#b8c4cc]'
        }`}
        style={{ textShadow: isPlaying ? '0 0 8px rgba(53,167,230,0.5)' : 'none' }}
      >
        {mode === 'bars' ? formatBars(currentBeat, beatsPerBar) : formatMinSec(currentBeat, bpm)}
      </span>
      <span className={`${LCD_CAPTION} mt-[2px]`}>{mode === 'bars' ? 'bar · beat' : 'min · sec'}</span>
    </button>
  )
}
