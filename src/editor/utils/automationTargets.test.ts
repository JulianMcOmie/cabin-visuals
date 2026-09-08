import assert from 'node:assert/strict'
import test from 'node:test'
import { automationTargetsForParent, laneWearsAutoName } from './automationTargets'
import { sceneTrackId } from '../core/sceneTrack'
import { fxTarget, parseFxTarget } from '../effects/automation'
import type { Track } from '../types'

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 'parent', name: 'Parent', type: 'base', instrumentId: '', color: '#ffffff',
    muted: false, solo: false, childIds: [], blocks: [], ...overrides,
  }
}

const transformKeys = ['tfX', 'tfY', 'tfZ', 'tfRotX', 'tfRotY', 'tfRotZ', 'tfSize', 'tfOpacity']
const grade = { id: 'grade:1', pluginId: 'sceneGrade', enabled: true, settings: {} }

test('Group and Switcher offer the same transform targets and bounds', () => {
  const group = automationTargetsForParent(track({ type: 'group' }), false)
  const switcher = automationTargetsForParent(track({ type: 'switcher' }), false)
  assert.deepEqual(switcher, group)
  assert.deepEqual(switcher.map((option) => option.key), transformKeys)
  assert.deepEqual(switcher.find((option) => option.key === 'tfOpacity')?.bounds, { min: 0, max: 1 })
  assert.deepEqual(switcher.find((option) => option.key === 'tfRotX')?.bounds, { min: -180, max: 180 })
})

test('Crop on Main offers composition opacity; Crop in a visual scene offers object transforms', () => {
  const crop = track({ instrumentId: 'crop' })
  const main = automationTargetsForParent(crop, true)
  const scene = automationTargetsForParent(crop, false)
  assert.equal(main[0].key, 'opacity')
  assert.deepEqual(main[0].bounds, { min: 0, max: 1 })
  assert.equal(main.some((option) => option.key.startsWith('tf')), false)
  assert.deepEqual(scene.slice(0, transformKeys.length).map((option) => option.key), transformKeys)
  assert.equal(scene.some((option) => option.key === 'opacity'), false)
  assert.deepEqual(main.slice(1), scene.slice(transformKeys.length), 'both Crop surfaces retain the shared numeric controls')
})

test('splitters retain spatial targets and integer counts, without object opacity or select controls', () => {
  const options = automationTargetsForParent(track({ type: 'splitter', splitterId: 'grid' }), false)
  assert.deepEqual(options.slice(0, 7).map((option) => option.key), transformKeys.slice(0, 7))
  assert.equal(options.some((option) => option.key === 'tfOpacity'), false)
  assert.equal(options.some((option) => option.key === 'plane'), false)
  assert.equal(options.find((option) => option.key === 'rows')?.integer, true)
  assert.deepEqual(options.find((option) => option.key === 'columnsRadius')?.bounds, { min: 0, max: 20 })
})

test('ordinary movers offer their own numeric params without adding object transforms', () => {
  const options = automationTargetsForParent(track({ type: 'mover', moverId: 'contour' }), false)
  assert.deepEqual(options.map((option) => option.key), ['slope', 'centerX', 'centerY'])
  assert.deepEqual(options[0].bounds, { min: -4, max: 4 })
})

test('effect targets retain instance identity, numeric bounds and the separate On/Off option', () => {
  const options = automationTargetsForParent(track({ instrumentId: 'stars', effects: [grade, { ...grade, id: 'grade:2' }] }), false)
  const effects = options.filter((option) => parseFxTarget(option.key))
  assert.deepEqual(effects[0], { key: fxTarget('grade:1', 'enabled'), label: 'Grade · On/Off', combine: 'override' })
  assert.deepEqual(effects.find((option) => option.key === fxTarget('grade:1', 'exposure'))?.bounds, { min: -2, max: 2 })
  assert.ok(effects.some((option) => option.key === fxTarget('grade:2', 'exposure')))
  assert.equal(new Set(options.map((option) => option.key)).size, options.length)
  assert.ok(options.findIndex((option) => option.key === 'starCount') < options.indexOf(effects[0]))
})

test('Group broadcast effects are omitted while virtual scene effects remain automatable', () => {
  const group = track({ type: 'group', effects: [grade] })
  const scene = { ...group, id: sceneTrackId('scene-1') }
  assert.equal(automationTargetsForParent(group, false).some((option) => parseFxTarget(option.key)), false)
  assert.ok(automationTargetsForParent(scene, false).some((option) => option.key === fxTarget(grade.id, 'exposure')))
})

test('unknown definitions and removed effects yield no unusable targets', () => {
  assert.deepEqual(automationTargetsForParent(track({ instrumentId: 'removed', effects: [{ ...grade, pluginId: 'removed' }] }), false), [])
})

test('drag retargeting recognizes auto-names on Switcher and effect targets', () => {
  const parent = track({ type: 'switcher' })
  assert.equal(laneWearsAutoName(track({ type: 'automation', targetParam: 'tfSize', name: 'Size' }), parent, false), true)
  assert.equal(laneWearsAutoName(track({ type: 'automation', targetParam: 'tfSize', name: 'My size lane' }), parent, false), false)
  assert.equal(laneWearsAutoName(track({ type: 'automation', targetParam: fxTarget(grade.id, 'enabled'), name: 'Grade · On/Off' }), track({ effects: [grade] }), false), true)
})

test('real target menus carry semantic defaults for objects, splitters, movers, compositions and effects', () => {
  const cube = automationTargetsForParent(track({ instrumentId: 'cube', effects: [grade] }), false)
  const mode = (options: typeof cube, key: string) => options.find(o => o.key === key)?.combine
  assert.equal(mode(cube, 'size'), 'multiply')
  assert.equal(mode(cube, 'tfSize'), 'multiply')
  assert.equal(mode(cube, 'tfX'), 'sum')
  assert.equal(mode(cube, 'tfRotY'), 'sum')
  assert.equal(mode(cube, 'fx:grade:1:enabled'), 'override')
  assert.equal(mode(cube, 'fx:grade:1:exposure'), 'sum')
  assert.equal(mode(cube, 'fx:grade:1:amount'), 'override')
  const grid = automationTargetsForParent(track({ type: 'splitter', splitterId: 'grid' }), false)
  assert.equal(mode(grid, 'rows'), 'override')
  assert.equal(mode(grid, 'depth'), 'override')
  assert.equal(mode(grid, 'columnsRadius'), 'multiply')
  assert.equal(mode(automationTargetsForParent(track({ type: 'mover', moverId: 'contour' }), false), 'centerX'), 'sum')
  assert.equal(mode(automationTargetsForParent(track({ instrumentId: 'crop' }), true), 'opacity'), 'multiply')
})
