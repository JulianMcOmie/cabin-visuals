import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../../types'
import { resolveProject, type ProjectSnapshot } from './resolve'

// Crop-with-targets routing: a crop track carrying `targets` masks THOSE
// objects (its id lands in each target's maskSourceIds and its own object is
// flagged masksTargets) instead of its whole scene. These pin the routing
// rules: scoping, dedup, mute, self/crop exclusion, and that a targets edit
// lands on the next resolve.

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

const routing = (scope: NonNullable<Track['targets']>[number]['scope']) =>
  ({ port: 'mover', scope, amount: 1 })

const objOf = (g: ReturnType<typeof resolveProject>, id: string) => {
  const obj = g.objects.find((o) => o.trackId === id)
  assert.ok(obj, `object ${id} resolved`)
  return obj
}

test('a targeted crop routes into exactly its targets and is flagged masksTargets', () => {
  const cube = track({ id: 'cube', instrumentId: 'cube' })
  const other = track({ id: 'other', instrumentId: 'cube' })
  const crop = track({ id: 'crop1', instrumentId: 'crop', targets: [routing({ kind: 'track', id: 'cube' })] })
  const g = resolveProject(snapshot([cube, other, crop], ['cube', 'other', 'crop1']))
  assert.deepEqual(objOf(g, 'cube').maskSourceIds, ['crop1'])
  assert.deepEqual(objOf(g, 'other').maskSourceIds, [])
  assert.equal(objOf(g, 'crop1').masksTargets, true)
})

test('an untargeted crop stays scene-wide: no routing, masksTargets false', () => {
  const cube = track({ id: 'cube', instrumentId: 'cube' })
  const crop = track({ id: 'crop1', instrumentId: 'crop' })
  const g = resolveProject(snapshot([cube, crop], ['cube', 'crop1']))
  assert.deepEqual(objOf(g, 'cube').maskSourceIds, [])
  assert.equal(objOf(g, 'crop1').masksTargets, false)
})

test('tag scope expands, duplicate routes dedup, and a muted crop routes nothing', () => {
  const a = track({ id: 'a', instrumentId: 'cube', tags: ['wall'] })
  const b = track({ id: 'b', instrumentId: 'cube', tags: ['wall'] })
  const crop = track({
    id: 'crop1', instrumentId: 'crop',
    targets: [routing({ kind: 'tag', tag: 'wall' }), routing({ kind: 'track', id: 'a' })],
  })
  const g = resolveProject(snapshot([a, b, crop], ['a', 'b', 'crop1']))
  assert.deepEqual(objOf(g, 'a').maskSourceIds, ['crop1'])
  assert.deepEqual(objOf(g, 'b').maskSourceIds, ['crop1'])

  const muted = { ...crop, muted: true }
  const g2 = resolveProject(snapshot([a, b, muted], ['a', 'b', 'crop1']))
  assert.deepEqual(objOf(g2, 'a').maskSourceIds, [])
  assert.deepEqual(objOf(g2, 'b').maskSourceIds, [])
})

test('a crop never masks itself or another crop', () => {
  const cropA = track({ id: 'cropA', instrumentId: 'crop', targets: [
    routing({ kind: 'track', id: 'cropA' }),
    routing({ kind: 'track', id: 'cropB' }),
  ] })
  const cropB = track({ id: 'cropB', instrumentId: 'crop' })
  const g = resolveProject(snapshot([cropA, cropB], ['cropA', 'cropB']))
  assert.deepEqual(objOf(g, 'cropA').maskSourceIds, [])
  assert.deepEqual(objOf(g, 'cropB').maskSourceIds, [])
})

test('a targets edit lands on the next resolve (per-emit, not deps-cached)', () => {
  const cube = track({ id: 'cube', instrumentId: 'cube' })
  const crop = track({ id: 'crop1', instrumentId: 'crop', targets: [routing({ kind: 'track', id: 'cube' })] })
  const before = resolveProject(snapshot([cube, crop], ['cube', 'crop1']))
  assert.deepEqual(objOf(before, 'cube').maskSourceIds, ['crop1'])
  // Immutable-store edit: targets cleared, cube untouched by reference.
  const cleared = { ...crop, targets: [] }
  const after = resolveProject(snapshot([cube, cleared], ['cube', 'crop1']))
  assert.deepEqual(objOf(after, 'cube').maskSourceIds, [])
  assert.equal(objOf(after, 'crop1').masksTargets, false)
})
