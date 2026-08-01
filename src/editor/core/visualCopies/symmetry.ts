// Symmetry splitter: reflect the object across one or more mirror lines that
// all pass through its own center, so the copies read as a mirror image rather
// than as a fan of clones. One mirror line is the plain case (2 copies: the
// object and its reflection); N evenly spaced mirror lines are the kaleidoscope
// (2N copies alternating handedness around the center).
//
// The N lines are spaced 180°/N apart, which makes the slot set exactly the
// dihedral group D_N: N rotations by multiples of 360°/N interleaved with the
// N reflections. That is the whole implementation - "mirror", "quad", and
// "kaleidoscope" are not three modes, they are N = 1, 2, and more.
//
// LOCAL composition (previous * delta), like Radial: the symmetry is centered
// on the object's own accumulated frame, so it works with the object anywhere
// in the scene, and every copy's REFLECTED axes are handed to the movers below
// it - a Burst 'Right (+X)' note under a Symmetry sends each mirrored copy
// outward in its own mirrored direction, which is what makes the arrangement
// stay symmetric while it moves.

import { Matrix4, Vector3 } from 'three'
import type { MoverOrSplitterDefinition } from './definitions'
import { SYMMETRY_COLOR } from './identityColors'
import { noteDisablesSplitterSlot, splitterMidiRows } from './splitterMidi'

export interface SymmetrySettings {
  /** Mirror lines through the center; the splitter emits 2 × this many copies. */
  mirrors: number
  /** Tilt of the first mirror line off vertical, in degrees. 0 = upright line
   *  (a left/right mirror), 45 = diagonal, 90 = horizontal (up/down mirror). */
  tilt: number
  /** How far the object sits from the symmetry center before mirroring. At 0
   *  every copy is coincident until a mover below pushes them apart. */
  spread: number
  /** 0 = XY, 1 = XZ, 2 = YZ - which plane the mirror lines live in. */
  plane: number
}

export const SYMMETRY_MAX_MIRRORS = 12

/** Horizontal / vertical in-plane axes per plane, matching Radial's and Grid's
 *  plane vocabulary (XY faces the camera, XZ is the floor, YZ is the side wall).
 *  The mirror "line" is really the plane spanned by that line and the remaining
 *  axis, so a mirror in XY reflects through a wall standing in depth. */
const SYMMETRY_PLANE_AXES: [Vector3, Vector3][] = [
  [new Vector3(1, 0, 0), new Vector3(0, 1, 0)], // XY: horizontal X, vertical Y
  [new Vector3(1, 0, 0), new Vector3(0, 0, 1)], // XZ: horizontal X, vertical Z
  [new Vector3(0, 0, 1), new Vector3(0, 1, 0)], // YZ: horizontal Z, vertical Y
]

const clampMirrors = (mirrors: number) =>
  Math.max(1, Math.min(SYMMETRY_MAX_MIRRORS, Math.round(mirrors)))

const clampPlane = (plane: number) => (plane === 1 || plane === 2 ? plane : 0)

/** Total copies for a mirror count - one reflection per line, plus the
 *  rotations that pair of adjacent lines generates. */
export const symmetryCopyCount = (mirrors: number) => clampMirrors(mirrors) * 2

/**
 * The slot transforms in slot order, in the object's own frame.
 *
 * Slot 0 is the unreflected object at its spread offset; odd slots are
 * reflections and even slots are rotations, so walking the ring alternates
 * handedness the way a real kaleidoscope does.
 */
