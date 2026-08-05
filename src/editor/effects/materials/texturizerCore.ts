// Pure half of the Texturizer material effect: maps (finish, knobs, original
// material's look) to the MeshPhysicalMaterial property targets. Type-only
// imports keep this testable under node (same split as laserSphereCore).

/** Finish select values - stored numerically in the effect instance. Append
 *  only: saved projects hold these indices. */
export const FINISH_OPTIONS = [
  { value: 0, label: 'Chrome' },
  { value: 1, label: 'Metal' },
  { value: 2, label: 'Matte' },
  { value: 3, label: 'Neon' },
  { value: 4, label: 'Glass' },
  { value: 5, label: 'Velvet' },
  { value: 6, label: 'Toon' },
] as const

export const FINISH = {
  chrome: 0, metal: 1, matte: 2, neon: 3, glass: 4, velvet: 5, toon: 6,
} as const

/** What the source material looked like before the swap - the Amount=0 end of
 *  every lerp, so backing the knob off approaches the instrument's own look. */
export interface OriginalLook {
  /** Source was unlit (MeshBasicMaterial): emulated at low Amount by driving
   *  emissive with the material's own colour, which IS the unlit equation. */
  unlit: boolean
  metalness: number
  roughness: number
  envMapIntensity: number
}

/** Property targets for the physical material, already blended by Amount. */
export interface FinishTarget {
  metalness: number
  roughness: number
  envMapIntensity: number
  specularIntensity: number
  sheen: number
  sheenRoughness: number
  transmission: number
  thickness: number
  ior: number
  /** Emissive drive as a multiple of the material's own colour. Carries the
   *  Glow knob, the Neon finish's self-light, and the unlit emulation. */
  emissiveIntensity: number
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Per-finish targets at Amount=1. `rough` is the shared character knob:
 *  surface roughness where that reads (chrome/metal/glass/velvet), ignored by
 *  the finishes it can't affect. */
function finishAtFull(finish: number, rough: number): Omit<FinishTarget, 'emissiveIntensity'> {
  const none = { sheen: 0, sheenRoughness: 0.5, transmission: 0, thickness: 0, ior: 1.5 }
  switch (finish) {
    case FINISH.metal:
      return { ...none, metalness: 1, roughness: 0.25 + rough * 0.55, envMapIntensity: 1.1, specularIntensity: 1 }
    case FINISH.matte:
      return { ...none, metalness: 0, roughness: 1, envMapIntensity: 0.06, specularIntensity: 0.05 }
    case FINISH.neon:
      return { ...none, metalness: 0, roughness: 1, envMapIntensity: 0, specularIntensity: 0 }
    case FINISH.glass:
      return {
        metalness: 0, roughness: rough * 0.35, envMapIntensity: 1.2, specularIntensity: 1,
        sheen: 0, sheenRoughness: 0.5, transmission: 1, thickness: 0.6, ior: 1.5,
      }
    case FINISH.velvet:
      return {
        ...none, metalness: 0, roughness: 1, envMapIntensity: 0.15, specularIntensity: 0.1,
        sheen: 1, sheenRoughness: 0.35 + rough * 0.4,
      }
    case FINISH.chrome:
    default:
      return { ...none, metalness: 1, roughness: rough * 0.35, envMapIntensity: 1.8, specularIntensity: 1 }
  }
}

/**
 * Resolve the physical-material targets for one frame. Amount lerps every
 * channel from the original's look toward the finish, so automating it sweeps
 * the surface between the instrument's own material and the full treatment.
 * (Toon renders on a MeshToonMaterial instead - see toonSteps - but its
 * emissive/glow still comes from here.)
 */
export function resolveFinish(
  finish: number,
  amount: number,
  rough: number,
  glow: number,
  original: OriginalLook,
): FinishTarget {
  const t = Math.max(0, Math.min(1, amount))
  const full = finishAtFull(finish, rough)
  // Unlit emulation fades out as the finish takes over; Neon is self-lit at
  // full Amount (intensity 1 = exactly the material's colour, so the hue
  // survives instead of clipping to white); the Glow knob adds emissive on top
  // of ANY finish (pair with the Glow shader effect for a real halo).
  const unlitBase = original.unlit ? 1 - t : 0
  const neon = finish === FINISH.neon ? (1 + glow) * t : glow * t
  return {
    metalness: lerp(original.metalness, full.metalness, t),
    roughness: lerp(original.roughness, full.roughness, t),
    envMapIntensity: lerp(original.envMapIntensity, full.envMapIntensity, t),
    specularIntensity: lerp(1, full.specularIntensity, t),
    sheen: full.sheen * t,
    sheenRoughness: full.sheenRoughness,
    transmission: full.transmission * t,
    thickness: full.thickness,
    ior: full.ior,
    emissiveIntensity: unlitBase + neon,
  }
}

/** Toon band count from the shared rough knob: smoother knob = more bands. */
export function toonSteps(rough: number): number {
  return Math.max(2, Math.min(5, 2 + Math.round((1 - rough) * 3)))
}
