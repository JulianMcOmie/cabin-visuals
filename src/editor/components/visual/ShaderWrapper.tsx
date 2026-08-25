import { useMemo, useRef, useEffect, type ReactNode } from 'react'
import { useFrame, useThree, createPortal } from '@react-three/fiber'
import {
  Scene, Group, AmbientLight, DirectionalLight, PointLight, Matrix4, Mesh,
  ShaderMaterial, WebGLRenderTarget, OrthographicCamera, PlaneGeometry, Vector2, LinearFilter,
  type IUniform, type Texture,
} from 'three'
import { useTimeStore } from '../../store/TimeStore'
import { getBeatOverride } from '../../core/visual/beatOverride'
import { getObjectState, getVisualCopy } from '../../core/visual/VisualEngine'
import { applyMaterialOpacity } from '../../core/visual/animatedOpacity'
import { getEffect } from '../../effects'
import { effectiveEffectState } from '../../effects/automation'
import type { EffectInstance } from '../../types'
import { composePostMoverScale, evaluatePostMoverScale } from '../../core/visual/postMoverScale'
import { CROP_MASK_FRAGMENT, resolveActiveCropMask, type ActiveCropMask } from '../../instruments/Crop'
import { MAX_DIVISIONS as CROP_MAX_DIVISIONS } from '../../core/directors/crop'
import { useRenderTargetScale } from './useRenderTargetScale'
import { acquireShaderScratch, releaseShaderScratch, type ShaderScratch } from './shaderScratchPool'

// Fullscreen-quad vertex shader: writes clip space directly, so a 2×2 plane always fills
// the target regardless of camera. Passthrough fragment blits the final texture.
const QUAD_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }'
const PASSTHROUGH_FRAG = 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tDiffuse, vUv); }'

// Scratch for composing the object's mesh-local size scale into the holder.
const _meshScale = new Matrix4()
// The FBO chain works in linear space; the main scene's render to the canvas applies
// the sRGB output encoding, but this overlay (a raw ShaderMaterial) bypasses it - so it
// must encode itself, or the object reads darker (looks like reduced opacity).
const OUTPUT_FRAG = `
  uniform sampler2D tDiffuse;
  varying vec2 vUv;
  vec3 lin2srgb(vec3 c){
    return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  void main(){
    vec4 t = texture2D(tDiffuse, vUv);
    gl_FragColor = vec4(lin2srgb(t.rgb), t.a);
  }
`

type PassEntry = { plugin: ReturnType<typeof getEffect>; mat: ShaderMaterial }
/** One pass of this frame's chain: a shader plugin (with its settings as of
 *  this frame) or a crop mask routed at the object. Planned before rendering so
 *  the LAST pass can land in the wrapper's own target - see the target notes. */
type Step =
  | { pass: PassEntry; eff: ReturnType<typeof effectiveEffectState>; mask: null }
  | { pass: null; eff: null; mask: ActiveCropMask }

/**
 * Per-object screen-space shader chain (plan §4.6, Option A - ported from Excellent DAW).
 * The object is rendered - with its world transform - into an offscreen scene/FBO, each
 * shader plugin runs as a fullscreen post pass (ping-pong FBOs), and the result is drawn
 * as a clip-space fullscreen overlay (depth-test off) over the 3D scene. So a shaded object
 * becomes a full-frame post-processed layer; un-shaded objects render normally, unaffected.
 *
 * Targets: the wrapper OWNS one target (`rig.own` - the texture its overlay
 * samples during the scene render, so it must survive past this useFrame) and
 * borrows the source + ping-pong intermediates from `shaderScratchPool`, which
 * every wrapper shares: each chain runs to completion inside one useFrame, so
 * the intermediates are free again before the next wrapper's runs. All of them
 * shrink by the preview-quality scale VisualScene's targets use (and stay
 * full-size while an export pin holds).
 */
