import { useUIStore } from '../../store/UIStore'
import { useTimeStore } from '../../store/TimeStore'
import { isExportPinned } from '../export/frameDriver'
import { particleBudget, limitParticleCount } from './particleBudget'

// Read synchronously inside instrument frames, including the first pinned export frame.
export function currentParticleBudget(): number {
  return particleBudget(useUIStore.getState().previewQuality, useTimeStore.getState().isPlaying, isExportPinned())
}

export function previewParticleCount(count: number): number {
  return limitParticleCount(count, currentParticleBudget())
}
