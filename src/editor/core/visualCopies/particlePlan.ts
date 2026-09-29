import { Color, Matrix4 } from 'three'
import { identityVisualCopy } from './identityVisualCopy'
import { applyGpuOperation, gpuOperationParameterCount, isGpuOperationSupported, GPU_OPERATION_APPEARANCE, GPU_OPERATION_IDENTITY, type GpuOperation } from './gpuOperations'
import { applyGpuAppearance } from './gpuAppearance'
import { copyIsTargeted } from './copyTargets'
import { entryMaxOutputCount } from './maxOutputCount'
import { resolveVisualCopyFrames } from './resolveVisualCopies'
import type { FramedLocalTransforms, MoverOrSplitter, SharedLocalLayout, VisualCopy } from './types'

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
  /** Scalar offsets of (opacity multiplier, additive HSL hue) pairs, one per
   * slot. -1 means identity appearance. Bare pairs follow the framed guard. */
  appearanceOffsets?: number[]
  bareAppearanceOffsets?: number[]
  /** Snapshot, never the mutable ObjectState matrix. A placement-dependent
   * table must be resampled even when the playhead stays at the same beat. */
  placementElements?: number[]
  /** Proven capacity, including every automation variant of a bounded CPU
   * prefix. It must not be inferred by expanding the eventual GPU population. */
  structuralCount?: number
  cpuPrefix?: {
    length: number
    count: number
    colors: VisualCopy['colorShift'][]
    colorOffset: number
  }
  /** Framed stages carry their motion separately until every layout has run.
   * Each frame/internal pair uses the SAME mixed-radix slot. Guard offsets
   * address scalar flags in matrices; -1 means always active, -2 always bare.
   * The flags are evaluated on the CPU so GPU float rounding cannot change a
   * near-singular frame's branch. Ordinary plans omit this program. */
  program?: {
    kinds: number[] // 0 local, 1 root, 2 frame/internal, 3 copy operation
    internalOffsets: number[]
    bareOffsets: number[]
    guardOffsets: number[]
    guardStrides: number[]
    operationKinds?: number[]
    operationOffsets?: number[]
    /** Scalar offset of count + (rule, requested slices, selected mask) triples. */
    operationGuardOffsets?: number[]
    operationPlacementOffsets?: number[]
    /** Nested appearance programs sample the parent's incoming frame and the
     * child's own local slot. Header count, then seven-scalar descriptors:
     * kind, data, frames, guards, input indices, input count, active flags. */
    nestedAppearanceOffsets?: number[]
  }
}

/** The metadata families are exclusive proofs, not inferred from cache
 * policy or composition. Only the framed proof can accompany applyFramed. */
export function particlePlanEntryKind(entry: MoverOrSplitter): 0 | 1 | 2 | 3 | undefined {
  const legacyLocal = !!(entry.localTransforms || entry.localTransformsAtBeat)
  const sharedLocal = !!(entry.localLayout || entry.localLayoutAtBeat)
  if (legacyLocal && sharedLocal) return undefined
  const local = legacyLocal || sharedLocal
  const root = !!(entry.rootTransform || entry.rootTransformAtBeat)
  const framed = !!entry.framedLocalTransformsAtBeat
  const operation = !!entry.gpuOperationAtBeat
  if (Number(local) + Number(root) + Number(framed) + Number(operation) !== 1 || entry.emitsCopyClocks) return undefined
  if (framed) return entry.applyFramed ? 2 : undefined
  if (entry.applyFramed) return undefined
  return operation ? 3 : root ? 1 : 0
}

export function particleLocalLayout(entry: MoverOrSplitter, beat: number, placement?: Matrix4): SharedLocalLayout | undefined {
  return entry.localLayoutAtBeat?.(beat, placement) ?? entry.localLayout
    ?? ((entry.localTransformsAtBeat || entry.localTransforms)
      ? { transforms: entry.localTransformsAtBeat?.(beat) ?? entry.localTransforms! } : undefined)
}

