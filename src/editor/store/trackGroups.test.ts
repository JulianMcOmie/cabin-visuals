import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../types'
import { useProjectStore } from './ProjectStore'

// groupTracks / ungroupTrack (⌘⇧G): members reparent under a new 'group' track
// in timeline order, and dissolving splices them back where the group sat.

function obj(id: string, partial: Partial<Track> = {}): Track {
  return {
    id,
    name: id,
    type: 'base',
    instrumentId: 'cube',
    color: '#fff',
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
    ...partial,
  }
}

test('groupTracks wraps the selection in timeline order and lands in the first member slot', () => {
  const s = useProjectStore.getState()
  s.addTrack(obj('grp-a'))
  s.addTrack(obj('grp-b'))
  s.addTrack(obj('grp-c'))

  // Selection order deliberately reversed: members follow the timeline, not the clicks.
  const gid = s.groupTracks(['grp-c', 'grp-a'])
  assert.ok(gid)
  const st = useProjectStore.getState()
  const g = st.tracks[gid!]
  assert.equal(g.type, 'group')
  assert.deepEqual(g.childIds, ['grp-a', 'grp-c'])
  assert.equal(st.tracks['grp-a'].parentId, gid)
  assert.equal(st.tracks['grp-c'].parentId, gid)
  const roots = st.rootTrackIds
  assert.ok(roots.includes(gid!))
  assert.ok(roots.indexOf(gid!) < roots.indexOf('grp-b'), 'group takes the first member\'s slot')
  assert.ok(!roots.includes('grp-a') && !roots.includes('grp-c'))
})

test('groupTracks skips lanes and members riding inside a selected ancestor', () => {
  const s = useProjectStore.getState()
  s.addTrack(obj('nest-p'))
  s.addTrack(obj('nest-c', { parentId: 'nest-p' }))
  s.addTrack(obj('nest-lane', { type: 'automation', instrumentId: '', targetParam: 'tfX', parentId: 'nest-p' }))

  const gid = s.groupTracks(['nest-p', 'nest-c', 'nest-lane'])
  assert.ok(gid)
  const st = useProjectStore.getState()
  // Only the ancestor became a member; its subtree rode along intact.
  assert.deepEqual(st.tracks[gid!].childIds, ['nest-p'])
  assert.equal(st.tracks['nest-c'].parentId, 'nest-p')
  assert.equal(st.tracks['nest-lane'].parentId, 'nest-p')
})

test('groupTracks returns null when nothing groupable is selected', () => {
  const s = useProjectStore.getState()
  assert.equal(s.groupTracks(['no-such-track']), null)
})

test('ungroupTrack splices members back into the group\'s slot and deletes its lanes', () => {
  const s = useProjectStore.getState()
  s.addTrack(obj('ug-a'))
  s.addTrack(obj('ug-b'))
  s.addTrack(obj('ug-tail'))
  const gid = s.groupTracks(['ug-a', 'ug-b'])!
  // A lane on the group itself dies with the group - it has nothing to target.
  s.addTrack(obj('ug-lane', { type: 'automation', instrumentId: '', targetParam: 'tfRotY', parentId: gid }))

  s.ungroupTrack(gid)
  const st = useProjectStore.getState()
  assert.equal(st.tracks[gid], undefined)
  assert.equal(st.tracks['ug-lane'], undefined)
  const roots = st.rootTrackIds
  assert.ok(roots.indexOf('ug-a') < roots.indexOf('ug-b'))
  assert.ok(roots.indexOf('ug-b') < roots.indexOf('ug-tail'), 'members return to the group\'s slot, not the end')
  assert.equal(st.tracks['ug-a'].parentId, undefined)
})
