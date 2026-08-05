import { getInstrument } from '../instruments'
import type { Track } from '../types'

/** Sorted, de-duplicated tags across all tracks - the suggestions pool. */
export function allProjectTags(tracks: Record<string, Track>): string[] {
  return [...new Set(Object.values(tracks).flatMap((t) => t.tags ?? []))].sort()
}

/** Object tracks (registered instrument) carrying `tag` - mirrors how mover
 *  routing resolves a tag scope, so UI listings match what the engine targets. */
export function tracksWithTag(tracks: Record<string, Track>, tag: string): Track[] {
  return Object.values(tracks).filter(
    (t) => getInstrument(t.instrumentId) && (t.tags ?? []).includes(tag),
  )
}
