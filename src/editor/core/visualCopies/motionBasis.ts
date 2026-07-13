import { Matrix4, Vector3 } from 'three'
import type { MidiRowDef, ParamDef } from '../../instruments/types'

export interface BasisSettings {
  basisXX: number
  basisXY: number
  basisXZ: number
  basisYX: number
  basisYY: number
  basisYZ: number
  basisZX: number
  basisZY: number
  basisZZ: number
}

export const BASIS_PARAMS: ParamDef[] = [
  { key: 'basisXX', label: 'Basis X · X', min: -1, max: 1, step: 0.01, default: 1 },
  { key: 'basisXY', label: 'Basis X · Y', min: -1, max: 1, step: 0.01, default: 0 },
  { key: 'basisXZ', label: 'Basis X · Z', min: -1, max: 1, step: 0.01, default: 0 },
  { key: 'basisYX', label: 'Basis Y · X', min: -1, max: 1, step: 0.01, default: 0 },
  { key: 'basisYY', label: 'Basis Y · Y', min: -1, max: 1, step: 0.01, default: 1 },
  { key: 'basisYZ', label: 'Basis Y · Z', min: -1, max: 1, step: 0.01, default: 0 },
  { key: 'basisZX', label: 'Basis Z · X', min: -1, max: 1, step: 0.01, default: 0 },
  { key: 'basisZY', label: 'Basis Z · Y', min: -1, max: 1, step: 0.01, default: 0 },
  { key: 'basisZZ', label: 'Basis Z · Z', min: -1, max: 1, step: 0.01, default: 1 },
]

export const SIGNED_BASIS_DIRECTIONS: Record<number, { axis: 0 | 1 | 2; sign: 1 | -1 }> = {
  60: { axis: 0, sign: 1 },
  61: { axis: 0, sign: -1 },
  62: { axis: 1, sign: 1 },
  63: { axis: 1, sign: -1 },
  64: { axis: 2, sign: 1 },
  65: { axis: 2, sign: -1 },
}

export const RETURN_PITCH = 66

export const SIGNED_BASIS_ROWS: MidiRowDef[] = [
  { pitch: 62, label: '+ Basis Y' },
  { pitch: 63, label: '− Basis Y' },
  { pitch: 60, label: '+ Basis X' },
  { pitch: 61, label: '− Basis X' },
  { pitch: 64, label: '+ Basis Z' },
  { pitch: 65, label: '− Basis Z' },
]

const CANONICAL_BASIS = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]

export function resolveBasis(settings: BasisSettings): [Vector3, Vector3, Vector3] {
  const raw = [
    new Vector3(settings.basisXX, settings.basisXY, settings.basisXZ),
    new Vector3(settings.basisYX, settings.basisYY, settings.basisYZ),
    new Vector3(settings.basisZX, settings.basisZY, settings.basisZZ),
  ]
  return raw.map((axis, index) =>
    axis.lengthSq() > 0.00000001 ? axis.normalize() : CANONICAL_BASIS[index].clone(),
  ) as [Vector3, Vector3, Vector3]
}

/** Compose signed rotations in stable basis-X, basis-Y, basis-Z order. */
export function basisRotation(
  basis: [Vector3, Vector3, Vector3],
  angles: [number, number, number],
): Matrix4 {
  const out = new Matrix4()
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(angles[axis]) > 0.0000000001) {
      out.multiply(new Matrix4().makeRotationAxis(basis[axis], angles[axis]))
    }
  }
  return out
}

export function pivotedRotation(rotation: Matrix4, pivot: [number, number, number]): Matrix4 {
  return new Matrix4()
    .makeTranslation(pivot[0], pivot[1], pivot[2])
    .multiply(rotation)
    .multiply(new Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]))
}

export function normalizedVelocity(velocity: number): number {
  return velocity <= 1 ? velocity : velocity / 127
}