export function ShaderWrapper({
  trackId,
  visualCopyIndex,
  plugins,
  postMoverScalePlugins,
  maskSourceIds,
  children,
}: {
  trackId: string
  /** Which VisualCopy occurrence this wrapper renders (composed into the holder).
   *  Full-frame occurrences OMIT it: their placement group inside the offscreen
   *  scene already carries the copy transform via the screen anchor, so the
   *  holder composing it too would apply the copy twice. */
  visualCopyIndex?: number
  plugins: EffectInstance[]
  /** Scale transform effects are composed outside the VisualCopy mover matrix. */
  postMoverScalePlugins: EffectInstance[]
  /** Crop tracks routed at this object (ObjectListEntry.maskSourceIds): each
   *  runs the crop mask as the OUTERMOST pass over the effect chain's output,
   *  its per-frame state pulled from that crop track's own engine state. */
  maskSourceIds?: readonly string[]
  children: ReactNode
}) {
  const { gl, camera, size, scene: parentScene } = useThree()
  const outMeshRef = useRef<Mesh>(null)

  // Offscreen render rig: scene (+ lights + a world-transform holder), ping-pong targets,
  // a fullscreen-quad pass rig, and the shared output uniform.
  const rig = useMemo(() => {
    const scene = new Scene()
    scene.add(new AmbientLight(0xffffff, 0.5))
    const dir = new DirectionalLight(0xffffff, 1.2); dir.position.set(4, 4, 4); scene.add(dir)
    const key = new PointLight(0x818cf8, 3); key.position.set(-4, -2, 3); scene.add(key)
    const rim = new PointLight(0xf0abfc, 1.5); rim.position.set(3, 3, -4); scene.add(rim)
    const holder = new Group(); holder.matrixAutoUpdate = false; scene.add(holder)

    // `own` holds the chain's final output; when no pass is active this frame
    // the object's geometry rasterizes straight into it, so it carries a
    // stencil buffer (Overlap Shape's parity passes need one wherever the
    // meshes draw). Sized by the effect below.
    const own = new WebGLRenderTarget(1, 1, { minFilter: LinearFilter, magFilter: LinearFilter, stencilBuffer: true })

    const quadScene = new Scene()
    const quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const quad = new Mesh(new PlaneGeometry(2, 2))
    quadScene.add(quad)

    const outUniforms: Record<string, IUniform> = { tDiffuse: { value: null as Texture | null } }
    return { scene, holder, own, quadScene, quadCam, quad, outUniforms }
  }, [])

  // Target size: the canvas' CSS size scaled by the preview-quality factor
  // (1 at Final and under an export pin). Floor, not round: the wrapper has
  // always floored its targets, and the pass `resolution` uniforms stay the
  // CSS size so pixel-measured effects (Pixelate, Glow) keep their look at
  // every scale.
  const targetScale = useRenderTargetScale()
  const targetW = Math.max(1, Math.floor(size.width * targetScale))
  const targetH = Math.max(1, Math.floor(size.height * targetScale))

  // One ShaderMaterial per shader plugin instance (rebuilt if the instance set or size changes).
  const passes = useMemo(() => {
    const map = new Map<string, { plugin: ReturnType<typeof getEffect>; mat: ShaderMaterial }>()
    for (const inst of plugins) {
      const plugin = getEffect(inst.pluginId)
      const uniforms: Record<string, IUniform> = {
        tDiffuse: { value: null }, time: { value: 0 }, resolution: { value: new Vector2(size.width, size.height) },
      }
      for (const pd of plugin?.params ?? []) uniforms[pd.key] = { value: inst.settings[pd.key] ?? pd.default }
      map.set(inst.id, {
        plugin,
        mat: new ShaderMaterial({
          vertexShader: plugin?.vertexShader ?? QUAD_VERT,
          fragmentShader: plugin?.fragmentShader ?? PASSTHROUGH_FRAG,
          uniforms, depthTest: false, depthWrite: false,
        }),
      })
    }
    return map
  }, [plugins.map((p) => p.id + ':' + p.pluginId).join(','), size.width, size.height]) // eslint-disable-line react-hooks/exhaustive-deps

  // One shared material for the crop mask passes: sources run sequentially and
  // their uniforms are rewritten just before each pass, the same way
  // VisualScene's scene-wide cropMaskMaterial is shared across scenes.
  const hasMaskSources = (maskSourceIds?.length ?? 0) > 0
  const maskMaterial = useMemo(() => {
    if (!hasMaskSources) return null
    return new ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: CROP_MASK_FRAGMENT,
      uniforms: {
        tDiffuse: { value: null as Texture | null },
        sliceState: { value: new Float32Array(CROP_MAX_DIVISIONS) },
        count: { value: 1 },
        angle: { value: 0 },
        wedge: { value: 0 },
        flash: { value: 0 },
        blur: { value: 0 },
        wet: { value: 1 },
        aspect: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    })
  }, [hasMaskSources])
  useEffect(() => () => { maskMaterial?.dispose() }, [maskMaterial])

  useEffect(() => {
    rig.own.setSize(targetW, targetH)
  }, [targetW, targetH, rig])

  // The shared scratch set is borrowed lazily on the first frame that needs a
  // pass and swapped for the right-sized set when the target size moves; the
  // pool disposes a set once its last borrower lets go.
  const scratchRef = useRef<ShaderScratch | null>(null)
  const stepsRef = useRef<Step[]>([])
  useEffect(() => () => {
    rig.own.dispose()
    if (scratchRef.current) { releaseShaderScratch(scratchRef.current); scratchRef.current = null }
  }, [rig])
  useEffect(() => () => { passes.forEach((p) => p.mat.dispose()) }, [passes])

  useFrame(() => {
    // Per-copy state for a staggered occurrence, so the offscreen pass renders
    // the copy's own world/meshScale/effect overrides on its own clock.
    const state = getObjectState(trackId, visualCopyIndex)
    if (outMeshRef.current) outMeshRef.current.visible = !!state && !state.blackedOut
    if (!state || state.blackedOut) return

    // Same clock rule as VisualBeatSync: exports drive time through the beat
    // override while the transport stays frozen.
    const beat = getBeatOverride() ?? useTimeStore.getState().currentBeat

    // Inherit the mounting scene's env map so env-driven materials (Texturizer
    // chrome/glass) keep their reflections inside the offscreen pass.
    if (rig.scene.environment !== parentScene.environment) {
      rig.scene.environment = parentScene.environment
    }

    // Render the object (with world × Scale effect × this occurrence's
    // VisualCopy transform) into the source FBO. The object's size
    // (meshScale) stays out of the world matrix and is multiplied in AFTER the
    // copy transform - applied to the mesh first, before the mover layout -
    // matching ObjectRenderer's placement group.
    if (state) {
      const visualCopy = visualCopyIndex === undefined ? undefined : getVisualCopy(trackId, visualCopyIndex)
      const effectScale = evaluatePostMoverScale(postMoverScalePlugins, state.effectOverrides, beat)
      composePostMoverScale(state.world, visualCopy?.transform, effectScale, rig.holder.matrix)
      if (state.meshScale !== 1) {
        rig.holder.matrix.multiply(_meshScale.makeScale(state.meshScale, state.meshScale, state.meshScale))
      }
      // Non-full-frame shader objects bypass ObjectRenderer's placement group,
      // so compose object + VisualCopy opacity here before rendering the source
      // FBO. Full-frame objects keep their inner placement group and therefore
      // arrive with visualCopyIndex undefined; applying again would double-fade.
      if (visualCopyIndex !== undefined) {
        applyMaterialOpacity(rig.holder, state.opacity * (visualCopy?.opacity ?? 1))
      }
    }
    // Plan this frame's chain first: the enabled shader passes (settings as of
    // this frame - stored values merged with automation), then the crop tracks
    // routed at this object. The matte is the OUTERMOST pass, so every effect
    // above lands inside the visible slices; a null resolve (crop with no
    // notes, muted, fully dry) skips that source's pass and the object shows
    // unmasked. Planning ahead is what lets the LAST pass write the wrapper's
    // own target while every earlier one uses the shared scratch set.
    const steps = stepsRef.current
    steps.length = 0
    for (const inst of plugins) {
      const eff = effectiveEffectState(inst, state?.effectOverrides)
      if (!eff.enabled) continue
      const pass = passes.get(inst.id)
      if (!pass) continue
      steps.push({ pass, eff, mask: null })
    }
    if (maskMaterial) {
      for (const sourceId of maskSourceIds ?? []) {
        const mask = resolveActiveCropMask(getObjectState(sourceId))
        if (mask) steps.push({ pass: null, eff: null, mask })
      }
    }
    const stepCount = steps.length

    let scratch = scratchRef.current
    if (stepCount > 0 && (!scratch || scratch.src.width !== targetW || scratch.src.height !== targetH)) {
      if (scratch) releaseShaderScratch(scratch)
      scratch = scratchRef.current = acquireShaderScratch(targetW, targetH)
    }

    // Render the object into the source target: the wrapper's own when no pass
    // will run (its texture is then what the overlay samples), else the shared
    // stencil-carrying scratch source.
    const prev = gl.getRenderTarget()
    const first = stepCount === 0 || !scratch ? rig.own : scratch.src
    gl.setRenderTarget(first)
    gl.setClearColor(0x000000, 0); gl.clear()
    gl.render(rig.scene, camera)

    // Chain the passes: intermediates ping-pong through the shared pair, the
    // last one lands in `own`.
    let inputTex: Texture = first.texture
    const aspect = Math.max(0.0001, size.width / Math.max(1, size.height))
    for (let i = 0; i < stepCount; i++) {
      const step = steps[i]
      if (step.pass) {
        const { pass, eff } = step
        pass.mat.uniforms.tDiffuse.value = inputTex
        if (pass.mat.uniforms.time) pass.mat.uniforms.time.value = beat
        for (const pd of pass.plugin?.params ?? []) {
          if (pass.mat.uniforms[pd.key]) pass.mat.uniforms[pd.key].value = eff.settings[pd.key] ?? pd.default
        }
        rig.quad.material = pass.mat
      } else if (maskMaterial) {
        const { mask } = step
        const uniforms = maskMaterial.uniforms
        uniforms.tDiffuse.value = inputTex
        uniforms.sliceState.value = mask.sliceState
        uniforms.count.value = mask.count
        uniforms.angle.value = mask.angle
        uniforms.wedge.value = mask.wedge ? 1 : 0
        uniforms.flash.value = mask.flash
        uniforms.blur.value = mask.blur
        uniforms.wet.value = mask.wet
        uniforms.aspect.value = aspect
        rig.quad.material = maskMaterial
      }
      const target = i === stepCount - 1 ? rig.own : (i % 2 === 0 ? scratch!.ping : scratch!.pong)
      gl.setRenderTarget(target)
      gl.setClearColor(0x000000, 0); gl.clear()
      gl.render(rig.quadScene, rig.quadCam)
      inputTex = target.texture
    }
    steps.length = 0

    gl.setRenderTarget(prev)
    rig.outUniforms.tDiffuse.value = inputTex
  })

  return (
    <>
      {createPortal(children, rig.holder)}
      {/* The post-processed result, drawn as a clip-space fullscreen overlay.
          (An "In front" track mounts in VisualScene's second pass, overlay and
          all - layering needs no special handling here.) */}
      <mesh ref={outMeshRef} frustumCulled={false} renderOrder={999}>
        <planeGeometry args={[2, 2]} />
        <shaderMaterial
          vertexShader={QUAD_VERT}
          fragmentShader={OUTPUT_FRAG}
          uniforms={rig.outUniforms}
          transparent
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
    </>
  )
}
