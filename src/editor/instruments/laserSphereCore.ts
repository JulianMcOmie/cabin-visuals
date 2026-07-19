export const DEFAULT_WHITE_CORE = 1

/** The rim always keeps the original HDR bloom drive. This helper controls only
 * the visible center: 1 exactly matches the original emitter, while 0 is a
 * saturated sub-threshold color that cannot tone-map to white. */
export function evaluateCoreAppearance(whiteCore: number, glow: number, energy: number): {
  intensity: number
  whiteMix: number
} {
  const heat = Math.max(0, Math.min(1, whiteCore))
  const flare = Math.max(0, Math.min(1, energy))
  const hdrIntensity = Math.max(0, glow) * (1 + flare * 1.65)
  return {
    intensity: 0.9 + heat * (hdrIntensity - 0.9),
    whiteMix: heat * (0.13 + flare * 0.1),
  }
}
