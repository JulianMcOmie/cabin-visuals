import assert from 'node:assert/strict'
import test from 'node:test'
import { Vector3 } from 'three'
import { UNDERTALE_CHARACTERS, undertaleCharacterIndex, undertalePose } from './undertaleCore'
import { UNDERTALE_SPRITES } from './undertaleSprites'
import { createUndertaleGeometry } from './undertaleGeometry'

test('every character blueprint produces finite colored geometry with front, back and thickness', () => {
  assert.equal(UNDERTALE_SPRITES.length, UNDERTALE_CHARACTERS.length)
  for (const [index, sprite] of UNDERTALE_SPRITES.entries()) {
    for (const code of sprite.rows.join('')) assert.ok(code === '.' || sprite.palette[code], `${UNDERTALE_CHARACTERS[index]}: unknown color ${code}`)
    const geometry = createUndertaleGeometry(sprite)
    const positions = geometry.getAttribute('position'), colors = geometry.getAttribute('color')
    assert.ok(positions.count > 100)
    assert.equal(positions.count, colors.count)
    assert.ok([...positions.array, ...colors.array].every(Number.isFinite))
    assert.equal(geometry.boundingBox!.min.z, -0.5)
    assert.equal(geometry.boundingBox!.max.z, 0.5)
    assert.ok(geometry.boundingBox!.max.y - geometry.boundingBox!.min.y <= 2.401)
    geometry.dispose()
  }
})

test('pixel slabs cull internal walls and wind every surface outward', () => {
  const geometry = createUndertaleGeometry({ rows: ['WW'], palette: { W: '#ffffff' } })
  // Two fronts, two backs and six boundary walls. No shared internal wall.
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal')
  assert.equal(positions.count, 10 * 6)
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), normal = new Vector3()
  for (let i = 0; i < positions.count; i += 3) {
    a.fromBufferAttribute(positions, i)
    b.fromBufferAttribute(positions, i + 1).sub(a)
    c.fromBufferAttribute(positions, i + 2).sub(a)
    normal.fromBufferAttribute(normals, i)
    assert.ok(b.cross(c).dot(normal) > 0, `triangle ${i / 3} must face outward`)
  }
  geometry.dispose()
})

test('empty pixels leave cutouts, including their interior walls', () => {
  const geometry = createUndertaleGeometry({rows:['WWW','W.W','WWW'], palette:{W:'#ffffff'}})
  // Eight front/back pairs, twelve outer edges and four inner edges.
  assert.equal(geometry.getAttribute('position').count, (16 + 12 + 4) * 6)
  geometry.dispose()
})

test('character selection clamps invalid saved values and poses survive backwards seeks', () => {
  for (const bad of [-20, NaN, Infinity]) assert.equal(undertaleCharacterIndex(bad), 0)
  assert.equal(undertaleCharacterIndex(200), UNDERTALE_CHARACTERS.length - 1)
  const reference = undertalePose(3.25, 0.8, 0.7, 0.5)
  for (const beat of [14, 0, 9.5, -1]) undertalePose(beat, 0.8, 0.7, 0.5)
  assert.deepEqual(undertalePose(3.25, 0.8, 0.7, 0.5), reference)
  const still = undertalePose(7, 0, 1, 0)
  assert.ok(still.lift === 0 && still.tilt === 0 && still.scale === 1)
})
