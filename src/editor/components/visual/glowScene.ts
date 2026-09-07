import {
  ZeroFactor,
  NormalBlending,
  NoBlending,
  AdditiveBlending,
  SrcAlphaFactor,
  AddEquation,
  Color,
  CustomBlending,
  DepthStencilFormat,
  DepthTexture,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NoToneMapping,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Scene,
  UnsignedInt248Type,
  WebGLRenderTarget,
  type Camera,
  type Object3D,
  type Group,
  type Material,
  type ShaderMaterial,
  type Texture,
  type WebGLRenderer,
} from 'three'
import { GlowPass, glowTarget } from './GlowPass'

export interface GlowSource {
  trackId: string
  scene: Scene
  holder: Group
  coreMesh: Mesh
  haloMesh: Mesh
  active: boolean
  emitsHalo: boolean
  dirty: boolean
  /** Only a lone Glow with identical effective settings can collect copies. */
  batchKey: string | null
  nativeCore: boolean
  /** A lone Glow keeps native geometry even when core brightness changes;
   * the core output then adds only the visible brightness difference. */
  nativeSource: boolean
  width: number
  height: number
  run: (
    gl: WebGLRenderer,
    input: Texture,
    output: WebGLRenderTarget,
    halo: boolean,
    glow: GlowPass,
  ) => void
}
interface Outputs {
  source: WebGLRenderTarget
  core: WebGLRenderTarget
  full: WebGLRenderTarget
}
interface Runtime {
  preparing: boolean
  nativeParents: Map<GlowSource, TParent>
  before: Scene['onBeforeRender']
  after: Scene['onAfterRender']
  entries: Set<GlowSource>
  glow: GlowPass
  outputs: Map<GlowSource, Outputs>
}
type TParent = Group['parent']
const scenes = new Map<Scene, Runtime>()
let haloVisible = true
export function glowSceneStats() {
  return [...scenes.values()].map((r) => ({
    sources: [...r.entries].filter((e) => e.active).length,
    groups: r.outputs.size,
  }))
}
export function hasSceneGlow(only?: Scene[]) {
  const runtimes = only
    ? only.flatMap((scene) => (scenes.has(scene) ? [scenes.get(scene)!] : []))
    : [...scenes.values()]
  return runtimes.some((r) => [...r.entries].some((e) => e.active && e.emitsHalo))
}
export function setSceneGlowHalo(visible: boolean) {
  haloVisible = visible
  for (const r of scenes.values())
    for (const e of r.entries)
      e.haloMesh.visible = visible && e.active && e.emitsHalo && r.outputs.has(e)
}
export function registerGlowSource(parent: Scene, entry: GlowSource) {
  let r = scenes.get(parent)
  if (!r) {
    r = {
      preparing: false,
      nativeParents: new Map(),
      before: parent.onBeforeRender,
      after: parent.onAfterRender,
      entries: new Set(),
      glow: new GlowPass(),
      outputs: new Map(),
    }
    scenes.set(parent, r)
    const runtime = r
    parent.onBeforeRender = function (...args) {
      const [renderer, , camera] = args
      runtime.before.apply(this, args)
      if (runtime.preparing) return
      prepareSceneGlow(renderer, parent, camera)
      for (const e of runtime.entries)
        if (e.active && e.nativeSource) {
          runtime.nativeParents.set(e, e.holder.parent)
          parent.add(e.holder)
          e.holder.updateMatrixWorld(true)
        }
    }
    parent.onAfterRender = function (...args) {
      if (!runtime.preparing) {
        for (const [e, p] of runtime.nativeParents) p?.add(e.holder)
        runtime.nativeParents.clear()
      }
      runtime.after.apply(this, args)
    }
  }
  r.entries.add(entry)
  return () => {
    r!.entries.delete(entry)
    const out = r!.outputs.get(entry)
    if (out) {
      disposeOutputs(out)
      r!.outputs.delete(entry)
    }
    if (!r!.entries.size) {
      parent.onBeforeRender = r!.before
      parent.onAfterRender = r!.after
      r!.glow.dispose()
      for (const o of r!.outputs.values()) disposeOutputs(o)
      scenes.delete(parent)
    }
  }
}
function disposeOutputs(o: Outputs) {
  o.source.dispose()
  o.core.dispose()
  o.full.dispose()
}

/** Render only this group's contribution in the real scene's draw order.
 * Other geometry keeps its actual shaders, alpha discard, depth and sorting,
 * but contributes zero radiance. Its opacity still attenuates the source. This
 * handles translucent occluders too, which a depth-only prepass cannot do. */
