import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import type { Scene, Track } from '../../types'
import { sceneTrackView } from '../sceneTrack'
import { resolveProject } from './resolve'
import { resolveVisualCopies } from '../visualCopies/resolveVisualCopies'

const track = (p: Partial<Track> & { id: string }): Track => ({
  name: p.id, type: 'base', instrumentId: '', color: '#fff', muted: false, solo: false,
  blocks: [], childIds: [], ...p,
})
const warp = (parentId?: string) => track({
  id: 'warp', type: 'mover', moverId: 'polarWarp', parentId,
  inputValues: { attack: 0.5, release: 0.75 },
  blocks: [{ id: 'block', startBar: 0, durationBars: 1, loop: false, notes: [
    { id: 'note', pitch: 40, startBeat: 0, durationBeats: 2, velocity: 1 },
  ] }],
})
const object = (id: string, parentId?: string) => track({ id, parentId, instrumentId: 'cube' })
function affected(tracks: Record<string, Track>, rootTrackIds: string[]) {
  const graph = resolveProject({ tracks, rootTrackIds, bpm: 120, beatsPerBar: 4 })
  const placement = new Matrix4().makeTranslation(7, 2, 0)
  return graph.objects.filter((o) => {
    const copies = resolveVisualCopies(o.moverAndSplitterChain, 1, placement)
    return !copies[0].transform.equals(new Matrix4())
  }).map((o) => o.trackId).sort()
}

test('a root Polar Warp follows existing global target routing', () => {
  assert.deepEqual(affected({ a: object('a'), b: object('b'), warp: { ...warp(), targets: ['a', 'b'].map((id) => ({ port: '', scope: { kind: 'track' as const, id }, amount: 1 })) } }, ['a', 'b', 'warp']), ['a', 'b'])
})
test('a group Polar Warp affects preceding member subtrees, never outsiders', () => {
  const tracks = {
    g: track({ id: 'g', type: 'group', childIds: ['a', 'nested', 'warp'] }),
    a: object('a', 'g'), nested: track({ id: 'nested', type: 'group', parentId: 'g', childIds: ['b'] }),
    b: object('b', 'nested'), c: object('c'), warp: warp('g'),
  }
  assert.deepEqual(affected(tracks, ['g', 'c']), ['a', 'b'])
})
test('a scene instrument Polar Warp reaches every root and nested object', () => {
  const scene: Scene = {
    id: 'scene', name: 'Scene', isMain: false, backgroundColor: '#000', backgroundTransparent: false,
    sceneTrackEnabled: true, sceneTrackChildIds: ['warp'], rootTrackIds: ['a', 'g'],
    tracks: { a: object('a'), g: track({ id: 'g', type: 'group', childIds: ['b'] }), b: object('b', 'g'), warp: warp() },
  }
  const view = sceneTrackView(scene)
  assert.deepEqual(affected(view.tracks, view.rootTrackIds), ['a', 'b'])
})
