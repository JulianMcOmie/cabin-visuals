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
      inputValues: { spawnMode: 2, density: 2, flightBeats: 2, afterBeats: 1, targetX: 3, targetY: 2, targetZ: 1, arrival },
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
