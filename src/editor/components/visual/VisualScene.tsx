import { Fragment, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { createPortal, useFrame, useThree } from '@react-three/fiber'
import {
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  BufferGeometry,
  Float32BufferAttribute,
  Scene as ThreeScene,
  WebGLRenderTarget,
  HalfFloatType,
  LinearFilter,
  AddEquation,
  CustomBlending,
  OneFactor,
  OneMinusDstColorFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  ShaderMaterial,
  PMREMGenerator,
  NoToneMapping,
  Vector2,
  type Texture,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'
import { BloomEffect } from 'postprocessing'
import { getCompositionLayers, getObjectState, setMountedRenderScenes, subscribeObjects, getObjectList } from '../../core/visual/VisualEngine'
import type { CompositionLayer } from '../../core/directors'
import { useProjectStore } from '../../store/ProjectStore'
import { getInstrument } from '../../instruments'
import { DEFAULT_SCENE_BACKGROUND } from '../../types'
import { ObjectRenderer } from './ObjectRenderer'
import { FinalInvertMaskContext } from '../../core/visual/finalInvertMask'
import { resolveActiveColorFilter } from '../../instruments/ColorFilters'
import { getBeatOverride } from '../../core/visual/beatOverride'
import { useTimeStore } from '../../store/TimeStore'

RectAreaLightUniformsLib.init()

interface MountedScene {
  base: ThreeScene
  front: ThreeScene
  invert: ThreeScene
  target: WebGLRenderTarget
  invertTarget: WebGLRenderTarget
  filterTargets: [WebGLRenderTarget, WebGLRenderTarget]
  outputTexture: Texture
}

interface PartitionUniforms {
  radial: { value: number }
  index: { value: number }
  count: { value: number }
  aspect: { value: number }
}

function disposeMountedScene(runtime: MountedScene) {
  runtime.target.dispose()
  runtime.invertTarget.dispose()
  runtime.filterTargets.forEach((target) => target.dispose())
}

function makeCompositorGeometry() {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(12), 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(new Float32Array(8), 2))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  return geometry
}

const COLOR_FILTER_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}`

const COLOR_FILTER_FRAGMENT = `
uniform sampler2D tDiffuse;
uniform float mode;
uniform float amount;
uniform float time;
varying vec2 vUv;

vec3 hueShift(vec3 color, float turns) {
  vec3 axis = normalize(vec3(1.0));
  float angle = turns * 6.28318530718;
  return color * cos(angle)
    + cross(axis, color) * sin(angle)
    + axis * dot(axis, color) * (1.0 - cos(angle));
}

