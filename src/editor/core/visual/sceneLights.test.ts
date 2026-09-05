import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AmbientLight, DirectionalLight, Object3D, PointLight, RectAreaLight, Scene } from 'three'
import {
  FLAT_LIGHT_INTENSITY,
  LIGHT_TYPE_AMBIENT,
  LIGHT_TYPE_AREA,
  LIGHT_TYPE_DIRECTIONAL,
  LIGHT_TYPE_POINT,
  PassLightPool,
  defaultLightDesc,
  lightTypeSurvivesTrim,
  registerLightAnchor,
} from './sceneLights'
import { previewLighting } from '../../store/UIStore'

// One anchor per light type, all shining, the directional one wishing to cast.
function rig(sceneId: string) {
  const unregister: Array<() => void> = []
  for (const [key, type] of [
    ['a', LIGHT_TYPE_AMBIENT],
    ['d', LIGHT_TYPE_DIRECTIONAL],
    ['p', LIGHT_TYPE_POINT],
    ['r', LIGHT_TYPE_AREA],
  ] as const) {
    const desc = { ...defaultLightDesc(), on: true, type, castShadow: type === LIGHT_TYPE_DIRECTIONAL }
    unregister.push(registerLightAnchor({ sceneId, key, object: new Object3D(), desc }))
  }
  return () => unregister.forEach((u) => u())
}

function lightsIn(scene: Scene) {
  const out = { ambient: [] as AmbientLight[], directional: [] as DirectionalLight[], point: [] as PointLight[], area: [] as RectAreaLight[] }
  scene.traverse((o) => {
    if (!(o as { visible: boolean }).visible) return
    if (o instanceof DirectionalLight) out.directional.push(o)
    else if (o instanceof PointLight) out.point.push(o)
    else if (o instanceof RectAreaLight) out.area.push(o)
    else if (o instanceof AmbientLight) out.ambient.push(o)
  })
  return out
}

test('previewLighting: only the two fixed fast levels spend lighting', () => {
  assert.equal(previewLighting('final'), 'full')
  assert.equal(previewLighting('auto'), 'full')
  assert.equal(previewLighting('fast'), 'trimmed')
  assert.equal(previewLighting('fastest'), 'flat')
})

test('trimmed keeps ambient + directional, drops shadows and the fills', () => {
  const done = rig('s1')
  const scene = new Scene()
  const pool = new PassLightPool(scene)
  try {
    pool.sync('s1', true, 'full')
    let lit = lightsIn(scene)
    assert.equal(lit.directional.length, 1)
    assert.equal(lit.directional[0].castShadow, true)
    assert.equal(lit.point.length, 1)
    assert.equal(lit.area.length, 1)
    assert.ok(lit.ambient.length >= 1)

    pool.sync('s1', true, 'trimmed')
    lit = lightsIn(scene)
    assert.equal(lit.directional.length, 1)
    assert.equal(lit.directional[0].castShadow, false, 'trimmed never pays the shadow pass')
    assert.equal(lit.point.length, 0)
    assert.equal(lit.area.length, 0)
    assert.ok(lit.ambient.length >= 1)
    assert.ok(lightTypeSurvivesTrim(LIGHT_TYPE_AMBIENT) && lightTypeSurvivesTrim(LIGHT_TYPE_DIRECTIONAL))
    assert.ok(!lightTypeSurvivesTrim(LIGHT_TYPE_POINT) && !lightTypeSurvivesTrim(LIGHT_TYPE_AREA))
  } finally {
    pool.dispose()
    done()
  }
})

test('flat drops every mirrored light for one albedo ambient, and comes back', () => {
  const done = rig('s2')
  const scene = new Scene()
  const pool = new PassLightPool(scene)
  try {
    pool.sync('s2', true, 'full')
    pool.sync('s2', true, 'flat')
    let lit = lightsIn(scene)
    assert.equal(lit.directional.length + lit.point.length + lit.area.length, 0)
    assert.equal(lit.ambient.length, 1)
    assert.equal(lit.ambient[0].intensity, FLAT_LIGHT_INTENSITY)
    assert.equal(FLAT_LIGHT_INTENSITY, Math.PI)

    pool.sync('s2', true, 'full')
    lit = lightsIn(scene)
    assert.equal(lit.directional.length, 1)
    assert.equal(lit.point.length, 1)
    assert.equal(lit.area.length, 1)
    // The flat ambient is hidden, not left adding to the full rig.
    assert.ok(lit.ambient.every((a) => a.intensity !== FLAT_LIGHT_INTENSITY))
  } finally {
    pool.dispose()
    done()
  }
})

test('a scene with no light tracks still gets the flat ambient', () => {
  const scene = new Scene()
  const pool = new PassLightPool(scene)
  pool.sync('nobody', false, 'flat')
  assert.equal(lightsIn(scene).ambient.length, 1)
  pool.dispose()
  assert.equal(lightsIn(scene).ambient.length, 0)
})
