import test from 'node:test'
import assert from 'node:assert/strict'
import { Cabin } from './api'
import { validateDoc } from './project'
import { barBeat, parsePosition, parseRange } from './time'
import type { ProjectDocument } from '../../../src/persistence/types'

function fresh(): Cabin {
  const doc: ProjectDocument = {
    schemaVersion: 20, bpm: 120, beatsPerBar: 4, totalBars: 8,
    scenes: {
      main: { id: 'main', name: 'Composite', isMain: true, backgroundColor: '#000', backgroundTransparent: false, tracks: {}, rootTrackIds: [] },
      s1: { id: 's1', name: 'Scene 1', isMain: false, backgroundColor: '#000', backgroundTransparent: false, tracks: {}, rootTrackIds: [] },
    },
    sceneOrder: ['main', 's1'],
    audioTracks: {}, audioRootTrackIds: [], audioClips: {},
  }
  return new Cabin('t', doc, {}, '/tmp/t')
}

test('notes land in blocks that cover them; blocks grow and merge', () => {
  const p = fresh()
  const t = p.scene('Scene 1').track('Kick', { instrument: 'cube' })
  t.add([{ beat: 0, pitch: 60 }, { beat: 5, pitch: 60 }, { beat: 7.9, pitch: 60, dur: 1 }])
  assert.equal(t.raw.blocks.length, 1)
  const b = t.raw.blocks[0]
  assert.equal(b.startBar, 0)
  assert.equal(b.durationBars, 3) // 7.9 + 1 → bar 2 ends at 12
  assert.deepEqual(t.notes().map((n) => n.beat), [0, 5, 7.9])
  // a distant note gets its own block; a gap stays a gap...
  t.add({ beat: 32, pitch: 60 })
  t.add({ beat: 20, pitch: 60 })
  assert.deepEqual(t.raw.blocks.map((x) => [x.startBar, x.durationBars]), [[0, 3], [5, 1], [8, 1]])
  // ...until a long note grows a block across the others, which then merge
  t.add({ beat: 10, pitch: 60, dur: 23 })
  assert.deepEqual(t.raw.blocks.map((x) => [x.startBar, x.durationBars]), [[0, 9]])
  assert.deepEqual(t.notes().map((n) => n.beat), [0, 5, 7.9, 10, 20, 32])
  assert.deepEqual(validateDoc(p.doc), [])
})

test('clear removes a range (and empty blocks inside it), by pitch too', () => {
  const p = fresh()
  const t = p.scene('Scene 1').track('Hat', { instrument: 'cube' })
  for (let i = 0; i < 16; i++) t.add({ beat: i, pitch: i % 2 ? 62 : 60 })
  assert.equal(t.clear(4, 8, 62), 2)
  assert.equal(t.notes(4, 8).length, 2)
  t.clear()
  assert.equal(t.raw.blocks.length, 0)
})

test('editing inside a looped block expands it first', () => {
  const p = fresh()
  const t = p.scene('Scene 1').track('Loop', { instrument: 'cube' })
  t.raw.blocks.push({ id: 'b', startBar: 0, durationBars: 2, loop: true, loopLengthBars: 1, notes: [{ id: 'n', startBeat: 0, durationBeats: 0.5, pitch: 60, velocity: 100 }] })
  t.add({ beat: 6, pitch: 64 })
  assert.equal(t.raw.blocks[0].loop, false)
  assert.deepEqual(t.notes().map((n) => [n.beat, n.pitch]), [[0, 60], [4, 60], [6, 64]])
})

