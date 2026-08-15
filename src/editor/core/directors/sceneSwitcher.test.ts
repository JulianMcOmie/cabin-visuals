import assert from 'node:assert/strict'
import test from 'node:test'
import type { Scene, Track } from '../../types'
import { sceneSwitcherDirector } from './sceneSwitcher'
import { colorToOklch } from '../../utils/oklch'

const scene = (id: string, name: string, isMain = false): Scene => ({ id, name, isMain, backgroundColor: '#000000', backgroundTransparent: false, tracks: {}, rootTrackIds: [] })
const scenes = { main: scene('main', 'Main', true), one: scene('one', 'Scene 1'), two: scene('two', 'Scene 2') }
const track: Track = {
  id: 'switcher', name: 'Scene Switcher', type: 'base', instrumentId: 'sceneSwitcher',
  color: '#6366f1', muted: false, solo: false, childIds: [],
  sceneBindings: [{ pitch: 60, sceneId: 'one' }, { pitch: 61, sceneId: 'two' }],
  blocks: [{
    id: 'b', startBar: 0, durationBars: 4, loop: false,
    notes: [
      { id: 'n1', startBeat: 2, durationBeats: 4, pitch: 61, velocity: 100 },
      { id: 'n2', startBeat: 4, durationBeats: 1, pitch: 60, velocity: 100 },
    ],
  }],
}

const resolve = (beat: number) => sceneSwitcherDirector.resolve(track, {
  beat, beatsPerBar: 4, totalBars: 8, scenes, sceneOrder: ['main', 'one', 'two'],
})

test('Scene Switcher emits no layer when no mapped row is held', () => {
  assert.deepEqual(resolve(0), [])
  assert.deepEqual(resolve(6), [])
})

test('Scene Switcher uses the latest held row, then reveals an older held row on release', () => {
  assert.deepEqual(resolve(1.999), [])
  assert.equal(resolve(2)[0]?.sceneId, 'two')
  assert.equal(resolve(4)[0]?.sceneId, 'one')
  assert.equal(resolve(4.999)[0]?.sceneId, 'one')
  assert.equal(resolve(5)[0]?.sceneId, 'two')
  assert.equal(resolve(3)[0]?.sceneId, 'two')
})

test('MIDI rows retain stable scene-id bindings independent of scene order', () => {
  const rows = sceneSwitcherDirector.midiRows(track, scenes, ['main', 'two', 'one'])
  assert.deepEqual(rows.map((row) => [row.pitch, row.label]), [[61, 'Scene 2'], [60, 'Scene 1']])
})

const rowHue = (rowScenes: Record<string, Scene>, pitch: number) => {
  const row = sceneSwitcherDirector.midiRows(track, rowScenes, ['main', 'one', 'two'])
    .find((r) => r.pitch === pitch)
  return colorToOklch(row!.color!)
}

test('MIDI rows wear their scene backdrop hue', () => {
  const colored = {
    ...scenes,
    one: { ...scenes.one, backgroundColor: '#c81e1e' },   // red
    two: { ...scenes.two, backgroundColor: '#1e3fc8' },   // blue
  }
  const red = rowHue(colored, 60)!
  const blue = rowHue(colored, 61)!
  assert.ok(Math.abs(red.h - colorToOklch('#c81e1e')!.h) < 1, `row hue ${red.h}`)
  assert.ok(Math.abs(blue.h - colorToOklch('#1e3fc8')!.h) < 1, `row hue ${blue.h}`)
  // Only the hue carries over: a dark room still gets a readable note color.
  assert.ok(red.l > 0.7 && blue.l > 0.7)
})

test('A near-black tinted backdrop still lends its hue', () => {
  const navy = { ...scenes, one: { ...scenes.one, backgroundColor: '#050a1e' } }
  const row = rowHue(navy, 60)!
  assert.ok(Math.abs(row.h - colorToOklch('#050a1e')!.h) < 1, `row hue ${row.h}`)
  // The note voice's chroma, gamut-mapped for the hue - not the backdrop's
  // own near-black smudge (c 0.04 at l 0.15).
  assert.ok(row.c > 0.05 && row.l > 0.7, `row ${JSON.stringify(row)}`)
})

test('A gradient backdrop reads as the blend of its stops, black stop and all', () => {
  const gradient = (from: string, to: string): Record<string, Scene> => ({
    ...scenes,
    one: { ...scenes.one, backgroundGradient: { enabled: true, kind: 'linear', from, to, angle: 0 } },
  })
  // Navy → black: black lowers chroma without dragging the hue around.
  const navyFade = rowHue(gradient('#1b2c55', '#000000'), 60)!
  assert.ok(Math.abs(navyFade.h - colorToOklch('#1b2c55')!.h) < 1, `row hue ${navyFade.h}`)
  // Two real hues land between them (red 29deg → yellow 110deg in OKLCH).
  const between = rowHue(gradient('#e02020', '#e0d020'), 60)!
  const red = colorToOklch('#e02020')!.h
  const yellow = colorToOklch('#e0d020')!.h
  assert.ok(between.h > Math.min(red, yellow) + 5 && between.h < Math.max(red, yellow) - 5, `row hue ${between.h}`)
  // Complementary stops cancel to grey in the average, so the more saturated
  // stop speaks rather than the row going colorless.
  const cancelling = rowHue(gradient('#ff0000', '#00e5e5'), 60)!
  assert.ok(cancelling.c > 0.1, 'complementary stops still produce a colored row')
})

test('Hueless backdrops keep the distinguishing cycle color', () => {
  const black = rowHue(scenes, 60)!
  const otherBlack = rowHue(scenes, 61)!
  // Default black rooms have no hue to lend, so the rows stay told apart.
  assert.notEqual(Math.round(black.h), Math.round(otherBlack.h))
  const transparent = {
    ...scenes,
    one: { ...scenes.one, backgroundColor: '#c81e1e', backgroundTransparent: true },
  }
  assert.deepEqual(rowHue(transparent, 60), black)
})
