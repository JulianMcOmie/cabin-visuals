// Pure math for the Overlap Shape instrument: the shape vocabulary (unit-radius
// outlines shared by the mesh geometry, the settings panel's preview, and the
// library icon) and the seven-pass stencil recipe that implements its one trick -
// wherever two shapes cover the same pixel AT THE SAME DEPTH, the overlap region
// renders as a cutout (pure transparency) or as a second color, XOR-style.
//
// How the recipe works (each pass is one mesh per occurrence, ordered by
// renderOrder so passes interleave ACROSS occurrences - that is what makes
// splitter/mover copies, and even two Overlap Shape tracks, overlap each other):
//
//   1. depth      - writes only the depth buffer. After every occurrence has
//                   run, the depth buffer holds the FRONTMOST shape surface per
//                   pixel.
//   2. mark       - depthFunc Equal against that prepass, setting the OWNED bit:
//                   "the depth at this pixel is OUR plane, not some occluder's".
//                   The depth-clear pass below keys on it - without the mark, a
//                   nearer object overlapping the silhouette would get its depth
//                   wiped too.
//   3. parity     - also Equal, inverting the parity bit per covering shape.
//                   Equal-depth is the "same axis" rule: coplanar shapes share a
//                   depth value at every shared pixel, so each toggles the bit;
//                   a shape at a different depth fails the test and simply
//                   occludes (or is occluded) like any opaque object. Odd
//                   coverage leaves parity 1, even leaves 0.
//   4. overlap    - fills the even-covered region (the overlap) with the overlap
//                   color, marking DONE so a second covering shape can't double-
//                   draw it. Hidden entirely in "cut out" mode - nothing is
//                   drawn, so the region stays whatever the scene already
//                   rendered there.
//   5. base       - fills the odd-covered region with the base color, marking
//                   BASE so it draws once however many shapes cover the pixel.
//   6. depthClear - the pass that makes a cutout ACTUALLY transparent: where the
//                   plane is owned but nothing was painted (stencil == OWNED
//                   exactly), it writes FAR depth via gl_FragDepth. Without it
//                   the prepass footprint keeps occluding, and everything three
//                   draws after these passes - the whole transparent render list
//                   (lasers, particles, water drops) - vanishes behind the hole.
//                   Painted regions keep their depth: they are opaque surfaces.
//   7. cleanup    - zeroes every stencil bit under the shape's silhouette so the
//                   next track (or next frame's front pass) starts clean.
//
// The overlap pass runs BEFORE the base pass on purpose: on a context with no
// stencil buffer every stencil test passes, so the base fill simply paints over
// the overlap fill and the shape degrades to a plain single-color silhouette
// instead of an all-overlap-colored one. (In that degrade the depth-clear also
// fires across the whole silhouette - the lone-shape previews it affects don't
// depth-sort against anything, so it stays invisible.)
// overlapShapeCore.test.ts pins all of these orderings and masks.

export const OVERLAP_PARITY_BIT = 0x01
export const OVERLAP_DONE_BIT = 0x02
export const OVERLAP_BASE_BIT = 0x04
export const OVERLAP_OWNED_BIT = 0x08

/** Render-order base for the pass stack. Above the default 0 so the depth
 *  prepass sees the scene's ordinary opaque objects already in the buffer,
 *  below the shader-overlay planes (ShaderWrapper draws at 999). */
export const OVERLAP_SHAPE_RENDER_ORDER = 20

export interface OverlapShapePass {
  name: 'depth' | 'mark' | 'parity' | 'overlap' | 'base' | 'depthClear' | 'cleanup'
  renderOrder: number
  writesColor: boolean
  /** prepass = write depth (LessEqual); equal = test-only against the prepass;
   *  clear = write FAR depth via gl_FragDepth (depth test Always, so the write
   *  lands - the stencil gate decides where); ignore = no depth test at all
   *  (the cleanup must reach occluded pixels). */
  depth: 'prepass' | 'equal' | 'clear' | 'ignore'
  stencil?: {
    func: 'always' | 'equal'
    ref: number
    funcMask: number
    zPass: 'invert' | 'zero' | 'replace'
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
    name: 'mark',
    renderOrder: OVERLAP_SHAPE_RENDER_ORDER + 1,
    writesColor: false,
    depth: 'equal',
    // Replace writes ref & writeMask, so ref doubles as the OWNED bit value;
    // re-marking by later coplanar shapes is idempotent.
    stencil: { func: 'always', ref: OVERLAP_OWNED_BIT, funcMask: 0xff, zPass: 'replace', writeMask: OVERLAP_OWNED_BIT },
  },
  {
    name: 'parity',
    renderOrder: OVERLAP_SHAPE_RENDER_ORDER + 2,
    writesColor: false,
    depth: 'equal',
    stencil: { func: 'always', ref: 0, funcMask: 0xff, zPass: 'invert', writeMask: OVERLAP_PARITY_BIT },
  },
  {
    name: 'overlap',
    renderOrder: OVERLAP_SHAPE_RENDER_ORDER + 3,
    writesColor: true,
    depth: 'equal',
    // Passes only where coverage is even AND not yet filled (parity and DONE
    // both 0 - the OWNED bit is excluded from the mask); inverting DONE under
    // its own writeMask marks the pixel filled so siblings can't double-draw.
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
    renderOrder: OVERLAP_SHAPE_RENDER_ORDER + 4,
    writesColor: true,
    depth: 'equal',
    // Odd parity, not yet drawn (BASE still 0); setting BASE makes a triple-
    // covered region draw once, not three times (which would double-blend
    // under a fade) - and distinguishes "painted" from "cutout" for the
    // depth-clear pass, which a plain zeroing zPass could not.
    stencil: {
      func: 'equal',
      ref: OVERLAP_PARITY_BIT,
      funcMask: OVERLAP_PARITY_BIT | OVERLAP_BASE_BIT,
      zPass: 'invert',
      writeMask: OVERLAP_BASE_BIT,
    },
  },
  {
    name: 'depthClear',
    renderOrder: OVERLAP_SHAPE_RENDER_ORDER + 5,
    writesColor: false,
    depth: 'clear',
    // Exactly OWNED across all four bits = our plane, nothing painted = a
    // cutout. Zeroing as it clears retires the pixel so sibling depth-clear
    // passes skip it.
    stencil: {
      func: 'equal',
      ref: OVERLAP_OWNED_BIT,
      funcMask: OVERLAP_PARITY_BIT | OVERLAP_DONE_BIT | OVERLAP_BASE_BIT | OVERLAP_OWNED_BIT,
      zPass: 'zero',
      writeMask: 0xff,
    },
  },
  {
    name: 'cleanup',
    renderOrder: OVERLAP_SHAPE_RENDER_ORDER + 6,
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
