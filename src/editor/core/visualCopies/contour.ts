// Contour: a STATIC world-space relief mover. Every copy is displaced along the
// scene's Z axis - the camera's depth axis - by a fixed surface z = f(x, y)
// evaluated at the copy's own accumulated (x, y) position, so a flat formation
// (a Grid, a Radial ring) is sculpted into a solid shape. Where Wave Terrain
// animates a water surface, Contour holds a landform still: it is deliberately
// beat-independent, and passive (no MIDI vocabulary) - depth choreography
// belongs to the movers above and below it in the chain.
//
// One surface family ships today - the CONE - but the `shape` select is the
// seam other families (paraboloid, dome, saddle...) slot into: a new entry in
// CONTOUR_SHAPES, a case in contourHeight, an icon in the panel's shape rail.

import { Matrix4, Vector3 } from 'three'
import type { MoverOrSplitterDefinition } from './definitions'
import { CONTOUR_COLOR } from './identityColors'

/** Surface families, indexed by the `shape` select value. */
export const CONTOUR_SHAPES = ['Cone'] as const

export const CONTOUR_SHAPE_CONE = 0

export interface ContourSettings {
  /** 0 = Cone (see CONTOUR_SHAPES). */
  shape: number
  /** Depth gained per unit of radial distance from the center, SIGNED: positive
   *  pulls the formation's rim toward the camera (+Z), negative pushes it away
   *  into the scene. */
  slope: number
  centerX: number
  centerY: number
}

/**
 * Height of the contour surface at world position (x, y): the copy's Z
 * displacement. Pure and beat-free - pause, scrub, playback, and export all
 * see the same landform. Exported for the settings panel's profile window,
 * so the picture cannot drift from what the stage applies.
 */
export function contourHeight(settings: ContourSettings, x: number, y: number): number {
  const dx = x - settings.centerX
  const dy = y - settings.centerY
  switch (settings.shape) {
    case CONTOUR_SHAPE_CONE:
    default:
      // A cone with its apex at the center: depth grows linearly with radius.
      return settings.slope * Math.hypot(dx, dy)
  }
}

export const contourMover: MoverOrSplitterDefinition<ContourSettings> = {
  id: 'contour',
  label: 'Contour',
  kind: 'mover',
  identityColor: CONTOUR_COLOR,
  params: [
    {
      key: 'shape',
      label: 'Surface',
      type: 'select',
      options: CONTOUR_SHAPES.map((label, value) => ({ value, label })),
      default: CONTOUR_SHAPE_CONE,
    },
    { key: 'slope', label: 'Slope', min: -4, max: 4, step: 0.05, default: 0.5 },
    { key: 'centerX', label: 'Center X', min: -20, max: 20, step: 0.1, default: 0 },
    { key: 'centerY', label: 'Center Y', min: -20, max: 20, step: 0.1, default: 0 },
  ],
  // Passive on purpose (the Gradient colorizer's contract): no rows, no notes.
  midiRows: () => [],
  strictMidiRows: true,
  resolve({ settings }) {
    return {
      apply(visualCopy, { placementTransform }) {
        const placedTransform = placementTransform
          ? placementTransform.clone().multiply(visualCopy.transform)
          : visualCopy.transform
        const position = new Vector3().setFromMatrixPosition(placedTransform)
        const z = contourHeight(settings, position.x, position.y)

        // A flat spot preserves the copy bit-for-bit (the pause invariant).
        if (Math.abs(z) <= 1e-10) {
          return [{
            transform: visualCopy.transform.clone(),
            opacity: visualCopy.opacity,
            colorShift: { ...visualCopy.colorShift },
          }]
        }

        // WORLD composition: desiredPlaced = translation * placement * copy.
        // The surface displaces along the SCENE's Z axis, no matter how
        // upstream movers or the track placement have rotated the copy;
        // conjugating by placement turns that world-space delta back into
        // VisualCopy space. (Same convention as Wave Terrain.)
        const translation = new Matrix4().makeTranslation(0, 0, z)
        const transform = placementTransform
          ? placementTransform.clone().invert()
            .multiply(translation)
            .multiply(placementTransform)
            .multiply(visualCopy.transform.clone())
          : translation.multiply(visualCopy.transform.clone())
        return [{
          transform,
          opacity: visualCopy.opacity,
          colorShift: { ...visualCopy.colorShift },
        }]
      },
    }
  },
}
