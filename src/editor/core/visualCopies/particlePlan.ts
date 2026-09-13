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
  /** Framed stages carry their motion separately until every layout has run.
   * Each frame/internal pair uses the SAME mixed-radix slot. Guard offsets
   * address scalar flags in matrices; -1 means always active, -2 always bare.
   * The flags are evaluated on the CPU so GPU float rounding cannot change a
   * near-singular frame's branch. Ordinary plans omit this program. */
  program?: {
    kinds: number[] // 0 local, 1 root, 2 frame/internal
    internalOffsets: number[]
    bareOffsets: number[]
    guardOffsets: number[]
    guardStrides: number[]
  }
}

/** The three metadata families are exclusive proofs, not inferred from cache
 * policy or composition. Only the framed proof can accompany applyFramed. */
export function particlePlanEntryKind(entry: MoverOrSplitter): 0 | 1 | 2 | undefined {
  const local = !!(entry.localTransforms || entry.localTransformsAtBeat)
  const root = !!(entry.rootTransform || entry.rootTransformAtBeat)
  const framed = !!entry.framedLocalTransformsAtBeat
  if (Number(local) + Number(root) + Number(framed) !== 1 || entry.emitsCopyClocks) return undefined
  if (framed) return entry.applyFramed ? 2 : undefined
  if (entry.applyFramed) return undefined
  return root ? 1 : 0
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
  if (chain.some(entry => entry.framedLocalTransformsAtBeat)) return compileFramedPlan(chain, version, beat)
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

interface FrameStage {
  kind: 0 | 1 | 2
  frames: readonly Matrix4[]
  internals?: readonly (Matrix4 | null)[]
  bare?: readonly Matrix4[]
  inputCount: number
  guard: boolean | readonly number[]
}

/** Evaluate only the reference frame of a prefix. This is needed solely when
 * a mixed/near-singular prefix cannot prove one common guard. Normal Radial
 * rotations certify immediately and never enumerate their Cartesian product. */
function prefixFrame(stages: readonly FrameStage[], count: number, index: number, out: Matrix4): Matrix4 {
  out.identity()
  let stride = count
  for (const stage of stages) {
    stride /= stage.frames.length
    const slot = Math.floor(index / stride) % stage.frames.length
    if (stage.kind === 1) out.premultiply(stage.frames[slot])
    else {
      const active = typeof stage.guard === 'boolean' ? stage.guard
        : stage.guard[Math.floor(index / (count / stage.inputCount))] === 1
      out.multiply(stage.kind === 2 && !active ? stage.bare![slot] : stage.frames[slot])
    }
  }
  return out
}

function compileFramedPlan(chain: readonly MoverOrSplitter[], version: number, beat: number): ParticlePlan | undefined {
  if (chain.length > 16) return undefined
  const stages: FrameStage[] = []
  const identity = new Matrix4(), scratch = new Matrix4()
  let count = 1, scaleBound = 1, frameBound = 1, fullFrameBound = 1, determinantMin = 1, determinantMax = 1
  const affine = (matrix: Matrix4) => matrix.elements.every(Number.isFinite)
    && matrix.elements[3] === 0 && matrix.elements[7] === 0
    && matrix.elements[11] === 0 && matrix.elements[15] === 1
  for (const entry of chain) {
    const kind = particlePlanEntryKind(entry)
    if (kind === undefined || entry.structuralVariants?.some(variant => particlePlanEntryKind(variant) === undefined)) return undefined
    const framed = kind === 2 ? entry.framedLocalTransformsAtBeat!(beat) : undefined
    const frames = framed?.frames ?? (kind === 1
      ? [entry.rootTransformAtBeat?.(beat) ?? entry.rootTransform!]
      : entry.localTransformsAtBeat?.(beat) ?? entry.localTransforms!)
    if (!frames?.length || frames.some(matrix => !affine(matrix))) return undefined
    if (framed && (framed.internals.length !== frames.length || framed.bareFrames.length !== frames.length
      || framed.internals.some(matrix => matrix && !affine(matrix)) || framed.bareFrames.some(matrix => !affine(matrix)))) return undefined

    let guard: FrameStage['guard'] = true
    if (framed) {
      // Determinant error grows with the cube of the linear norm. Expand both
      // factor intervals and accumulated-product rounding outward. Ambiguous,
      // nonfinite and ill-conditioned cases use exact CPU prefix decisions.
      const margin = 1e-10 * (stages.length + 1) * frameBound ** 3
      // Three's general determinant also evaluates translation cofactors even
      // for affine matrices. Enormous translations can overflow those terms
      // (then 0 * Infinity becomes NaN), so certify only finite full bounds.
      const certifiable = Number.isFinite(margin) && Number.isFinite(fullFrameBound ** 3)
      if (certifiable && determinantMin - margin > 1e-12) guard = true
      else if (certifiable && determinantMax + margin < 1e-12) guard = false
      else {
        const flags = new Array<number>(count)
        for (let i = 0; i < count; i++) {
          const determinant = prefixFrame(stages, count, i, scratch).determinant()
          flags[i] = Number.isFinite(determinant) && Math.abs(determinant) >= 1e-12 ? 1 : 0
        }
        guard = flags.every(flag => flag === flags[0]) ? flags[0] === 1 : flags
      }
    }
    const stage: FrameStage = { kind, frames, internals: framed?.internals, bare: framed?.bareFrames, inputCount: count, guard }
    count *= frames.length
    if (!Number.isSafeInteger(count) || count > 0x7fffffff) return undefined
    stages.push(stage)
    const possibleFrames = framed && guard !== true ? (guard === false ? framed.bareFrames : [...frames, ...framed.bareFrames]) : frames
    let minimum = Infinity, maximum = 0, bound = 0, fullBound = 0
    for (const matrix of possibleFrames) {
      const norm = matrixScaleBound(matrix), determinant = Math.abs(matrix.determinant())
      const error = 1e-12 * norm ** 3
      minimum = Math.min(minimum, Math.max(0, determinant - error))
      maximum = Math.max(maximum, determinant + error)
      bound = Math.max(bound, norm)
      const e = matrix.elements
      for (let row = 0; row < 4; row++) {
        fullBound = Math.max(fullBound, Math.abs(e[row]) + Math.abs(e[row + 4]) + Math.abs(e[row + 8]) + Math.abs(e[row + 12]))
      }
    }
    determinantMin *= minimum * (1 - 16 * Number.EPSILON)
    determinantMax *= maximum * (1 + 16 * Number.EPSILON)
    frameBound *= bound
    fullFrameBound *= fullBound * (1 + 16 * Number.EPSILON)
    scaleBound *= bound
    if (framed && guard !== false) scaleBound *= framed.internals.reduce((max, matrix) => Math.max(max, matrix ? matrixScaleBound(matrix) : 1), 1)
  }
  const counts: number[] = [], offsets: number[] = [], packed: Matrix4[] = []
  const program: NonNullable<ParticlePlan['program']> = { kinds: [], internalOffsets: [], bareOffsets: [], guardOffsets: [], guardStrides: [] }
  for (const stage of stages) {
    counts.push(stage.frames.length); offsets.push(packed.length)
    for (const matrix of stage.frames) packed.push(matrix)
    program.kinds.push(stage.kind)
    program.internalOffsets.push(stage.internals ? packed.length : -1)
    if (stage.internals) for (const matrix of stage.internals) packed.push(matrix ?? identity)
    program.bareOffsets.push(stage.bare ? packed.length : -1)
    if (stage.bare) for (const matrix of stage.bare) packed.push(matrix)
    program.guardOffsets.push(stage.guard === true ? -1 : -2)
    program.guardStrides.push(count / stage.inputCount)
  }
  let length = packed.length * 16
  stages.forEach((stage, i) => {
    if (typeof stage.guard !== 'boolean') { program.guardOffsets[i] = length; length += stage.guard.length }
  })
  // Scalar guard flags share the layout texture; pad to whole matrices so the
  // existing allocation/upload path stays valid, including texture growth.
  const matrices = new Float64Array(Math.ceil(length / 16) * 16)
  packed.forEach((matrix, i) => matrices.set(matrix.elements, i * 16))
  stages.forEach((stage, i) => {
    if (typeof stage.guard !== 'boolean') matrices.set(stage.guard, program.guardOffsets[i])
  })
  return { version, beat, count, counts, offsets, matrices, scaleBound, program }
}

/** Random access for inspection/picking: O(chain depth), with no expansion. */
export function particlePlanMatrix(plan: ParticlePlan, index: number, out: Matrix4, scratch = new Matrix4()): Matrix4 {
  out.identity()
  const program = plan.program, internal = program ? new Matrix4() : undefined
  let stride = plan.count
  for (let stage = 0; stage < plan.counts.length; stage++) {
    stride /= plan.counts[stage]
    const slot = Math.floor(index / stride) % plan.counts[stage]
    const kind = program?.kinds[stage] ?? 0
    const guard = program?.guardOffsets[stage] ?? -1
    const active = guard === -1 || (guard >= 0 && plan.matrices[guard + Math.floor(index / program!.guardStrides[stage])] === 1)
    const offset = kind === 2 && !active ? program!.bareOffsets[stage] : plan.offsets[stage]
    scratch.fromArray(plan.matrices, (offset + slot) * 16)
    if (kind === 1) out.premultiply(scratch)
    else out.multiply(scratch)
    if (kind === 2 && active) {
      scratch.fromArray(plan.matrices, (program!.internalOffsets[stage] + slot) * 16)
      internal!.multiply(scratch)
    }
  }
  if (internal) out.multiply(internal)
  return out
}

export function particlePlanCopy(plan: ParticlePlan, index: number): VisualCopy | undefined {
  if (!Number.isInteger(index) || index < 0 || index >= plan.count) return undefined
  const copy = identityVisualCopy()
  particlePlanMatrix(plan, index, copy.transform)
  return copy
}
