import type { Scene } from '../../types'
import type { ObjectListEntry } from './VisualEngineInstance'
import { hasUnbatchableEffects } from './instancedEffects'

/** Shared stream fields have bounded local sampling, but their modifier chains
 * still evaluate CPU copies. Admit a bounded population to direct presentation;
 * arbitrary instruments, private clocks and per-copy effects keep the worker
 * policy. Ordinary lighting must not disable an otherwise batched scene. */
export function isDirectParticlePopulation(
  entries: readonly Pick<ObjectListEntry, 'trackId' | 'sceneId' | 'instrumentId' | 'maskSourceIds'>[],
  hasPlan: (trackId: string) => boolean,
  copyCount: (trackId: string) => number,
  staggered: ReadonlySet<string>,
  scenes?: Record<string, Scene>,
): boolean {
  const seen = new Set<string>()
  let particles = false, streamCopies = 0, streamTracks = 0, lights = 0
  for (const entry of entries) {
    if (seen.has(entry.trackId)) continue
    seen.add(entry.trackId)
    if (hasPlan(entry.trackId)) { particles = true; continue }
    if (entry.instrumentId !== 'particleStream' && entry.instrumentId !== 'light') return false
    const tracks = scenes?.[entry.sceneId]?.tracks, track = tracks?.[entry.trackId]
    if (!track || staggered.has(entry.trackId) || entry.maskSourceIds.length
      || hasUnbatchableEffects(tracks, entry.trackId)) return false
    if (entry.instrumentId === 'light') {
      lights += copyCount(entry.trackId)
      if (lights > 16) return false
    } else {
      particles = true
      streamTracks++
      streamCopies += copyCount(entry.trackId)
      if (streamTracks > 8 || streamCopies > 8192) return false
    }
  }
  return particles
}
