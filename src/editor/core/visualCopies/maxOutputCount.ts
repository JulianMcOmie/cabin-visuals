import type { MoverOrSplitter } from './types'

function validCount(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0
}

/** A structural upper bound, never a sample of apply or a beat sampler. Unknown
 * variants invalidate a proof; their documented bracket may establish a bound
 * for an otherwise dynamic entry. Cyclic variant graphs are not proofs. */
export function entryMaxOutputCount(entry: MoverOrSplitter): number | undefined {
  const visiting = new Set<MoverOrSplitter>()
  const visit = (current: MoverOrSplitter): number | undefined => {
    if (visiting.has(current) || current.emitsCopyClocks) return undefined
    visiting.add(current)
    try {
      let bound: number | undefined
      if (current.maxOutputCount !== undefined) {
        if (!validCount(current.maxOutputCount)) return undefined
        bound = current.maxOutputCount
      } else if (!current.applyFramed && !current.framedLocalTransformsAtBeat) {
        const legacy = !!(current.localTransforms || current.localTransformsAtBeat)
        const shared = !!(current.localLayout || current.localLayoutAtBeat)
        const root = !!(current.rootTransform || current.rootTransformAtBeat)
        const gpu = !!current.gpuOperationAtBeat
        const families = Number(legacy) + Number(shared) + Number(root) + Number(gpu)
        if (families === 1) {
          if (legacy) bound = current.localTransformsAtBeat
            ? current.localTransformCount : current.localTransforms!.length
          if (shared) bound = current.localLayoutAtBeat
            ? current.localLayoutCount : current.localLayout!.transforms.length
          if (root || gpu) bound = 1
        } else if (families === 0 && current.localSlotMotion) bound = 1
        if (bound !== undefined && !validCount(bound)) return undefined
      }
      for (const variant of current.structuralVariants ?? []) {
        const variantBound = visit(variant)
        if (variantBound === undefined) return undefined
        bound = Math.max(bound ?? 0, variantBound)
      }
      return bound
    } finally {
      visiting.delete(current)
    }
  }
  return visit(entry)
}
