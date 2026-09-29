import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import { mergeDefinitionSettings } from './definitions'
import { pathGeometry, pathPoint, pathSplitter, pathTravelSampler, PATH_MIDI_ROWS, type PathSettings } from './path'
import { resolveVisualCopies } from './resolveVisualCopies'
import { getMoverOrSplitterDefinition } from './registry'
import type { ResolvedNote } from '../visual/types'

const defaults = mergeDefinitionSettings(pathSplitter, undefined) as unknown as PathSettings
const settings = (patch: Partial<PathSettings> = {}) => ({ ...defaults, ...patch })
const note = (pitch: number, beat = 0, durationBeats = 2): ResolvedNote => ({ pitch, beat, durationBeats, velocity: 0.1, blockStartBeat: beat, blockEndBeat: beat + durationBeats })
const near = (a: number, b: number, epsilon = 1e-7) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`)
const copies = (s: PathSettings, beat = 0, notes: ResolvedNote[] = []) => resolveVisualCopies([pathSplitter.resolve({ settings: s, notes })], beat)

test('Path is registered with exactly six MIDI speed/direction rows', () => {
  assert.equal(getMoverOrSplitterDefinition('path'), pathSplitter)
  assert.equal(PATH_MIDI_ROWS.length, 6)
  for (const [pitch, expected] of [[60, 1], [62, 2], [64, 4], [61, -1], [63, -2], [65, -4]]) {
    const at = pathTravelSampler([note(pitch)])
    near(at(1), expected)
    near(at(100), expected * 2)
    near(at(-1), 0)
  }
})

test('MIDI changes speed continuously, rests in gaps, resumes held notes and scrubs exactly', () => {
  const at = pathTravelSampler([note(60, 0, 4), note(64, 1, 1), note(61, 5, 2), note(99, 0, 20)])
  for (const [beat, expected] of [[0, 0], [1, 1], [2, 5], [4, 7], [5, 7], [7, 5], [100, 5], [1.5, 3], [0, 0]]) near(at(beat), expected)
  near(pathTravelSampler([note(62), note(64)])(1), 4)
  near(pathTravelSampler([note(64), note(62)])(1), 4)
  near(pathTravelSampler([note(60, 0, 0), note(61, 0, -1)])(10), 0)
})

test('size and color belong to position, not copy index or direction', () => {
  const s = settings({ copies: 3, length: 8, fadeEnd: 0, repeat: 0 })
  const base = copies(s)
  const moved = copies(s, 1, [note(64)])
  near(moved[0].transform.elements[12], base[1].transform.elements[12])
  near(moved[0].transform.elements[0], base[1].transform.elements[0])
  assert.equal(moved[0].colorShift.tint, base[1].colorShift.tint)
  const backward = copies(s, 1, [note(65)])
  near(backward[2].transform.elements[0], base[1].transform.elements[0])
  assert.equal(backward[2].colorShift.tint, base[1].colorShift.tint)
  assert.equal(base[0].colorShift.tint, s.startColor)
  assert.equal(base[2].colorShift.tint, s.endColor)
})

test('Once mode fades completely and retains stable invisible slots outside its bounds', () => {
  const s = settings({ copies: 5, length: 8, fadeEnd: 0.5, repeat: 0 })
  const base = copies(s)
  near(base[2].opacity, 1)
  near(base[3].opacity, 0.5)
  near(base[4].opacity, 0)
  const exited = copies(s, 30, [note(60, 0, 30)])
  assert.equal(exited.length, 5)
  assert.ok(exited.every(c => c.opacity === 0))
  assert.ok(copies(s, 30, [note(61, 0, 30)]).every(c => c.opacity === 0))
  near(copies(settings({ copies: 1, fadeStart: 0.2 }))[0].opacity, 0)
})

test('open paths repeat by default in both directions on straight, curved and sine paths', () => {
  for (const shape of [{}, { bend: 3 }, { amplitude: 1, frequency: 2 }]) {
    for (const motion of [1, 2]) {
      const s = settings({ ...shape, copies: 12, motion })
      const period = pathGeometry(s, 0).length / s.speed
      const initial = copies(s)
      for (const lap of [1, 20, 0, 3]) {
        const frame = copies(s, period * lap)
        assert.equal(frame.length, 12)
        assert.ok(frame.some(c => c.opacity > 0))
        frame.forEach((c, i) => {
          c.transform.elements.forEach((v, j) => near(v, initial[i].transform.elements[j]))
          assert.equal(c.colorShift.tint, initial[i].colorShift.tint)
          near(c.opacity, initial[i].opacity)
        })
      }
      const withoutRepeat = { ...s }
      delete (withoutRepeat as Partial<PathSettings>).repeat
      assert.deepEqual(copies(withoutRepeat, period * 3), copies(s, period * 3))
    }
  }
})

test('straight-path recycling fades at the exit and resets appearance at the entrance', () => {
  const s = settings({ copies: 1, motion: 1, length: 8 })
  const exiting = copies(s, 8 - 1e-5)[0]
  assert.ok(exiting.opacity < 1e-8)
  near(exiting.transform.elements[0], s.endSize, 1e-5)
  const respawn = copies(s, 8)[0]
  near(respawn.transform.elements[12], -4)
  near(respawn.transform.elements[0], s.startSize)
  assert.equal(respawn.colorShift.tint, s.startColor)
  assert.equal(respawn.opacity, 1)
  const fadingIn = copies({ ...s, fadeStart: 0.2 }, 8.8)[0]
  near(fadingIn.opacity, 0.5)
})

test('MIDI recycling keeps distinct evenly spaced slots and stops where notes end', () => {
  const s = settings({ copies: 4, length: 8, fadeEnd: 0 })
  for (const pitch of [60, 62, 64, 61, 63, 65]) {
    const entry = pathSplitter.resolve({ settings: s, notes: [note(pitch, 0, 100)] })
    const frame = resolveVisualCopies([entry], 99.25)
    const x = frame.map(c => c.transform.elements[12]).sort((a, b) => a - b)
    assert.equal(new Set(x).size, 4)
    for (let i = 1; i < x.length; i++) near(x[i] - x[i - 1], 2)
    assert.ok(frame.every(c => c.opacity === 1 && c.transform.elements[12] >= -4 && c.transform.elements[12] < 4))
    assert.deepEqual(resolveVisualCopies([entry], 100), resolveVisualCopies([entry], 150))
  }
})

test('closed loop wraps both directions without a position, scale, color or opacity seam', () => {
  const s = settings({ pathMode: 1, copies: 1, motion: 1, speed: 1, amplitude: 1, frequency: 2.25 })
  const length = pathGeometry(s, 0).length
  const start = copies(s)[0]
  for (const beat of [length, -length, length * 20]) {
    const current = copies(s, beat)[0]
    current.transform.elements.forEach((value, i) => near(value, start.transform.elements[i]))
    assert.equal(current.colorShift.tint, start.colorShift.tint)
    assert.equal(current.opacity, 1)
  }
  for (const beat of [-1e-6, 1e-6]) {
    const c = copies(s, beat)[0]
    c.transform.elements.forEach((v, i) => near(v, start.transform.elements[i], 1e-5))
  }
  const opposite = copies(s, length / 2)[0]
  near(Math.hypot(...opposite.transform.elements.slice(0, 3)), s.endSize)
  assert.equal(opposite.colorShift.tint, s.endColor)
  const points = [pathPoint(s, 0, 1), pathPoint(s, 1, 1)]
  points[0].forEach((v, i) => near(v, points[1][i]))
})

test('curved and sine paths have approximately constant spatial speed', () => {
  for (const patch of [{ bend: 4 }, { amplitude: 2, frequency: 3 }, { pathMode: 1, amplitude: 1, frequency: 3 }]) {
    const geometry = pathGeometry(settings(patch), 0)
    // Small steps measure speed instead of the chord shortcut across a bend.
    const distances = Array.from({ length: 2000 }, (_, i) => {
      const a = geometry.at(i / 2000), b = geometry.at((i + 1) / 2000)
      return Math.hypot(...a.map((v, axis) => v - b[axis]))
    })
    assert.ok(Math.max(...distances) / Math.min(...distances) < 1.05)
  }
})

test('wave animation is beat deterministic and preserves closed endpoints', () => {
  const s = settings({ amplitude: 1, waveRate: 0.25, pathMode: 1 })
  assert.notDeepEqual(pathPoint(s, 0, 0), pathPoint(s, 0, 1))
  assert.deepEqual(copies(s, 3), copies(s, 3))
  pathPoint(s, 0, 3).forEach((v, i) => near(v, pathPoint(s, 1, 3)[i]))
})

test('upstream frame, opacity and color are preserved; shared size never moves copies', () => {
  const s = settings({ colorAmount: 0, copies: 2, fadeEnd: 0 })
  const input = { transform: new Matrix4().makeRotationZ(Math.PI / 2), opacity: 0.4,
    colorShift: { hue: 0.1, saturation: 0.2, lightness: 0.1, tint: '#ff0000', tintAmount: 0.5 } }
  const before = input.transform.clone()
  const output = pathSplitter.resolve({ settings: s, notes: [] }).apply(input, { beat: 0, index: 0, count: 1 })
  near(output[0].transform.elements[13], -4)
  assert.equal(output[0].opacity, 0.4)
  assert.deepEqual(output[0].colorShift, input.colorShift)
  assert.deepEqual(input.transform, before)
  const scaled = copies({ ...s, size: 2 }), base = copies(s)
  scaled.forEach((c, i) => {
    assert.deepEqual(c.transform.elements.slice(12, 15), base[i].transform.elements.slice(12, 15))
    near(c.transform.elements[0], base[i].transform.elements[0] * 2)
  })
})
