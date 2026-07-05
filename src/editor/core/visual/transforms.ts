import { Matrix4 } from 'three'
import type { LocalTransform } from '../../instruments/types'
import { composeMatrix, identitySV, localTransformToSV } from './stateVector'

const _sv = identitySV()

/** Build a TRS matrix from a LocalTransform (missing fields → identity defaults). */
export function composeLocal(t: LocalTransform, out: Matrix4): Matrix4 {
  localTransformToSV(t, _sv)
  composeMatrix(_sv, out)
  return out
}
