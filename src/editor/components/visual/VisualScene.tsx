import { Fragment, useEffect, useMemo, useSyncExternalStore } from 'react'
import { createPortal, useFrame, useThree } from '@react-three/fiber'
import {
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  BufferGeometry,
  Float32BufferAttribute,
  Scene as ThreeScene,
  WebGLRenderTarget,
  LinearFilter,
} from 'three'
import { getCompositionLayers, setMountedRenderScenes, subscribeObjects, getObjectList } from '../../core/visual/VisualEngine'
import type { CompositionLayer } from '../../core/directors'
import { useProjectStore } from '../../store/ProjectStore'
import { getInstrument } from '../../instruments'
import { DEFAULT_SCENE_BACKGROUND } from '../../types'
import { ObjectRenderer } from './ObjectRenderer'

interface MountedScene {
  base: ThreeScene
  front: ThreeScene
  target: WebGLRenderTarget
}

interface PartitionUniforms {
  radial: { value: number }
  index: { value: number }
  count: { value: number }
  aspect: { value: number }
}

function makeCompositorGeometry() {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(12), 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(new Float32Array(8), 2))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  return geometry
}

/** Shape one compositor quad into a full-height screen partition while keeping
 * UVs in final-frame coordinates, so each scene is cropped rather than squeezed. */
function setPartitionGeometry(geometry: BufferGeometry, partition?: CompositionLayer['partition']) {
  const linear = partition?.kind === 'linear' ? partition : undefined
  const count = linear ? Math.max(1, linear.count) : 1
  const start = linear ? linear.index / count : 0
  const end = linear ? (linear.index + 1) / count : 1
  const halfSlant = (linear?.slant ?? 0) / 2
  const xs = [start - halfSlant, end - halfSlant, end + halfSlant, start + halfSlant]
  const ys = [0, 0, 1, 1]
  const positions = geometry.getAttribute('position') as Float32BufferAttribute
  const uvs = geometry.getAttribute('uv') as Float32BufferAttribute
  for (let i = 0; i < 4; i++) {
    positions.setXYZ(i, -1 + xs[i] * 2, -1 + ys[i] * 2, 0)
    uvs.setXY(i, xs[i], ys[i])
  }
  positions.needsUpdate = true
  uvs.needsUpdate = true
}

function makeCompositorMaterial() {
  const uniforms: PartitionUniforms = {
    radial: { value: 0 },
    index: { value: 0 },
    count: { value: 1 },
    aspect: { value: 1 },
  }
  const material = new MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false })
  material.userData.partitionUniforms = uniforms
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      partitionRadial: uniforms.radial,
      partitionIndex: uniforms.index,
      partitionCount: uniforms.count,
      partitionAspect: uniforms.aspect,
    })
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec2 vPartitionUv;\nvoid main() {')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvPartitionUv = uv;')
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `
varying vec2 vPartitionUv;
uniform float partitionRadial;
uniform float partitionIndex;
uniform float partitionCount;
uniform float partitionAspect;
void main() {`)
      .replace('#include <clipping_planes_fragment>', `
#include <clipping_planes_fragment>
if (partitionRadial > 0.5) {
  vec2 p = vPartitionUv - vec2(0.5);
  p.x *= partitionAspect;
  float maxRadius = 0.5 * length(vec2(partitionAspect, 1.0));
  float radius = length(p) / maxRadius;
  float innerRadius = partitionIndex / partitionCount;
  float outerRadius = (partitionIndex + 1.0) / partitionCount;
  if (radius < innerRadius || radius > outerRadius) discard;
}`)
  }
  material.customProgramCacheKey = () => 'scene-partition-v1'
  return material
}

function lights() {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[4, 6, 4]} intensity={1.4} castShadow />
      <pointLight position={[-4, -2, 3]} color="#818cf8" intensity={3} />
      <pointLight position={[3, 3, -4]} color="#f0abfc" intensity={1.5} />
    </>
  )
}

/**
 * Every logical project scene stays mounted in its own literal THREE.Scene.
 * A second scene per runtime is the existing "In front" pass; the compositor
 * renders it after clearing depth, preserving hard overlay semantics inside the
 * scene while keeping depth/lights isolated from every other project scene.
 *
 * The final compositor consumes an ORDERED ARRAY of layers. Today those layers
 * come from preview or Scene Switcher, but multiple directors already append
 * simultaneous layers without a singular active-scene assumption.
 */
