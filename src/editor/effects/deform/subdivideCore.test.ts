import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_SUBDIVIDED_VERTICES,
  subdivideAttributes,
  subdividedVertexCount,
} from './subdivideCore'

/** One triangle in the z = 0 plane, plus a matching 2-component attribute. */
function triangle() {
  return [
    { array: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), itemSize: 3 },
    { array: new Float32Array([0, 0, 1, 0, 0, 1]), itemSize: 2 },
  ]
}

test('each level quadruples the triangle count', () => {
  const [positions] = subdivideAttributes(triangle(), 1)
  assert.equal(positions.array.length / 3, 12, 'one triangle becomes four')
  const [twice] = subdivideAttributes(triangle(), 2)
  assert.equal(twice.array.length / 3, 48)
})

test('every attribute stays vertex-aligned with the others', () => {
  const [positions, uvs] = subdivideAttributes(triangle(), 2)
  assert.equal(positions.array.length / positions.itemSize, uvs.array.length / uvs.itemSize)
})

test('subdivision adds no new extent - midpoints stay inside the original', () => {
  const [positions] = subdivideAttributes(triangle(), 3)
  for (let i = 0; i < positions.array.length; i += 3) {
    const x = positions.array[i]
    const y = positions.array[i + 1]
    assert.ok(x >= -1e-6 && y >= -1e-6 && x + y <= 1 + 1e-6, `vertex escaped the triangle: ${x},${y}`)
  }
})

test('winding is preserved, so faces do not flip', () => {
  const [positions] = subdivideAttributes(triangle(), 1)
  for (let t = 0; t < 4; t++) {
    const b = t * 9
    const ax = positions.array[b], ay = positions.array[b + 1]
    const bx = positions.array[b + 3], by = positions.array[b + 4]
    const cx = positions.array[b + 6], cy = positions.array[b + 7]
    const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    assert.ok(cross > 0, `triangle ${t} reversed its winding`)
  }
})

test('level 0 and malformed input come back untouched, so callers never special-case', () => {
  const input = triangle()
  assert.equal(subdivideAttributes(input, 0), input)
  const ragged = [{ array: new Float32Array([0, 0, 0, 1, 0, 0]), itemSize: 3 }]
  assert.equal(subdivideAttributes(ragged, 2), ragged, 'two vertices is not a triangle')
})

test('the vertex cap stops early rather than producing an unrenderable mesh', () => {
  const dense = [{ array: new Float32Array(3 * 3 * 30_000), itemSize: 3 }]
  const [out] = subdivideAttributes(dense, 4)
  assert.ok(
    out.array.length / 3 <= MAX_SUBDIVIDED_VERTICES,
    'must not exceed the cap even when asked for four levels',
  )
  assert.ok(out.array.length >= dense[0].array.length, 'and never returns less than it was given')
})

test('the cost estimate matches what subdivision actually produces', () => {
  assert.equal(subdividedVertexCount(3, 2), 48)
  const [out] = subdivideAttributes(triangle(), 2)
  assert.equal(out.array.length / out.itemSize, subdividedVertexCount(3, 2))
})
