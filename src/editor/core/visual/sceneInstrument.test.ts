import assert from 'node:assert/strict'
import test from 'node:test'
import type { Scene, Track } from '../../types'
import { sceneTrackId, sceneTrackView } from '../sceneTrack'
import { resolveProject, type ProjectSnapshot } from './resolve'
import { structuralCopyCount } from '../visualCopies/resolveVisualCopies'
import { computeAtBeat, getSceneBackdrop, getSceneFxOverrides, setProject } from './VisualEngine'

// What the scene instrument means to the ENGINE: it parents every root object,
// its movers/splitters broadcast to all of them, and its COLORIZERS are held
// out of every object chain and painted onto the backdrop instead.

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

const SCENE_ID = 's1'
const ST = sceneTrackId(SCENE_ID)

function scene(partial: Partial<Scene> = {}): Scene {
  return {
    id: SCENE_ID,
    name: 'Scene 1',
    isMain: false,
    backgroundColor: '#204080',
    backgroundTransparent: false,
    tracks: {},
    rootTrackIds: [],
    sceneTrackEnabled: true,
    ...partial,
  }
}

function snapshotOf(s: Scene): ProjectSnapshot {
  const view = sceneTrackView(s)
  return { tracks: view.tracks, rootTrackIds: view.rootTrackIds, beatsPerBar: 4, bpm: 120 }
}

/** Hue Rotate is the passive, knob-driven colorizer - no notes, `rotate` is the
 *  automation target - which makes it the natural backdrop device and a
 *  deterministic test vehicle. `spread: 0` removes the position mapping, which
 *  a backdrop has no meaningful value for anyway. */
function colorizerLane(id: string, rotate: number): Track {
  return track({
    id,
    type: 'mover',
    moverId: 'hueRotate',
    parentId: ST,
    inputValues: { rotate, spread: 0 },
  })
}

test('the scene instrument resolves as a placement node parenting every root object', () => {
  const graph = resolveProject(snapshotOf(scene({
    tracks: { a: track({ id: 'a', instrumentId: 'cube' }), b: track({ id: 'b', instrumentId: 'cube' }) },
    rootTrackIds: ['a', 'b'],
  })))
  assert.equal(graph.groups?.some((g) => g.trackId === ST), true)
  assert.equal(graph.groups?.find((g) => g.trackId === ST)?.afterObjectIndex, 0, 'composed before any object reads it')
  for (const o of graph.objects) assert.equal(o.parentId, ST, `${o.trackId} inherits the scene transform`)
})

test('a nested track keeps its own parent - only ROOTS parent on the scene', () => {
  const graph = resolveProject(snapshotOf(scene({
    tracks: {
      g: track({ id: 'g', type: 'group', childIds: ['a'] }),
      a: track({ id: 'a', instrumentId: 'cube', parentId: 'g' }),
    },
    rootTrackIds: ['g'],
  })))
  assert.equal(graph.objects[0].parentId, 'g')
  assert.equal(graph.groups?.find((gr) => gr.trackId === 'g')?.parentId, ST)
})

test('the scene instrument never parents itself', () => {
  const graph = resolveProject(snapshotOf(scene()))
  assert.equal(graph.groups?.find((g) => g.trackId === ST)?.parentId, undefined)
})

test('a splitter on the scene broadcasts to every object in the scene', () => {
  const graph = resolveProject(snapshotOf(scene({
    tracks: {
      a: track({ id: 'a', instrumentId: 'cube' }),
      b: track({ id: 'b', instrumentId: 'cube' }),
      sp: track({ id: 'sp', type: 'splitter', splitterId: 'radial', inputValues: { copies: 3 }, parentId: ST }),
    },
    rootTrackIds: ['a', 'b'],
    sceneTrackChildIds: ['sp'],
  })))
  for (const o of graph.objects) {
    assert.equal(structuralCopyCount(o.moverAndSplitterChain), 3, `${o.trackId} split`)
  }
})

test('a colorizer on the scene is kept OUT of the object chains', () => {
  const graph = resolveProject(snapshotOf(scene({
    tracks: {
      a: track({ id: 'a', instrumentId: 'cube' }),
      cz: colorizerLane('cz', 0.5),
    },
    rootTrackIds: ['a'],
    sceneTrackChildIds: ['cz'],
  })))
  assert.equal(graph.objects[0].moverAndSplitterChain.length, 0, 'the cube is untouched')
  assert.equal(graph.backdropChain?.length, 1, 'it went to the backdrop instead')
})

test('with no scene instrument there is no backdrop chain at all', () => {
  const graph = resolveProject(snapshotOf(scene({
    sceneTrackEnabled: undefined,
    tracks: { a: track({ id: 'a', instrumentId: 'cube' }) },
    rootTrackIds: ['a'],
  })))
  assert.equal(graph.backdropChain, undefined)
  assert.equal(graph.objects[0].parentId, undefined, 'and nothing is reparented')
})

// ── Through the engine, to the pixel the renderer clears with ────────────────

