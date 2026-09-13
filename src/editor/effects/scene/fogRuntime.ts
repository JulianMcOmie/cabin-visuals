import {
  AmbientLight, Camera, DirectionalLight, HemisphereLight, Matrix4,
  PointLight, RectAreaLight, Scene, SpotLight, Vector3, Vector4,
  type ShaderMaterial, type Texture,
} from 'three'
import { FOG_MAX_LIGHTS } from './fog'

export function createFogUniforms() {
  return {
    tDepth: { value: null as Texture | null },
    fogProjectionInverse: { value: new Matrix4() },
    fogCameraWorld: { value: new Matrix4() },
    fogAmbient: { value: new Vector3() },
    fogLightCount: { value: 0 },
    fogLightPosition: { value: Array.from({ length: FOG_MAX_LIGHTS }, () => new Vector3()) },
    fogLightColor: { value: Array.from({ length: FOG_MAX_LIGHTS }, () => new Vector3()) },
    fogLightDirection: { value: Array.from({ length: FOG_MAX_LIGHTS }, () => new Vector3()) },
    fogLightShape: { value: Array.from({ length: FOG_MAX_LIGHTS }, () => new Vector4()) },
    fogLightExtra: { value: Array.from({ length: FOG_MAX_LIGHTS }, () => new Vector3()) },
  }
}

/** Read the actual pass rig AFTER pool sync, so transforms, mute, fades,
 * note flashes, legacy lighting and preview budgets all agree with surfaces.
 * Arrays are retained across frames; the eight-light cap bounds GPU work.
 * Volume shadows are not sampled; opaque camera-ray occlusion comes from depth. */
export function syncFogUniforms(material: ShaderMaterial, scene: Scene, camera: Camera, depth: Texture) {
  const u = material.uniforms as ReturnType<typeof createFogUniforms>
  u.tDepth.value = depth
  camera.updateWorldMatrix(true, false)
  u.fogProjectionInverse.value.copy(camera.projectionMatrixInverse)
  u.fogCameraWorld.value.copy(camera.matrixWorld)
  const ambient = u.fogAmbient.value.set(0, 0, 0)
  let count = 0
  scene.traverseVisible((light) => {
    if (light instanceof AmbientLight || light instanceof HemisphereLight) {
      const c = light.color, intensity = Math.max(0, light.intensity)
      const ground = light instanceof HemisphereLight ? light.groundColor : c
      ambient.x += (c.r + ground.r) * 0.5 * intensity
      ambient.y += (c.g + ground.g) * 0.5 * intensity
      ambient.z += (c.b + ground.b) * 0.5 * intensity
      return
    }
    if (!(light instanceof PointLight || light instanceof SpotLight || light instanceof DirectionalLight || light instanceof RectAreaLight)) return
    if (light.intensity <= 0 || count >= FOG_MAX_LIGHTS) return
    const i = count++
    light.getWorldPosition(u.fogLightPosition.value[i])
    u.fogLightColor.value[i].set(light.color.r, light.color.g, light.color.b).multiplyScalar(light.intensity)
    const direction = u.fogLightDirection.value[i].set(0, 0, -1)
    const shape = u.fogLightShape.value[i].set(0, 0, 2, -1)
    const extra = u.fogLightExtra.value[i].set(1, 0, 0)
    if (light instanceof DirectionalLight || light instanceof SpotLight) {
      light.target.getWorldPosition(direction)
      direction.sub(u.fogLightPosition.value[i]).normalize()
      shape.x = light instanceof SpotLight ? 1 : 2
    }
    if (light instanceof PointLight || light instanceof SpotLight) {
      shape.y = light.distance
      shape.z = light.decay
    }
    if (light instanceof SpotLight) {
      shape.w = Math.cos(light.angle)
      extra.x = Math.cos(light.angle * (1 - light.penumbra))
    }
    if (light instanceof RectAreaLight) {
      shape.x = 3
      direction.transformDirection(light.matrixWorld)
      extra.y = light.width
      extra.z = light.height
    }
  })
  u.fogLightCount.value = count
}
