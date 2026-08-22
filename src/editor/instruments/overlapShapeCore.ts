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

import { gradientStops } from '../utils/oklch'

// The parity recipe's four flags live in the HIGH nibble so the counted
// recipe's tally can own the LOW one outright: a count is ARITHMETIC (the
// increment carries), so it cannot be shifted into spare high bits the way a
// flag can, and two tracks running different recipes must not scribble on each
// other's meaning where their shapes cross.
export const OVERLAP_PARITY_BIT = 0x10
export const OVERLAP_DONE_BIT = 0x20
export const OVERLAP_BASE_BIT = 0x40
export const OVERLAP_OWNED_BIT = 0x80

/** The counted recipe's tally field: coverage depth, 0-15. A 16th coplanar
 *  shape wraps the nibble back to 0 (the write mask keeps the carry out of the
 *  parity flags), which reads as uncovered - the honest ceiling of counting in
 *  four bits, and far past any formation worth colouring. */
export const OVERLAP_COUNT_MASK = 0x0f

/** How many overlap colours the instrument can hold past the base one, i.e.
 *  coverage depths 2 … OVERLAP_MAX_ORDERS + 1. */
export const OVERLAP_MAX_ORDERS = 4

/** Render-order base for the pass stack. Above the default 0 so the depth
 *  prepass sees the scene's ordinary opaque objects already in the buffer,
 *  below the shader-overlay planes (ShaderWrapper draws at 999). */
export const OVERLAP_SHAPE_RENDER_ORDER = 20

export interface OverlapShapePass {
  name: 'depth' | 'mark' | 'parity' | 'count' | 'overlap' | 'base' | 'fill' | 'depthClear' | 'cleanup'
  /** Which rule this pass serves. Both recipes are MOUNTED at once and one is
   *  made visible per frame (see `overlapShapePassActive`): the pass list is
   *  the mesh list, and rebuilding meshes from a param would mean re-rendering
   *  React per frame - the engine's invariant 4. */
  recipe: 'parity' | 'counted' | 'both'
  /** For a colour-writing pass: the coverage depth it paints. 1 = the lone
   *  shape (the base colour), 2 = two shapes crossing, and so on. */
  order?: number
  renderOrder: number
  writesColor: boolean
  /** prepass = write depth (LessEqual); equal = test-only against the prepass;
   *  clear = write FAR depth via gl_FragDepth (depth test Always, so the write
   *  lands - the stencil gate decides where); ignore = no depth test at all
   *  (the cleanup must reach occluded pixels). */
  depth: 'prepass' | 'equal' | 'clear' | 'ignore'
  stencil?: {
    /** GL puts the REFERENCE on the left: `lequal` passes where ref <= stencil,
     *  which is how a fill says "covered at least this deep". */
    func: 'always' | 'equal' | 'lequal'
    ref: number
    funcMask: number
    zPass: 'invert' | 'zero' | 'replace' | 'increment'
    writeMask: number
  }
}

/** The counted recipe's fill for coverage depth `order`: paint where the tally
 *  has reached at least `order`, then ZERO the tally. Zeroing is what makes one
 *  pixel take exactly one fill - the sibling occurrences drawing the same pass
 *  find nothing left to paint, and the shallower fills below skip it too. That
 *  is also why the fills run DEEPEST FIRST: the first one whose threshold is
 *  met owns the pixel, so depths past the last colour hold that colour instead
 *  of falling through to the base. */
function countedFill(order: number, renderOrder: number): OverlapShapePass {
  return {
    name: 'fill',
    recipe: 'counted',
    order,
    renderOrder,
    writesColor: true,
    depth: 'equal',
    stencil: {
      func: 'lequal',
      ref: order,
      funcMask: OVERLAP_COUNT_MASK,
      zPass: 'zero',
      writeMask: OVERLAP_COUNT_MASK,
    },
  }
}

