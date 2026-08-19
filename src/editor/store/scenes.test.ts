import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyDocument } from '../../persistence/types'
import { hydrate, serialize } from '../../persistence/serialize'
import { sceneBackdropMode, type Track } from '../types'
import { useProjectStore } from './ProjectStore'

const cube = (id: string): Track => ({ id, name: id, type: 'base', instrumentId: 'cube', color: '#fff', muted: false, solo: false, blocks: [], childIds: [] })

test('track edits are written only into the selected scene ownership map', () => {
  hydrate(emptyDocument())
  const firstId = useProjectStore.getState().activeSceneId
  useProjectStore.getState().addTrack(cube('one'))
  const secondId = useProjectStore.getState().addScene()
  useProjectStore.getState().setActiveScene(secondId)
  useProjectStore.getState().addTrack(cube('two'))
  const state = useProjectStore.getState()
  assert.ok(state.scenes[firstId].tracks.one)
  assert.equal(state.scenes[firstId].tracks.two, undefined)
  assert.ok(state.scenes[secondId].tracks.two)
  assert.equal(state.scenes[secondId].tracks.one, undefined)
})

test('active compatibility fields are not serialized as a second ownership source', () => {
  const doc = serialize() as unknown as Record<string, unknown>
  assert.equal('tracks' in doc, false)
  assert.equal('rootTrackIds' in doc, false)
  assert.ok(doc.scenes)
})

test('selected scene is persisted and restored without duplicating its tracks', () => {
  hydrate(emptyDocument())
  const secondId = useProjectStore.getState().addScene()
  useProjectStore.getState().setActiveScene(secondId)
  useProjectStore.getState().addTrack(cube('selected'))

  const doc = serialize()
  assert.equal(doc.activeSceneId, secondId)
  hydrate(doc)

  const state = useProjectStore.getState()
  assert.equal(state.activeSceneId, secondId)
  assert.ok(state.tracks.selected)
  assert.equal(state.scenes[secondId].tracks.selected, state.tracks.selected)
})

test('older v5 documents without a selected scene fall back to the first visual scene', () => {
  const doc = emptyDocument()
  const firstVisualId = doc.sceneOrder.find((id) => !doc.scenes[id].isMain)!
  delete doc.activeSceneId

  hydrate(doc)

  assert.equal(useProjectStore.getState().activeSceneId, firstVisualId)
})

test('scene background color defaults, edits, duplicates, and persists with the scene', () => {
  hydrate(emptyDocument())
  const sceneId = useProjectStore.getState().activeSceneId
  assert.equal(useProjectStore.getState().scenes[sceneId].backgroundColor, '#000000')

  useProjectStore.getState().setSceneBackgroundColor(sceneId, '#123456')
  useProjectStore.getState().setSceneBackgroundTransparent(sceneId, true)
  const copyId = useProjectStore.getState().duplicateScene(sceneId)!
  assert.equal(useProjectStore.getState().scenes[copyId].backgroundColor, '#123456')
  assert.equal(useProjectStore.getState().scenes[copyId].backgroundTransparent, true)

  const document = serialize()
  hydrate(document)
  assert.equal(useProjectStore.getState().scenes[sceneId].backgroundColor, '#123456')
  assert.equal(useProjectStore.getState().scenes[sceneId].backgroundTransparent, true)
})

test('scene backdrop gradient: atomic mode switches, config survival, duplication, persistence', () => {
  hydrate(emptyDocument())
  const sceneId = useProjectStore.getState().activeSceneId
  assert.equal(sceneBackdropMode(useProjectStore.getState().scenes[sceneId]), 'color')

  useProjectStore.getState().setSceneBackdropMode(sceneId, 'gradient')
  let scene = useProjectStore.getState().scenes[sceneId]
  assert.equal(sceneBackdropMode(scene), 'gradient')
  assert.equal(scene.backgroundTransparent, false)

  useProjectStore.getState().setSceneBackgroundGradient(sceneId, { kind: 'radial', from: '#ff8800', to: '#112233', angle: 135 })

  // Leaving gradient mode keeps the setup; coming back restores it verbatim.
  useProjectStore.getState().setSceneBackdropMode(sceneId, 'transparent')
  scene = useProjectStore.getState().scenes[sceneId]
  assert.equal(sceneBackdropMode(scene), 'transparent')
  assert.equal(scene.backgroundGradient!.enabled, false)
  assert.equal(scene.backgroundGradient!.from, '#ff8800')
  useProjectStore.getState().setSceneBackdropMode(sceneId, 'gradient')

  const expected = { enabled: true, kind: 'radial', from: '#ff8800', to: '#112233', angle: 135 }
  const copyId = useProjectStore.getState().duplicateScene(sceneId)!
  assert.deepEqual(useProjectStore.getState().scenes[copyId].backgroundGradient, expected)

  const document = serialize()
  hydrate(document)
  assert.deepEqual(useProjectStore.getState().scenes[sceneId].backgroundGradient, expected)
  assert.equal(sceneBackdropMode(useProjectStore.getState().scenes[sceneId]), 'gradient')
})

test('a scene never starts with effects on it - the chain is opt-in', () => {
  // Scene FX devices are ADDED by hand, never seeded: a new project, a new
  // scene and a copy of an empty scene all come up with no chain at all, so
  // the full-frame passes cost nothing until someone asks for one.
  hydrate(emptyDocument())
  for (const scene of Object.values(useProjectStore.getState().scenes)) {
    assert.equal(scene.effects, undefined, `${scene.name} was seeded with an effect chain`)
  }
  const addedId = useProjectStore.getState().addScene()
  assert.equal(useProjectStore.getState().scenes[addedId].effects, undefined)
  const copyId = useProjectStore.getState().duplicateScene(addedId)!
  assert.equal(useProjectStore.getState().scenes[copyId].effects, undefined)
})

