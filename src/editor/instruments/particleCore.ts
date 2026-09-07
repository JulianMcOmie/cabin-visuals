import { AdditiveBlending, Color, InstancedMesh, Matrix4, Mesh, ShaderMaterial, Vector3 } from 'three'
import type { Camera, Intersection, PlaneGeometry } from 'three'
import { FORCE_TRANSPARENT_KEY } from '../core/visual/animatedOpacity'
import { PARTICLE_COLOR, PARTICLE_GLOW } from './Particle'

const scale = new Vector3()

/** CPU mirror of the shader's camera-facing quad, used only for picking. */
export function particleBillboard(out: Matrix4, world: Matrix4, cameraWorld: Matrix4): Matrix4 {
  const e = world.elements
  const x = e[12], y = e[13], z = e[14]
  const size = Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]))
  return out.extractRotation(cameraWorld).scale(scale.setScalar(size)).setPosition(x, y, z)
}

/** Shader billboards avoid CPU rotations and extra instance-buffer uploads.
 * Reconstruct a quad only when it is picked, as with GPU Stars. */
export function configureParticlePicking(mesh: Mesh<PlaneGeometry, ShaderMaterial>) {
  let camera: Camera | undefined
  const pickMesh = new Mesh(mesh.geometry, mesh.material)
  const world = new Matrix4()
  const hits: Intersection[] = []
  mesh.onBeforeRender = (_renderer, _scene, drawnCamera) => { camera = drawnCamera }
  mesh.raycast = (raycaster, intersections) => {
    const viewCamera = raycaster.camera ?? camera
    if (!viewCamera) return
    const instanced = mesh instanceof InstancedMesh
    const count = instanced ? mesh.count : 1
    const radius = mesh.material.uniforms.uGlow.value > 0 ? 0.5 : 0.275
    for (let i = 0; i < count; i++) {
      if (instanced) {
        mesh.getMatrixAt(i, world)
        world.premultiply(mesh.matrixWorld)
      } else world.copy(mesh.matrixWorld)
      particleBillboard(pickMesh.matrixWorld, world, viewCamera.matrixWorld)
      hits.length = 0
      pickMesh.raycast(raycaster, hits)
      for (const hit of hits) {
        if (hit.uv && Math.hypot(hit.uv.x - 0.5, hit.uv.y - 0.5) > radius) continue
        hit.object = mesh
        if (instanced) hit.instanceId = i
        intersections.push(hit)
      }
    }
  }
}

export function createParticleMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'Particle',
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    userData: { [FORCE_TRANSPARENT_KEY]: true },
    uniforms: {
      uColor: { value: new Color(PARTICLE_COLOR) },
      uGlow: { value: PARTICLE_GLOW },
      uOpacity: { value: 1 },
    },
    vertexShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec4 vColor;
      #ifdef USE_INSTANCING
        attribute vec4 particleColor;
      #endif
      void main() {
        vUv = uv;
        mat4 world = modelMatrix;
        #ifdef USE_INSTANCING
          world *= instanceMatrix;
          vColor = particleColor;
        #else
          vColor = vec4(uColor, uOpacity);
        #endif
        float diameter = max(length(world[0].xyz), max(length(world[1].xyz), length(world[2].xyz)));
        vec4 center = viewMatrix * world[3];
        center.xy += position.xy * diameter;
        gl_Position = projectionMatrix * center;
      }
    `,
    fragmentShader: `
      uniform float uGlow;
      varying vec2 vUv;
      varying vec4 vColor;
      void main() {
        float r = length(vUv * 2.0 - 1.0);
        if (r >= 1.0) discard;
        float core = 1.0 - smoothstep(0.35, 0.55, r);
        float halo = (1.0 - smoothstep(0.1, 1.0, r)) * min(uGlow, 1.0) * 0.45;
        gl_FragColor = vec4(vColor.rgb * (1.0 + uGlow * 3.0), max(core, halo) * vColor.a);
      }
    `,
  })
}
