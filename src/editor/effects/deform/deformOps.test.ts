import assert from 'node:assert/strict'
import test from 'node:test'
import { deformPlugin } from './deform'
import { deformFieldGlsl, deformSuffix, deformUniformName } from './deformField'
import {
  DEFORM_OPERATIONS,
  DRIVE_OSCILLATE,
  DRIVE_PULSE,
  DRIVE_RAMP,
  DRIVE_STATIC,
  FALLOFF_BOX,
  FALLOFF_LINEAR,
  FALLOFF_NONE,
  FALLOFF_SPHERICAL,
  driveEnvelope,
  falloffWeight,
  visibleDeformParams,
} from './deformOps'

const PARAM_KEYS = new Set(deformPlugin.params.map((p) => p.key))

test('every operation only asks for knobs the device actually has', () => {
  for (const op of DEFORM_OPERATIONS) {
    for (const key of op.params) {
      assert.ok(PARAM_KEYS.has(key), `${op.id} lists a param the plugin does not declare: ${key}`)
    }
  }
})

test('operation values are their own index, so persisted saves stay addressable', () => {
  DEFORM_OPERATIONS.forEach((op, index) => {
    assert.equal(op.value, index, `${op.id} must stay at index ${index} - the value is persisted`)
  })
})

test('the shader has a branch for every declared operation', () => {
  const glsl = deformFieldGlsl('_x')
  for (const op of DEFORM_OPERATIONS) {
    assert.ok(
      glsl.includes(`op == ${op.value}`),
      `${op.id} (${op.value}) has no branch in the generated GLSL`,
    )
  }
})

test('the shader declares a uniform for every numeric param it reads', () => {
  const glsl = deformFieldGlsl('_x')
  for (const param of deformPlugin.params) {
    // `detail` is CPU-side (subdivision) and deliberately has no uniform.
    if (param.key === 'detail') continue
    assert.ok(
      glsl.includes(`uniform float ${deformUniformName(param.key, '_x')};`),
      `no uniform declared for ${param.key}`,
    )
  }
})

test('suffixes survive a nanoid: GLSL identifiers, never leading digits', () => {
  const suffix = deformSuffix('7aB-c_d.e')
  assert.equal(suffix, '_7aB_c_d_e')
  assert.match(suffix, /^[A-Za-z_][A-Za-z0-9_]*$/)
})

test('static drive is exactly neutral at every beat', () => {
  for (const beat of [0, 0.5, 3, 17.25]) {
    assert.equal(driveEnvelope(DRIVE_STATIC, 2, beat), 1)
  }
})

test('pulse peaks on the cycle and decays within it', () => {
  assert.equal(driveEnvelope(DRIVE_PULSE, 1, 0), 1)
  assert.equal(driveEnvelope(DRIVE_PULSE, 1, 3), 1, 'retriggers on every whole cycle')
  const early = driveEnvelope(DRIVE_PULSE, 1, 0.25)
  const late = driveEnvelope(DRIVE_PULSE, 1, 0.75)
  assert.ok(early > late, 'must decay across the cycle')
  assert.ok(late > 0, 'never reaches zero, so the retrigger is a step not a jump')
})

test('ramp is unbounded and linear in the beat - the rotational ops clock', () => {
  assert.equal(driveEnvelope(DRIVE_RAMP, 2, 0), 0)
  assert.equal(driveEnvelope(DRIVE_RAMP, 2, 3), 6)
  assert.equal(driveEnvelope(DRIVE_RAMP, 2, 100), 200)
})

test('oscillate is one-sided: 0 at rest, 1 at the top, never negative', () => {
  assert.ok(Math.abs(driveEnvelope(DRIVE_OSCILLATE, 1, 0)) < 1e-12)
  assert.ok(Math.abs(driveEnvelope(DRIVE_OSCILLATE, 1, 0.5) - 1) < 1e-12)
  for (let beat = 0; beat < 4; beat += 0.05) {
    const value = driveEnvelope(DRIVE_OSCILLATE, 1, beat)
    assert.ok(value >= -1e-12 && value <= 1 + 1e-12, `out of range at beat ${beat}: ${value}`)
  }
})

test('no falloff means no falloff, whatever the geometry knobs say', () => {
  assert.equal(falloffWeight(FALLOFF_NONE, 99, 99, 99, 0.1, 5, 1), 1)
})

test('linear falloff ramps across the band and clamps past both ends', () => {
  const w = (along: number) => falloffWeight(FALLOFF_LINEAR, along, 0, 0, 2, 0, 0)
  assert.equal(w(-5), 0)
  assert.equal(w(-1), 0)
  assert.equal(w(0), 0.5)
  assert.equal(w(1), 1)
  assert.equal(w(5), 1)
})

test('spherical and box falloff are full inside and zero outside', () => {
  for (const mode of [FALLOFF_SPHERICAL, FALLOFF_BOX]) {
    assert.equal(falloffWeight(mode, 0, 0, 0, 2, 0, 0.5), 1, 'the center is fully inside')
    assert.equal(falloffWeight(mode, 0, 9, 9, 2, 0, 0.5), 0, 'well outside is fully out')
    const edge = falloffWeight(mode, 0, 1.75, 1.75, 2, 0, 0.5)
    assert.ok(edge > 0 && edge < 1, 'the soft band interpolates')
  }
})

test('softness widens the edge without moving the outer boundary', () => {
  const hard = falloffWeight(FALLOFF_SPHERICAL, 0, 1.5, 1.5, 2, 0, 0)
  const soft = falloffWeight(FALLOFF_SPHERICAL, 0, 1.5, 1.5, 2, 0, 1)
  assert.equal(hard, 1, 'a hard edge is still fully inside at 1.5 of 2')
  assert.ok(soft < 1, 'a soft edge has already begun to fade there')
  assert.equal(falloffWeight(FALLOFF_SPHERICAL, 0, 2, 2, 2, 0, 1), 0, 'both end at size')
})

test('visible params are the master, the operation, then only what drive and falloff add', () => {
  const twistStatic = visibleDeformParams(0, DRIVE_STATIC, FALLOFF_NONE)
  assert.deepEqual(twistStatic, ['strength', 'angle', 'axis', 'center'])
  assert.ok(!twistStatic.includes('rate'), 'Static has no clock, so it shows no rate')

  const withClockAndRegion = visibleDeformParams(0, DRIVE_OSCILLATE, FALLOFF_SPHERICAL)
  assert.ok(withClockAndRegion.includes('rate'))
  assert.ok(withClockAndRegion.includes('falloffSize'))
  assert.ok(withClockAndRegion.includes('falloffSoftness'))
})

test('every visible key is a real param, for every cell of the matrix', () => {
  for (const op of DEFORM_OPERATIONS) {
    for (const drive of [DRIVE_STATIC, DRIVE_PULSE, DRIVE_RAMP, DRIVE_OSCILLATE]) {
      for (const falloff of [FALLOFF_NONE, FALLOFF_LINEAR, FALLOFF_SPHERICAL, FALLOFF_BOX]) {
        for (const key of visibleDeformParams(op.value, drive, falloff)) {
          assert.ok(PARAM_KEYS.has(key), `${op.id}/${drive}/${falloff} shows unknown key ${key}`)
        }
      }
    }
  }
})