void main() {
  vec4 source = texture2D(tDiffuse, vUv);
  vec3 color = source.rgb;
  float hdrScale = max(1.0, max(color.r, max(color.g, color.b)));
  vec3 working = color / hdrScale;
  float luma = dot(working, vec3(0.2126, 0.7152, 0.0722));
  vec3 filtered = working;

  if (mode < 1.5) {
    filtered = vec3(1.0) - working;
  } else if (mode < 2.5) {
    filtered = vec3(1.0) - abs(working * 2.0 - vec3(1.0));
  } else if (mode < 3.5) {
    filtered = working.gbr;
  } else if (mode < 4.5) {
    filtered = working.brg;
  } else if (mode < 5.5) {
    filtered = vec3(
      smoothstep(0.0, 0.55, luma),
      smoothstep(0.25, 0.78, luma),
      smoothstep(0.62, 1.0, luma)
    );
  } else if (mode < 6.5) {
    vec3 shadow = vec3(0.015, 0.02, 0.16);
    vec3 light = vec3(1.0, 0.02, 0.62);
    filtered = mix(shadow, light, smoothstep(0.05, 0.95, luma));
    filtered += vec3(0.0, 0.35, 0.45) * smoothstep(0.55, 1.0, working.g);
  } else if (mode < 7.5) {
    filtered = floor(working * 4.0 + 0.5) / 4.0;
  } else if (mode < 8.5) {
    filtered = 0.5 + 0.5 * cos(6.28318530718 * (luma + vec3(0.0, 0.33, 0.67)));
  } else {
    filtered = hueShift(working, 0.16 + mod(time * 0.035, 1.0));
  }

  filtered *= hdrScale;
  gl_FragColor = vec4(mix(color, clamp(filtered, 0.0, hdrScale), amount), source.a);
}`

const FINAL_GRADE_FRAGMENT = `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform vec2 resolution;
uniform float time;
uniform float bloomIntensity;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec3 fxaa(vec2 uv) {
  vec2 inverseResolution = 1.0 / resolution;
  vec3 rgbNW = texture2D(tScene, uv + vec2(-1.0, -1.0) * inverseResolution).rgb;
  vec3 rgbNE = texture2D(tScene, uv + vec2( 1.0, -1.0) * inverseResolution).rgb;
  vec3 rgbSW = texture2D(tScene, uv + vec2(-1.0,  1.0) * inverseResolution).rgb;
  vec3 rgbSE = texture2D(tScene, uv + vec2( 1.0,  1.0) * inverseResolution).rgb;
  vec3 rgbM = texture2D(tScene, uv).rgb;
  vec3 lumaWeights = vec3(0.299, 0.587, 0.114);
  float lumaNW = dot(rgbNW, lumaWeights);
  float lumaNE = dot(rgbNE, lumaWeights);
  float lumaSW = dot(rgbSW, lumaWeights);
  float lumaSE = dot(rgbSE, lumaWeights);
  float lumaM = dot(rgbM, lumaWeights);
  float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
  float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));

  vec2 direction;
  direction.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));
  direction.y =  ((lumaNW + lumaSW) - (lumaNE + lumaSE));
  float directionReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * 0.03125, 0.0078125);
  float inverseDirectionMin = 1.0 / (min(abs(direction.x), abs(direction.y)) + directionReduce);
  direction = clamp(direction * inverseDirectionMin, vec2(-8.0), vec2(8.0)) * inverseResolution;

  vec3 rgbA = 0.5 * (
    texture2D(tScene, uv + direction * (1.0 / 3.0 - 0.5)).rgb +
    texture2D(tScene, uv + direction * (2.0 / 3.0 - 0.5)).rgb
  );
  vec3 rgbB = rgbA * 0.5 + 0.25 * (
    texture2D(tScene, uv + direction * -0.5).rgb +
    texture2D(tScene, uv + direction * 0.5).rgb
  );
  float lumaB = dot(rgbB, lumaWeights);
  return (lumaB < lumaMin || lumaB > lumaMax) ? rgbA : rgbB;
}

