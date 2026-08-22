import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  OVERLAP_BASE_BIT,
  OVERLAP_COUNT_MASK,
  OVERLAP_DONE_BIT,
  OVERLAP_MAX_ORDERS,
  OVERLAP_OWNED_BIT,
  OVERLAP_PARITY_BIT,
  OVERLAP_SHAPE_OPTIONS,
  OVERLAP_SHAPE_PASSES,
  overlapShapeCounted,
  overlapShapeFillParam,
  overlapShapeIndex,
  overlapShapeOrders,
  overlapShapePassActive,
  overlapShapePoints,
  overlapShapeScale,
} from './overlapShapeCore'

/** The passes that actually draw for a given panel state. */
function activePasses(overlapOn: boolean, orders: number) {
  return OVERLAP_SHAPE_PASSES.filter((p) => overlapShapePassActive(p, { overlapOn, orders }))
}
const nameOf = (p: { name: string; order?: number }) => (p.name === 'fill' ? `fill${p.order}` : p.name)

describe('overlap shape pass recipe', () => {
  it('runs its passes in strictly ascending, contiguous render order', () => {
    assert.deepEqual(OVERLAP_SHAPE_PASSES.map(nameOf), [
      'depth', 'mark', 'parity', 'count', 'overlap', 'base',
      'fill5', 'fill4', 'fill3', 'fill2', 'fill1',
      'depthClear', 'cleanup',
    ])
    for (let i = 1; i < OVERLAP_SHAPE_PASSES.length; i++) {
      assert.equal(
        OVERLAP_SHAPE_PASSES[i].renderOrder,
        OVERLAP_SHAPE_PASSES[i - 1].renderOrder + 1,
        `${OVERLAP_SHAPE_PASSES[i].name} must directly follow ${OVERLAP_SHAPE_PASSES[i - 1].name}`,
      )
    }
  })

  it('the four parity bits are distinct single bits, clear of the count field', () => {
    const bits = [OVERLAP_PARITY_BIT, OVERLAP_DONE_BIT, OVERLAP_BASE_BIT, OVERLAP_OWNED_BIT]
    for (const b of bits) assert.equal(b & (b - 1), 0, `bit ${b} must be a power of two`)
    assert.equal(new Set(bits).size, bits.length)
    // The whole point of the high nibble: a counted track's tally and a parity
    // track's flags can share a pixel where their shapes cross without either
    // rule reading the other's writes as its own.
    for (const b of bits) assert.equal(b & OVERLAP_COUNT_MASK, 0, `bit ${b} must miss the count field`)
    assert.equal(OVERLAP_COUNT_MASK & 0xff, OVERLAP_COUNT_MASK)
  })

  it('mark stamps the OWNED bit at the shape plane, idempotently', () => {
    const mark = OVERLAP_SHAPE_PASSES.find((p) => p.name === 'mark')!
    assert.equal(mark.depth, 'equal')
    assert.equal(mark.stencil?.func, 'always')
    assert.equal(mark.stencil?.zPass, 'replace')
    assert.equal(mark.stencil?.ref, OVERLAP_OWNED_BIT)
    assert.equal(mark.stencil?.writeMask, OVERLAP_OWNED_BIT)
  })

  it('depth-clear fires exactly on owned-but-unpainted pixels (the cutout)', () => {
    const clear = OVERLAP_SHAPE_PASSES.find((p) => p.name === 'depthClear')!
    assert.equal(clear.depth, 'clear')
    assert.equal(clear.writesColor, false)
    assert.equal(clear.stencil?.func, 'equal')
    assert.equal(clear.stencil?.ref, OVERLAP_OWNED_BIT)
    // All four bits in the mask: OWNED set, parity/DONE/BASE all clear - so an
    // occluder's footprint (no OWNED) and painted pixels are both excluded.
    assert.equal(
      clear.stencil?.funcMask,
      OVERLAP_PARITY_BIT | OVERLAP_DONE_BIT | OVERLAP_BASE_BIT | OVERLAP_OWNED_BIT,
    )
    assert.equal(clear.stencil?.zPass, 'zero')
  })

  it('draws the overlap fill BEFORE the base fill (the no-stencil degrade)', () => {
    // On a canvas without a stencil buffer every stencil test passes, so the
    // later pass wins the pixel. Base-after-overlap means such a context shows
    // a plain single-color shape instead of an all-overlap-colored one.
    const overlap = OVERLAP_SHAPE_PASSES.findIndex((p) => p.name === 'overlap')
    const base = OVERLAP_SHAPE_PASSES.findIndex((p) => p.name === 'base')
    assert.ok(overlap >= 0 && base >= 0)
    assert.ok(overlap < base)
  })

  it('every color-writing pass is depth-tested Equal and declares its depth', () => {
    const colorPasses = OVERLAP_SHAPE_PASSES.filter((p) => p.writesColor)
    assert.deepEqual(colorPasses.map(nameOf), ['overlap', 'base', 'fill5', 'fill4', 'fill3', 'fill2', 'fill1'])
    for (const pass of colorPasses) {
      assert.equal(pass.depth, 'equal')
      assert.ok((pass.order ?? 0) >= 1, `${nameOf(pass)} must say which coverage depth it paints`)
    }
  })

  it('keeps the parity toggle confined to the parity bit', () => {
    const parity = OVERLAP_SHAPE_PASSES.find((p) => p.name === 'parity')!
    assert.equal(parity.stencil?.zPass, 'invert')
    assert.equal(parity.stencil?.writeMask, OVERLAP_PARITY_BIT)
    assert.equal(parity.stencil?.func, 'always')
  })

  it('lets the overlap fill draw once per pixel: reads parity+done, marks done', () => {
    const overlap = OVERLAP_SHAPE_PASSES.find((p) => p.name === 'overlap')!
    assert.equal(overlap.stencil?.func, 'equal')
    assert.equal(overlap.stencil?.ref, 0)
    assert.equal(overlap.stencil?.funcMask, OVERLAP_PARITY_BIT | OVERLAP_DONE_BIT)
    assert.equal(overlap.stencil?.writeMask, OVERLAP_DONE_BIT)
  })

  it('base fill requires odd parity, draws once, and preserves the other bits', () => {
    const base = OVERLAP_SHAPE_PASSES.find((p) => p.name === 'base')!
    assert.equal(base.stencil?.func, 'equal')
    assert.equal(base.stencil?.ref, OVERLAP_PARITY_BIT)
    // BASE in the read mask = "not yet drawn"; BASE alone in the write mask =
    // the depth-clear pass can still tell painted pixels from cutout ones.
    assert.equal(base.stencil?.funcMask, OVERLAP_PARITY_BIT | OVERLAP_BASE_BIT)
    assert.equal(base.stencil?.zPass, 'invert')
    assert.equal(base.stencil?.writeMask, OVERLAP_BASE_BIT)
  })

  it('cleanup clears every bit under the silhouette regardless of depth', () => {
    const cleanup = OVERLAP_SHAPE_PASSES.find((p) => p.name === 'cleanup')!
    assert.equal(cleanup.depth, 'ignore')
    assert.equal(cleanup.writesColor, false)
    assert.equal(cleanup.stencil?.func, 'always')
    assert.equal(cleanup.stencil?.zPass, 'zero')
    assert.equal(cleanup.stencil?.writeMask, 0xff)
  })

  it('the count pass tallies coverage where parity would have flipped it', () => {
    const count = OVERLAP_SHAPE_PASSES.find((p) => p.name === 'count')!
    const parity = OVERLAP_SHAPE_PASSES.find((p) => p.name === 'parity')!
    // Same Equal-depth gate as parity, so it counts exactly the coplanar set.
    assert.equal(count.depth, parity.depth)
    assert.equal(count.stencil?.func, 'always')
    assert.equal(count.stencil?.zPass, 'increment')
    assert.equal(count.stencil?.writeMask, OVERLAP_COUNT_MASK)
  })

  it('counted fills run DEEPEST first, each claiming the pixel by zeroing the tally', () => {
    const fills = OVERLAP_SHAPE_PASSES.filter((p) => p.name === 'fill')
    // Descending depth is what makes coverage past the last color HOLD it:
    // the first threshold met owns the pixel, so a 9-deep stack under 2 orders
    // is caught by the depth-3 fill rather than falling through to the base.
    assert.deepEqual(fills.map((p) => p.order), [5, 4, 3, 2, 1])
    for (const fill of fills) {
      assert.equal(fill.stencil?.func, 'lequal', 'ref <= stencil: covered AT LEAST this deep')
      assert.equal(fill.stencil?.ref, fill.order)
      assert.equal(fill.stencil?.funcMask, OVERLAP_COUNT_MASK)
      // Zeroing is the once-per-pixel rule: sibling occurrences drawing the
      // same pass, and the shallower fills below, find nothing left.
      assert.equal(fill.stencil?.zPass, 'zero')
      assert.equal(fill.stencil?.writeMask, OVERLAP_COUNT_MASK)
    }
    // The no-stencil degrade again: the shallowest fill draws LAST, so a
    // context without a stencil buffer paints a plain base-colored shape.
    const indices = fills.map((p) => OVERLAP_SHAPE_PASSES.indexOf(p))
    assert.deepEqual(indices, [...indices].sort((a, b) => a - b))
    assert.equal(fills[fills.length - 1].order, 1)
  })

  it('ORDERS picks the recipe: 1 is the parity flip, 2+ counts', () => {
    assert.deepEqual(activePasses(true, 1).map(nameOf), [
      'depth', 'mark', 'parity', 'overlap', 'base', 'depthClear', 'cleanup',
    ])
    // Cut-out keeps parity whatever ORDERS says - it has no colors to grade -
    // and withholds the overlap fill so the region stays see-through.
    assert.deepEqual(activePasses(false, 4).map(nameOf), [
      'depth', 'mark', 'parity', 'base', 'depthClear', 'cleanup',
    ])
    assert.deepEqual(activePasses(true, 2).map(nameOf), [
      'depth', 'count', 'fill3', 'fill2', 'fill1', 'cleanup',
    ])
    assert.deepEqual(activePasses(true, OVERLAP_MAX_ORDERS).map(nameOf), [
      'depth', 'count', 'fill5', 'fill4', 'fill3', 'fill2', 'fill1', 'cleanup',
    ])
  })

  it('a fill deeper than the last color stands down, so that depth holds it', () => {
    // ORDERS 2 means colors for depths 2 and 3; the depth-4 and depth-5 fills
    // are dark, which is exactly how 4-deep coverage ends up wearing depth 3's
    // color rather than a color nobody picked.
    const deepest = (orders: number) => Math.max(
      ...activePasses(true, orders).filter((p) => p.name === 'fill').map((p) => p.order ?? 0),
    )
    assert.equal(deepest(2), 3)
    assert.equal(deepest(3), 4)
    assert.equal(deepest(OVERLAP_MAX_ORDERS), OVERLAP_MAX_ORDERS + 1)
  })

  it('the counted recipe needs no depth-clear: every owned pixel takes a fill', () => {
    // It only runs in COLOR mode, where the depth-1 fill catches whatever the
    // deeper ones did not - so there is no owned-but-unpainted region to punch
    // through, and firing the clear would blow a hole in painted depth.
    assert.ok(!activePasses(true, 3).some((p) => p.name === 'depthClear'))
    assert.ok(activePasses(true, 3).some((p) => p.name === 'fill' && p.order === 1))
  })

  it('the two recipes share only the prepass and the cleanup', () => {
    const shared = OVERLAP_SHAPE_PASSES.filter((p) => p.recipe === 'both').map((p) => p.name)
    assert.deepEqual(shared, ['depth', 'cleanup'])
    // Cleanup runs after every fill of either recipe, so a track cannot wipe
    // its neighbour's tally mid-flight.
    const cleanup = OVERLAP_SHAPE_PASSES.findIndex((p) => p.name === 'cleanup')
    assert.equal(cleanup, OVERLAP_SHAPE_PASSES.length - 1)
  })

  it('orders clamp to the shipped range, and each depth names its own color param', () => {
    assert.equal(overlapShapeOrders(0), 1)
    assert.equal(overlapShapeOrders(2.4), 2)
    assert.equal(overlapShapeOrders(99), OVERLAP_MAX_ORDERS)
    assert.equal(overlapShapeOrders(Number.NaN), 1)
    assert.equal(overlapShapeCounted(true, 1), false)
    assert.equal(overlapShapeCounted(true, 2), true)
    assert.equal(overlapShapeCounted(false, 4), false)
    // Depth 2 is the color that shipped, so its key keeps its old name - the
    // rest are keyed by the depth they paint.
    assert.deepEqual(
      [1, 2, 3, 4, 5].map(overlapShapeFillParam),
      ['baseColor', 'overlapColor', 'overlapColor3', 'overlapColor4', 'overlapColor5'],
    )
  })

  it('only the depth prepass writes depth', () => {
    for (const pass of OVERLAP_SHAPE_PASSES) {
      assert.equal(pass.depth === 'prepass', pass.name === 'depth')
    }
  })
})

