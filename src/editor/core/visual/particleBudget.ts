import type { PreviewQuality } from '../../store/UIStore'

/** Per emitter budget. Final preserves the authored count; Auto restores it paused. */
export function particleBudget(quality: PreviewQuality, playing: boolean, pinned = false): number {
  if (pinned || quality === 'final' || (quality === 'auto' && !playing)) return Infinity
  return quality === 'fastest' ? 1000 : quality === 'fast' ? 4000 : 8000
}

export function limitParticleCount(count: number, budget: number): number {
  return Math.max(0, Math.min(Math.floor(count), budget))
}