export function prepareSceneGlow(gl: WebGLRenderer, parent: Scene, camera: Camera) {
  const r = scenes.get(parent)
  if (!r || r.preparing || ![...r.entries].some((e) => e.dirty)) return
  const entries = [...r.entries]
  for (const e of entries) {
    e.dirty = false
    e.coreMesh.visible = false
    e.haloMesh.visible = false
  }
  const active = entries.filter((e) => e.active)
  const processing = active.filter((e) => !e.nativeCore || e.emitsHalo)
  if (!processing.length) {
    for (const out of r.outputs.values()) disposeOutputs(out)
    r.outputs.clear()
    return
  }
  const prev = gl.getRenderTarget(),
    auto = gl.autoClear,
    tone = gl.toneMapping,
    clear = gl.getClearColor(new Color()),
    alpha = gl.getClearAlpha()
  const parents = new Map(entries.map((e) => [e, e.holder.parent]))
  const background = parent.background
  try {
    r.preparing = true
    gl.autoClear = false
    gl.toneMapping = NoToneMapping
    gl.setClearColor(0, 0)
    const width = active[0].width,
      height = active[0].height
    // Capture all shader sources together with ordinary scene geometry.
    for (const e of active) parent.add(e.holder)
    parent.background = null
    const batches = new Map<string | GlowSource, GlowSource[]>()
    for (const e of processing) {
      const key = e.batchKey ?? e
      const b = batches.get(key) ?? []
      b.push(e)
      batches.set(key, b)
    }
    const leaders = new Set<GlowSource>()
    for (const members of batches.values()) {
      const e = members[0]
      leaders.add(e)
      let out = r.outputs.get(e)
      if (!out) {
        const source = new WebGLRenderTarget(width, height, {
          type: HalfFloatType,
          minFilter: LinearFilter,
          magFilter: LinearFilter,
          stencilBuffer: true,
        })
        source.depthTexture = new DepthTexture(width, height, UnsignedInt248Type)
        source.depthTexture.format = DepthStencilFormat
        out = {
          source,
          core: glowTarget(width, height),
          full: glowTarget(width, height),
        }
        r.outputs.set(e, out)
      }
      out.source.setSize(width, height)
      out.core.setSize(width, height)
      out.full.setSize(width, height)
      gl.setRenderTarget(out.source)
      gl.clear(true, true, true)
      renderVisibleGlowSource(
        gl,
        parent,
        camera,
        members.map((member) => member.holder),
      )
      r.glow.sourceDepth = out.source.depthTexture
      e.run(gl, out.source.texture, out.core, false, r.glow)
      if (e.emitsHalo) e.run(gl, out.source.texture, out.full, true, r.glow)
      const core = e.coreMesh.material as ShaderMaterial,
        halo = e.haloMesh.material as ShaderMaterial
      core.uniforms.tDiffuse.value = out.core.texture
      core.uniforms.tDepth.value = out.source.depthTexture
      core.uniforms.tOriginal.value = out.source.texture
      core.uniforms.delta.value = e.nativeSource ? 1 : 0
      core.depthTest = !e.nativeSource
      core.blendDst = e.nativeSource ? OneFactor : OneMinusSrcAlphaFactor
      halo.uniforms.tDiffuse.value = out.full.texture
      halo.uniforms.tCore.value = out.core.texture
    }
    // No processed overlays may enter another group's visibility capture.
    for (const e of leaders) {
      e.coreMesh.visible = !e.nativeCore
      e.haloMesh.visible = haloVisible && e.emitsHalo
    }
    for (const [e, out] of r.outputs)
      if (!leaders.has(e)) {
        disposeOutputs(out)
        r.outputs.delete(e)
      }
  } finally {
    for (const e of entries) parents.get(e)?.add(e.holder)
    r.preparing = false
    parent.background = background
    gl.setRenderTarget(prev)
    gl.autoClear = auto
    gl.toneMapping = tone
    gl.setClearColor(clear, alpha)
  }
}
type BlendState = Pick<
  Material,
  | 'blending'
  | 'blendSrc'
  | 'blendDst'
  | 'blendSrcAlpha'
  | 'blendDstAlpha'
  | 'blendEquation'
  | 'blendEquationAlpha'