export function particlePlanNeedsUpdate(plan: ParticlePlan, chain: readonly MoverOrSplitter[], beat: number, placement: Matrix4): boolean {
  if (plan.placementElements?.some((value, i) => value !== placement.elements[i])) return true
  return plan.beat !== beat && (!!plan.cpuPrefix || chain.some(entry => entry.localTransformsAtBeat || entry.localLayoutAtBeat
    || entry.rootTransformAtBeat || entry.framedLocalTransformsAtBeat || entry.gpuOperationAtBeat))
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

interface PackedLocalLayout {
  matrices: Float64Array
  scaleBound: number
}
const packedLocalLayouts = new WeakMap<readonly Matrix4[], PackedLocalLayout>()

/** Declared tables are immutable, including their matrices. Validate and pack
 * a static Fractal once, rather than visiting all 781 matrices whenever an
 * unrelated Rotate advances. The weak key does not retain old edited layouts;
 * each plan receives its own storage, never this cached backing array. */
function packLocalLayout(layout: readonly Matrix4[]): PackedLocalLayout | undefined {
  const cached = packedLocalLayouts.get(layout)
  if (cached) return cached
  const matrices = new Float64Array(layout.length * 16)
  let scaleBound = 0
  for (let i = 0; i < layout.length; i++) {
    const matrix = layout[i]
    if (!matrix.elements.every(Number.isFinite)) return undefined
    matrices.set(matrix.elements, i * 16)
    scaleBound = Math.max(scaleBound, matrixScaleBound(matrix))
  }
  const packed = { matrices, scaleBound }
  packedLocalLayouts.set(layout, packed)
  return packed
}

/** Compile explicit layout/operation proofs, or a proven-small CPU prefix and
 * compatible suffix. Static alone does not imply independence from index,
 * formation or placement. The simple layout path still collects root deltas
 * on the left without changing input-major slot order. */
export function compileParticlePlan(chain: readonly MoverOrSplitter[], version = 0, beat = 0, placement?: Matrix4): ParticlePlan | undefined {
  if (!chain.length) return undefined
  if (chain.some(entry => particlePlanEntryKind(entry) === undefined
    || entry.structuralVariants?.some(variant => particlePlanEntryKind(variant) === undefined))) {
    return compileHybridPlan(chain, version, beat, placement)
  }
  if (chain.some(entry => entry.framedLocalTransformsAtBeat || entry.localLayout || entry.localLayoutAtBeat || entry.gpuOperationAtBeat)) {
    return compileFramedPlan(chain, version, beat, placement)
  }
  const counts: number[] = [], offsets: number[] = []
  const layouts: PackedLocalLayout[] = []
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
    const packed = packLocalLayout(layout)
    if (!packed) return undefined
    count *= layout.length
    if (!Number.isSafeInteger(count) || count > 0x7fffffff) return undefined
    counts.push(layout.length); offsets.push(length)
    layouts.push(packed)
    scaleBound *= packed.scaleBound
    length += layout.length
  }
  if (root) {
    const packed = packLocalLayout([root])
    if (!packed) return undefined
    layouts.unshift(packed)
    counts.unshift(1)
    for (let i = 0; i < offsets.length; i++) offsets[i]++
    offsets.unshift(0)
    length++
    scaleBound *= packed.scaleBound
  }
  if (layouts.length > 16) return undefined
  const matrices = new Float64Array(length * 16)
  let offset = 0
  for (const layout of layouts) {
    matrices.set(layout.matrices, offset); offset += layout.matrices.length
  }
  return { version, beat, count, counts, offsets, matrices, scaleBound }
}

/** Run only a proven-small prefix on the CPU, preserving its reference frames
 * and deferred internal motion. Later splitters still form a Cartesian product
 * on the GPU. A single sampled beat is never used as an output-count proof. */
