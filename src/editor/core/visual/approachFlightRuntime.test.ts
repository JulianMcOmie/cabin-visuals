import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../../types'
import { computeAtBeat, getVisualCopies, setProject } from './VisualEngine'
import type { ProjectSnapshot } from './resolve'

function track(partial: Partial<Track> & { id: string }): Track {
  return { name: partial.id, type: 'base', instrumentId: '', color: '#fff', muted: false, solo: false, blocks: [], childIds: [], ...partial }
}

test('timeline block notes are available before block start and land identically after seeks', () => {
  for (const arrival of [0, 1]) {
    const cube = track({ id: 'cube', instrumentId: 'cube', childIds: ['flight'] })
    const flight = track({ id: 'flight', type: 'splitter', parentId: 'cube', splitterId: 'approach',
      inputValues: { spawnMode: 2, density: 2, flightBeats: 2, afterBeats: 1, targetX: 3, targetY: 2, targetZ: 1, bend: 5, bendDirection: 35, arrival },
      blocks: [{ id: 'block', startBar: 2, durationBars: 2, loop: true, loopLengthBars: 1,
        notes: [{ id: 'note', pitch: 60, velocity: 100, startBeat: 0, durationBeats: 0.25 }] }],
    })
    const project: ProjectSnapshot = { tracks: { cube, flight }, rootTrackIds: ['cube'], beatsPerBar: 4, bpm: 120 }
    setProject(project)
    const sample = (beat: number) => {
      computeAtBeat(beat)
      return getVisualCopies('cube').map((copy) => ({ position: copy.transform.elements.slice(12, 15), opacity: copy.opacity }))
    }
    assert.ok(sample(7).some((copy) => copy.opacity > 0), 'flight visible before the block begins at beat 8')
    const onset = sample(8)
    assert.deepEqual(onset.find((copy) => copy.opacity > 0)?.position, [3, 2, 1])
    assert.deepEqual(sample(12).find((copy) => copy.opacity > 0)?.position, [3, 2, 1], 'looped MIDI also anticipates')
    sample(20)
    sample(0)
    assert.deepEqual(sample(8), onset)
  }
})

test('engine mounts enough copies for a dense chord before playback, without velocity scaling', () => {
  const cube = track({ id: 'cube', instrumentId: 'cube', childIds: ['flight'] })
  const flight = track({ id: 'flight', type: 'splitter', parentId: 'cube', splitterId: 'approach',
    inputValues: { spawnMode: 2, density: 1, flightBeats: 2, afterBeats: 1, bend: 6, bendDirection: 90 },
    blocks: [{ id: 'block', startBar: 2, durationBars: 2, loop: false,
      notes: Array.from({ length: 64 }, (_, i) => ({ id: `note-${i}`, pitch: i, velocity: i + 1, startBeat: 0, durationBeats: (i + 1) / 16 })) }],
  })
  setProject({ tracks: { cube, flight }, rootTrackIds: ['cube'], beatsPerBar: 4, bpm: 120 })
  assert.equal(getVisualCopies('cube').length, 64)
  for (const beat of [7, 8, 8.5, 0, 8]) {
    computeAtBeat(beat)
    const copies = getVisualCopies('cube')
    assert.equal(copies.length, 64)
    assert.equal(copies.filter((copy) => copy.opacity > 0).length, beat === 0 ? 0 : 64)
    for (const copy of copies) assert.deepEqual(copy.transform.elements, copies[0].transform.elements)
  }
})

test('travel-time automation reserves future overlap before the longer flights are sampled', () => {
  const cube = track({ id: 'cube', instrumentId: 'cube', childIds: ['flight'] })
  const flight = track({ id: 'flight', type: 'splitter', parentId: 'cube', splitterId: 'approach', childIds: ['travel'],
    inputValues: { spawnMode: 2, density: 1, flightBeats: 0.125, afterBeats: 1, bend: 5 },
    blocks: [{ id: 'block', startBar: 0, durationBars: 10, loop: false,
      notes: Array.from({ length: 20 }, (_, i) => ({ id: `note-${i}`, pitch: 60, velocity: 1, startBeat: 10 + i, durationBeats: 0.25 })) }],
  })
  const travel = track({ id: 'travel', type: 'automation', parentId: 'flight', targetParam: 'flightBeats', interpolation: 'linear',
    blocks: [{ id: 'automation', startBar: 0, durationBars: 10, loop: false, notes: [
      { id: 'short', pitch: 36, velocity: 1, startBeat: 0, durationBeats: 1 },
      { id: 'long', pitch: 84, velocity: 1, startBeat: 8, durationBeats: 1 },
    ] }],
  })
  setProject({ tracks: { cube, flight, travel }, rootTrackIds: ['cube'], beatsPerBar: 4, bpm: 120 })
  assert.equal(getVisualCopies('cube').length, 20, 'pool covers the maximum travel time, even at beat zero')
  computeAtBeat(8)
  assert.equal(getVisualCopies('cube').filter((copy) => copy.opacity > 0).length, 20)
  computeAtBeat(0)
  assert.equal(getVisualCopies('cube').filter((copy) => copy.opacity > 0).length, 0)
})
