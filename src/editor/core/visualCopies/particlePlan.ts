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
  // The largest singular value is sqrt(lambdaMax(AᵀA)), bounded by the
  // Gram matrix's largest absolute row sum. Unlike norms of A itself, this
  // stays at one for a rotation: rotating a cloud must not spuriously switch
  // between points and quads by changing its estimated particle size.
  // Normalize first so finite tiny/large transforms do not under/overflow
  // while their entries are squared. Translation has no effect on size.
  const scale = Math.max(Math.abs(e[0]), Math.abs(e[1]), Math.abs(e[2]),
    Math.abs(e[4]), Math.abs(e[5]), Math.abs(e[6]), Math.abs(e[8]), Math.abs(e[9]), Math.abs(e[10]))
  if (scale === 0) return 0
  if (!Number.isFinite(scale)) return Infinity
  const ax = e[0] / scale, ay = e[1] / scale, az = e[2] / scale
  const bx = e[4] / scale, by = e[5] / scale, bz = e[6] / scale
  const cx = e[8] / scale, cy = e[9] / scale, cz = e[10] / scale
  const aa = ax * ax + ay * ay + az * az
  const bb = bx * bx + by * by + bz * bz
  const cc = cx * cx + cy * cy + cz * cz
  const ab = Math.abs(ax * bx + ay * by + az * bz)
  const ac = Math.abs(ax * cx + ay * cy + az * cz)
  const bc = Math.abs(bx * cx + by * cy + bz * cz)
  // A small outward margin covers the dot-product/sqrt rounding, including
  // the exact orthogonal case, without a visible change in the bound.
  return scale * Math.sqrt(Math.max(aa + ab + ac, bb + ab + bc, cc + ac + bc)) * (1 + 8 * Number.EPSILON)
}

/** Only explicit, appearance-preserving layouts and uniform root motions can
 * use this path. Static alone does not imply independence from index, formation
 * or placement. Root deltas collect on the left; their count-one prefix never
 * changes the local layouts' input-major slot order. */
export function compileParticlePlan(chain: readonly MoverOrSplitter[], version = 0, beat = 0): ParticlePlan | undefined {
  if (!chain.length) return undefined
  const counts: number[] = [], offsets: number[] = []
  const layouts: (readonly Matrix4[])[] = []
  let count = 1, length = 0
  let scaleBound = 1
  let root: Matrix4 | undefined
  const factored = (entry: MoverOrSplitter) => {
    const local = !!(entry.localTransforms || entry.localTransformsAtBeat)
    const uniformRoot = !!(entry.rootTransform || entry.rootTransformAtBeat)
    return local !== uniformRoot && !entry.applyFramed && !entry.emitsCopyClocks
  }
  for (const entry of chain) {
    if (!factored(entry) || entry.structuralVariants?.some(variant => !factored(variant))) return undefined
    const rootDelta = entry.rootTransformAtBeat?.(beat) ?? entry.rootTransform
    if (rootDelta) {
      if (!rootDelta.elements.every(Number.isFinite)) return undefined
      root = root ? root.premultiply(rootDelta) : rootDelta.clone()
      continue
    }
    const layout = entry.localTransformsAtBeat?.(beat) ?? entry.localTransforms
    if (!layout?.length) return undefined
    count *= layout.length
    if (!Number.isSafeInteger(count) || count > 0x7fffffff) return undefined
    counts.push(layout.length); offsets.push(length)
    layouts.push(layout)
    scaleBound *= layout.reduce((max, matrix) => Math.max(max, matrixScaleBound(matrix)), 0)
    length += layout.length
  }
  if (root) {
    layouts.unshift([root])
    counts.unshift(1)
    for (let i = 0; i < offsets.length; i++) offsets[i]++
    offsets.unshift(0)
    length++
    scaleBound *= matrixScaleBound(root)
  }
  if (layouts.length > 16) return undefined
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
