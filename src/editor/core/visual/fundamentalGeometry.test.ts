import assert from 'node:assert/strict'
import test from 'node:test'
import { FUNDAMENTAL_GEOMETRIES, normalizeFundamentalGeometry } from '../../instruments/FundamentalGeometry'

test('the geometry instrument exposes the five Platonic solids', () => {
  assert.deepEqual(FUNDAMENTAL_GEOMETRIES.map(({ id }) => id), [
    'cube',
    'tetrahedron',
    'octahedron',
    'dodecahedron',
    'icosahedron',
  ])
})

test('legacy and invalid geometry values safely render as a cube', () => {
  assert.equal(normalizeFundamentalGeometry(undefined), 'cube')
  assert.equal(normalizeFundamentalGeometry('unknown'), 'cube')
  assert.equal(normalizeFundamentalGeometry('tetrahedron'), 'tetrahedron')
})