test('scene effect chain edits, reorders, duplicates with fresh ids, and persists with the scene', () => {
  hydrate(emptyDocument())
  const sceneId = useProjectStore.getState().activeSceneId

  useProjectStore.getState().addSceneEffect(sceneId, 'sceneGrade')
  useProjectStore.getState().addSceneEffect(sceneId, 'sceneGlitch')
  let effects = useProjectStore.getState().scenes[sceneId].effects!
  assert.deepEqual(effects.map((e) => e.pluginId), ['sceneGrade', 'sceneGlitch'])
  assert.ok(effects.every((e) => e.enabled))

  const [grade, glitch] = effects
  useProjectStore.getState().reorderSceneEffect(sceneId, glitch.id, -1)
  useProjectStore.getState().toggleSceneEffect(sceneId, grade.id)
  useProjectStore.getState().setSceneEffectSetting(sceneId, glitch.id, 'amount', 0.5)
  effects = useProjectStore.getState().scenes[sceneId].effects!
  assert.deepEqual(effects.map((e) => e.pluginId), ['sceneGlitch', 'sceneGrade'])
  assert.equal(effects.find((e) => e.id === grade.id)!.enabled, false)
  assert.equal(effects.find((e) => e.id === glitch.id)!.settings.amount, 0.5)

  const copyId = useProjectStore.getState().duplicateScene(sceneId)!
  const copied = useProjectStore.getState().scenes[copyId].effects!
  assert.deepEqual(copied.map((e) => e.pluginId), ['sceneGlitch', 'sceneGrade'])
  assert.ok(copied.every((e) => !effects.some((source) => source.id === e.id)))

  hydrate(serialize())
  assert.deepEqual(useProjectStore.getState().scenes[sceneId].effects!.map((e) => e.pluginId), ['sceneGlitch', 'sceneGrade'])

  useProjectStore.getState().removeSceneEffect(sceneId, grade.id)
  assert.deepEqual(useProjectStore.getState().scenes[sceneId].effects!.map((e) => e.pluginId), ['sceneGlitch'])
})

test('adding a scene extends every director binding and keeps the active Main view in sync', () => {
  hydrate(emptyDocument())
  const state = useProjectStore.getState()
  const mainId = state.sceneOrder.find((id) => state.scenes[id].isMain)!
  state.setActiveScene(mainId)
  state.addTrack({
    id: 'cut', name: 'Cut', type: 'base', instrumentId: 'cut',
    color: '#6366f1', muted: false, solo: false, blocks: [], childIds: [], sceneBindings: [],
  })

  const nextSceneId = useProjectStore.getState().addScene()
  const next = useProjectStore.getState()
  assert.equal(next.tracks.cut.sceneBindings?.at(-1)?.sceneId, nextSceneId)
  assert.equal(next.scenes[mainId].tracks.cut.sceneBindings?.at(-1)?.sceneId, nextSceneId)
})

test('moving a root track transfers its complete subtree with stable ids', () => {
  hydrate(emptyDocument())
  const sourceId = useProjectStore.getState().activeSceneId
  const targetId = useProjectStore.getState().addScene()
  const root = { ...cube('visual'), childIds: ['motion'] }
  const child: Track = {
    id: 'motion', name: 'Burst', type: 'mover', instrumentId: '', moverId: 'mover',
    color: '#fff', muted: false, solo: false, blocks: [], childIds: [], parentId: root.id,
  }
  useProjectStore.getState().addTrackTree([root, child])

  useProjectStore.getState().moveTrackToScene(root.id, targetId)
  const moved = useProjectStore.getState()
  assert.equal(moved.scenes[sourceId].tracks.visual, undefined)
  assert.equal(moved.scenes[sourceId].tracks.motion, undefined)
  assert.deepEqual(moved.scenes[targetId].rootTrackIds, ['visual'])
  assert.equal(moved.scenes[targetId].tracks.visual.childIds[0], 'motion')
  assert.equal(moved.scenes[targetId].tracks.motion.parentId, 'visual')
  assert.equal(moved.tracks.visual, undefined)

  moved.setActiveScene(targetId)
  assert.equal(useProjectStore.getState().tracks.visual.id, 'visual')
  assert.equal(useProjectStore.getState().tracks.motion.id, 'motion')
})

test('scene transfer rejects child rows and incompatible Main destinations', () => {
  hydrate(emptyDocument())
  const state = useProjectStore.getState()
  const sourceId = state.activeSceneId
  const mainId = state.sceneOrder.find((id) => state.scenes[id].isMain)!
  const root = { ...cube('visual'), childIds: ['motion'] }
  const child: Track = {
    id: 'motion', name: 'Burst', type: 'mover', instrumentId: '', moverId: 'mover',
    color: '#fff', muted: false, solo: false, blocks: [], childIds: [], parentId: root.id,
  }
  state.addTrackTree([root, child])

  useProjectStore.getState().moveTrackToScene('motion', mainId)
  useProjectStore.getState().moveTrackToScene('visual', mainId)
  assert.ok(useProjectStore.getState().scenes[sourceId].tracks.visual)
  assert.ok(useProjectStore.getState().scenes[sourceId].tracks.motion)
  assert.equal(useProjectStore.getState().scenes[mainId].tracks.visual, undefined)
})
