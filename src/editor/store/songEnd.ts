import type { Track } from '../types'

// Where the song stops, and the rule that keeps looping visuals from running
// past it.
//
// Lyric templates author their ambience as ONE loop block claiming the 512-bar
// project ceiling, because a template cannot know how long the song will be.
// Something has to cut that back once there IS a song, and this is it. The
// audio-end math used to be copy-pasted in three places (addLyricTrack,
// applyTemplate, and the thumbnail path) which is how they drifted; it lives
// here now so every caller agrees on where the song ends.

export interface SongEndState {
  bpm: number
  beatsPerBar: number
  tracks: Record<string, Track>
  rootTrackIds: string[]
}

/** The song's last bar: the later of where the audio stops and where the
 *  transcribed lyrics stop. Returns 0 when there is neither, which callers
 *  treat as "nothing to trim to". */
export function songEndBars(s: SongEndState): number {
  const secPerBeat = 60 / s.bpm
  let endBars = 0
  for (const id of s.rootTrackIds) {
    const t = s.tracks[id]
    if (!t) continue
    if (t.type === 'audio') {
      for (const ab of t.audioBlocks ?? []) {
        const beats = Math.max(0, ab.trimEnd - ab.trimStart) / secPerBeat
        endBars = Math.max(endBars, ab.startBar + Math.ceil(beats / s.beatsPerBar))
      }
    } else if (t.type === 'base' && t.instrumentId === 'textDisplay' && t.name === 'Lyrics') {
      // Only the written-out word block counts. A looping block on the Lyrics
      // track would be the very thing we are trimming, so it cannot also be
      // the thing that decides how far to trim.
      for (const b of t.blocks) {
        if (!b.loop) endBars = Math.max(endBars, b.startBar + b.durationBars)
      }
    }
  }
  return endBars
}

/** Cut every looping block back to `endBars`. Returns the same object when
 *  nothing needed changing, so callers can hand it straight to a store update
 *  without forcing a re-render.
 *
 *  Shrink-only, deliberately: a block that already ends before the song is left
 *  alone. Re-growing would fight the user - a short loop is a choice, a
 *  512-bar one is the template's placeholder. */
export function trimLoopsToSongEnd(
  tracks: Record<string, Track>,
  endBars: number,
): Record<string, Track> {
  if (endBars <= 0) return tracks
  let changed = false
  const out: Record<string, Track> = {}
  for (const [id, t] of Object.entries(tracks)) {
    const needsTrim = t.blocks.some((b) => b.loop && b.startBar + b.durationBars > endBars)
    if (!needsTrim) {
      out[id] = t
      continue
    }
    changed = true
    out[id] = {
      ...t,
      blocks: t.blocks.map((b) =>
        b.loop && b.startBar + b.durationBars > endBars
          ? { ...b, durationBars: Math.max(1, endBars - b.startBar) }
          : b,
      ),
    }
  }
  return changed ? out : tracks
}