export function VisualScene() {
  const objects = useSyncExternalStore(subscribeObjects, getObjectList, getObjectList)
  const { gl, camera, size } = useThree()
  const sceneKey = [...new Set(objects.map((o) => o.sceneId))].sort().join(',')
  const mounted = useMemo(() => {
    const map = new Map<string, MountedScene>()
    for (const sceneId of sceneKey ? sceneKey.split(',') : []) {
      map.set(sceneId, {
        base: new ThreeScene(),
        front: new ThreeScene(),
        target: new WebGLRenderTarget(Math.max(1, size.width), Math.max(1, size.height), {
          minFilter: LinearFilter,
          magFilter: LinearFilter,
        }),
      })
    }
    return map
  // Scene structure changes on resolve; target resizing is handled separately.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneKey])

  const compositor = useMemo(() => {
    const scene = new ThreeScene()
    const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 2)
    cam.position.z = 1
    const meshes: Mesh[] = []
    return { scene, cam, meshes }
  }, [])

  useEffect(() => {
    for (const runtime of mounted.values()) runtime.target.setSize(Math.max(1, size.width), Math.max(1, size.height))
  }, [mounted, size.width, size.height])

  useEffect(() => {
    const roots = new Map<string, ThreeScene>()
    for (const [sceneId, runtime] of mounted) {
      roots.set(`${sceneId}:base`, runtime.base)
      roots.set(`${sceneId}:front`, runtime.front)
    }
    setMountedRenderScenes(roots)
    return () => setMountedRenderScenes(new Map())
  }, [mounted])

  useEffect(() => () => {
    for (const runtime of mounted.values()) runtime.target.dispose()
  }, [mounted])

  useEffect(() => () => {
    for (const mesh of compositor.meshes) {
      mesh.geometry.dispose()
      ;(mesh.material as MeshBasicMaterial).dispose()
    }
  }, [compositor])

  const onTopKey = useProjectStore((s) => objects.map((o) => {
    const track = s.scenes[o.sceneId]?.tracks[o.trackId]
    return (track?.onTop ?? getInstrument(o.instrumentId)?.defaultOnTop ?? false) ? '1' : '0'
  }).join(''))

  useFrame(() => {
    const previous = gl.getRenderTarget()
    const previousAutoClear = gl.autoClear
    gl.autoClear = false
    try {
      const layers = getCompositionLayers()
      const requested = new Set(layers.map((layer) => layer.sceneId))

      for (const sceneId of requested) {
        const runtime = mounted.get(sceneId)
        if (!runtime) continue
        gl.setRenderTarget(runtime.target)
        gl.setClearColor(useProjectStore.getState().scenes[sceneId]?.backgroundColor ?? DEFAULT_SCENE_BACKGROUND, 1)
        gl.clear(true, true, true)
        gl.render(runtime.base, camera)
        gl.clearDepth()
        gl.render(runtime.front, camera)
      }

      while (compositor.meshes.length < layers.length) {
        const material = makeCompositorMaterial()
        const geometry = makeCompositorGeometry()
        setPartitionGeometry(geometry)
        const mesh = new Mesh(geometry, material)
        mesh.frustumCulled = false
        compositor.meshes.push(mesh)
        compositor.scene.add(mesh)
      }
      compositor.meshes.forEach((mesh, i) => {
        const layer = layers[i]
        mesh.visible = !!layer
        if (!layer) return
        const runtime = mounted.get(layer.sceneId)
        mesh.visible = !!runtime
        if (!runtime) return
        const material = mesh.material as MeshBasicMaterial
        if (material.map !== runtime.target.texture) {
          material.map = runtime.target.texture
          material.needsUpdate = true
        }
        material.opacity = layer.opacity
        setPartitionGeometry(mesh.geometry, layer.partition)
        const uniforms = material.userData.partitionUniforms as PartitionUniforms
        const radial = layer.partition?.kind === 'radial' ? layer.partition : undefined
        uniforms.radial.value = radial ? 1 : 0
        uniforms.index.value = radial?.index ?? 0
        uniforms.count.value = Math.max(1, radial?.count ?? 1)
        uniforms.aspect.value = Math.max(0.0001, size.width / Math.max(1, size.height))
        if (layer.partition) {
          mesh.position.set(0, 0, -i * 0.001)
          mesh.scale.set(1, 1, 1)
        } else {
          mesh.position.set(
            -1 + layer.viewport.x * 2 + layer.viewport.width,
            -1 + layer.viewport.y * 2 + layer.viewport.height,
            -i * 0.001,
          )
          mesh.scale.set(layer.viewport.width, layer.viewport.height, 1)
        }
        mesh.renderOrder = i
      })

      gl.setRenderTarget(previous)
      const project = useProjectStore.getState()
      const mainId = project.sceneOrder.find((id) => project.scenes[id]?.isMain)
      gl.setClearColor(mainId ? project.scenes[mainId].backgroundColor : DEFAULT_SCENE_BACKGROUND, 1)
      gl.clear(true, true, true)
      gl.render(compositor.scene, compositor.cam)
    } finally {
      gl.setRenderTarget(previous)
      gl.autoClear = previousAutoClear
    }
  }, 100)

  return (
    <>
      {[...mounted.entries()].map(([sceneId, runtime]) => {
        const sceneObjects = objects.filter((o) => o.sceneId === sceneId)
        const base = sceneObjects.filter((o) => onTopKey[objects.indexOf(o)] !== '1')
        const front = sceneObjects.filter((o) => onTopKey[objects.indexOf(o)] === '1')
        return (
          <Fragment key={sceneId}>
            {createPortal(
            <>
              {lights()}
              {base.map((o) => <ObjectRenderer key={`${o.trackId}:${o.visualCopyIndex}`} sceneId={o.sceneId} trackId={o.trackId} instrumentId={o.instrumentId} visualCopyIndex={o.visualCopyIndex} />)}
            </>,
            runtime.base,
            )}
            {createPortal(
            <>
              {lights()}
              {front.map((o) => <ObjectRenderer key={`${o.trackId}:${o.visualCopyIndex}:front`} sceneId={o.sceneId} trackId={o.trackId} instrumentId={o.instrumentId} visualCopyIndex={o.visualCopyIndex} />)}
            </>,
            runtime.front,
            )}
          </Fragment>
        )
      })}
    </>
  )
}
