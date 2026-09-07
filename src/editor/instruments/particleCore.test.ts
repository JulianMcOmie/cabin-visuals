import assert from 'node:assert/strict'
import test from 'node:test'
import { AdditiveBlending, Euler, InstancedMesh, Matrix4, Mesh, PerspectiveCamera, PlaneGeometry, Quaternion, Raycaster, Vector2, Vector3 } from 'three'
import type { Intersection } from 'three'
import { particleInstrument, PARTICLE_SIZE } from './Particle'
import { configureParticlePicking, createParticleMaterial, particleBillboard } from './particleCore'

test('a particle is a standing object whose size does not pulse with MIDI energy', () => {
  assert.equal(particleInstrument.localTransform!({ params: {}, energy: 0, beat: 0 }).scale, PARTICLE_SIZE)
  assert.equal(particleInstrument.localTransform!({ params: { size: 0.4 }, energy: 1, beat: 9 }).scale, 0.4)
  assert.ok(particleInstrument.instancedComponent)
})

test('billboard picking preserves its center and scale under rotations and mirrors', () => {
  const camera = new Matrix4().makeRotationFromEuler(new Euler(0.4, 0.7, 0.2)).setPosition(8, 3, 5)
  const world = new Matrix4().compose(new Vector3(1, 2, 3), new Quaternion().setFromEuler(new Euler(1, 2, 0.3)), new Vector3(-2, 3, 1))
  const result = particleBillboard(new Matrix4(), world, camera)
  const alias = world.clone()
  particleBillboard(alias, alias, camera)
  assert.deepEqual(alias.elements, result.elements)
  assert.deepEqual(new Vector3().setFromMatrixPosition(result).toArray(), [1, 2, 3])
  assert.ok(new Vector3().setFromMatrixScale(result).distanceTo(new Vector3(3, 3, 3)) < 1e-12)
  const facing = new Vector3().setFromMatrixColumn(result, 2).normalize()
  assert.ok(facing.distanceTo(new Vector3().setFromMatrixColumn(camera, 2)) < 1e-12)
})

test('the material needs no lights, textures, shadow pass, or order-dependent copy blending', () => {
  const material = createParticleMaterial()
  assert.equal(material.lights, false)
  assert.equal(material.depthWrite, false)
  assert.equal(material.blending, AdditiveBlending)
  assert.equal(material.uniforms.uOpacity.value, 1)
  assert.ok(!Object.values(material.uniforms).some(u => u.value?.isTexture))
  material.dispose()
})

test('GPU-facing quads are pickable from a side view without rewriting render matrices', () => {
  const camera = new PerspectiveCamera(55, 1, 0.1, 100)
  camera.position.set(5, 0, 0)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const mesh = new Mesh(new PlaneGeometry(2, 2), createParticleMaterial())
  configureParticlePicking(mesh)
  const before = mesh.matrixWorld.clone()
  const ray = new Raycaster()
  ray.setFromCamera(new Vector2(0, 0), camera)
  const hits: Intersection[] = []
  mesh.raycast(ray, hits)
  assert.ok(hits.length > 0)
  assert.ok(hits.every(hit => hit.object === mesh && Math.abs(hit.distance - 5) < 1e-10))
  assert.deepEqual(mesh.matrixWorld.elements, before.elements)
  mesh.geometry.dispose()
  mesh.material.dispose()
})

test('batched picking identifies the live instance and ignores invisible quad corners', () => {
  const camera = new PerspectiveCamera(55, 1, 0.1, 100)
  camera.position.z = 5
  camera.updateMatrixWorld()
  const mesh = new InstancedMesh(new PlaneGeometry(2, 2), createParticleMaterial(), 2)
  mesh.setMatrixAt(0, new Matrix4().makeTranslation(3, 0, 0))
  mesh.setMatrixAt(1, new Matrix4())
  configureParticlePicking(mesh)
  const before = Array.from(mesh.instanceMatrix.array)
  const ray = new Raycaster()
  ray.setFromCamera(new Vector2(0, 0), camera)
  const hits: Intersection[] = []
  mesh.raycast(ray, hits)
  assert.ok(hits.length > 0)
  assert.ok(hits.every(hit => hit.object === mesh && hit.instanceId === 1))
  ray.set(new Vector3(0.9, 0.9, 5), new Vector3(0, 0, -1))
  hits.length = 0
  mesh.raycast(ray, hits)
  assert.equal(hits.length, 0)
  assert.deepEqual(Array.from(mesh.instanceMatrix.array), before)
  mesh.geometry.dispose()
  mesh.material.dispose()
  mesh.dispose()
})
