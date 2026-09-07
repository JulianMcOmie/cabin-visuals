import { Matrix4, Vector3 } from 'three'
import type { VisualCopy } from './types'
import type { MoverOrSplitterDefinition } from './definitions'
import { FRACTAL_COLOR } from './identityColors'
import { applySplitterSize, splitterSize, SPLITTER_SIZE_PARAM } from './splitterSize'
import { countLaneRows, resolveCountLane } from './countLane'

export interface FractalSettings {
  pattern: number
  depth: number
  branches: number
  shrink: number
  angle: number
  spread: number
  size: number
  plane: number
}

// Four generations of at most five children: 1 + 5 + 25 + 125 + 625.
// Keep complete generations, so the safety bound never chops off a star arm.
export const FRACTAL_MAX_COPIES = 781
const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback

/** Breadth-first local recursion. Each child inherits its parent's frame AND
 * scale: later generations take shorter steps and carry smaller instruments. */
export function fractalTransforms(settings: FractalSettings): Matrix4[] {
  const depth = Math.max(0, Math.min(4, Math.round(finite(settings.depth, 3))))
  const branches = Math.max(1, Math.min(5, Math.round(finite(settings.branches, 3))))
  const shrink = Math.max(0.1, Math.min(0.85, finite(settings.shrink, 0.45)))
  const spread = Math.max(0, Math.min(20, finite(settings.spread, 1.5)))
  const angle = finite(settings.angle, 30) * Math.PI / 180
  const normal = settings.plane === 1 ? new Vector3(0, 1, 0) : settings.plane === 2 ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1)
  const up = settings.plane === 1 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0)
  const steps = Array.from({ length: branches }, (_, i) => {
    const heading = settings.pattern === 1
      ? (branches === 1 ? 0 : (i / (branches - 1) - 0.5) * angle)
      : i / branches * Math.PI * 2
    return new Matrix4().makeRotationAxis(normal, heading)
      .multiply(new Matrix4().makeTranslation(up.x * spread, up.y * spread, up.z * spread))
      .multiply(new Matrix4().makeRotationAxis(normal, settings.pattern === 1 ? 0 : angle))
      .scale(new Vector3(shrink, shrink, shrink))
  })
  let generation = [new Matrix4()]
  const all = [...generation]
  for (let level = 0; level < depth; level++) {
    generation = generation.flatMap(parent => steps.map(step => parent.clone().multiply(step)))
    all.push(...generation)
  }
  // Shared SIZE grows the seed independently of the recursive step length.
  return all.map(matrix => applySplitterSize(matrix, splitterSize(settings.size)))
}

function resolveFractal(settings: FractalSettings) {
  const transforms = fractalTransforms(settings)
  return {
    apply(copy: VisualCopy) {
      return transforms.map(transform => ({
        ...copy,
        transform: copy.transform.clone().multiply(transform), colorShift: { ...copy.colorShift },
      }))
    }
  }
}

export const fractalSplitter: MoverOrSplitterDefinition<FractalSettings> = {
  id: 'fractal', label: 'Fractal', kind: 'splitter', identityColor: FRACTAL_COLOR,
  params: [
    { key: 'pattern', label: 'Pattern', type: 'select', options: [{ value: 0, label: 'Snowflake' }, { value: 1, label: 'Branches' }], default: 0 },
    { key: 'depth', label: 'Depth', min: 0, max: 4, step: 1, integer: true, default: 3 },
    { key: 'branches', label: 'Branches', min: 1, max: 5, step: 1, integer: true, default: 3 },
    { key: 'shrink', label: 'Shrink', min: 0.1, max: 0.85, step: 0.01, default: 0.45 },
    { key: 'angle', label: 'Angle (°)', min: -180, max: 180, step: 1, default: 30 },
    { key: 'spread', label: 'Spread', min: 0, max: 20, step: 0.1, default: 1.5 },
    SPLITTER_SIZE_PARAM,
    { key: 'plane', label: 'Plane', type: 'select', options: [{ value: 0, label: 'XY' }, { value: 1, label: 'XZ' }, { value: 2, label: 'YZ' }], default: 0 },
  ],
  midiRows: () => countLaneRows(0, 4, 'generation', 'generations'), strictMidiRows: true,
  resolve({ settings, notes }) {
    return resolveCountLane({ settings, notes, key: 'depth', min: 0, max: 4, resolveAt: resolveFractal })
  },
}