function compileHybridPlan(chain: readonly MoverOrSplitter[], version: number, beat: number, placement?: Matrix4): ParticlePlan | undefined {
  let lastUnknown = -1
  const malformedProof = (entry: MoverOrSplitter) => particlePlanEntryKind(entry) === undefined
    && !!(entry.localTransforms || entry.localTransformsAtBeat || entry.localLayout || entry.localLayoutAtBeat
      || entry.rootTransform || entry.rootTransformAtBeat || entry.framedLocalTransformsAtBeat || entry.gpuOperationAtBeat)
  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i]
    if (entry.emitsCopyClocks || malformedProof(entry) || entry.structuralVariants?.some(malformedProof)) return undefined
    if (particlePlanEntryKind(entry) === undefined
      || entry.structuralVariants?.some(variant => particlePlanEntryKind(variant) === undefined)) lastUnknown = i
  }
  if (lastUnknown < 0 || lastUnknown === chain.length - 1) return undefined
  let capacity = 1
  for (let i = 0; i < chain.length; i++) {
    const bound = entryMaxOutputCount(chain[i])
    if (bound === undefined) return undefined
    capacity *= bound
    if (!Number.isSafeInteger(capacity) || capacity > (i <= lastUnknown ? 4096 : 0x7fffffff)) return undefined
  }
  const prefix = resolveVisualCopyFrames(chain.slice(0, lastUnknown + 1), beat, placement, 4096)
  if (!prefix) return undefined
  const colors = prefix.copies.map(copy => ({ ...copy.colorShift }))
  // Keep a valid, hidden seed stage when this beat emits no copies. Capacity
  // still comes from the proof, so a later beat can populate the same mesh.
  const copies = prefix.copies.length ? prefix.copies : [identityVisualCopy()]
  const frames = copies.map(copy => copy.transform)
  const seed: MoverOrSplitter = {
    apply: copy => [copy], applyFramed: copy => [{ visualCopy: copy }],
    framedLocalTransformsAtBeat: () => ({ frames, bareFrames: frames,
      internals: prefix.copies.length ? prefix.internals ?? frames.map(() => null) : [null],
      opacities: copies.map(copy => copy.opacity), hueShifts: copies.map(copy => copy.colorShift.hue) }),
  }
  const plan = compileFramedPlan([seed, ...chain.slice(lastUnknown + 1)], version, beat, placement, true)
  if (!plan) return undefined
  const colorOffset = plan.matrices.length
  const matrices = new Float64Array(Math.ceil((colorOffset + copies.length * 8) / 16) * 16)
  matrices.set(plan.matrices)
  const tint = new Color()
  for (let i = 0; i < copies.length; i++) {
    const color = copies[i].colorShift
    const amount = color.tint && /^#[0-9a-f]{6}$/i.test(color.tint) ? Math.max(0, Math.min(1, color.tintAmount)) : 0
    tint.set(amount > 0 ? color.tint! : '#000000')
    matrices.set([color.saturation, color.lightness, tint.r, tint.g, tint.b, amount,
      color.tintPerceptual ? 1 : 0, color.huePerceptual ? 1 : 0], colorOffset + i * 8)
  }
  plan.matrices = matrices
  plan.cpuPrefix = { length: lastUnknown + 1, count: prefix.copies.length, colors, colorOffset }
  plan.structuralCount = capacity
  plan.placementElements = (placement ?? new Matrix4()).elements.slice()
  if (!prefix.copies.length) plan.count = 0
  return plan
}

interface FrameStage {
  kind: 0 | 1 | 2 | 3
  operation?: GpuOperation
  frames: readonly Matrix4[]
  internals?: readonly (Matrix4 | null)[]
  bare?: readonly Matrix4[]
  inputCount: number
  guard: boolean | readonly number[]
  opacities?: readonly number[]
  hueShifts?: readonly number[]
  bareOpacities?: readonly number[]
  bareHueShifts?: readonly number[]
  appearanceStages?: FramedLocalTransforms['appearanceStages']
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
    if (stage.kind === 3) {
      const inputIndex = Math.floor(index / (count / stage.inputCount))
      if (stage.operation!.indexGuards?.every(guard => copyIsTargeted(inputIndex, stage.inputCount, guard)) ?? true) {
        applyGpuOperation(stage.operation!, out, out)
      }
    }
    else if (stage.kind === 1) out.premultiply(stage.frames[slot])
    else {
      const active = typeof stage.guard === 'boolean' ? stage.guard
        : stage.guard[Math.floor(index / (count / stage.inputCount))] === 1
      out.multiply(stage.kind === 2 && !active ? stage.bare![slot] : stage.frames[slot])
    }
  }
  return out
}

