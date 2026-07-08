// The one place beat⟷second block-placement math lives - extracted from
// AudioEngine.armBlock so live playback and offline export literally share it.
// Three cases per block relative to `atBeat`: past (null - leave idle), future
// (delay ahead), mid-clip (join at an in-clip offset). The live engine calls
// this at transport events with the seek beat; export calls it once with 0.

import type { AudioBlock } from '../../types'

export interface BlockPlacement {
  /** Seconds after the anchor (live: `when`; export: t=0) the source starts. */
  delaySec: number
  /** In-clip offset (seconds) to start from. */
  offset: number
  /** Seconds of clip to play. */
  duration: number
}

export function blockPlacement(
  block: Pick<AudioBlock, 'startBar' | 'trimStart' | 'trimEnd'>,
  atBeat: number,
  bpm: number,
  beatsPerBar: number,
): BlockPlacement | null {
  const startBeat = block.startBar * beatsPerBar
  const clipSec = Math.max(0, block.trimEnd - block.trimStart)
  const endBeat = startBeat + (clipSec * bpm) / 60

  if (atBeat >= endBeat) return null // past - nothing to play
  if (atBeat <= startBeat) {
    // future - starts after a delay
    return { delaySec: ((startBeat - atBeat) * 60) / bpm, offset: block.trimStart, duration: clipSec }
  }
  // mid-clip - join with an in-clip offset
  const offset = block.trimStart + ((atBeat - startBeat) * 60) / bpm
  return { delaySec: 0, offset, duration: Math.max(0, block.trimEnd - offset) }
}