export function symmetryTransforms(settings: SymmetrySettings): Matrix4[] {
  const mirrors = clampMirrors(settings.mirrors)
  const [horizontal, vertical] = SYMMETRY_PLANE_AXES[clampPlane(settings.plane)]
  const depth = new Vector3().crossVectors(horizontal, vertical)
  // Everything below is stated in the plane's own (horizontal, vertical, depth)
  // coordinates and conjugated into world axes by this orthonormal basis, so
  // the group math never has to know which world plane it landed in.
  const basis = new Matrix4().makeBasis(horizontal, vertical, depth)
  const inverseBasis = basis.clone().transpose()
  const toWorld = (inPlane: Matrix4) => basis.clone().multiply(inPlane).multiply(inverseBasis)

  const tilt = (settings.tilt * Math.PI) / 180
  /** Unit direction at `angle` measured off vertical, turning toward horizontal. */
  const direction = (angle: number) => new Vector3(Math.sin(angle), Math.cos(angle), 0)

  // The object sits in the middle of a wedge - halfway between two adjacent
  // mirror lines - so the copies land evenly spaced rather than piled onto a
  // line. For a single mirror that is simply "off to one side of it".
  const wedgeCenter = direction(tilt + Math.PI / (2 * mirrors))
    .multiplyScalar(Math.max(0, settings.spread))
  const offset = toWorld(
    new Matrix4().makeTranslation(wedgeCenter.x, wedgeCenter.y, wedgeCenter.z),
  )

  const transforms: Matrix4[] = []
  for (let k = 0; k < mirrors; k++) {
    // Rotation by k full sectors, in-plane (columns are the images of the
    // horizontal, vertical, and depth axes).
    const spin = (k / mirrors) * Math.PI * 2
    transforms.push(toWorld(new Matrix4().makeBasis(
      new Vector3(Math.cos(spin), -Math.sin(spin), 0),
      new Vector3(Math.sin(spin), Math.cos(spin), 0),
      new Vector3(0, 0, 1),
    )).multiply(offset))

    // Reflection across mirror line k, at tilt + k·180°/mirrors. It fixes the
    // line and the depth axis and negates the in-plane perpendicular, so its
    // determinant is -1 - a genuine mirror image, not a 180° turn. three.js
    // decomposes the negative determinant into a negated scale axis and flips
    // the winding order for it, so reflected copies light and cull correctly.
    const line = 2 * (tilt + (k * Math.PI) / mirrors)
    transforms.push(toWorld(new Matrix4().makeBasis(
      new Vector3(-Math.cos(line), Math.sin(line), 0),
      new Vector3(Math.sin(line), Math.cos(line), 0),
      new Vector3(0, 0, 1),
    )).multiply(offset))
  }
  return transforms
}

/** One slot as the settings panel needs to draw it: where the copy sits in the
 *  plane and how its axes are turned or flipped there. Derived from the real
 *  slot transforms, so the diagram cannot drift from what renders. */
export interface SymmetrySlotLayout {
  /** In-plane position: horizontal axis, then vertical axis, in scene units. */
  u: number
  v: number
  /** The slot's in-plane 2×2 linear map, column-major: the first pair is where
   *  the horizontal axis lands, the second where the vertical axis lands. */
  basis: [number, number, number, number]
  /** True for the reflected slots - a mirror image rather than a turn. */
  mirrored: boolean
}

export function symmetryLayout(settings: SymmetrySettings): SymmetrySlotLayout[] {
  const [horizontal, vertical] = SYMMETRY_PLANE_AXES[clampPlane(settings.plane)]
  const position = new Vector3()
  const mappedHorizontal = new Vector3()
  const mappedVertical = new Vector3()
  return symmetryTransforms(settings).map((transform) => {
    position.setFromMatrixPosition(transform)
    mappedHorizontal.copy(horizontal).transformDirection(transform)
    mappedVertical.copy(vertical).transformDirection(transform)
    return {
      u: position.dot(horizontal),
      v: position.dot(vertical),
      basis: [
        mappedHorizontal.dot(horizontal),
        mappedHorizontal.dot(vertical),
        mappedVertical.dot(horizontal),
        mappedVertical.dot(vertical),
      ],
      mirrored: transform.determinant() < 0,
    }
  })
}

/** Where each mirror line points, in degrees off vertical - what the panel
 *  draws as the symmetry lines the copies are folded across. */
export function symmetryMirrorAngles(settings: SymmetrySettings): number[] {
  const mirrors = clampMirrors(settings.mirrors)
  return Array.from({ length: mirrors }, (_, k) => settings.tilt + (k * 180) / mirrors)
}

export const symmetrySplitter: MoverOrSplitterDefinition<SymmetrySettings> = {
  id: 'symmetry',
  label: 'Symmetry',
  kind: 'splitter',
  identityColor: SYMMETRY_COLOR,
  params: [
    { key: 'mirrors', label: 'Mirrors', min: 1, max: SYMMETRY_MAX_MIRRORS, step: 1, default: 1 },
    { key: 'tilt', label: 'Tilt', min: 0, max: 180, step: 1, default: 0 },
    { key: 'spread', label: 'Spread', min: 0, max: 10, step: 0.1, default: 1.5 },
    {
      key: 'plane',
      label: 'Plane',
      type: 'select',
      options: [
        { value: 0, label: 'XY' },
        { value: 1, label: 'XZ' },
        { value: 2, label: 'YZ' },
      ],
      default: 0,
    },
  ],
  midiRows: (settings) => splitterMidiRows(symmetryCopyCount(settings.mirrors), 'copy', 'copies'),
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const transforms = symmetryTransforms(settings)
    const count = transforms.length
    return {
      apply(visualCopy, { beat }) {
        return transforms.map((transform, slot) => ({
          transform: visualCopy.transform.clone().multiply(transform),
          opacity: noteDisablesSplitterSlot(notes, beat, slot, count) ? 0 : visualCopy.opacity,
          colorShift: { ...visualCopy.colorShift },
        }))
      },
    }
  },
}