describe('overlap shape vocabulary', () => {
  it('exposes six shapes with contiguous select values', () => {
    assert.equal(OVERLAP_SHAPE_OPTIONS.length, 6)
    OVERLAP_SHAPE_OPTIONS.forEach((option, i) => assert.equal(option.value, i))
  })

  it('clamps and rounds arbitrary param values to a valid index', () => {
    assert.equal(overlapShapeIndex(-3), 0)
    assert.equal(overlapShapeIndex(2.4), 2)
    assert.equal(overlapShapeIndex(2.6), 3)
    assert.equal(overlapShapeIndex(99), OVERLAP_SHAPE_OPTIONS.length - 1)
    assert.equal(overlapShapeIndex(Number.NaN), 0)
  })

  it('outlines have the expected vertex counts', () => {
    const counts = OVERLAP_SHAPE_OPTIONS.map((o) => overlapShapePoints(o.value).length)
    assert.deepEqual(counts, [96, 3, 4, 5, 6, 10])
  })

  it('every outline stays within the unit radius', () => {
    for (const option of OVERLAP_SHAPE_OPTIONS) {
      for (const [x, y] of overlapShapePoints(option.value)) {
        assert.ok(Math.hypot(x, y) <= 1 + 1e-9)
      }
    }
  })

  it('polygons start at the top vertex; the square sits axis-aligned', () => {
    for (const value of [1, 3, 4, 5]) {
      const [x, y] = overlapShapePoints(value)[0]
      assert.ok(Math.abs(x) < 1e-9, `shape ${value} first vertex x`)
      assert.ok(Math.abs(y - 1) < 1e-9, `shape ${value} first vertex y`)
    }
    const [sx, sy] = overlapShapePoints(2)[0]
    assert.ok(Math.abs(sx - sy) < 1e-9 && sx > 0, 'square first vertex on the 45° diagonal')
  })

  it('the star alternates outer and inner radii', () => {
    const radii = overlapShapePoints(5).map(([x, y]) => Math.hypot(x, y))
    radii.forEach((r, i) => {
      if (i % 2 === 0) assert.ok(Math.abs(r - 1) < 1e-9)
      else assert.ok(r < 0.6)
    })
  })
})

describe('overlap shape scale', () => {
  it('swells from SIZE by energy × PULSE and never collapses to zero', () => {
    assert.equal(overlapShapeScale(2, 0, 0.5), 2)
    assert.equal(overlapShapeScale(2, 1, 0.5), 3)
    assert.ok(overlapShapeScale(0, 0, 0) > 0)
  })
})
