import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  OVERLAP_BASE_BIT,
  OVERLAP_DONE_BIT,
  OVERLAP_OWNED_BIT,
  OVERLAP_PARITY_BIT,
  OVERLAP_SHAPE_OPTIONS,
  OVERLAP_SHAPE_PASSES,
  overlapShapeIndex,
  overlapShapePoints,
  overlapShapeScale,
} from './overlapShapeCore'

describe('overlap shape pass recipe', () => {
  it('runs its seven passes in strictly ascending, contiguous render order', () => {
    assert.deepEqual(
      OVERLAP_SHAPE_PASSES.map((p) => p.name),
      ['depth', 'mark', 'parity', 'overlap', 'base', 'depthClear', 'cleanup'],
    )
    for (let i = 1; i < OVERLAP_SHAPE_PASSES.length; i++) {
      assert.equal(
        OVERLAP_SHAPE_PASSES[i].renderOrder,
        OVERLAP_SHAPE_PASSES[i - 1].renderOrder + 1,
        `${OVERLAP_SHAPE_PASSES[i].name} must directly follow ${OVERLAP_SHAPE_PASSES[i - 1].name}`,
      )
    }
  })

  it('the four stencil bits are distinct single bits', () => {
    const bits = [OVERLAP_PARITY_BIT, OVERLAP_DONE_BIT, OVERLAP_BASE_BIT, OVERLAP_OWNED_BIT]
    for (const b of bits) assert.equal(b & (b - 1), 0, `bit ${b} must be a power of two`)
    assert.equal(new Set(bits).size, bits.length)
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

  it('has exactly two color-writing passes, both depth-tested Equal', () => {
    const colorPasses = OVERLAP_SHAPE_PASSES.filter((p) => p.writesColor)
    assert.deepEqual(colorPasses.map((p) => p.name), ['overlap', 'base'])
    for (const pass of colorPasses) assert.equal(pass.depth, 'equal')
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