void main() {
  vec4 source = texture2D(tScene, vUv);
  vec3 color = fxaa(vUv) + texture2D(tBloom, vUv).rgb * bloomIntensity;

  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luma), color, 1.08);
  color = (color - 0.5) * 1.045 + 0.5;

  vec2 centered = vUv - 0.5;
  centered.x *= resolution.x / max(1.0, resolution.y);
  float vignette = smoothstep(0.92, 0.20, length(centered));
  color *= mix(0.82, 1.0, vignette);

  float grain = hash(gl_FragCoord.xy + vec2(time * 19.7, time * 7.3)) - 0.5;
  color += grain * 0.014;
  gl_FragColor = vec4(max(color, 0.0), source.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

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

function makeCompositorMaterial(invertBehind = false) {
  const uniforms: PartitionUniforms = {
    radial: { value: 0 },
    index: { value: 0 },
    count: { value: 1 },
    aspect: { value: 1 },
  }
  const material = new MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false })
  if (invertBehind) {
    // The mask is a premultiplied white glyph. This blend computes, per channel:
    // alpha * (1 - destination) + destination * (1 - alpha).
    material.premultipliedAlpha = true
    material.blending = CustomBlending
    material.blendEquation = AddEquation
    material.blendSrc = OneMinusDstColorFactor
    material.blendDst = OneMinusSrcAlphaFactor
    material.blendSrcAlpha = OneFactor
    material.blendDstAlpha = OneMinusSrcAlphaFactor
  }
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
  float outerRadius = (partitionIndex + 1.0) / partitionCount;
  if (radius > outerRadius) discard;
}`)
    if (invertBehind) {
      // Use the mask alpha as premultiplied white regardless of the offscreen
      // mask's RGB encoding, effects, or antialias interpolation.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <premultiplied_alpha_fragment>',
        'gl_FragColor.rgb = vec3(gl_FragColor.a);',
      )
    }
  }
  material.customProgramCacheKey = () => invertBehind ? 'scene-partition-invert-v1' : 'scene-partition-v1'
  return material
}

function lights() {
  return (
    <>
      <ambientLight intensity={0.12} />
      <hemisphereLight color="#dbeafe" groundColor="#170921" intensity={0.55} />
      <rectAreaLight position={[4, 4, 5]} rotation={[-0.62, 0.62, 0]} color="#fff7ed" intensity={6} width={5} height={5} />
      <directionalLight
        position={[4, 7, 5]}
        intensity={2.4}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
        shadow-camera-near={0.1}
        shadow-camera-far={30}
        shadow-bias={-0.0004}
        shadow-normalBias={0.035}
      />
      <pointLight position={[-4, 2, -3]} color="#60a5fa" intensity={7} distance={20} decay={2} />
      <pointLight position={[3, -1, 3]} color="#fb7185" intensity={3.5} distance={16} decay={2} />
    </>
  )
}

/**
 * Every logical project scene stays mounted in its own literal THREE.Scene.
 * A second scene per runtime is the existing "In front" pass; a third holds
 * final-frame inversion masks. The compositor renders ordinary scene layers
 * first, then applies those masks against the combined result.
 *
 * The final compositor consumes an ORDERED ARRAY of layers. Today those layers
 * come from preview or Scene Switcher, but multiple directors already append
 * simultaneous layers without a singular active-scene assumption.
 */
export function VisualScene() {
  const objects = useSyncExternalStore(subscribeObjects, getObjectList, getObjectList)
  const { gl, camera, size } = useThree()
  const environment = useMemo(() => {
    const room = new RoomEnvironment()
    const pmrem = new PMREMGenerator(gl)
    const target = pmrem.fromScene(room, 0.04)
    room.dispose()
    pmrem.dispose()
    return target
  }, [gl])
  const sceneKey = [...new Set(objects.map((o) => o.sceneId))].sort().join(',')
  // Incremental scene mounting: runtimes are keyed by scene id and REUSED when
  // the scene set changes. Rebuilding the whole map on every add/remove would
  // remount every scene's object portals and dispose their render targets
  // mid-flight - the "adding a scene blanks unrelated scenes" bug. Creation
  // happens in render (new ids only, so a discarded render can only leak, never
  // break committed scenes); disposal of dropped runtimes waits for the commit
  // effect below.
  const prevMountedRef = useRef(new Map<string, MountedScene>())
  const mounted = useMemo(() => {
    const prev = prevMountedRef.current
    const map = new Map<string, MountedScene>()
    for (const sceneId of sceneKey ? sceneKey.split(',') : []) {
      const reused = prev.get(sceneId)
      if (reused) {
        map.set(sceneId, reused)
        continue
      }
      const options = { minFilter: LinearFilter, magFilter: LinearFilter, type: HalfFloatType }
      const maskOptions = { minFilter: LinearFilter, magFilter: LinearFilter }
      const width = Math.max(1, size.width)
      const height = Math.max(1, size.height)
      const target = new WebGLRenderTarget(width, height, options)
      map.set(sceneId, {
        base: new ThreeScene(),
        front: new ThreeScene(),
        invert: new ThreeScene(),
        target,
        invertTarget: new WebGLRenderTarget(width, height, maskOptions),
        filterTargets: [
          new WebGLRenderTarget(width, height, options),
          new WebGLRenderTarget(width, height, options),
        ],
        outputTexture: target.texture,
      })
    }
    return map
  // Scene structure changes on resolve; target resizing is handled separately.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneKey])

  const compositor = useMemo(() => {
    const scene = new ThreeScene()
    const invertScene = new ThreeScene()
    const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 2)
    cam.position.z = 1
    const meshes: Mesh[] = []
    const invertMeshes: Mesh[] = []
    const filterScene = new ThreeScene()
    const filterCam = new OrthographicCamera(-1, 1, 1, -1, 0, 2)
    filterCam.position.z = 1
    const filterMaterial = new ShaderMaterial({
      vertexShader: COLOR_FILTER_VERTEX,
      fragmentShader: COLOR_FILTER_FRAGMENT,
      uniforms: {
        tDiffuse: { value: null as Texture | null },
        mode: { value: 0 },
        amount: { value: 1 },
        time: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    })
    const filterMesh = new Mesh(new PlaneGeometry(2, 2), filterMaterial)
    filterMesh.frustumCulled = false
    filterScene.add(filterMesh)
    const hdrOptions = { minFilter: LinearFilter, magFilter: LinearFilter, type: HalfFloatType }
    const compositeTarget = new WebGLRenderTarget(1, 1, hdrOptions)
    // Production mip-chain bloom from `postprocessing`. It extracts luminance
    // from the half-float scene buffer, then combines seven progressively wider
    // levels. HDR emitters create a tight core and long, smooth falloff without
    // geometry shells or hand-authored blur planes.
    const bloomEffect = new BloomEffect({
      luminanceThreshold: 1.15,
      luminanceSmoothing: 0.08,
      mipmapBlur: true,
      radius: 0.72,
      levels: 7,
    })
    bloomEffect.initialize(gl, true, HalfFloatType)
    const finalMaterial = new ShaderMaterial({
      vertexShader: COLOR_FILTER_VERTEX,
      fragmentShader: FINAL_GRADE_FRAGMENT,
      uniforms: {
        tScene: { value: compositeTarget.texture },
        tBloom: { value: bloomEffect.texture },
        resolution: { value: new Vector2(1, 1) },
        time: { value: 0 },
        bloomIntensity: { value: 0.9 },
      },
      depthTest: false,
      depthWrite: false,
    })
    return {
      scene, invertScene, cam, meshes, invertMeshes,
      filterScene, filterCam, filterMesh, filterMaterial,
      compositeTarget, bloomEffect, finalMaterial,
    }
  }, [gl])

  useEffect(() => {
    for (const runtime of mounted.values()) {
      runtime.target.setSize(Math.max(1, size.width), Math.max(1, size.height))
      runtime.invertTarget.setSize(Math.max(1, size.width), Math.max(1, size.height))
      runtime.filterTargets.forEach((target) => target.setSize(Math.max(1, size.width), Math.max(1, size.height)))
    }
    const width = Math.max(1, size.width)
    const height = Math.max(1, size.height)
    compositor.compositeTarget.setSize(width, height)
    compositor.bloomEffect.setSize(width, height)
    compositor.finalMaterial.uniforms.resolution.value.set(width, height)
  }, [compositor, mounted, size.width, size.height])

  useEffect(() => {
    for (const runtime of mounted.values()) {
      runtime.base.environment = environment.texture
      runtime.front.environment = environment.texture
    }
  }, [environment, mounted])

  useEffect(() => () => environment.dispose(), [environment])

  useEffect(() => {
    const roots = new Map<string, ThreeScene>()
    for (const [sceneId, runtime] of mounted) {
      roots.set(`${sceneId}:base`, runtime.base)
      roots.set(`${sceneId}:front`, runtime.front)
      roots.set(`${sceneId}:invert`, runtime.invert)
    }
    setMountedRenderScenes(roots)
    return () => setMountedRenderScenes(new Map())
  }, [mounted])

  // Commit the new mounted set and dispose ONLY the runtimes that fell out of
  // it - surviving scenes keep their THREE.Scenes and GPU targets untouched.
  useEffect(() => {
    const prev = prevMountedRef.current
    prevMountedRef.current = mounted
    for (const [sceneId, runtime] of prev) {
      if (mounted.get(sceneId) !== runtime) disposeMountedScene(runtime)
    }
  }, [mounted])

  useEffect(() => () => {
    for (const runtime of prevMountedRef.current.values()) disposeMountedScene(runtime)
    prevMountedRef.current = new Map()
  }, [])

  useEffect(() => () => {
    for (const mesh of compositor.meshes) {
      mesh.geometry.dispose()
      ;(mesh.material as MeshBasicMaterial).dispose()
    }
    for (const mesh of compositor.invertMeshes) {
      mesh.geometry.dispose()
      ;(mesh.material as MeshBasicMaterial).dispose()
    }
    compositor.filterMesh.geometry.dispose()
    compositor.filterMaterial.dispose()
    compositor.bloomEffect.dispose()
    compositor.finalMaterial.dispose()
    compositor.compositeTarget.dispose()
  }, [compositor])

  const colorFilterTrackIds = useMemo(() => {
    const byScene = new Map<string, string[]>()
    const seen = new Set<string>()
    for (const object of objects) {
      if (object.instrumentId !== 'colorFilters') continue
      const key = `${object.sceneId}:${object.trackId}`
      if (seen.has(key)) continue
      seen.add(key)
      const ids = byScene.get(object.sceneId) ?? []
      ids.push(object.trackId)
      byScene.set(object.sceneId, ids)
    }
    return byScene
  }, [objects])

  const placementKey = useProjectStore((s) => objects.map((o) => {
    const track = s.scenes[o.sceneId]?.tracks[o.trackId]
    const onTop = track?.onTop ?? getInstrument(o.instrumentId)?.defaultOnTop ?? false
    const finalInvert = onTop
      && o.instrumentId === 'textDisplay'
      && (track?.params?.colorMode ?? 0) >= 0.5
    return finalInvert ? 'I' : onTop ? 'F' : 'B'
  }).join(''))

  useFrame(() => {
    const previous = gl.getRenderTarget()
    const previousAutoClear = gl.autoClear
    const previousToneMapping = gl.toneMapping
    gl.autoClear = false
    // Preserve scene-linear values above 1.0 through every offscreen pass.
    // Tone mapping happens once, in the final grade after bloom is composed.
    gl.toneMapping = NoToneMapping
    try {
      const layers = getCompositionLayers()
      const requested = new Set(layers.map((layer) => layer.sceneId))

      for (const sceneId of requested) {
        const runtime = mounted.get(sceneId)
        if (!runtime) continue
        const projectScene = useProjectStore.getState().scenes[sceneId]
        gl.setRenderTarget(runtime.target)
        gl.setClearColor(projectScene?.backgroundColor ?? DEFAULT_SCENE_BACKGROUND, projectScene?.backgroundTransparent ? 0 : 1)
        gl.clear(true, true, true)
        gl.render(runtime.base, camera)
        gl.clearDepth()
        gl.render(runtime.front, camera)

        // Scene-wide color filters are ordinary scene tracks whose held notes
        // choose post-process modes. Multiple tracks chain in resolved order.
        let filteredTexture: Texture = runtime.target.texture
        let filterPass = 0
        for (const trackId of colorFilterTrackIds.get(sceneId) ?? []) {
          const filter = resolveActiveColorFilter(getObjectState(trackId))
          if (!filter) continue
          const output = runtime.filterTargets[filterPass % runtime.filterTargets.length]
          compositor.filterMesh.material = compositor.filterMaterial
          compositor.filterMaterial.uniforms.tDiffuse.value = filteredTexture
          compositor.filterMaterial.uniforms.mode.value = filter.mode
          compositor.filterMaterial.uniforms.amount.value = filter.amount
          compositor.filterMaterial.uniforms.time.value = filter.beat
          gl.setRenderTarget(output)
          gl.setClearColor(0x000000, 0)
          gl.clear(true, true, true)
          gl.render(compositor.filterScene, compositor.filterCam)
          filteredTexture = output.texture
          filterPass++
        }
        runtime.outputTexture = filteredTexture

        // Final-invert text is isolated as a transparent mask. It is applied only
        // after every requested scene layer has been composited below.
        gl.setRenderTarget(runtime.invertTarget)
        gl.setClearColor(0x000000, 0)
        gl.clear(true, true, true)
        gl.render(runtime.invert, camera)
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
        if (material.map !== runtime.outputTexture) {
          material.map = runtime.outputTexture
          material.needsUpdate = true
        }
        material.opacity = layer.opacity
        setPartitionGeometry(mesh.geometry, layer.partition)
        const uniforms = material.userData.partitionUniforms as PartitionUniforms
        const radial = layer.partition?.kind === 'radial' ? layer.partition : undefined
        uniforms.radial.value = radial ? 1 : 0
        uniforms.index.value = radial?.radiusIndex ?? radial?.index ?? 0
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

      const project = useProjectStore.getState()
      const mainId = project.sceneOrder.find((id) => project.scenes[id]?.isMain)
      const main = mainId ? project.scenes[mainId] : undefined
      gl.setRenderTarget(compositor.compositeTarget)
      gl.setClearColor(main?.backgroundColor ?? DEFAULT_SCENE_BACKGROUND, main?.backgroundTransparent ? 0 : 1)
      gl.clear(true, true, true)
      gl.render(compositor.scene, compositor.cam)

      // Luminance-thresholded, multi-resolution bloom consumes the completed
      // scene composite, so preview, directors, partitions and export all match.
      compositor.bloomEffect.update(gl, compositor.compositeTarget, 0)

      compositor.filterMesh.material = compositor.finalMaterial
      compositor.finalMaterial.uniforms.tBloom.value = compositor.bloomEffect.texture
      compositor.finalMaterial.uniforms.time.value = getBeatOverride() ?? useTimeStore.getState().currentBeat
      gl.toneMapping = previousToneMapping
      gl.setRenderTarget(previous)
      gl.setClearColor(main?.backgroundColor ?? DEFAULT_SCENE_BACKGROUND, main?.backgroundTransparent ? 0 : 1)
      gl.clear(true, true, true)
      gl.render(compositor.filterScene, compositor.filterCam)

      while (compositor.invertMeshes.length < layers.length) {
        const material = makeCompositorMaterial(true)
        const geometry = makeCompositorGeometry()
        setPartitionGeometry(geometry)
        const mesh = new Mesh(geometry, material)
        mesh.frustumCulled = false
        compositor.invertMeshes.push(mesh)
        compositor.invertScene.add(mesh)
      }
      compositor.invertMeshes.forEach((mesh, i) => {
        const layer = layers[i]
        mesh.visible = !!layer
        if (!layer) return
        const runtime = mounted.get(layer.sceneId)
        mesh.visible = !!runtime
        if (!runtime) return
        const material = mesh.material as MeshBasicMaterial
        if (material.map !== runtime.invertTarget.texture) {
          material.map = runtime.invertTarget.texture
          material.needsUpdate = true
        }
        material.opacity = layer.opacity
        setPartitionGeometry(mesh.geometry, layer.partition)
        const uniforms = material.userData.partitionUniforms as PartitionUniforms
        const radial = layer.partition?.kind === 'radial' ? layer.partition : undefined
        uniforms.radial.value = radial ? 1 : 0
        uniforms.index.value = radial?.radiusIndex ?? radial?.index ?? 0
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
      gl.render(compositor.invertScene, compositor.cam)
    } finally {
      gl.setRenderTarget(previous)
      gl.toneMapping = previousToneMapping
      gl.autoClear = previousAutoClear
    }
  }, 100)

  return (
    <>
      {[...mounted.entries()].map(([sceneId, runtime]) => {
        const sceneObjects = objects.filter((o) => o.sceneId === sceneId)
        const base = sceneObjects.filter((o) => placementKey[objects.indexOf(o)] === 'B')
        const front = sceneObjects.filter((o) => placementKey[objects.indexOf(o)] === 'F')
        const invert = sceneObjects.filter((o) => placementKey[objects.indexOf(o)] === 'I')
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
            {createPortal(
            <FinalInvertMaskContext.Provider value>
              {lights()}
              {invert.map((o) => <ObjectRenderer key={`${o.trackId}:${o.visualCopyIndex}:invert`} sceneId={o.sceneId} trackId={o.trackId} instrumentId={o.instrumentId} visualCopyIndex={o.visualCopyIndex} />)}
            </FinalInvertMaskContext.Provider>,
            runtime.invert,
            )}
          </Fragment>
        )
      })}
    </>
  )
}
