import type { Track } from '../types'

/** True for a track that contains only lighting: a
 *  light itself, or a group holding only lights. The timeline's empty-scene
 *  helper treats a scene wearing nothing else as still empty. */
export function isLightingOnlyTrack(track: Track | undefined, tracks: Record<string, Track>): boolean {
  if (!track) return false
  if (track.type === 'base' && track.instrumentId === 'light') return true
  return track.type === 'group'
    && track.childIds.length > 0
    && track.childIds.every((id) => isLightingOnlyTrack(tracks[id], tracks))
}
