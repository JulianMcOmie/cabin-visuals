// The Deformer's vocabulary: which operations exist, which knobs each one reads,
// and how the DRIVE clock and the FALLOFF envelope are shaped. Pure data + pure
// maths, no three and no GLSL - the shader generator (deformField.ts) and the
// panel both read this file, so the picture, the knobs and the geometry cannot
// drift apart.
//
// The shape of the device is one definition covering OPERATION x DRIVE x FALLOFF
// rather than a dozen sibling plugins, for the same reason `mover` covers
// (translate|rotate|orbit) x (burst|constant|oscillate): every cell speaks the
// same handful of knobs, so switching operations keeps a dialled-in setting
// meaningful instead of resetting the device.

/** Operation ids. Values are PERSISTED in saved projects: append only, never
 *  reorder. */
export const DEFORM_TWIST = 0
export const DEFORM_BEND = 1
export const DEFORM_TAPER = 2
export const DEFORM_SHEAR = 3
export const DEFORM_BULGE = 4
export const DEFORM_WAVE = 5
export const DEFORM_RIPPLE = 6
export const DEFORM_INFLATE = 7
export const DEFORM_SPHERIFY = 8
export const DEFORM_PINCH = 9
export const DEFORM_MELT = 10
export const DEFORM_JITTER = 11

/** Drive: how the deformation moves on its own. All four are closed-form
 *  functions of the beat - an effect never sees MIDI notes (it is handed
 *  `(settings, beat)` and nothing else), so note-shaped control comes from an
 *  automation lane on `strength` (`fx:<instanceId>:strength`), which already
 *  has burst/cycle/noise modes. That split matches the library's passive/played
 *  divide: the Gradient colorizer is passive, the note Colorizer is played. */
export const DRIVE_STATIC = 0
export const DRIVE_PULSE = 1
export const DRIVE_RAMP = 2
export const DRIVE_OSCILLATE = 3

export const FALLOFF_NONE = 0
export const FALLOFF_LINEAR = 1
export const FALLOFF_SPHERICAL = 2
export const FALLOFF_BOX = 3

export const DEFORM_AXIS_X = 0
export const DEFORM_AXIS_Y = 1
export const DEFORM_AXIS_Z = 2

export interface DeformOperation {
  value: number
  id: string
  label: string
  /** Param keys this operation actually reads, in panel order. Everything else
   *  is hidden for that operation rather than sitting there doing nothing -
   *  twelve operations sharing one flat list of fifteen knobs is the spreadsheet
   *  this device exists to avoid. */
  params: string[]
  /** One line for the panel's caption: what the knobs are doing. */
  hint: string
}

/** `axis` means the same thing everywhere it appears: the operation's spine.
 *  Ops that have no spine (Inflate, Spherify, Jitter) simply don't list it. */
export const DEFORM_OPERATIONS: DeformOperation[] = [
  { value: DEFORM_TWIST, id: 'twist', label: 'Twist', params: ['angle', 'axis', 'center'], hint: 'Rotation about the axis, growing along it.' },
  { value: DEFORM_BEND, id: 'bend', label: 'Bend', params: ['angle', 'axis', 'center'], hint: 'The spine arcs; the surface follows it.' },
  { value: DEFORM_TAPER, id: 'taper', label: 'Taper', params: ['amount', 'axis', 'center'], hint: 'Cross-section grows or shrinks along the axis.' },
  { value: DEFORM_SHEAR, id: 'shear', label: 'Shear', params: ['amount', 'axis'], hint: 'Each slice slides sideways in proportion to its height.' },
  { value: DEFORM_BULGE, id: 'bulge', label: 'Bulge', params: ['amount', 'axis', 'width', 'center'], hint: 'A barrel swell in a band around the center.' },
  { value: DEFORM_WAVE, id: 'wave', label: 'Wave', params: ['amount', 'axis', 'wavelength', 'phase'], hint: 'Sideways sine displacement along the axis.' },
  { value: DEFORM_RIPPLE, id: 'ripple', label: 'Ripple', params: ['amount', 'axis', 'wavelength', 'phase'], hint: 'Concentric rings travelling out from the axis.' },
  { value: DEFORM_INFLATE, id: 'inflate', label: 'Inflate', params: ['amount'], hint: 'Every point pushed along its own normal.' },
  { value: DEFORM_SPHERIFY, id: 'spherify', label: 'Spherify', params: ['amount', 'radius'], hint: 'Blend the whole surface toward a sphere.' },
  { value: DEFORM_PINCH, id: 'pinch', label: 'Pinch', params: ['amount', 'axis', 'width', 'center'], hint: 'A waist: the inverse of Bulge.' },
  { value: DEFORM_MELT, id: 'melt', label: 'Melt', params: ['amount', 'axis', 'width'], hint: 'Sags along the axis and spreads where it pools.' },
  { value: DEFORM_JITTER, id: 'jitter', label: 'Jitter', params: ['amount', 'wavelength', 'seed'], hint: 'Seeded per-vertex scatter; the machine-perfect look, gone.' },
]

