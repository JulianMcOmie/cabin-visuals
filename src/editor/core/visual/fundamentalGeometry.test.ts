import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FUNDAMENTAL_GEOMETRIES,
  FUNDAMENTAL_SOLID_RADIUS,
  SIDED_GEOMETRIES,
  TUBED_GEOMETRIES,
  fundamentalMaterialSettings,
  normalizeFundamentalGeometry,
  normalizeSides,
  torusKnotRadii,
  torusRadii,
} from '../../instruments/FundamentalGeometry'

test('the geometry vocabulary keeps the original six solids first, appended solids after', () => {
  // Append-only: tracks store the id string, so the original ids must never
  // move or rename, and new solids only ever extend the tail.
  assert.deepEqual(FUNDAMENTAL_GEOMETRIES.map(({ id }) => id), [
    'cube',
    'tetrahedron',
    'octahedron',
    'dodecahedron',
    'icosahedron',
    'sphere',
    'cylinder',
    'prism',
    'cone',
    'capsule',
    'torus',
    'torusKnot',
  ])
})

test('legacy and invalid geometry values safely render as a cube', () => {
  assert.equal(normalizeFundamentalGeometry(undefined), 'cube')
  assert.equal(normalizeFundamentalGeometry('unknown'), 'cube')
  assert.equal(normalizeFundamentalGeometry('tetrahedron'), 'tetrahedron')
  assert.equal(normalizeFundamentalGeometry('torusKnot'), 'torusKnot')
})

test('torus radii trade ring for tube inside the shared solid radius', () => {
  for (const fraction of [0.12, 0.38, 0.85]) {
    const { ring, tube } = torusRadii(fraction)
    // Overall extent (ring + tube) holds still while thickness changes.
    assert.ok(Math.abs(ring + tube - FUNDAMENTAL_SOLID_RADIUS) < 1e-9)
    assert.ok(Math.abs(tube / ring - fraction) < 1e-9)
  }
  const knot = torusKnotRadii(0.38)
  assert.ok(knot.ring + knot.tube < FUNDAMENTAL_SOLID_RADIUS) // knots swing wider, so they start smaller
  assert.ok(TUBED_GEOMETRIES.has('torus') && TUBED_GEOMETRIES.has('torusKnot'))
})

test('the SIDES param covers prism and cone, clamped to whole polygon counts', () => {
  assert.ok(SIDED_GEOMETRIES.has('prism') && SIDED_GEOMETRIES.has('cone'))
  assert.equal(normalizeSides(undefined), 3) // the default: a triangular prism
  assert.equal(normalizeSides(3.4), 3) // fractional sides would tear the polygon
  assert.equal(normalizeSides(0), 3)
  assert.equal(normalizeSides(99), 24)
})

test('the default surface reproduces the legacy material exactly', () => {
  const settings = fundamentalMaterialSettings(
    { reflective: false, refractive: false, shaded: true, textured: false },
    0.4,
  )
  assert.equal(settings.metalness, 0.08)
  assert.equal(settings.roughness, 0.24)
  assert.equal(settings.clearcoat, 0.9)
  assert.equal(settings.clearcoatRoughness, 0.16)
  assert.equal(settings.envMapIntensity, 1.25)
  assert.equal(settings.transmission, 0)
  assert.equal(settings.emissiveIntensity, 0.25 + 0.4 * 2.5)
  assert.equal(settings.unlit, false)
})

test('surface toggles: glass zeroes metal, unlit overrides everything physical', () => {
  const reflect = fundamentalMaterialSettings(
    { reflective: true, refractive: false, shaded: true, textured: false }, 0)
  assert.ok(reflect.metalness > 0.5)

  // Refractive beats reflective on the conflicting fields: metal cannot transmit.
  const both = fundamentalMaterialSettings(
    { reflective: true, refractive: true, shaded: true, textured: false }, 0)
  assert.equal(both.metalness, 0)
  assert.ok(both.transmission > 0)
  assert.equal(both.envMapIntensity, 2.3) // reflect still keeps the stronger environment

  const unlit = fundamentalMaterialSettings(
    { reflective: true, refractive: true, shaded: false, textured: true }, 0)
  assert.equal(unlit.unlit, true)
  assert.equal(unlit.transmission, 0)
  assert.equal(unlit.metalness, 0)
  assert.equal(unlit.envMapIntensity, 0)
  assert.equal(unlit.textured, true) // grain survives unlit - it rides the emissive surface
})
