// Polyhedron splitter: one structural copy per vertex (or face center) of a
// Platonic solid, each pushed out to `radius` and rotated so its local −Z axis
// points at the polyhedron's center (a lookAt: local +Z maps to the outward
// radial direction). The rotation composes LOCALLY (previous * delta), so it
// re-frames movers BELOW it: a Burst 'Forward (+Z)' note blooms the whole shell
// outward, 'Back (−Z)' collapses it toward the center.
// Slot count comes only from the shape/placement settings, never from MIDI;
// notes gate slots via the shared disable-slot rows.

import { Matrix4, Quaternion, Vector3 } from 'three'
import type { MoverOrSplitterDefinition } from './definitions'
import { noteDisablesSplitterSlot, splitterMidiRows } from './splitterMidi'

export interface PolyhedronSettings {
  /** Index into POLYHEDRON_SHAPES. */
  shape: number
  /** 0 = vertices, 1 = face centers (the dual's vertex directions). */
  placement: number
  radius: number
}

const PHI = (1 + Math.sqrt(5)) / 2
const INV_PHI = 1 / PHI
const Z_AXIS = new Vector3(0, 0, 1)

type RawVertex = [number, number, number]

const TETRAHEDRON: RawVertex[] = [
  [1, 1, 1],
  [1, -1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
]
const OCTAHEDRON: RawVertex[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]
const CUBE: RawVertex[] = [
  [1, 1, 1],
  [1, 1, -1],
  [1, -1, 1],
  [1, -1, -1],
  [-1, 1, 1],
  [-1, 1, -1],
  [-1, -1, 1],
  [-1, -1, -1],
]
const ICOSAHEDRON: RawVertex[] = [
  [0, 1, PHI],
  [0, 1, -PHI],
  [0, -1, PHI],
  [0, -1, -PHI],
  [1, PHI, 0],
  [1, -PHI, 0],
  [-1, PHI, 0],
  [-1, -PHI, 0],
  [PHI, 0, 1],
  [PHI, 0, -1],
  [-PHI, 0, 1],
  [-PHI, 0, -1],
]
const DODECAHEDRON: RawVertex[] = [
  ...CUBE,
  [0, INV_PHI, PHI],
  [0, INV_PHI, -PHI],
  [0, -INV_PHI, PHI],
  [0, -INV_PHI, -PHI],
  [INV_PHI, PHI, 0],
  [INV_PHI, -PHI, 0],
  [-INV_PHI, PHI, 0],
  [-INV_PHI, -PHI, 0],
  [PHI, 0, INV_PHI],
  [PHI, 0, -INV_PHI],
  [-PHI, 0, INV_PHI],
  [-PHI, 0, -INV_PHI],
]

/** Face centers of each solid lie along its dual's vertex directions (a
 *  tetrahedron is self-dual with negated vertices), so both placements share
 *  the same five tables. */
export const POLYHEDRON_SHAPES: {
  label: string
  vertices: RawVertex[]
  faces: RawVertex[]
}[] = [
  { label: 'Tetrahedron', vertices: TETRAHEDRON, faces: TETRAHEDRON.map(([x, y, z]) => [-x, -y, -z]) },
  { label: 'Octahedron', vertices: OCTAHEDRON, faces: CUBE },
  { label: 'Cube', vertices: CUBE, faces: OCTAHEDRON },
  { label: 'Icosahedron', vertices: ICOSAHEDRON, faces: DODECAHEDRON },
  { label: 'Dodecahedron', vertices: DODECAHEDRON, faces: ICOSAHEDRON },
]

function clampShape(shape: number): number {
  const index = Math.round(shape)
  return index >= 0 && index < POLYHEDRON_SHAPES.length ? index : 3
}

/** Unit outward directions in slot order (the table order above). */
export function polyhedronDirections(shape: number, placement: number): Vector3[] {
  const entry = POLYHEDRON_SHAPES[clampShape(shape)]
  const raw = placement === 1 ? entry.faces : entry.vertices
  return raw.map(([x, y, z]) => new Vector3(x, y, z).normalize())
}

export const polyhedronSplitter: MoverOrSplitterDefinition<PolyhedronSettings> = {
  id: 'polyhedron',
  label: 'Polyhedron',
  kind: 'splitter',
  params: [
    {
      key: 'shape',
      label: 'Shape',
      type: 'select',
      options: POLYHEDRON_SHAPES.map((shape, value) => ({ value, label: shape.label })),
      default: 3,
    },
    {
      key: 'placement',
      label: 'Placement',
      type: 'select',
      options: [
        { value: 0, label: 'Vertices' },
        { value: 1, label: 'Face centers' },
      ],
      default: 0,
    },
    { key: 'radius', label: 'Radius', min: 0, max: 10, step: 0.1, default: 2 },
  ],
  midiRows: (settings) => splitterMidiRows(
    polyhedronDirections(settings.shape, settings.placement).length,
    'copy',
    'copies',
  ),
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const directions = polyhedronDirections(settings.shape, settings.placement)
    const count = directions.length
    const radius = Math.max(0, settings.radius)
    // Structural slot transforms: minimal rotation carrying local +Z onto the
    // outward direction (deterministic, no up-vector degeneracy), positioned on
    // the shell. Radius 0 keeps the copies coincident but still aimed inward.
    const transforms = directions.map((outward) => {
      const rotation = new Quaternion().setFromUnitVectors(Z_AXIS, outward)
      return new Matrix4()
        .makeRotationFromQuaternion(rotation)
        .setPosition(outward.x * radius, outward.y * radius, outward.z * radius)
    })
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
