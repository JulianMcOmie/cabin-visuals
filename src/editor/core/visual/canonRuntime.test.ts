import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../../types'
import { identityVisualCopy } from '../visualCopies/identityVisualCopy'
import { resolveVisualCopies } from '../visualCopies/resolveVisualCopies'
import { resolveProject, type ProjectSnapshot } from './resolve'

// The Canon's WIRING: that a canon track resolves into the chain through
// resolveProject, that the copies below it latch per birth end to end, and
// that the automation wrapper forwards applyFramed (dropping it would silently
// strip every copy's clock the moment a knob is automated - the exact failure
// the wrapper note in resolve.ts warns about). The clock arithmetic itself is
// visualCopies/canon.test.ts's job.

function track(partial: Partial<Track> & { id: string }): Track {
  return {
    name: partial.id,
    type: 'base',
    instrumentId: '',
    color: '#fff',
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
    ...partial,
  }
}

function snapshot(tracks: Track[], rootTrackIds: string[]): ProjectSnapshot {
  return {
    tracks: Object.fromEntries(tracks.map((t) => [t.id, t])),
    rootTrackIds,
    beatsPerBar: 4,
    bpm: 120,
  }
}

function chainOf(p: ProjectSnapshot, trackId: string) {
  const obj = resolveProject(p).objects.find((o) => o.trackId === trackId)
  assert.ok(obj, `object ${trackId} resolved`)
  return obj.moverAndSplitterChain
}

/** A latching colorizer lane: slot 1 (pitch 60) over beats [0, 2), slot 2
 *  (pitch 62) over [2, 4) - one note per birth at the canon defaults below. */
function latchColorizerTrack(id: string, parentId: string): Track {
  return track({
    id, type: 'mover', moverId: 'calmHueRotate', parentId,
    inputValues: { sample: 1 },
    blocks: [{
      id: `${id}-b`, startBar: 0, durationBars: 1, loop: false,
      notes: [
        { id: `${id}-n1`, startBeat: 0, durationBeats: 2, pitch: 60, velocity: 100 },
        { id: `${id}-n2`, startBeat: 2, durationBeats: 2, pitch: 62, velocity: 100 },
      ],
    }],
  })
}

test('a canon in the document gives each copy the color its birth note said', () => {
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['cn', 'col'] }),
    track({ id: 'cn', type: 'splitter', splitterId: 'canon', parentId: 'cube', inputValues: { copies: 2, period: 4 } }),
    latchColorizerTrack('col', 'cube'),
  ], ['cube'])
  // At beat 3: copy 0 was born at 0 (slot 1 sounding), copy 1 at 2 (slot 2).
  const copies = resolveVisualCopies(chainOf(p, 'cube'), 3)
  assert.equal(copies.length, 2)
  assert.equal(copies[0].colorShift.tint, '#ffd166')
  assert.equal(copies[1].colorShift.tint, '#ef476f')
})

test('an automated canon still emits its clocks (applyFramed survives the wrapper)', () => {
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['cn'] }),
    track({
      id: 'cn', type: 'splitter', splitterId: 'canon', parentId: 'cube',
      inputValues: { copies: 2, period: 4 }, childIds: ['auto'],
    }),
    track({
      id: 'auto', type: 'automation', parentId: 'cn', targetParam: 'period',
      blocks: [{
        id: 'auto-b', startBar: 0, durationBars: 1, loop: false,
        notes: [{ id: 'auto-n', startBeat: 0, durationBeats: 1, pitch: 60, velocity: 100 }],
      }],
    }),
  ], ['cube'])
  const [entry] = chainOf(p, 'cube')
  assert.ok(entry.applyFramed, 'the automation wrapper forwards applyFramed')
  const framed = entry.applyFramed!(identityVisualCopy(), { beat: 3, index: 0, count: 1 })
  assert.equal(framed.length, 2)
  for (const copy of framed) {
    assert.notEqual(copy.beatOffset, undefined)
    assert.notEqual(copy.birthBeat, undefined)
  }
})
