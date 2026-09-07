import test from 'node:test'
import assert from 'node:assert/strict'
import type { Track } from '../../types'
import { trackPreviewTargets } from './trackPreviewTargets'

const track = (id: string, values: Partial<Track> = {}): Track => ({
  id, name: id, type: 'base', instrumentId: '',
  childIds: [], blocks: [], muted: false, solo: false, color: '#fff', ...values,
})
const tracks = {
  group: track('group', { type: 'group', childIds: ['a', 'b'] }),
  a: track('a', { instrumentId: 'cube', parentId: 'group', childIds: ['device'], tags: ['blue'] }),
  b: track('b', { instrumentId: 'cube', parentId: 'group' }),
  device: track('device', { type: 'mover', parentId: 'a' }),
  routed: track('routed', { type: 'mover', targets: [{ port: '', amount: 1, scope: { kind: 'tag', tag: 'blue' } }] }),
}

test('objects are isolated, groups include descendants, device rows show their affected object', () => {
  assert.deepEqual([...trackPreviewTargets('a', tracks)], ['a'])
  assert.deepEqual([...trackPreviewTargets('group', tracks)], ['a', 'b'])
  assert.deepEqual([...trackPreviewTargets('device', tracks)], ['a'])
  assert.deepEqual([...trackPreviewTargets('routed', tracks)], ['a'])
  assert.deepEqual([...trackPreviewTargets('scene-track:test', tracks)], ['a', 'b'])
})

test('missing targets and malformed subtree cycles terminate without inventing objects', () => {
  assert.equal(trackPreviewTargets('missing', tracks).size, 0)
  const cyclic = { ...tracks, group: { ...tracks.group, childIds: ['a', 'group'] } }
  assert.deepEqual([...trackPreviewTargets('group', cyclic)], ['a'])
})

test('group devices include only preceding members; scene devices see scene objects', () => {
  const grouped = {
    ...tracks,
    group: { ...tracks.group, childIds: ['a', 'device', 'b'] },
    a: { ...tracks.a, childIds: [] },
    device: { ...tracks.device, parentId: 'group' },
  }
  assert.deepEqual([...trackPreviewTargets('device', grouped)], ['a'])
  assert.deepEqual([...trackPreviewTargets('device', {
    ...grouped, device: { ...grouped.device, parentId: 'scene-track:test' },
  })], ['a', 'b'])
})