export const DEFORM_DRIVES = [
  { value: DRIVE_STATIC, label: 'Static' },
  { value: DRIVE_PULSE, label: 'Pulse' },
  { value: DRIVE_RAMP, label: 'Ramp' },
  { value: DRIVE_OSCILLATE, label: 'Oscillate' },
]

export const DEFORM_FALLOFFS = [
  { value: FALLOFF_NONE, label: 'None' },
  { value: FALLOFF_LINEAR, label: 'Linear' },
  { value: FALLOFF_SPHERICAL, label: 'Spherical' },
  { value: FALLOFF_BOX, label: 'Box' },
]

/** Knobs the DRIVE adds on top of the operation's own. Static has no clock, so
 *  it adds nothing - which is what makes Static the honest default. */
export function driveParams(drive: number): string[] {
  return drive === DRIVE_STATIC ? [] : ['rate']
}

export const FALLOFF_PARAMS = ['falloffSize', 'falloffOffset', 'falloffSoftness']

export function falloffParams(falloff: number): string[] {
  return falloff === FALLOFF_NONE ? [] : FALLOFF_PARAMS
}

export function deformOperation(value: number): DeformOperation {
  return DEFORM_OPERATIONS[Math.round(value)] ?? DEFORM_OPERATIONS[0]
}

/** Every key the device shows for one (operation, drive, falloff) cell, in panel
 *  order. `strength` leads because it is the master for every operation - the
 *  one knob that is always worth reaching for first. */
export function visibleDeformParams(operation: number, drive: number, falloff: number): string[] {
  return [
    'strength',
    ...deformOperation(operation).params,
    ...driveParams(drive),
    ...falloffParams(falloff),
  ]
}

const TAU = Math.PI * 2

/**
 * The drive envelope: a multiplier on `strength`, as a pure function of the beat.
 * Mirrored EXACTLY by `fxDrive` in deformField.ts - this copy is what the panel
 * plots and what the tests pin, so if you change one, change both.
 *
 * RAMP is deliberately unbounded (`beat * rate`), the same call Constant Rotate
 * makes: it is the rotational ops' clock, where an ever-growing angle is a spin,
 * and on a Taper it will genuinely run away. A wrapping sawtooth would be the
 * alternative and it is worse - `fract()` teleports the shape at every wrap,
 * which is the one thing effects/CLAUDE.md tells you not to do.
 */
export function driveEnvelope(drive: number, rate: number, beat: number): number {
  switch (drive) {
    case DRIVE_PULSE: {
      // A decaying hit on every cycle. Continuous within a cycle and it lands on
      // the same value (~0) at the wrap, so the retrigger reads as a hit rather
      // than a jump.
      const phase = beat * rate
      return Math.exp(-4 * (phase - Math.floor(phase)))
    }
    case DRIVE_RAMP:
      return beat * rate
    case DRIVE_OSCILLATE:
      // One-sided on purpose (0 -> 1 -> 0): a bipolar swing would make the
      // `amount` knob's sign meaningless, since the wave would visit both.
      return 0.5 - 0.5 * Math.cos(beat * rate * TAU)
    case DRIVE_STATIC:
    default:
      return 1
  }
}

/**
 * The falloff weight at a point, given its coordinate ALONG the operation's axis
 * (`along`) and its distance from the axis origin (`radius` for spherical, `box`
 * for the chebyshev distance). Mirrored by `fxFalloff` in deformField.ts.
 *
 * Softness is a FRACTION of size rather than an absolute width, so widening the
 * region keeps its edge looking the same - the alternative makes every size
 * change also a softness change.
 */
export function falloffWeight(
  falloff: number,
  along: number,
  radius: number,
  chebyshev: number,
  size: number,
  offset: number,
  softness: number,
): number {
  const s = Math.max(1e-4, size)
  const soft = Math.min(1, Math.max(0, softness))
  switch (falloff) {
    case FALLOFF_LINEAR: {
      const u = Math.min(1, Math.max(0, (along - offset) / s + 0.5))
      // Softness blends between a hard ramp and a smoothstep, so 0 gives a crisp
      // boundary at both ends of the band and 1 eases into and out of it.
      return u * (1 - soft) + soft * u * u * (3 - 2 * u)
    }
    case FALLOFF_SPHERICAL:
      return softEdge(radius - offset, s, soft)
    case FALLOFF_BOX:
      return softEdge(chebyshev - offset, s, soft)
    case FALLOFF_NONE:
    default:
      return 1
  }
}

function softEdge(distance: number, size: number, softness: number): number {
  const inner = size * (1 - softness)
  if (distance <= inner) return 1
  if (distance >= size) return 0
  const u = (distance - inner) / Math.max(1e-4, size - inner)
  return 1 - u * u * (3 - 2 * u)
}
