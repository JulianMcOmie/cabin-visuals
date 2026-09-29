import { Matrix4, Object3D, Vector3 } from 'three'

const meshSize = new Vector3()

/** Render the exact affine copy basis, including shear. Rebuilding it from
 * decomposed TRS loses a warp's stretch along a curved field and disagrees
 * with the instanced path. Keep TRS readable for picking/tooling, but let the
 * matrix own rendering. Mesh size scales the basis, never the placement. */
export function applyObjectPlacement(object: Object3D, placement: Matrix4, meshScale = 1): void {
  object.matrix.copy(placement)
  object.matrix.decompose(object.position, object.quaternion, object.scale)
  // Decompose before mesh size: size zero is a valid invisible instrument,
  // and decomposing that singular matrix would put NaNs in its quaternion.
  object.scale.multiplyScalar(meshScale)
  object.matrix.scale(meshSize.setScalar(meshScale))
  object.matrixAutoUpdate = false
  object.matrixWorldNeedsUpdate = true
}
