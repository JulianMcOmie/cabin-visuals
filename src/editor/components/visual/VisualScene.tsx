import { Fragment, useEffect, useMemo, useSyncExternalStore } from 'react'
import { createPortal, useFrame, useThree } from '@react-three/fiber'
import {
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene as ThreeScene,
  WebGLRenderTarget,
  LinearFilter,
} from 'three'
import { getCompositionLayers, setMountedRenderScenes, subscribeObjects, getObjectList } from '../../core/visual/VisualEngine'
import { useProjectStore } from '../../store/ProjectStore'
import { getInstrument } from '../../instruments'
import { ObjectRenderer } from './ObjectRenderer'

interface MountedScene {
  base: ThreeScene
  front: ThreeScene
  target: WebGLRenderTarget
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
    const geometry = new PlaneGeometry(2, 2)
    const meshes: Mesh[] = []
    return { scene, cam, geometry, meshes }
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
    compositor.geometry.dispose()
    for (const mesh of compositor.meshes) (mesh.material as MeshBasicMaterial).dispose()
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
        gl.setClearColor(0x09090b, 0)
        gl.clear(true, true, true)
        gl.render(runtime.base, camera)
        gl.clearDepth()
        gl.render(runtime.front, camera)
      }

      while (compositor.meshes.length < layers.length) {
        const material = new MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false })
        const mesh = new Mesh(compositor.geometry, material)
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
        material.map = runtime.target.texture
        material.opacity = layer.opacity
        material.needsUpdate = true
        mesh.position.set(
          -1 + layer.viewport.x * 2 + layer.viewport.width,
          -1 + layer.viewport.y * 2 + layer.viewport.height,
          -i * 0.001,
        )
        mesh.scale.set(layer.viewport.width, layer.viewport.height, 1)
        mesh.renderOrder = i
      })

      gl.setRenderTarget(previous)
      gl.setClearColor(0x09090b, 1)
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
