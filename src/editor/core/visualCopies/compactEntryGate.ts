import { Matrix4 } from 'three'
import { identityGpuOperation } from './gpuOperations'
import type { FramedLocalTransforms, MoverOrSplitter, SharedLocalLayout } from './types'

const identity = new Matrix4()
const identityTransforms = [identity]
const identityLayout: SharedLocalLayout = { transforms: identityTransforms }
const identityFrames: FramedLocalTransforms = {
  frames: identityTransforms, internals: [null], bareFrames: identityTransforms,
}

/** A uniform beat gate chooses the existing data or identity. It never reads
 * individual copies, so every compact family can keep its original proof.
 * Count-changing gates still publish their structural variants on the wrapper;
 * a count-one identity at rest is not the device's allocation ceiling. */
export function forwardCompactUniformGate(
  target: MoverOrSplitter,
  entry: MoverOrSplitter,
  activeAt: (beat: number) => boolean,
): void {
  if (entry.emitsCopyClocks) return
  const legacy = !!(entry.localTransforms || entry.localTransformsAtBeat)
  const shared = !!(entry.localLayout || entry.localLayoutAtBeat)
  const root = !!(entry.rootTransform || entry.rootTransformAtBeat)
  const framed = !!entry.framedLocalTransformsAtBeat
  const gpu = !!entry.gpuOperationAtBeat
  if (Number(legacy) + Number(shared) + Number(root) + Number(framed) + Number(gpu) !== 1
    || framed !== !!entry.applyFramed) return
  if (legacy) {
    target.localTransformsAtBeat = beat => activeAt(beat)
      ? entry.localTransformsAtBeat?.(beat) ?? entry.localTransforms! : identityTransforms
    const count = entry.localTransformsAtBeat ? entry.localTransformCount : entry.localTransforms!.length
    if (count === 1) target.localTransformCount = 1
  } else if (shared) {
    target.localLayoutAtBeat = (beat, placement) => activeAt(beat)
      ? entry.localLayoutAtBeat?.(beat, placement) ?? entry.localLayout! : identityLayout
    target.localLayoutUsesPlacement = entry.localLayoutUsesPlacement
    const count = entry.localLayoutAtBeat ? entry.localLayoutCount : entry.localLayout!.transforms.length
    if (count === 1) target.localLayoutCount = 1
  } else if (root) {
    target.rootTransformAtBeat = beat => activeAt(beat)
      ? entry.rootTransformAtBeat?.(beat) ?? entry.rootTransform! : identity
  } else if (framed) {
    if (entry.framedRequiresInvertibleInput || entry.structuralVariants?.some(variant => variant.framedRequiresInvertibleInput)) {
      target.framedRequiresInvertibleInput = true
    }
    target.framedLocalTransformsAtBeat = (beat, placement) => activeAt(beat)
      ? entry.framedLocalTransformsAtBeat!(beat, placement) : identityFrames
    target.framedLayoutUsesPlacement = entry.framedLayoutUsesPlacement
    target.framedTransformUsesPlacement = entry.framedTransformUsesPlacement
  } else if (gpu) {
    target.gpuOperationAtBeat = (beat, placement) => activeAt(beat)
      ? entry.gpuOperationAtBeat!(beat, placement) : identityGpuOperation()
    target.gpuOperationUsesPlacement = entry.gpuOperationUsesPlacement
    if (entry.gpuAppearanceOnly) target.gpuAppearanceOnly = true
    if (entry.gpuOperationPreservesDeterminant) target.gpuOperationPreservesDeterminant = true
  }
}
