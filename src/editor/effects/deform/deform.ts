// Deformer: one device covering the classic mesh-deformer vocabulary -
// Twist, Bend, Taper, Shear, Bulge, Wave, Ripple, Inflate, Spherify, Pinch,
// Melt, Jitter - times four self-running DRIVE clocks times four spatial
// FALLOFFS, from three selects.
//
// Why one plugin rather than twelve: every operation reads the same handful of
// knobs (a strength, an axis, an angle or an amount, a width), so switching
// operations keeps a dialled-in setting meaningful instead of resetting the
// device - and twelve entries in the add menu would bury everything else in it.
// Same call `mover` made for the (translate|rotate|orbit) x
// (burst|constant|oscillate) matrix, and Fundamental Geometry for its twelve
// solids.
//
// Two things worth knowing before reaching for it:
//
// - It is a VERTEX effect, so it inherits MaterialWrapper's injection limit:
//   instruments drawing with their own raw ShaderMaterial (LaserSphere,
//   FractalTunnel, Stars, Wormhole, DotField, ShapeFlight) are left untouched.
//   For those, nothing here applies and nothing breaks.
// - It has no MIDI vocabulary, because an effect is handed `(settings, beat)`
//   and never sees notes. The four drives are self-running clocks; note-shaped
//   control is an automation lane on `strength`, which already has burst, cycle
//   and noise modes. Passive by default, played by automation - the same divide
//   as the Gradient colorizer against the note Colorizer.

import type { VisualEffect } from '../types'
import { deformFieldGlsl } from './deformField'
import {
  DEFORM_AXIS_Y,
  DEFORM_DRIVES,
  DEFORM_FALLOFFS,
  DEFORM_OPERATIONS,
  DEFORM_TWIST,
  DRIVE_STATIC,
  FALLOFF_NONE,
} from './deformOps'

export const DEFORM_PLUGIN_ID = 'deform'

/** The device's accent, worn by its console and its preview. Declared beside the
 *  plugin rather than in the panel for the reason `identityColors.ts` exists on
 *  the mover side: one definition, one colour, no drift between the two files. */
export const DEFORM_ACCENT = '#e0794f'

export const deformPlugin: VisualEffect = {
  id: DEFORM_PLUGIN_ID,
  name: 'Deformer',
  category: 'deform',
  params: [
    {
      key: 'operation',
      label: 'Operation',
      type: 'select',
      options: DEFORM_OPERATIONS.map((op) => ({ value: op.value, label: op.label })),
      default: DEFORM_TWIST,
    },
    {
      key: 'drive',
      label: 'Drive',
      type: 'select',
      options: DEFORM_DRIVES.map((d) => ({ value: d.value, label: d.label })),
      default: DRIVE_STATIC,
    },
    {
      key: 'falloff',
      label: 'Falloff',
      type: 'select',
      options: DEFORM_FALLOFFS.map((f) => ({ value: f.value, label: f.label })),
      default: FALLOFF_NONE,
    },
    // The master. Every operation multiplies by it, so it is the one knob worth
    // reaching for first and the natural target for an automation lane.
    { key: 'strength', label: 'Strength', min: 0, max: 2, step: 0.01, default: 1 },
    {
      key: 'axis',
      label: 'Axis',
      type: 'select',
      options: [
        { value: 0, label: 'X' },
        { value: 1, label: 'Y' },
        { value: 2, label: 'Z' },
      ],
      default: DEFORM_AXIS_Y,
    },
    { key: 'angle', label: 'Angle (°)', min: -720, max: 720, step: 1, default: 180 },
    { key: 'amount', label: 'Amount', min: -2, max: 2, step: 0.01, default: 0.6 },
    { key: 'center', label: 'Center', min: -2, max: 2, step: 0.01, default: 0 },
    { key: 'width', label: 'Width', min: 0.05, max: 3, step: 0.01, default: 0.6 },
    { key: 'wavelength', label: 'Wavelength', min: 0.05, max: 4, step: 0.01, default: 1 },
    { key: 'phase', label: 'Phase', min: 0, max: 1, step: 0.01, default: 0 },
    { key: 'radius', label: 'Radius', min: 0.1, max: 3, step: 0.01, default: 1 },
    { key: 'seed', label: 'Seed', min: 0, max: 999, step: 1, default: 0 },
    // Cycles per beat, so a rate of 1 lands one pulse (or one full oscillation)
    // on every beat however the project's tempo moves.
    { key: 'rate', label: 'Rate (cyc/beat)', min: 0, max: 8, step: 0.05, default: 1 },
    { key: 'falloffSize', label: 'Falloff size', min: 0.05, max: 8, step: 0.05, default: 2 },
    { key: 'falloffOffset', label: 'Falloff offset', min: -4, max: 4, step: 0.05, default: 0 },
    { key: 'falloffSoftness', label: 'Falloff softness', min: 0, max: 1, step: 0.01, default: 0.5 },
    // Subdivision level, applied on the CPU before the shader ever sees the mesh
    // (see subdivideCore.ts for why a deformer cannot do without it). Costs
    // 4^detail triangles, so the default is the lowest level at which a twisted
    // cube reads as twisted rather than skewed.
    { key: 'detail', label: 'Detail', min: 0, max: 4, step: 1, default: 3 },
  ],
  vertexField: deformFieldGlsl,
  subdivideParam: 'detail',
}
