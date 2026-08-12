import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  OVERLAP_SOLID_CONTAINS_GLSL,
  OVERLAP_SOLID_MAX_SIBLINGS,
  OVERLAP_SOLID_OPTIONS,
  OVERLAP_SOLID_TORUS_RADIUS,
  OVERLAP_SOLID_TORUS_TUBE,
  overlapSolidIndex,
  overlapSolidScale,
  packAffineRows,
} from './overlapSolidCore'

describe('overlap solid vocabulary', () => {
  it('exposes five solids with contiguous select values', () => {
    assert.equal(OVERLAP_SOLID_OPTIONS.length, 5)
    OVERLAP_SOLID_OPTIONS.forEach((option, i) => assert.equal(option.value, i))
  })

  it('clamps and rounds arbitrary param values to a valid index', () => {
    assert.equal(overlapSolidIndex(-2), 0)
    assert.equal(overlapSolidIndex(1.4), 1)
    assert.equal(overlapSolidIndex(99), OVERLAP_SOLID_OPTIONS.length - 1)
    assert.equal(overlapSolidIndex(Number.NaN), 0)
  })

  it('every solid except the last has an explicit GLSL branch; the last is the else', () => {
    // The containment dispatch and the option list must never drift apart: a
    // new solid needs BOTH a select entry and a shape test.
    for (const option of OVERLAP_SOLID_OPTIONS.slice(0, -1)) {
      assert.ok(
        OVERLAP_SOLID_CONTAINS_GLSL.includes(`shape == ${option.value}`),
        `missing GLSL branch for ${option.label}`,
      )
    }
    assert.ok(!OVERLAP_SOLID_CONTAINS_GLSL.includes(`shape == ${OVERLAP_SOLID_OPTIONS.length - 1}`))
  })

  it('the torus constants are sane and baked into the GLSL', () => {
    assert.ok(OVERLAP_SOLID_TORUS_RADIUS + OVERLAP_SOLID_TORUS_TUBE <= 1)
    assert.ok(OVERLAP_SOLID_CONTAINS_GLSL.includes(OVERLAP_SOLID_TORUS_RADIUS.toFixed(4)))
  })

  it('caps the shader loop at a positive sibling budget', () => {
    assert.ok(OVERLAP_SOLID_MAX_SIBLINGS > 0)
  })
})

describe('overlap solid scale', () => {
  it('swells from SIZE by energy × PULSE and never collapses to zero', () => {
    assert.equal(overlapSolidScale(2, 0, 0.5), 2)
    assert.equal(overlapSolidScale(2, 1, 0.5), 3)
    assert.ok(overlapSolidScale(0, 0, 0) > 0)
  })
})

describe('packAffineRows', () => {
  it('packs a column-major matrix as three row-vector texels', () => {
    // Column-major elements of: rotationless affine with scale (2,3,4) and
    // translation (5,6,7).
    const elements = [
      2, 0, 0, 0,
      0, 3, 0, 0,
      0, 0, 4, 0,
      5, 6, 7, 1,
    ]
    const out = new Float32Array(24)
    packAffineRows(elements, out, 1)
    // Copy 1 lands at float offset 12; rows read back as (row-major) vectors.
    assert.deepEqual([...out.slice(12, 16)], [2, 0, 0, 5])
    assert.deepEqual([...out.slice(16, 20)], [0, 3, 0, 6])
    assert.deepEqual([...out.slice(20, 24)], [0, 0, 4, 7])
    // Copy 0's slot untouched.
    assert.ok([...out.slice(0, 12)].every((v) => v === 0))
  })

  it('a packed row dotted with a homogeneous point applies the transform', () => {
    // Identity: dot(row_i, (p, 1)) must reproduce p.
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    const out = new Float32Array(12)
    packAffineRows(identity, out, 0)
    const p = [3.5, -2, 8, 1]
    for (let row = 0; row < 3; row++) {
      const dot = out[row * 4] * p[0] + out[row * 4 + 1] * p[1] + out[row * 4 + 2] * p[2] + out[row * 4 + 3] * p[3]
      assert.equal(dot, p[row])
    }
  })
})
