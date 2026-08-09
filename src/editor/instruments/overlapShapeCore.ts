// Pure math for the Overlap Shape instrument: the shape vocabulary (unit-radius
// outlines shared by the mesh geometry, the settings panel's preview, and the
// library icon) and the five-pass stencil recipe that implements its one trick -
// wherever two shapes cover the same pixel AT THE SAME DEPTH, the overlap region
// renders as a cutout (pure transparency) or as a second color, XOR-style.
//
// How the recipe works (each pass is one mesh per occurrence, ordered by
// renderOrder so passes interleave ACROSS occurrences - that is what makes
// splitter/mover copies, and even two Overlap Shape tracks, overlap each other):
//
//   1. depth    - writes only the depth buffer. After every occurrence has run,
//                 the depth buffer holds the FRONTMOST shape surface per pixel.
//   2. parity   - depthFunc Equal against that prepass, inverting stencil bit 0
//                 per covering shape. Equal-depth is the "same axis" rule: two
//                 coplanar shapes share a depth value at every shared pixel, so
//                 both toggle the bit; a shape at a different depth fails the
//                 test and simply occludes (or is occluded) like any opaque
//                 object. Odd coverage leaves bit 0 = 1, even leaves 0.
//   3. overlap  - fills the even-covered region (the overlap) with the overlap
//                 color, marking bit 1 so a second covering shape can't double-
//                 draw it. Hidden entirely in "cut out" mode - nothing is drawn,
//                 so the region stays whatever the scene already rendered there.
//   4. base     - fills the odd-covered region with the base color and zeroes
//                 the stencil behind itself (idempotent across occurrences).
//   5. cleanup  - zeroes every stencil bit under the shape's silhouette so the
//                 next track (or next frame's front pass) starts clean.
//
// The overlap pass runs BEFORE the base pass on purpose: on a context with no
// stencil buffer (the library's live-preview canvas) every stencil test passes,
// so the base fill simply paints over the overlap fill and the shape degrades to
// a plain single-color silhouette instead of an all-overlap-colored one.
// overlapShapeCore.test.ts pins all of these orderings and masks.

export const OVERLAP_PARITY_BIT = 0x01
export const OVERLAP_DONE_BIT = 0x02

/** Render-order base for the pass stack. Above the default 0 so the depth
 *  prepass sees the scene's ordinary opaque objects already in the buffer,
 *  below the shader-overlay planes (ShaderWrapper draws at 999). */
export const OVERLAP_SHAPE_RENDER_ORDER = 20

export interface OverlapShapePass {
  name: 'depth' | 'parity' | 'overlap' | 'base' | 'cleanup'
  renderOrder: number
  writesColor: boolean
  /** prepass = write depth (LessEqual); equal = test-only against the prepass;
   *  ignore = no depth test at all (the cleanup must reach occluded pixels). */
  depth: 'prepass' | 'equal' | 'ignore'
  stencil?: {
    func: 'always' | 'equal'
    ref: number
    funcMask: number
    zPass: 'invert' | 'zero'
    writeMask: number
  }
}

export const OVERLAP_SHAPE_PASSES: readonly OverlapShapePass[] = [
  {
    name: 'depth',
    renderOrder: OVERLAP_SHAPE_RENDER_ORDER,
    writesColor: false,
    depth: 'prepass',
  },
  {
    name: 'parity',
    renderOrder: OVERLAP_SHAPE_RENDER_ORDER + 1,
    writesColor: false,
    depth: 'equal',
    stencil: { func: 'always', ref: 0, funcMask: 0xff, zPass: 'invert', writeMask: OVERLAP_PARITY_BIT },
  },
  {
    name: 'overlap',
    renderOrder: OVERLAP_SHAPE_RENDER_ORDER + 2,
    writesColor: true,
    depth: 'equal',
    // Passes only where coverage is even AND not yet filled (both bits 0);
    // inverting the done bit under writeMask 0x02 marks the pixel filled.
    stencil: {
      func: 'equal',
      ref: 0,
      funcMask: OVERLAP_PARITY_BIT | OVERLAP_DONE_BIT,
      zPass: 'invert',
      writeMask: OVERLAP_DONE_BIT,
    },
  },
  {
    name: 'base',
    renderOrder: OVERLAP_SHAPE_RENDER_ORDER + 3,
    writesColor: true,
    depth: 'equal',
    // Odd parity only; zeroing behind itself makes a triple-covered region
    // draw once, not three times (which would double-blend under a fade).
    stencil: { func: 'equal', ref: 1, funcMask: OVERLAP_PARITY_BIT, zPass: 'zero', writeMask: 0xff },
  },
  {
    name: 'cleanup',
    renderOrder: OVERLAP_SHAPE_RENDER_ORDER + 4,
    writesColor: false,
    depth: 'ignore',
    stencil: { func: 'always', ref: 0, funcMask: 0xff, zPass: 'zero', writeMask: 0xff },
  },
]

// ── The shape vocabulary ────────────────────────────────────────────────────

export interface OverlapShapeOption {
  value: number
  label: string
  /** Segmented-control caption (the panel's six segments leave no room for words). */
  short: string
}

export const OVERLAP_SHAPE_OPTIONS: readonly OverlapShapeOption[] = [
  { value: 0, label: 'Circle', short: 'CIRC' },
  { value: 1, label: 'Triangle', short: 'TRI' },
  { value: 2, label: 'Square', short: 'SQR' },
  { value: 3, label: 'Pentagon', short: 'PENT' },
  { value: 4, label: 'Hexagon', short: 'HEX' },
  { value: 5, label: 'Star', short: 'STAR' },
]

/** A param value (possibly automated off-grid) to a valid shape index. */
export function overlapShapeIndex(value: number): number {
  const i = Math.round(value)
  return Math.max(0, Math.min(OVERLAP_SHAPE_OPTIONS.length - 1, Number.isFinite(i) ? i : 0))
}

const CIRCLE_SEGMENTS = 96
const STAR_POINTS = 5
const STAR_INNER_RADIUS = 0.45

function ring(count: number, radiusAt: (i: number) => number, startAngle: number): [number, number][] {
  return Array.from({ length: count }, (_, i) => {
    const a = startAngle + (i * 2 * Math.PI) / count
    const r = radiusAt(i)
    return [Math.cos(a) * r, Math.sin(a) * r]
  })
}

/**
 * The unit-radius outline of a shape, counter-clockwise, y up. Polygons start
 * at the top vertex (the square at 45° so it sits axis-aligned rather than as
 * a diamond); the star alternates outer/inner radii. One source for the mesh
 * geometry, the panel preview and the icon, so they can never disagree.
 */
export function overlapShapePoints(shape: number): [number, number][] {
  switch (overlapShapeIndex(shape)) {
    case 0: return ring(CIRCLE_SEGMENTS, () => 1, Math.PI / 2)
    case 1: return ring(3, () => 1, Math.PI / 2)
    case 2: return ring(4, () => 1, Math.PI / 4)
    case 3: return ring(5, () => 1, Math.PI / 2)
    case 4: return ring(6, () => 1, Math.PI / 2)
    default:
      return ring(STAR_POINTS * 2, (i) => (i % 2 === 0 ? 1 : STAR_INNER_RADIUS), Math.PI / 2)
  }
}

/** Mesh scale: SIZE swelled by the shared note-pulse energy, PULSE = how far. */
export function overlapShapeScale(size: number, energy: number, pulse: number): number {
  return Math.max(0.0001, size) * (1 + energy * pulse)
}
