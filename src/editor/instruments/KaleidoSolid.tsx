import type { FundamentalGeometryId } from './FundamentalGeometry'
import type { ObjectInstrumentDef } from './types'
import { lazyInstrument } from './lazyInstrument'

/**
 * Kaleido Solid: a solid whose SURFACE is a live kaleidoscope.
 *
 * The pattern is generated in OBJECT space, so it is bolted to the surface -
 * it turns and travels with the mesh instead of sliding across it as the object
 * moves. Object space rather than UV space on purpose: a cube's UV seams would
 * tear the pattern into six unrelated tiles, and object space has no seams at
 * all, so one field works for every solid in the vocabulary.
 *
 * Nothing here is a preset or a baked image. The shards continuously grow and
 * shrink, drift within their cells, morph between 3 and 7 sides, and each one
 * cycles its own hue - so the surface never settles into a fixed texture.
 *
 * The field is injected into a MeshPhysicalMaterial rather than drawn with a raw
 * ShaderMaterial, so the scene's real lights, clearcoat and shadows still model
 * the form; the kaleidoscope supplies base colour and tints the emissive glow.
 *
 * The visual itself lives in ./KaleidoSolidVisual (lazy: fetched when a project
 * mounts one); this file is the def - params, rows, and nothing heavy.
 */

/** Sphere shows the mandala most clearly, so it is the shape the instrument
 *  arrives as. Must match the `geometry` param default below AND the initial
 *  `visible` flag on the meshes. */
export const DEFAULT_GEOMETRY: FundamentalGeometryId = 'sphere'

export const kaleidoSolidInstrument: ObjectInstrumentDef = {
  id: 'kaleidoSolid',
  name: 'Kaleido Solid',
  kind: 'object',
  userInterfaceRenderer: 'kaleidoSolid',
  // Position and size are the canonical track transform (core/transform.ts), so
  // these are behaviour only. Four knobs on purpose - everything else that makes
  // the surface live is derived in the shader.
  params: [
    { key: 'geometry', label: 'Geometry', type: 'string', default: DEFAULT_GEOMETRY },
    // Floored in the shader: automation lanes interpolate continuously and a
    // fractional wedge count tears the fold at the wrap seam.
    { key: 'facets', label: 'Facets', min: 2, max: 16, step: 1, default: 6 },
    { key: 'scale', label: 'Scale', min: 0.3, max: 3, step: 0.05, default: 1 },
    { key: 'drift', label: 'Drift', min: 0, max: 2, step: 0.05, default: 0.6 },
    { key: 'hue', label: 'Hue', min: 0, max: 6.28, step: 0.05, default: 0 },
  ],
  // A note flicks the kaleidoscope's barrel: the pattern lurches to a new
  // arrangement and settles. Pitch picks the coarse size of the flick.
  midiRows: [
    { pitch: 76, label: 'Twist · hard', emphasized: true },
    { pitch: 68, label: 'Twist · strong' },
    { pitch: 60, label: 'Twist · medium' },
    { pitch: 52, label: 'Twist · soft' },
    { pitch: 44, label: 'Twist · nudge' },
  ],
  component: lazyInstrument(() => import('./KaleidoSolidVisual').then((m) => m.KaleidoSolid)),
}
