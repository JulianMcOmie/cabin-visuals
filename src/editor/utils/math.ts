/** Scalar helpers that used to be hand-copied into ~50 files. Pure, allocation-free. */

export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

/** Hermite ease over [0, 1]; input is clamped first. */
export function smoothstep(t: number): number {
  const x = clamp01(t)
  return x * x * (3 - 2 * x)
}
