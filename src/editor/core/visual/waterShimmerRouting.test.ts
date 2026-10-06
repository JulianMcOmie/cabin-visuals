import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../../types'
import { resolveProject, type ProjectSnapshot } from './resolve'

// Water Shimmer's reach follows its NESTING: at the root it re-lights the
// whole scene (VisualScene's pass - nothing routed here), under an instrument
// only that instrument, under a group every object in it. These pin where its
// id lands (each target's shimmerSourceIds) and when its own object is flagged
// shimmersParent, which is what tells VisualScene to skip the scene-wide pass.

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

const objOf = (g: ReturnType<typeof resolveProject>, id: string) => {
  const obj = g.objects.find((o) => o.trackId === id)
  assert.ok(obj, `object ${id} resolved`)
  return obj
}

const shimmer = (partial: Partial<Track> = {}) => track({ id: 'water', instrumentId: 'waterShimmer', ...partial })

test('at the root a shimmer is scene-wide: nothing routed, shimmersParent false', () => {
  const g = resolveProject(snapshot([track({ id: 'cube', instrumentId: 'cube' }), shimmer()], ['cube', 'water']))
  assert.deepEqual(objOf(g, 'cube').shimmerSourceIds, [])
  assert.equal(objOf(g, 'water').shimmersParent, false)
})

test('nested under an instrument it re-lights exactly that instrument', () => {
  const cube = track({ id: 'cube', instrumentId: 'cube', childIds: ['water'] })
  const other = track({ id: 'other', instrumentId: 'cube' })
  const g = resolveProject(snapshot([cube, other, shimmer({ parentId: 'cube' })], ['cube', 'other']))
  assert.deepEqual(objOf(g, 'cube').shimmerSourceIds, ['water'])
  assert.deepEqual(objOf(g, 'other').shimmerSourceIds, [])
  assert.equal(objOf(g, 'water').shimmersParent, true)
  // It never re-lights itself.
  assert.deepEqual(objOf(g, 'water').shimmerSourceIds, [])
})

test('an instrument parent scopes it to that instrument alone, not to its nested objects', () => {
  const cube = track({ id: 'cube', instrumentId: 'cube', childIds: ['water', 'inner'] })
  const inner = track({ id: 'inner', instrumentId: 'cube', parentId: 'cube' })
  const g = resolveProject(snapshot([cube, inner, shimmer({ parentId: 'cube' })], ['cube']))
  assert.deepEqual(objOf(g, 'cube').shimmerSourceIds, ['water'])
  assert.deepEqual(objOf(g, 'inner').shimmerSourceIds, [])
})

test('nested under a group it re-lights every object in the group, however deep', () => {
  const group = track({ id: 'g', type: 'group', childIds: ['a', 'inner', 'water'] })
  const a = track({ id: 'a', instrumentId: 'cube', parentId: 'g' })
  const inner = track({ id: 'inner', type: 'group', parentId: 'g', childIds: ['b'] })
  const b = track({ id: 'b', instrumentId: 'cube', parentId: 'inner' })
  const outside = track({ id: 'outside', instrumentId: 'cube' })
  const g = resolveProject(snapshot([group, a, inner, b, outside, shimmer({ parentId: 'g' })], ['g', 'outside']))
  assert.deepEqual(objOf(g, 'a').shimmerSourceIds, ['water'])
  assert.deepEqual(objOf(g, 'b').shimmerSourceIds, ['water'])
  assert.deepEqual(objOf(g, 'outside').shimmerSourceIds, [])
  assert.equal(objOf(g, 'water').shimmersParent, true)
})

test('a device between the shimmer and its instrument is walked through', () => {
  // Under a root-level mover there is no instrument above: still scene-wide.
  const mover = track({ id: 'm', type: 'mover', moverId: 'mover', childIds: ['water'] })
  const loose = resolveProject(snapshot([mover, shimmer({ parentId: 'm' })], ['m']))
  assert.equal(objOf(loose, 'water').shimmersParent, false)

  // Under a mover that is itself a cube's child, the cube is the scope.
  const cube = track({ id: 'cube', instrumentId: 'cube', childIds: ['m'] })
  const chained = resolveProject(snapshot(
    [cube, { ...mover, parentId: 'cube' }, shimmer({ parentId: 'm' })], ['cube'],
  ))
  assert.deepEqual(objOf(chained, 'cube').shimmerSourceIds, ['water'])
})

test('a muted nested shimmer re-lights nothing', () => {
  const cube = track({ id: 'cube', instrumentId: 'cube', childIds: ['water'] })
  const g = resolveProject(snapshot([cube, shimmer({ parentId: 'cube', muted: true })], ['cube']))
  assert.deepEqual(objOf(g, 'cube').shimmerSourceIds, [])
})

test('soloing the instrument keeps its own nested shimmer live', () => {
  // Nested object tracks never inherit a parent's solo, so without the
  // exemption soloing a cube would silently switch its water off.
  const cube = track({ id: 'cube', instrumentId: 'cube', solo: true, childIds: ['water'] })
  const other = track({ id: 'other', instrumentId: 'cube' })
  const g = resolveProject(snapshot([cube, other, shimmer({ parentId: 'cube' })], ['cube', 'other']))
  assert.equal(objOf(g, 'water').muted, false)
  assert.equal(objOf(g, 'other').muted, true)
  assert.deepEqual(objOf(g, 'cube').shimmerSourceIds, ['water'])
})

test('a root-level shimmer still joins the solo pool like any scene-wide instrument', () => {
  const cube = track({ id: 'cube', instrumentId: 'cube', solo: true })
  const g = resolveProject(snapshot([cube, shimmer()], ['cube', 'water']))
  assert.equal(objOf(g, 'water').muted, true)
})

test('it never re-lights another shimmer or a crop, and several shimmers stack in tree order', () => {
  const group = track({ id: 'g', type: 'group', childIds: ['cube', 'crop', 'water', 'water2'] })
  const cube = track({ id: 'cube', instrumentId: 'cube', parentId: 'g' })
  const crop = track({ id: 'crop', instrumentId: 'crop', parentId: 'g' })
  const g = resolveProject(snapshot(
    [group, cube, crop, shimmer({ parentId: 'g' }), shimmer({ id: 'water2', parentId: 'g' })], ['g'],
  ))
  assert.deepEqual(objOf(g, 'cube').shimmerSourceIds, ['water', 'water2'])
  assert.deepEqual(objOf(g, 'crop').shimmerSourceIds, [])
  assert.deepEqual(objOf(g, 'water').shimmerSourceIds, [])
  assert.deepEqual(objOf(g, 'water2').shimmerSourceIds, [])
})

test('moving it out of its parent returns it to scene-wide on the next resolve', () => {
  const nested = resolveProject(snapshot(
    [track({ id: 'cube', instrumentId: 'cube', childIds: ['water'] }), shimmer({ parentId: 'cube' })], ['cube'],
  ))
  assert.deepEqual(objOf(nested, 'cube').shimmerSourceIds, ['water'])
  const loose = resolveProject(snapshot([track({ id: 'cube', instrumentId: 'cube' }), shimmer()], ['cube', 'water']))
  assert.deepEqual(objOf(loose, 'cube').shimmerSourceIds, [])
  assert.equal(objOf(loose, 'water').shimmersParent, false)
})
