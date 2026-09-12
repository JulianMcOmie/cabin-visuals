import { Matrix4 } from 'three'
import { identityVisualCopy } from './identityVisualCopy'
import type { MoverOrSplitter, VisualCopy } from './types'

/** A factored Cartesian product, never an array of its expanded occurrences.
 * Float64 retains the CPU reference; rendering uploads Float32 when edited or
 * when a layout/count lane changes the sampled beat. */
export interface ParticlePlan {
  version: number
  beat: number
  count: number
  counts: number[]
  offsets: number[]
  matrices: Float64Array
  /** Conservative linear scale bound, used only to select a GPU primitive. */
  scaleBound: number
}

export function matrixScaleBound(matrix: Matrix4): number {
  const e = matrix.elements
  const column = Math.max(Math.abs(e[0]) + Math.abs(e[1]) + Math.abs(e[2]), Math.abs(e[4]) + Math.abs(e[5]) + Math.abs(e[6]), Math.abs(e[8]) + Math.abs(e[9]) + Math.abs(e[10]))
  const row = Math.max(Math.abs(e[0]) + Math.abs(e[4]) + Math.abs(e[8]), Math.abs(e[1]) + Math.abs(e[5]) + Math.abs(e[9]), Math.abs(e[2]) + Math.abs(e[6]) + Math.abs(e[10]))
  return Math.sqrt(column * row)
}

/** Only explicit, appearance-preserving local layouts can use this path.
 * Static alone does not imply independence from index, formation or placement. */
export function compileParticlePlan(chain: readonly MoverOrSplitter[], version = 0, beat = 0): ParticlePlan | undefined {
  if (!chain.length || chain.length > 16) return undefined
  const counts: number[] = [], offsets: number[] = []
  const layouts: (readonly Matrix4[])[] = []
  let count = 1, length = 0
  let scaleBound = 1
  for (const entry of chain) {
    const layout = entry.localTransformsAtBeat?.(beat) ?? entry.localTransforms
    if (!layout?.length || entry.applyFramed || entry.emitsCopyClocks) return undefined
    if (entry.structuralVariants?.some(variant => !variant.localTransforms && !variant.localTransformsAtBeat)) return undefined
    count *= layout.length
    if (!Number.isSafeInteger(count) || count > 0x7fffffff) return undefined
    counts.push(layout.length); offsets.push(length)
    layouts.push(layout)
    scaleBound *= layout.reduce((max, matrix) => Math.max(max, matrixScaleBound(matrix)), 0)
    length += layout.length
  }
  const matrices = new Float64Array(length * 16)
  let offset = 0
  for (const layout of layouts) for (const matrix of layout) {
    if (!matrix.elements.every(Number.isFinite)) return undefined
    matrices.set(matrix.elements, offset); offset += 16
  }
  return { version, beat, count, counts, offsets, matrices, scaleBound }
}

/** Random access for inspection/picking: O(chain depth), with no expansion. */
export function particlePlanMatrix(plan: ParticlePlan, index: number, out: Matrix4, scratch = new Matrix4()): Matrix4 {
  out.identity()
  let stride = plan.count
  for (let stage = 0; stage < plan.counts.length; stage++) {
    stride /= plan.counts[stage]
    const slot = Math.floor(index / stride) % plan.counts[stage]
    scratch.fromArray(plan.matrices, (plan.offsets[stage] + slot) * 16)
    out.multiply(scratch)
  }
  return out
}

export function particlePlanCopy(plan: ParticlePlan, index: number): VisualCopy | undefined {
  if (!Number.isInteger(index) || index < 0 || index >= plan.count) return undefined
  const copy = identityVisualCopy()
  particlePlanMatrix(plan, index, copy.transform)
  return copy
}
