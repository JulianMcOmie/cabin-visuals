import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../../types'
import { getPriorVisualCopyCount, resolveProject, type ProjectSnapshot } from './resolve'
import { structuralCopyCount } from '../visualCopies/resolveVisualCopies'
import { computeAtBeat, getObjectState, getVisualCopies, setProject } from './VisualEngine'

// GROUP tracks in the resolved graph: they emit placement nodes (not objects),
// their chain children broadcast to all member objects, and their
// mute/solo cascades onto member objects.

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

test('a group resolves to a placement node, not an object', () => {
  const g = track({ id: 'g', type: 'group', childIds: ['a'] })
  const a = track({ id: 'a', instrumentId: 'cube', parentId: 'g' })
  const graph = resolveProject(snapshot([g, a], ['g']))
  assert.deepEqual(graph.objects.map((o) => o.trackId), ['a'])
  assert.equal(graph.groups?.length, 1)
  assert.equal(graph.groups?.[0].trackId, 'g')
  assert.equal(graph.groups?.[0].afterObjectIndex, 0)
})

test('a group chain child broadcasts to members on both sides of its row', () => {
  const g = track({ id: 'g', type: 'group', childIds: ['a', 'sp', 'b'] })
  const a = track({ id: 'a', instrumentId: 'cube', parentId: 'g' })
  const sp = track({ id: 'sp', type: 'splitter', splitterId: 'radial', inputValues: { copies: 3 }, parentId: 'g' })
  const b = track({ id: 'b', instrumentId: 'cube', parentId: 'g' })
  const graph = resolveProject(snapshot([g, a, sp, b], ['g']))
  const objA = graph.objects.find((o) => o.trackId === 'a')!
  const objB = graph.objects.find((o) => o.trackId === 'b')!
  assert.equal(structuralCopyCount(objA.moverAndSplitterChain), 3, 'member above the splitter splits')
  assert.equal(structuralCopyCount(objB.moverAndSplitterChain), 3, 'member below the splitter splits too')
})

test('a leading burst Mover moves every copy of nested group members, never outsiders', () => {
  const g = track({ id: 'g', type: 'group', childIds: ['mv', 'a', 'inner'] })
  const mv = track({ id: 'mv', type: 'mover', moverId: 'mover', parentId: 'g',
    inputValues: { motion: 1, mode: 0, angleX: 0, angleY: 0, angleZ: 90, angle: 1.4 },
    blocks: [{ id: 'block', startBar: 0, durationBars: 4, loop: false, notes: [
      { id: 'note', pitch: 64, startBeat: 0, durationBeats: 1, velocity: 1 },
    ] }],
  })
  const a = track({ id: 'a', instrumentId: 'cube', parentId: 'g', childIds: ['sp'] })
  const sp = track({ id: 'sp', type: 'splitter', splitterId: 'radial', parentId: 'a', inputValues: { copies: 3 } })
  const inner = track({ id: 'inner', type: 'group', parentId: 'g', childIds: ['b'] })
  const b = track({ id: 'b', instrumentId: 'cube', parentId: 'inner' })
  const x = track({ id: 'x', instrumentId: 'cube' })
  const p = snapshot([g, mv, a, sp, inner, b, x], ['g', 'x'])
  assert.equal(getPriorVisualCopyCount('mv', p), 3, 'copy targeting includes members below the Mover')
  setProject(p)
  computeAtBeat(0)
  const before = ['a', 'b', 'x'].map(id => getVisualCopies(id).map(c => [...c.transform.elements]))
  computeAtBeat(1)
  for (const [index, id] of ['a', 'b'].entries()) {
    const copies = getVisualCopies(id)
    assert.equal(copies.length, before[index].length)
    copies.forEach((copy, i) => assert.notDeepEqual(copy.transform.elements, before[index][i], `${id} copy ${i} rotates`))
  }
  assert.deepEqual(getVisualCopies('x').map(c => c.transform.elements), before[2])
  const after = getVisualCopies('a').map(c => [...c.transform.elements])
  computeAtBeat(0)
  computeAtBeat(1)
  assert.deepEqual(getVisualCopies('a').map(c => c.transform.elements), after, 'scrubbing is deterministic')
})