export const OVERLAP_SHAPE_PASSES: readonly OverlapShapePass[] = [
  {
    name: 'depth',
    recipe: 'both',
    renderOrder: OVERLAP_SHAPE_RENDER_ORDER,
    writesColor: false,
    depth: 'prepass',
  },
  {
    name: 'mark',
    recipe: 'parity',
    renderOrder: OVERLAP_SHAPE_RENDER_ORDER + 1,
    writesColor: false,
    depth: 'equal',
    // Replace writes ref & writeMask, so ref doubles as the OWNED bit value;
    // re-marking by later coplanar shapes is idempotent.
    stencil: { func: 'always', ref: OVERLAP_OWNED_BIT, funcMask: 0xff, zPass: 'replace', writeMask: OVERLAP_OWNED_BIT },
  },
  {
    name: 'parity',
    recipe: 'parity',
    renderOrder: OVERLAP_SHAPE_RENDER_ORDER + 2,
    writesColor: false,
    depth: 'equal',
    stencil: { func: 'always', ref: 0, funcMask: 0xff, zPass: 'invert', writeMask: OVERLAP_PARITY_BIT },
  },
  {
    // The counted recipe's answer to `parity`: tally coverage instead of
    // toggling it. Same Equal-depth gate, so it counts exactly the coplanar
    // set the parity bit would have flipped.
    name: 'count',
    recipe: 'counted',
    renderOrder: OVERLAP_SHAPE_RENDER_ORDER + 3,
    writesColor: false,
    depth: 'equal',
    stencil: { func: 'always', ref: 0, funcMask: 0xff, zPass: 'increment', writeMask: OVERLAP_COUNT_MASK },
  },
  {
    name: 'overlap',
    recipe: 'parity',
    order: 2,
    renderOrder: OVERLAP_SHAPE_RENDER_ORDER + 4,
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
    recipe: 'parity',
    order: 1,
    renderOrder: OVERLAP_SHAPE_RENDER_ORDER + 5,
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
  // The counted fills, DEEPEST FIRST - see countedFill. The deepest ones sit
  // idle until ORDERS reaches them (a hidden fill is exactly "this depth holds
  // the colour above it"), and the shallowest, depth 1, is the counted
  // recipe's base fill.
  ...Array.from({ length: OVERLAP_MAX_ORDERS + 1 }, (_, i) =>
    countedFill(OVERLAP_MAX_ORDERS + 1 - i, OVERLAP_SHAPE_RENDER_ORDER + 6 + i)),
  {
    name: 'depthClear',
    recipe: 'parity',
    renderOrder: OVERLAP_SHAPE_RENDER_ORDER + 6 + OVERLAP_MAX_ORDERS + 1,
    writesColor: false,
    depth: 'clear',
    // Exactly OWNED across all four bits = our plane, nothing painted = a
    // cutout. Zeroing as it clears retires the pixel so sibling depth-clear
    // passes skip it. The counted recipe needs no such pass: it only runs in
    // colour mode, where every owned pixel takes a fill.
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
    recipe: 'both',
    renderOrder: OVERLAP_SHAPE_RENDER_ORDER + 6 + OVERLAP_MAX_ORDERS + 2,
    writesColor: false,
    depth: 'ignore',
    stencil: { func: 'always', ref: 0, funcMask: 0xff, zPass: 'zero', writeMask: 0xff },
  },
]

/** How many overlap colours are in play: 1 is the parity flip the instrument
 *  shipped with, 2+ switches the whole track to the counted recipe. */
export function overlapShapeOrders(value: number): number {
  const n = Math.round(value)
  return Math.max(1, Math.min(OVERLAP_MAX_ORDERS, Number.isFinite(n) ? n : 1))
}

/** Whether the counted recipe (per-depth colours) is the one running: colour
 *  mode with more than one overlap colour. Cut-out has no colours to grade, so
 *  it always keeps the parity rule. */
export function overlapShapeCounted(overlapOn: boolean, orders: number): boolean {
  return overlapOn && overlapShapeOrders(orders) > 1
}

/**
 * Which of the mounted passes draw this frame. Both recipes hang off one mesh
 * list (the type's note on `recipe` says why), so this is the switch between
 * them - plus the two gates inside a recipe: the parity overlap fill is what
 * cut-out mode withholds, and a counted fill deeper than the last colour stays
 * dark so its depth holds that colour.
 */
export function overlapShapePassActive(
  pass: OverlapShapePass,
  { overlapOn, orders }: { overlapOn: boolean; orders: number },
): boolean {
  const counted = overlapShapeCounted(overlapOn, orders)
  if (pass.recipe === 'parity' && counted) return false
  if (pass.recipe === 'counted' && !counted) return false
  if (pass.name === 'overlap') return overlapOn
  if (pass.name === 'fill') return (pass.order ?? 1) <= overlapShapeOrders(orders) + 1
  return true
}

/** The instrument's colour param a fill pass paints with in PER-DEPTH mode:
 *  depth 1 is the shape itself, and each depth past it wears its own overlap
 *  colour. Returned as a param KEY so the caller reads the shifted value the
 *  frame already resolved. */
export function overlapShapeFillParam(order: number): string {
  return order <= 1 ? 'baseColor' : order === 2 ? 'overlapColor' : `overlapColor${order}`
}

/** How the overlap depths get their colours. GRADIENT is the primary one: two
 *  ends and the depths between them are the ramp. */
export const OVERLAP_RAMP_GRADIENT = 0
export const OVERLAP_RAMP_PER_DEPTH = 1

/**
 * Every coverage depth's colour, indexed by depth − 1 (so entry 0 is the lone
 * shape's own colour and entry k−1 is what k crossing shapes wear). ONE
 * function for the fills, the panel's swatches and its preview, so the picture,
 * the ramp strip and the pixels cannot disagree.
 *
 * The ramp spans the OVERLAP depths only — it starts at the first overlap
 * colour, not at the shape's own. Running it from the base would make two
 * crossing shapes nearly the colour of one, which is the one thing an overlap
 * colour exists to avoid. `gradientStops` walks OKLCH and keeps both endpoints
 * literal, so the first and last depth are exactly the two picked colours.
 *
 * `read` hands back a resolved hex for a param key — each host has its own idea
 * of what an absent value falls back to (the frame's shifted string params vs
 * the panel's bindings), and neither is this module's business.
 */
export function overlapShapeDepthColors(
  orders: number,
  gradient: boolean,
  read: (key: string) => string,
): string[] {
  const count = overlapShapeOrders(orders)
  const base = read('baseColor')
  // One overlap colour is the parity flip, where a ramp has nothing to span.
  if (count <= 1) return [base, read('overlapColor')]
  if (gradient) return [base, ...gradientStops(read('overlapColor'), read('overlapColorDeep'), count)]
  return [base, ...Array.from({ length: count }, (_, i) => read(overlapShapeFillParam(i + 2)))]
}

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
