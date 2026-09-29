import assert from 'node:assert/strict'
import test from 'node:test'
import { AmbientLight, DirectionalLight, Group, PerspectiveCamera, PointLight, RectAreaLight, Scene, ShaderMaterial, SpotLight, Texture } from 'three'
import { createFogUniforms, syncFogUniforms } from './fogRuntime'
import { FOG_MAX_LIGHTS } from './fog'
import { defaultLightDesc, PassLightPool, registerLightAnchor } from '../../core/visual/sceneLights'

test('fog follows mirrored light placement, color, flashes, mute and preview budgets', () => {
  const scene = new Scene(), camera = new PerspectiveCamera(), depth = new Texture()
  const uniforms = createFogUniforms(), material = new ShaderMaterial({ uniforms })
  const anchor = new Group(), parent = new Group()
  parent.position.set(2, 0, 0); parent.add(anchor); anchor.position.set(1, 3, 4)
  const desc = { ...defaultLightDesc(), on: true, color: '#ff0000', intensity: 6 }
  const unregister = registerLightAnchor({ sceneId: 'fog-test', key: 'light:0', object: anchor, desc })
  const pool = new PassLightPool(scene)
  const sync = () => syncFogUniforms(material, scene, camera, depth)
  try {
    pool.sync('fog-test', false); sync()
    assert.equal(uniforms.fogLightCount.value, 1)
    assert.deepEqual(uniforms.fogLightPosition.value[0].toArray(), [3, 3, 4])
    assert.deepEqual(uniforms.fogLightColor.value[0].toArray(), [6, 0, 0])
    desc.intensity = 12; desc.color = '#0000ff'
    pool.sync('fog-test', false); sync()
    assert.deepEqual(uniforms.fogLightColor.value[0].toArray(), [0, 0, 12])
    parent.visible = false; pool.sync('fog-test', false); sync()
    assert.equal(uniforms.fogLightCount.value, 0)
    parent.visible = true; pool.sync('fog-test', false, 'trimmed'); sync()
    assert.equal(uniforms.fogLightCount.value, 0)
    pool.sync('fog-test', false, 'full'); sync()
    assert.equal(uniforms.fogLightCount.value, 1)
    desc.on = false; pool.sync('fog-test', false); sync()
    assert.equal(uniforms.fogLightCount.value, 0)
  } finally { unregister(); pool.dispose(); material.dispose(); depth.dispose() }
})

test('fog packs spot cones, directional aims, area sizes, ambient and camera matrices', () => {
  const scene = new Scene(), camera = new PerspectiveCamera(40, 2, 0.1, 100)
  camera.position.set(0, 0, 10)
  const spot = new SpotLight(0xffffff, 3, 20, Math.PI / 4, 0.5, 2)
  spot.position.set(0, 0, 5)
  const sun = new DirectionalLight(); sun.position.set(0, 4, 0)
  const area = new RectAreaLight(0xffffff, 2, 4, 6)
  scene.add(spot, sun, area, new AmbientLight(0xff0000, 0.5))
  const uniforms = createFogUniforms(), material = new ShaderMaterial({ uniforms }), depth = new Texture()
  syncFogUniforms(material, scene, camera, depth)
  assert.equal(uniforms.fogLightCount.value, 3)
  assert.deepEqual(uniforms.fogLightDirection.value[0].toArray(), [0, 0, -1])
  assert.equal(uniforms.fogLightShape.value[0].w, Math.cos(Math.PI / 4))
  assert.equal(uniforms.fogLightExtra.value[0].x, Math.cos(Math.PI / 8))
  assert.deepEqual(uniforms.fogLightDirection.value[1].toArray(), [0, -1, 0])
  assert.deepEqual(uniforms.fogLightExtra.value[2].toArray(), [1, 4, 6])
  assert.deepEqual(uniforms.fogAmbient.value.toArray(), [0.5, 0, 0])
  assert.deepEqual(uniforms.fogProjectionInverse.value.elements, camera.projectionMatrixInverse.elements)
  assert.equal(uniforms.fogCameraWorld.value.elements[14], 10)
  assert.equal(uniforms.tDepth.value, depth)
  material.dispose(); depth.dispose()
})

test('fog light work is bounded and removed lights cannot leave stale illumination', () => {
  const scene = new Scene(), camera = new PerspectiveCamera(), depth = new Texture()
  const uniforms = createFogUniforms(), material = new ShaderMaterial({ uniforms })
  for (let i = 0; i < FOG_MAX_LIGHTS + 5; i++) scene.add(new PointLight())
  syncFogUniforms(material, scene, camera, depth)
  assert.equal(uniforms.fogLightCount.value, FOG_MAX_LIGHTS)
  scene.clear(); syncFogUniforms(material, scene, camera, depth)
  assert.equal(uniforms.fogLightCount.value, 0)
  assert.deepEqual(uniforms.fogAmbient.value.toArray(), [0, 0, 0])
  material.dispose(); depth.dispose()
})