>
function blendState(m: Material): BlendState {
  return {
    blending: m.blending,
    blendSrc: m.blendSrc,
    blendDst: m.blendDst,
    blendSrcAlpha: m.blendSrcAlpha,
    blendDstAlpha: m.blendDstAlpha,
    blendEquation: m.blendEquation,
    blendEquationAlpha: m.blendEquationAlpha,
  }
}
/** Per-draw hooks, not material injection. Per-object hooks also handle a
 * material shared between a source copy and an unrelated occluder. */
export function renderVisibleGlowSource(
  gl: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  roots: Object3D[],
) {
  const sourceObjects = new Set<Object3D>()
  for (const root of roots) root.traverse((object) => sourceObjects.add(object))
  const hooks = new Map<
    Object3D,
    { before: Object3D['onBeforeRender']; after: Object3D['onAfterRender'] }
  >()
  const changed = new Map<Material, BlendState>()
  scene.traverse((object) => {
    if (!(object as Mesh).material) return
    const before = object.onBeforeRender,
      after = object.onAfterRender
    hooks.set(object, { before, after })
    object.onBeforeRender = function (...args) {
      before.apply(this, args)
      const m = args[4],
        state = blendState(m)
      changed.set(m, state)
      if (sourceObjects.has(object)) {
        if (m.blending !== AdditiveBlending) return
        m.blending = CustomBlending
        m.blendEquation = AddEquation
        m.blendEquationAlpha = AddEquation
        m.blendSrc = m.premultipliedAlpha ? OneFactor : SrcAlphaFactor
        m.blendDst = OneFactor
        m.blendSrcAlpha = OneFactor
        m.blendDstAlpha = OneMinusSrcAlphaFactor
      } else {
        const dst =
          state.blending === AdditiveBlending
            ? OneFactor
            : state.blending === NoBlending || !m.transparent
              ? ZeroFactor
              : state.blending === NormalBlending
                ? OneMinusSrcAlphaFactor
                : state.blendDst
        m.blending = CustomBlending
        m.blendEquation = AddEquation
        m.blendEquationAlpha = AddEquation
        m.blendSrc = ZeroFactor
        m.blendDst = dst
        m.blendSrcAlpha = ZeroFactor
        m.blendDstAlpha =
          state.blending === AdditiveBlending
            ? OneFactor
            : dst === ZeroFactor
              ? ZeroFactor
              : OneMinusSrcAlphaFactor
      }
    }
    object.onAfterRender = function (...args) {
      const m = args[4],
        state = changed.get(m)
      if (state) {
        Object.assign(m, state)
        changed.delete(m)
      }
      after.apply(this, args)
    }
  })
  try {
    gl.render(scene, camera)
  } finally {
    for (const [m, state] of changed) Object.assign(m, state)
    for (const [object, hook] of hooks) {
      object.onBeforeRender = hook.before
      object.onAfterRender = hook.after
    }
  }
}

/** Native source geometry keeps its original transparent ordering, blending,
 * depthWrite and depthTest when the core is preserved and Glow is the only pass. */
export function renderSceneWithGlow(gl: WebGLRenderer, scene: Scene, camera: Camera) {
  try {
    gl.render(scene, camera)
  } finally {
    const r = scenes.get(scene)
    if (r) {
      for (const [e, p] of r.nativeParents) p?.add(e.holder)
      r.nativeParents.clear()
    }
  }
}

export const GLOW_CORE_OUTPUT = `uniform sampler2D tDiffuse,tDepth,tOriginal;uniform float delta;varying vec2 vUv;void main(){vec4 c=texture2D(tDiffuse,vUv);if(c.a<0.00001)discard;gl_FragDepth=texture2D(tDepth,vUv).r;gl_FragColor=delta>.5?vec4(c.rgb-texture2D(tOriginal,vUv).rgb,0.):c;}`
export const GLOW_HALO_OUTPUT = `uniform sampler2D tDiffuse,tCore;varying vec2 vUv;void main(){vec4 full=texture2D(tDiffuse,vUv),core=texture2D(tCore,vUv);gl_FragColor=vec4(full.rgb-core.rgb,max(0.,full.a-core.a));}`
export const glowCoreBlend = {
  blending: CustomBlending,
  blendEquation: AddEquation,
  blendSrc: OneFactor,
  blendDst: OneMinusSrcAlphaFactor,
}
export const glowHaloBlend = {
  blending: CustomBlending,
  blendEquation: AddEquation,
  blendSrc: OneFactor,
  blendDst: OneFactor,
  blendSrcAlpha: OneFactor,
  blendDstAlpha: OneMinusSrcAlphaFactor,
}