test('children, automation keys and composition cues', () => {
  const p = fresh()
  const obj = p.scene('Scene 1').track('Orb', { instrument: 'cube' })
  const lane = obj.child('Size', { param: 'size', range: { min: 0, max: 2 } })
  assert.equal(lane.raw.type, 'automation')
  lane.keys([[0, 0], [4, 2]])
  assert.deepEqual(lane.notes().map((n) => n.pitch), [36, 84])
  const split = obj.child('Ring', { splitter: 'radial', inputs: { copies: 6 } })
  assert.equal(split.raw.type, 'splitter')
  p.scene('B')
  const cuts = p.main().track('Cuts', { instrument: 'sceneSwitcher' })
  cuts.cue(0, 'Scene 1', 8)
  cuts.cue(8, 'B', 8)
  assert.deepEqual(cuts.raw.sceneBindings?.map((b) => b.pitch), [60, 61])
  assert.deepEqual(cuts.notes().map((n) => n.pitch), [60, 61])
  assert.deepEqual(validateDoc(p.doc), [])
  obj.remove()
  assert.equal(Object.keys(p.scene('Scene 1').raw.tracks).length, 0)
})

test('positions and ranges', () => {
  const ctx = { bpm: 120, beatsPerBar: 4, sections: [{ name: 'drop', from: 8, to: 16 }] }
  assert.equal(parsePosition('3', ctx), 12)
  assert.equal(parsePosition('2.5', ctx), 10)
  assert.equal(parsePosition('b7', ctx), 7)
  assert.equal(parsePosition('1.5s', ctx), 3)
  assert.equal(parsePosition('@drop', ctx), 32)
  assert.equal(parsePosition('@drop+2', ctx), 40)
  assert.deepEqual(parseRange('4-6', ctx), [16, 24])
  assert.deepEqual(parseRange('@drop', ctx), [32, 64])
  assert.deepEqual(parseRange('b2:3s', ctx), [2, 6])
  assert.equal(barBeat(13, 4), '3.2')
})

test('provenance: a re-run replaces script notes but keeps notes the user drew or edited', () => {
  const p = fresh()
  p.author = 'script:build.ts'
  const t = p.scene('Scene 1').track('Kick', { instrument: 'cube' })
  t.add([{ beat: 0, pitch: 60 }, { beat: 1, pitch: 60 }, { beat: 2, pitch: 60 }])
  assert.equal(t.raw.createdBy, 'script:build.ts')
  assert.ok(t.raw.blocks[0].notes.every((n) => n.src?.by === 'script:build.ts'))
  // the user moves one script note and draws one of their own (no src)
  const moved = t.raw.blocks[0].notes.find((n) => n.startBeat === 1)!
  moved.startBeat = 1.5
  t.raw.blocks[0].notes.push({ id: 'mine', startBeat: 3, durationBeats: 0.25, pitch: 62, velocity: 90 })
  // a fresh open (as the next CLI run would): clear() + re-add
  const again = new Cabin('t', p.doc, p.meta, '/tmp/t')
  again.author = 'script:build.ts'
  const t2 = again.scene('Scene 1').get('Kick')
  t2.clear()
  t2.add([{ beat: 0, pitch: 60 }, { beat: 1, pitch: 60 }, { beat: 2, pitch: 60 }])
  const beats = t2.notes().map((n) => [n.beat, n.pitch])
  assert.deepEqual(beats, [[0, 60], [1.5, 60], [2, 60], [3, 62]]) // the moved note stays moved; mine stays; no duplicate at 1
  // clear({ all }) really clears
  t2.clear(-Infinity, Infinity, undefined, { all: true })
  assert.equal(t2.notes().length, 0)
})

test('curves carry exact values and eases on an automation lane', () => {
  const p = fresh()
  const lane = p.scene('Scene 1').track('Orb', { instrument: 'cube' }).child('Size', { param: 'size', range: { min: 0, max: 2 } })
  lane.curve([{ beat: 0, value: 0.37 }, { beat: 4, value: 1.9, ease: 'expo.out' }])
  const notes = lane.raw.blocks.flatMap((b) => b.notes)
  assert.deepEqual(notes.map((n) => n.value), [0.37, 1.9])
  assert.equal(notes[1].ease, 'expo.out')
  assert.equal(notes[0].pitch, 45) // nearest row for 0.37 of 0..2 (36 + round(0.185 · 48))
})
