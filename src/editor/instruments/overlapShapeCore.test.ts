import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  OVERLAP_DONE_BIT,
  OVERLAP_PARITY_BIT,
  OVERLAP_SHAPE_OPTIONS,
  OVERLAP_SHAPE_PASSES,
  overlapShapeIndex,
  overlapShapePoints,
  overlapShapeScale,
} from './overlapShapeCore'

describe('overlap shape pass recipe', () => {
  it('runs its five passes in strictly ascending, contiguous render order', () => {
    assert.equal(OVERLAP_SHAPE_PASSES.length, 5)
    for (let i = 1; i < OVERLAP_SHAPE_PASSES.length; i++) {
      assert.equal(
        OVERLAP_SHAPE_PASSES[i].renderOrder,
        OVERLAP_SHAPE_PASSES[i - 1].renderOrder + 1,
        `${OVERLAP_SHAPE_PASSES[i].name} must directly follow ${OVERLAP_SHAPE_PASSES[i - 1].name}`,
      )
    }
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

  it('lets the overlap fill draw once per pixel: reads both bits, marks done', () => {
    const overlap = OVERLAP_SHAPE_PASSES.find((p) => p.name === 'overlap')!
    assert.equal(overlap.stencil?.func, 'equal')
    assert.equal(overlap.stencil?.ref, 0)
    assert.equal(overlap.stencil?.funcMask, OVERLAP_PARITY_BIT | OVERLAP_DONE_BIT)
    assert.equal(overlap.stencil?.writeMask, OVERLAP_DONE_BIT)
  })

  it('base fill requires odd parity and zeroes the stencil behind itself', () => {
    const base = OVERLAP_SHAPE_PASSES.find((p) => p.name === 'base')!
    assert.equal(base.stencil?.func, 'equal')
    assert.equal(base.stencil?.ref, 1)
    assert.equal(base.stencil?.funcMask, OVERLAP_PARITY_BIT)
    assert.equal(base.stencil?.zPass, 'zero')
    assert.equal(base.stencil?.writeMask, 0xff)
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