test('inner group entries land before outer group entries on a member chain', () => {
  const outer = track({ id: 'outer', type: 'group', childIds: ['inner', 'spOuter'] })
  const inner = track({ id: 'inner', type: 'group', parentId: 'outer', childIds: ['a', 'spInner'] })
  const a = track({ id: 'a', instrumentId: 'cube', parentId: 'inner' })
  const spInner = track({ id: 'spInner', type: 'splitter', splitterId: 'radial', inputValues: { copies: 2 }, parentId: 'inner' })
  const spOuter = track({ id: 'spOuter', type: 'splitter', splitterId: 'radial', inputValues: { copies: 3 }, parentId: 'outer' })
  const graph = resolveProject(snapshot([outer, inner, a, spInner, spOuter], ['outer']))
  const objA = graph.objects.find((o) => o.trackId === 'a')!
  assert.equal(objA.moverAndSplitterChain.length, 2)
  // Both splits compound: 2 (inner) x 3 (outer).
  assert.equal(structuralCopyCount(objA.moverAndSplitterChain), 6)
})

test('group mute silences members; group solo keeps its members in the pool', () => {
  const g = track({ id: 'g', type: 'group', muted: true, childIds: ['a'] })
  const a = track({ id: 'a', instrumentId: 'cube', parentId: 'g' })
  const x = track({ id: 'x', instrumentId: 'cube' })
  const muted = resolveProject(snapshot([g, a, x], ['g', 'x']))
  assert.equal(muted.objects.find((o) => o.trackId === 'a')?.muted, true)
  assert.equal(muted.objects.find((o) => o.trackId === 'x')?.muted, false)

  const gSolo = { ...g, muted: false, solo: true }
  const soloed = resolveProject(snapshot([gSolo, a, x], ['g', 'x']))
  assert.equal(soloed.objects.find((o) => o.trackId === 'a')?.muted, false, 'soloed group keeps its members on')
  assert.equal(soloed.objects.find((o) => o.trackId === 'x')?.muted, true, 'everything else leaves the pool')
})

test('group tf* and tfOpacity apply to members per frame; nested groups compound', () => {
  const outer = track({ id: 'outer', type: 'group', params: { tfX: 3, tfOpacity: 0.5 }, childIds: ['inner'] })
  const inner = track({ id: 'inner', type: 'group', parentId: 'outer', params: { tfX: 1 }, childIds: ['a'] })
  const a = track({ id: 'a', instrumentId: 'cube', parentId: 'inner' })
  const x = track({ id: 'x', instrumentId: 'cube' })
  setProject(snapshot([outer, inner, a, x], ['outer', 'x']))
  computeAtBeat(0)
  const member = getObjectState('a')!
  const outsider = getObjectState('x')!
  // World x = outer 3 + inner 1; opacity halves through the outer group.
  assert.equal(member.world.elements[12], 4)
  assert.equal(member.opacity, 0.5)
  assert.equal(outsider.world.elements[12], 0)
  assert.equal(outsider.opacity, 1)
})

test('getPriorVisualCopyCount for a group entry uses the largest member chain', () => {
  const g = track({ id: 'g', type: 'group', childIds: ['a', 'b', 'mv'] })
  const a = track({ id: 'a', instrumentId: 'cube', parentId: 'g', childIds: ['aSp'] })
  const aSp = track({ id: 'aSp', type: 'splitter', splitterId: 'radial', inputValues: { copies: 4 }, parentId: 'a' })
  const b = track({ id: 'b', instrumentId: 'cube', parentId: 'g' })
  const mv = track({ id: 'mv', type: 'mover', moverId: 'visibility', parentId: 'g' })
  const p = snapshot([g, a, aSp, b, mv], ['g'])
  assert.equal(getPriorVisualCopyCount('mv', p), 4)
})
