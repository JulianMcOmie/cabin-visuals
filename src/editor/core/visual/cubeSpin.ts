/** Intrinsic cube rotation, applied inside each resolved visual copy. */
export function cubeSpinRotation(beat: number, spinSpeed: number): [number, number, number] {
  return [beat * 0.09 * spinSpeed, beat * 0.22 * spinSpeed, 0]
}
