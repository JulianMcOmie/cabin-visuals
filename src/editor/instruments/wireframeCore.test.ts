import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  WIREFRAME_DEFAULT_SHAPE,
  WIREFRAME_DETAIL_STEPS,
  WIREFRAME_SHAPES,
  wireframeDetailStep,
  wireframeGeometry,
  wireframeIsFlat,
  wireframeSegmentPositions,
  wireframeSpinAngle,
} from './wireframeCore'

// Tracks store a shape as its INDEX in this list; any insertion or reorder
// silently re-shapes saved projects. Extend by appending only.
test('shape catalog order is frozen', () => {
  assert.deepEqual(WIREFRAME_SHAPES.map((s) => s.id), [
    'circle', 'triangle', 'square', 'pentagon', 'hexagon', 'star', 'squircle',
    'tetrahedron', 'cube', 'octahedron', 'icosahedron', 'dodecahedron',
    'sphere', 'torus', 'cone', 'cylinder',
    'torusKnot', 'mobius', 'spiral', 'helix', 'lissajous', 'gem',
  ])
  assert.equal(WIREFRAME_SHAPES[WIREFRAME_DEFAULT_SHAPE].id, 'sphere')
})

test('every shape builds finite unit-radius geometry at every detail step', () => {
  for (let index = 0; index < WIREFRAME_SHAPES.length; index++) {
    for (const step of [0, Math.floor(WIREFRAME_DETAIL_STEPS / 2), WIREFRAME_DETAIL_STEPS]) {
      const lines = wireframeGeometry(index, step)
      assert.ok(lines.length > 0, `${WIREFRAME_SHAPES[index].id} has lines`)
      let max = 0
      for (const line of lines) {
        assert.ok(line.length >= 2, `${WIREFRAME_SHAPES[index].id} lines have segments`)
        for (const p of line) {
          for (const c of p) assert.ok(Number.isFinite(c), `${WIREFRAME_SHAPES[index].id} finite coords`)
          max = Math.max(max, Math.hypot(p[0], p[1], p[2]))
        }
      }
      assert.ok(max <= 1.0001, `${WIREFRAME_SHAPES[index].id} normalized (max ${max})`)
      assert.ok(max > 0.9, `${WIREFRAME_SHAPES[index].id} fills its radius (max ${max})`)
    }
  }
})

test('platonic solids carry their known edge counts', () => {
  const edgeCount = (id: string) =>
    wireframeGeometry(WIREFRAME_SHAPES.findIndex((s) => s.id === id), 0).length
  assert.equal(edgeCount('tetrahedron'), 6)
  assert.equal(edgeCount('cube'), 12)
  assert.equal(edgeCount('octahedron'), 12)
  assert.equal(edgeCount('icosahedron'), 30)
  assert.equal(edgeCount('dodecahedron'), 30)
})

test('segment positions flatten to consecutive point pairs', () => {
  const lines = wireframeGeometry(WIREFRAME_SHAPES.findIndex((s) => s.id === 'triangle'), 0)
  const positions = wireframeSegmentPositions(lines)
  const segments = lines.reduce((sum, line) => sum + line.length - 1, 0)
  assert.equal(positions.length, segments * 6)
  // Each segment's start is the previous segment's end along a polyline.
  assert.equal(positions[3], positions[6])
  assert.equal(positions[4], positions[7])
  assert.equal(positions[5], positions[8])
})

test('detail knob quantizes to a handful of rebuild steps', () => {
  assert.equal(wireframeDetailStep(0), 0)
  assert.equal(wireframeDetailStep(1), WIREFRAME_DETAIL_STEPS)
  assert.equal(wireframeDetailStep(0.5), Math.round(0.5 * WIREFRAME_DETAIL_STEPS))
  const low = wireframeGeometry(WIREFRAME_SHAPES.findIndex((s) => s.id === 'sphere'), 0)
  const high = wireframeGeometry(WIREFRAME_SHAPES.findIndex((s) => s.id === 'sphere'), WIREFRAME_DETAIL_STEPS)
  assert.ok(wireframeSegmentPositions(high).length > wireframeSegmentPositions(low).length)
})

test('spin is a pure signed function of the beat', () => {
  assert.equal(wireframeSpinAngle(0, 0.5), 0)
  assert.equal(wireframeSpinAngle(4, 1), 2 * Math.PI)
  assert.equal(wireframeSpinAngle(4, -1), -2 * Math.PI)
  assert.equal(wireframeSpinAngle(2, 0), 0)
})

test('flat shapes are the 2d family plus the spiral', () => {
  const flatIds = WIREFRAME_SHAPES.map((s, i) => (wireframeIsFlat(i) ? s.id : null)).filter(Boolean)
  assert.deepEqual(flatIds, ['circle', 'triangle', 'square', 'pentagon', 'hexagon', 'star', 'squircle', 'spiral'])
})
