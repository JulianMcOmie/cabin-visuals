import { Matrix4 } from 'three'
import { copyIsTargeted } from './copyTargets'
import { applyGpuAppearance } from './gpuAppearance'
import { applyGpuOperation, GPU_OPERATION_APPEARANCE, type GpuOperation } from './gpuOperations'
import type { MoverOrSplitter, MoverOrSplitterContext, VisualCopy } from './types'

/** The single-copy interpreter is also used by random-access inspection and
 * picking. Appearance is accumulated as state, never flattened into RGB before
 * later colorizers have had their turn. */
export function applyGpuCopyOperation(operation: GpuOperation, copy: VisualCopy, context: MoverOrSplitterContext): VisualCopy {
  if (operation.indexGuards?.some(guard => !copyIsTargeted(context.index, context.count, guard))) {
    return { transform: copy.transform.clone(), opacity: copy.opacity, colorShift: { ...copy.colorShift } }
  }
  if (operation.kind === GPU_OPERATION_APPEARANCE) return applyGpuAppearance(operation, copy,
    operation.appearancePlacement ? { ...context, placementTransform: new Matrix4().fromArray(operation.appearancePlacement) } : context)
  return { transform: applyGpuOperation(operation, copy.transform, new Matrix4()),
    opacity: copy.opacity, colorShift: { ...copy.colorShift } }
}

/** Define a device once as data. Both CPU reference evaluation and compact GPU
 * rendering are derived here, so a new device cannot accidentally implement
 * only the per-copy path. The sampled record is immutable and independent of
 * the expanded particle population. */
export function sharedGpuOperation(
  sample: (beat: number, placement?: Matrix4) => GpuOperation,
  options: {
    usesPlacement?: boolean
    localSlotMotion?: true
    composition?: MoverOrSplitter['composition']
    appearanceOnly?: true
    preservesDeterminant?: true
    /** Per-copy birth clocks use the existing reference engine. This hook must
     * preserve their semantics; it is never used by a shared-clock GPU plan. */
    referenceApply?: MoverOrSplitter['apply']
  } = {},
): MoverOrSplitter {
  let lastBeat: number | undefined, lastPlacement: number[] | undefined, last: GpuOperation | undefined
  const identity = new Matrix4()
  const operationAt = (beat: number, placement?: Matrix4) => {
    const elements = (placement ?? identity).elements
    if (!last || beat !== lastBeat || options.usesPlacement && elements.some((value, i) => value !== lastPlacement?.[i])) {
      last = sample(beat, placement)
      lastBeat = beat
      if (options.usesPlacement) lastPlacement = elements.slice()
    }
    return last
  }
  return {
    maxOutputCount: 1,
    cachePolicy: 'beat',
    gpuOperationAtBeat: operationAt,
    gpuOperationUsesPlacement: !!options.usesPlacement,
    ...(options.appearanceOnly ? { gpuAppearanceOnly: true } : {}),
    ...(options.appearanceOnly || options.preservesDeterminant ? { gpuOperationPreservesDeterminant: true as const } : {}),
    ...(options.localSlotMotion ? { localSlotMotion: true } : {}),
    ...(options.composition ? { composition: options.composition } : {}),
    apply(copy, context) {
      if (context.birthBeat !== undefined && options.referenceApply) return options.referenceApply(copy, context)
      return [applyGpuCopyOperation(operationAt(context.beat, context.placementTransform), copy, context)]
    },
  }
}