function project(s: Scene) {
  return {
    scenes: { [SCENE_ID]: s },
    sceneOrder: [SCENE_ID],
    activeSceneId: SCENE_ID,
    bpm: 120,
    beatsPerBar: 4,
    totalBars: 32,
  }
}

test('the backdrop reads the document when nothing drives it', () => {
  setProject(project(scene({ sceneTrackEnabled: undefined })) as never)
  computeAtBeat(0)
  assert.equal(getSceneBackdrop(SCENE_ID)?.color, '#204080')
})

test('a colorizer on the scene tints the backdrop', () => {
  setProject(project(scene({
    tracks: { cz: colorizerLane('cz', 0.5) },
    sceneTrackChildIds: ['cz'],
  })) as never)
  computeAtBeat(0)
  const backdrop = getSceneBackdrop(SCENE_ID)!
  assert.notEqual(backdrop.color, '#204080', 'the stored colour is not what renders')

  // ...and an inert colorizer leaves it exactly alone, so the chain is only
  // ever additive to what the user set in the backdrop console.
  setProject(project(scene({
    tracks: { cz: colorizerLane('cz', 0) },
    sceneTrackChildIds: ['cz'],
  })) as never)
  computeAtBeat(0)
  assert.equal(getSceneBackdrop(SCENE_ID)?.color, '#204080')
})

test('both gradient stops travel through the same shift', () => {
  setProject(project(scene({
    backgroundGradient: { enabled: true, kind: 'linear', from: '#204080', to: '#000000', angle: 0 },
    tracks: { cz: colorizerLane('cz', 0.5) },
    sceneTrackChildIds: ['cz'],
  })) as never)
  computeAtBeat(0)
  const gradient = getSceneBackdrop(SCENE_ID)!.gradient!
  assert.notEqual(gradient.from, '#204080', 'the lit stop turns')
  // Black has no hue to rotate, so it stays put - which is the honest result
  // and pins that the two stops go through one shift rather than two.
  assert.equal(gradient.to, '#000000')
})

test('a transparent backdrop is left alone - there is no colour to shift', () => {
  setProject(project(scene({
    backgroundTransparent: true,
    tracks: { cz: colorizerLane('cz', 0.5) },
    sceneTrackChildIds: ['cz'],
  })) as never)
  computeAtBeat(0)
  assert.equal(getSceneBackdrop(SCENE_ID)?.transparent, true)
})

// ── The scene EFFECT chain's automation (fx: lanes on the scene instrument) ──

/** A keyframe lane on the scene instrument targeting one device's AMOUNT.
 *  Pitch 36 is the param's min, 84 its max (core/trackTypes.ts). */
function fxLane(id: string, instanceId: string, pitch: number): Track {
  return track({
    id,
    type: 'automation',
    parentId: ST,
    targetParam: `fx:${instanceId}:amount`,
    blocks: [{
      id: `${id}-b`,
      startBar: 0,
      durationBars: 1,
      loop: false,
      notes: [{ id: `${id}-n`, startBeat: 0, durationBeats: 1, pitch, velocity: 100 }],
    }],
  })
}

const GRADE = { id: 'fx1', pluginId: 'sceneGrade', enabled: true, settings: { amount: 1 } }

test('an fx lane on the scene instrument resolves into sceneFxAutomations, not any object', () => {
  const graph = resolveProject(snapshotOf(scene({
    effects: [GRADE],
    tracks: {
      a: track({ id: 'a', instrumentId: 'cube' }),
      lane: fxLane('lane', 'fx1', 36),
    },
    rootTrackIds: ['a'],
    sceneTrackChildIds: ['lane'],
  })))
  assert.equal(graph.sceneFxAutomations?.length, 1)
  assert.equal(graph.sceneFxAutomations?.[0].instanceId, 'fx1')
  assert.equal(graph.objects[0].effectAutomations.length, 0, 'no object carries it')
})

test('computeAtBeat samples fx lanes into the per-scene override map', () => {
  setProject(project(scene({
    effects: [GRADE],
    tracks: { lane: fxLane('lane', 'fx1', 36) },
    sceneTrackChildIds: ['lane'],
  })) as never)
  computeAtBeat(0)
  // Pitch 36 = the amount param's min (0), overriding the stored 1.
  assert.equal(getSceneFxOverrides(SCENE_ID)?.fx1?.amount, 0)
})

test('with no fx lanes the override map is absent - stored settings pass through untouched', () => {
  setProject(project(scene({ effects: [GRADE] })) as never)
  computeAtBeat(0)
  assert.equal(getSceneFxOverrides(SCENE_ID), undefined)
})

test('the backdrop is a pure function of the beat - same beat, same colour', () => {
  setProject(project(scene({
    tracks: { cz: colorizerLane('cz', 0.35) },
    sceneTrackChildIds: ['cz'],
  })) as never)
  computeAtBeat(7.25)
  const first = getSceneBackdrop(SCENE_ID)?.color
  computeAtBeat(99)
  computeAtBeat(7.25)
  assert.equal(getSceneBackdrop(SCENE_ID)?.color, first)
})