function compileFramedPlan(chain: readonly MoverOrSplitter[], version: number, beat: number, placement?: Matrix4, seeded = false): ParticlePlan | undefined {
  if (chain.length > 16) return undefined
  const stages: FrameStage[] = []
  const identity = new Matrix4(), scratch = new Matrix4()
  let generalSeed = false
  // Recursive fanout has a different singular fallback cardinality. Admission
  // must remain valid through playback, including an animated scale crossing 0.
  let stablePrefixDeterminant = true
  let count = 1, scaleBound = 1, frameBound = 1, fullFrameBound = 1, determinantMin = 1, determinantMax = 1
  const affine = (matrix: Matrix4) => matrix.elements.every(Number.isFinite)
    && matrix.elements[3] === 0 && matrix.elements[7] === 0
    && matrix.elements[11] === 0 && matrix.elements[15] === 1
  for (const entry of chain) {
    const kind = particlePlanEntryKind(entry)
    if (kind === undefined || entry.structuralVariants?.some(variant => particlePlanEntryKind(variant) === undefined)) return undefined
    if (kind === 3) {
      const operation = entry.gpuOperationAtBeat!(beat, placement)
      if (!isGpuOperationSupported(operation)) return undefined
      stablePrefixDeterminant &&= !!entry.gpuOperationPreservesDeterminant || !!entry.gpuAppearanceOnly
      stages.push({ kind, operation, frames: [identity], inputCount: count, guard: true })
      if (operation.kind === GPU_OPERATION_IDENTITY || operation.kind === GPU_OPERATION_APPEARANCE) continue
      const selectable = !!operation.indexGuards?.length
      scaleBound *= selectable ? Math.max(1, operation.scaleBound) : operation.scaleBound
      frameBound *= selectable ? Math.max(1, operation.scaleBound) : operation.scaleBound
      fullFrameBound = operation.frameScaleBound !== undefined
        ? fullFrameBound * (selectable ? Math.max(1, operation.frameScaleBound) : operation.frameScaleBound) * (1 + 16 * Number.EPSILON)
        : generalSeed
        ? 4 * Math.max(1, operation.positionScaleBound ?? 1, operation.scaleBound, operation.translationBound)
          * fullFrameBound * Math.max(1, fullFrameBound)
        : 4 * Math.max(1, operation.positionScaleBound ?? 1, operation.scaleBound) * fullFrameBound + operation.translationBound
      // Position operations preserve exact determinants mathematically. Widen
      // the floating interval; near-singular decisions still use prefixFrame.
      const error = 1e-10 * (generalSeed ? fullFrameBound ** 4 : frameBound ** 3)
      const determinantScale = operation.determinantScale ?? (operation.determinantPreserving ? 1 : undefined)
      determinantMin = determinantScale !== undefined
        ? Math.max(0, determinantMin * (selectable ? Math.min(1, determinantScale) : determinantScale) - error) : 0
      determinantMax = determinantScale !== undefined
        ? determinantMax * (selectable ? Math.max(1, determinantScale) : determinantScale) + error : Infinity
      continue
    }
    const framed = kind === 2 ? entry.framedLocalTransformsAtBeat!(beat, placement) : undefined
    const layout = kind === 0 ? particleLocalLayout(entry, beat, placement) : undefined
    const frames = framed?.frames ?? (kind === 1
      ? [entry.rootTransformAtBeat?.(beat) ?? entry.rootTransform!]
      : layout!.transforms)
    const isSeed = seeded && stages.length === 0
    if (!frames?.length || (!isSeed && frames.some(matrix => !affine(matrix)))) return undefined
    if (framed && (framed.internals.length !== frames.length || (framed.bareFrames.length !== frames.length && !framed.requiresInvertibleInput)
      || (!isSeed && (framed.internals.some(matrix => matrix && !affine(matrix)) || framed.bareFrames.some(matrix => !affine(matrix)))))) return undefined
    if (isSeed) {
      // CPU entries promise a count bound, not an affine transform contract.
      // Preserve even a singular world's zero inverse or projective matrices.
      // General seeds use full-matrix determinant bounds; projective linear
      // parts cannot certify point size after position-dependent operations.
      generalSeed = frames.some(matrix => !affine(matrix))
      if ([...frames, ...(framed?.internals ?? [])].some(matrix => matrix
        && (matrix.elements[3] !== 0 || matrix.elements[7] !== 0 || matrix.elements[11] !== 0))) scaleBound = Infinity
    }
    const appearance = framed ?? layout
    const validChannel = (values: readonly number[] | undefined, count = frames.length) => !values
      || (values.length === count && values.every(Number.isFinite))
    if (!isSeed && (!validChannel(appearance?.opacities) || !validChannel(appearance?.hueShifts)
      || !validChannel(framed?.bareOpacities, framed?.bareFrames.length) || !validChannel(framed?.bareHueShifts, framed?.bareFrames.length))) return undefined
    if (framed?.appearanceStages?.some(stage => stage.sampleFrames.length !== frames.length
      || stage.sampleFrames.some(matrix => !affine(matrix)) || !isGpuOperationSupported(stage.operation)
      || ![GPU_OPERATION_IDENTITY, GPU_OPERATION_APPEARANCE].includes(stage.operation.kind)
      || stage.operation.appearancePlacement
      || stage.inputCount !== undefined && (!Number.isSafeInteger(stage.inputCount) || stage.inputCount < 1)
      || stage.inputIndices && (stage.inputIndices.length !== frames.length
        || stage.inputIndices.some(index => !Number.isInteger(index) || index < 0 || index >= (stage.inputCount ?? frames.length)))
      || stage.active && (stage.active.length !== frames.length || stage.active.some(value => value !== 0 && value !== 1)))) return undefined

    let guard: FrameStage['guard'] = true
    if (framed) {
      // Determinant error grows with the cube of the linear norm. Expand both
      // factor intervals and accumulated-product rounding outward. Ambiguous,
      // nonfinite and ill-conditioned cases use exact CPU prefix decisions.
      const margin = 1e-10 * (stages.length + 1) * (generalSeed ? fullFrameBound ** 4 : frameBound ** 3)
      // Three's general determinant also evaluates translation cofactors even
      // for affine matrices. Enormous translations can overflow those terms
      // (then 0 * Infinity becomes NaN), so certify only finite full bounds.
      const certifiable = Number.isFinite(margin) && Number.isFinite(fullFrameBound ** 3)
      // A recursive splitter may emit fewer bare slots than active slots.
      // This product representation is exact only when the whole incoming
      // population takes the active branch; never pad a variable fanout into
      // hidden slots and thereby change downstream color/index semantics.
      if ((entry.framedRequiresInvertibleInput || entry.structuralVariants?.some(variant => variant.framedRequiresInvertibleInput)
        || framed.requiresInvertibleInput) && !(stablePrefixDeterminant && certifiable && determinantMin - margin > 1e-12)) return undefined
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
    stablePrefixDeterminant &&= !isSeed && (kind === 0
      ? !!(entry.localTransforms || entry.localLayout) && !entry.localTransformsAtBeat && !entry.localLayoutAtBeat && !entry.localLayoutUsesPlacement
      : kind === 1 ? !!entry.rootTransform && !entry.rootTransformAtBeat : false)
    const stage: FrameStage = { kind, frames, internals: framed?.internals, bare: framed?.bareFrames, inputCount: count, guard,
      opacities: appearance?.opacities, hueShifts: appearance?.hueShifts,
      bareOpacities: framed?.bareOpacities, bareHueShifts: framed?.bareHueShifts,
      appearanceStages: framed?.appearanceStages }
    count *= frames.length
    if (!Number.isSafeInteger(count) || count > 0x7fffffff) return undefined
    stages.push(stage)
    const possibleFrames = framed && guard !== true ? (guard === false ? framed.bareFrames : [...frames, ...framed.bareFrames]) : frames
    let minimum = Infinity, maximum = 0, bound = 0, fullBound = 0
    for (const matrix of possibleFrames) {
      const norm = matrixScaleBound(matrix), determinant = Math.abs(matrix.determinant())
      const e = matrix.elements
      let matrixFullBound = 0
      for (let row = 0; row < 4; row++) {
        matrixFullBound = Math.max(matrixFullBound, Math.abs(e[row]) + Math.abs(e[row + 4]) + Math.abs(e[row + 8]) + Math.abs(e[row + 12]))
      }
      fullBound = Math.max(fullBound, matrixFullBound)
      const error = 1e-12 * (generalSeed ? matrixFullBound ** 4 : norm ** 3)
      minimum = Math.min(minimum, Math.max(0, determinant - error))
      maximum = Math.max(maximum, determinant + error)
      bound = Math.max(bound, norm)
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
  if (stages.some(stage => stage.operation)) { program.operationKinds = []; program.operationOffsets = [] }
  if (stages.some(stage => stage.operation?.indexGuards?.length)) program.operationGuardOffsets = []
  if (stages.some(stage => stage.operation?.appearancePlacement)) program.operationPlacementOffsets = []
  if (stages.some(stage => stage.appearanceStages?.length)) program.nestedAppearanceOffsets = []
  const nestedPrograms: { operation: GpuOperation; framesOffset: number; dataOffset: number; guardOffset: number;
    inputIndices?: readonly number[]; inputCount: number; active?: readonly number[]; indexOffset: number; activeOffset: number }[][] = []
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
    program.operationKinds?.push(stage.operation?.kind ?? 0)
    program.operationOffsets?.push(-1)
    program.operationGuardOffsets?.push(-1)
    program.operationPlacementOffsets?.push(-1)
    program.nestedAppearanceOffsets?.push(-1)
    const nested = []
    for (const appearance of stage.appearanceStages ?? []) {
      nested.push({ operation: appearance.operation, framesOffset: packed.length, dataOffset: -1, guardOffset: -1,
        inputIndices: appearance.inputIndices, inputCount: appearance.inputCount ?? stage.frames.length, active: appearance.active,
        indexOffset: -1, activeOffset: -1 })
      packed.push(...appearance.sampleFrames)
    }
    nestedPrograms.push(nested)
  }
  let length = packed.length * 16
  stages.forEach((stage, i) => {
    if (typeof stage.guard !== 'boolean') { program.guardOffsets[i] = length; length += stage.guard.length }
    if (stage.operation) { program.operationOffsets![i] = length; length += stage.operation.parameters.length }
    if (stage.operation?.indexGuards?.length) {
      program.operationGuardOffsets![i] = length; length += 1 + stage.operation.indexGuards.length * 3
    }
    if (stage.operation?.appearancePlacement) { program.operationPlacementOffsets![i] = length; length += 16 }
    if (nestedPrograms[i].length) {
      program.nestedAppearanceOffsets![i] = length; length += 1 + nestedPrograms[i].length * 7
      for (const nested of nestedPrograms[i]) {
        nested.dataOffset = length; length += nested.operation.parameters.length
        if (nested.operation.indexGuards?.length) { nested.guardOffset = length; length += 1 + nested.operation.indexGuards.length * 3 }
        if (nested.inputIndices) { nested.indexOffset = length; length += nested.inputIndices.length }
        if (nested.active) { nested.activeOffset = length; length += nested.active.length }
      }
    }
  })
  const appearanceOffsets: number[] = [], bareAppearanceOffsets: number[] = []
  const appearanceValues: { offset: number; values: number[] }[] = []
  const packAppearance = (count: number, opacities?: readonly number[], hues?: readonly number[]) => {
    if (!opacities && !hues) return -1
    const offset = length
    const values = new Array<number>(count * 2)
    for (let i = 0; i < count; i++) { values[i * 2] = opacities?.[i] ?? 1; values[i * 2 + 1] = hues?.[i] ?? 0 }
    appearanceValues.push({ offset, values }); length += values.length
    return offset
  }
  for (const stage of stages) {
    appearanceOffsets.push(packAppearance(stage.frames.length, stage.opacities, stage.hueShifts))
    bareAppearanceOffsets.push(packAppearance(stage.frames.length, stage.bareOpacities, stage.bareHueShifts))
  }
  // Scalar guard flags share the layout texture; pad to whole matrices so the
  // existing allocation/upload path stays valid, including texture growth.
  const matrices = new Float64Array(Math.ceil(length / 16) * 16)
  packed.forEach((matrix, i) => matrices.set(matrix.elements, i * 16))
  stages.forEach((stage, i) => {
    if (typeof stage.guard !== 'boolean') matrices.set(stage.guard, program.guardOffsets[i])
    if (stage.operation) matrices.set(stage.operation.parameters, program.operationOffsets![i])
    if (stage.operation?.indexGuards?.length) {
      const values = [stage.operation.indexGuards.length]
      for (const guard of stage.operation.indexGuards) {
        const mask = guard.on.reduce((bits, slice) => bits | (1 << slice), 0)
        values.push(guard.rule === 'every' ? 0 : 1, guard.slices, mask)
      }
      matrices.set(values, program.operationGuardOffsets![i])
    }
    if (stage.operation?.appearancePlacement) matrices.set(stage.operation.appearancePlacement, program.operationPlacementOffsets![i])
    if (nestedPrograms[i].length) {
      const descriptors = [nestedPrograms[i].length]
      for (const nested of nestedPrograms[i]) {
        descriptors.push(nested.operation.kind, nested.dataOffset, nested.framesOffset, nested.guardOffset,
          nested.indexOffset, nested.inputCount, nested.activeOffset)
        matrices.set(nested.operation.parameters, nested.dataOffset)
        if (nested.inputIndices) matrices.set(nested.inputIndices, nested.indexOffset)
        if (nested.active) matrices.set(nested.active, nested.activeOffset)
        if (nested.operation.indexGuards?.length) {
          const guards = [nested.operation.indexGuards.length]
          for (const guard of nested.operation.indexGuards) guards.push(guard.rule === 'every' ? 0 : 1, guard.slices,
            guard.on.reduce((bits, slice) => bits | (1 << slice), 0))
          matrices.set(guards, nested.guardOffset)
        }
      }
      matrices.set(descriptors, program.nestedAppearanceOffsets![i])
    }
  })
  for (const { offset, values } of appearanceValues) matrices.set(values, offset)
  const usesPlacement = chain.some(entry => entry.localLayoutUsesPlacement || entry.framedLayoutUsesPlacement || entry.gpuOperationUsesPlacement)
  return { version, beat, count, counts, offsets, matrices, scaleBound, program,
    ...(appearanceValues.length ? { appearanceOffsets, bareAppearanceOffsets } : {}),
    ...(usesPlacement ? { placementElements: (placement ?? identity).elements.slice() } : {}) }
}

function particleOperationSelected(plan: ParticlePlan, offset: number, index: number, count: number): boolean {
  if (offset < 0) return true
  for (let i = 0; i < plan.matrices[offset]; i++) {
    const p = offset + 1 + i * 3
    const slices = Math.max(2, Math.min(Math.round(plan.matrices[p + 1]), 12, Math.max(2, count)))
    const slice = plan.matrices[p] === 0 ? index % slices
      : Math.max(0, Math.min(slices - 1, Math.floor(index / Math.max(1, count) * slices)))
    if (((plan.matrices[p + 2] | 0) & (1 << slice)) === 0) return false
  }
  return true
}

/** Evaluate one ordinal through the same ordered frame/appearance program as
 * the shader. Input ordinals are decoded BEFORE each stage's fanout, so a
 * colorizer above a later splitter keeps its original index/count semantics. */
function evaluateParticlePlan(plan: ParticlePlan, index: number, out: Matrix4, scratch: Matrix4, copy?: VisualCopy): Matrix4 {
  out.identity()
  const program = plan.program, internal = program ? new Matrix4() : undefined
  const placement = copy && plan.placementElements ? new Matrix4().fromArray(plan.placementElements) : undefined
  let stride = plan.count
  for (let stage = 0; stage < plan.counts.length; stage++) {
    const inputIndex = Math.floor(index / stride), inputCount = plan.count / stride
    stride /= plan.counts[stage]
    const slot = Math.floor(index / stride) % plan.counts[stage]
    const kind = program?.kinds[stage] ?? 0
    const nestedOffset = program?.nestedAppearanceOffsets?.[stage] ?? -1
    const parentFrame = copy && nestedOffset >= 0 ? out.clone() : undefined
    if (kind === 3) {
      const operationKind = program!.operationKinds![stage], start = program!.operationOffsets![stage]
      const guardOffset = program!.operationGuardOffsets?.[stage] ?? -1
      const selected = particleOperationSelected(plan, guardOffset, inputIndex, inputCount)
      if (selected && (operationKind !== GPU_OPERATION_APPEARANCE || copy)) {
        const parameters = plan.matrices.subarray(start)
        const operation: GpuOperation = { kind: operationKind,
          parameters: Array.from(parameters.subarray(0, gpuOperationParameterCount(operationKind, parameters)!)),
          scaleBound: 1, translationBound: 0 }
        if (operationKind === GPU_OPERATION_APPEARANCE && copy) {
          const placementOffset = program!.operationPlacementOffsets?.[stage] ?? -1
          const operationPlacement = placementOffset >= 0 ? new Matrix4().fromArray(plan.matrices, placementOffset) : placement
          const result = applyGpuAppearance(operation, { ...copy, transform: out },
            { beat: plan.beat, index: inputIndex, count: inputCount, placementTransform: operationPlacement })
          copy.opacity = result.opacity
          copy.colorShift = result.colorShift
        } else applyGpuOperation(operation, out, out)
      }
    } else {
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
    if (copy) {
      const guard = program?.guardOffsets[stage] ?? -1
      const active = guard === -1 || (guard >= 0 && plan.matrices[guard + Math.floor(index / program!.guardStrides[stage])] === 1)
      const offset = (kind === 2 && !active ? plan.bareAppearanceOffsets?.[stage] : plan.appearanceOffsets?.[stage]) ?? -1
      if (offset >= 0) {
        copy.opacity *= plan.matrices[offset + slot * 2]
        copy.colorShift.hue += plan.matrices[offset + slot * 2 + 1]
      }
      if (active && nestedOffset >= 0 && parentFrame) {
        const childPlacement = placement ? placement.clone().multiply(parentFrame) : parentFrame
        for (let nested = 0; nested < plan.matrices[nestedOffset]; nested++) {
          const p = nestedOffset + 1 + nested * 7, operationKind = plan.matrices[p]
          const inputIndex = plan.matrices[p + 4] >= 0 ? plan.matrices[plan.matrices[p + 4] + slot] : slot
          const inputCount = plan.matrices[p + 5]
          if (operationKind !== GPU_OPERATION_APPEARANCE
            || plan.matrices[p + 6] >= 0 && plan.matrices[plan.matrices[p + 6] + slot] !== 1
            || !particleOperationSelected(plan, plan.matrices[p + 3], inputIndex, inputCount)) continue
          const start = plan.matrices[p + 1], parameters = plan.matrices.subarray(start)
          const operation: GpuOperation = { kind: operationKind,
            parameters: Array.from(parameters.subarray(0, gpuOperationParameterCount(operationKind, parameters)!)), scaleBound: 1, translationBound: 0 }
          const sampleFrame = new Matrix4().fromArray(plan.matrices, (plan.matrices[p + 2] + slot) * 16)
          const result = applyGpuAppearance(operation, { ...copy, transform: sampleFrame },
            { beat: plan.beat, index: inputIndex, count: inputCount, placementTransform: childPlacement })
          copy.opacity = result.opacity; copy.colorShift = result.colorShift
        }
      }
    }
  }
  if (internal) out.multiply(internal)
  return out
}

/** Random access for inspection/picking: O(chain depth), with no expansion. */
export function particlePlanMatrix(plan: ParticlePlan, index: number, out: Matrix4, scratch = new Matrix4()): Matrix4 {
  return evaluateParticlePlan(plan, index, out, scratch)
}

export function particlePlanCopy(plan: ParticlePlan, index: number): VisualCopy | undefined {
  if (!Number.isInteger(index) || index < 0 || index >= plan.count) return undefined
  const copy = identityVisualCopy()
  if (plan.cpuPrefix) {
    const slot = Math.floor(index / (plan.count / plan.counts[0]))
    copy.colorShift = { ...plan.cpuPrefix.colors[slot], hue: 0 }
  }
  evaluateParticlePlan(plan, index, copy.transform, new Matrix4(), copy)
  return copy
}
