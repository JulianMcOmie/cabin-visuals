import { useMemo, useRef, useEffect, type ReactNode } from 'react'
import { useFrame, useThree, createPortal } from '@react-three/fiber'
import {
  Scene, Group, AmbientLight, DirectionalLight, PointLight, Mesh,
  ShaderMaterial, WebGLRenderTarget, OrthographicCamera, PlaneGeometry, Vector2, LinearFilter,
  type IUniform, type Texture,
} from 'three'
import { useTimeStore } from '../../store/TimeStore'
import { getObjectState } from '../../core/visual/VisualEngine'
import { getEffect } from '../../effects'
import type { EffectInstance } from '../../types'

// Fullscreen-quad vertex shader: writes clip space directly, so a 2×2 plane always fills
// the target regardless of camera. Passthrough fragment blits the final texture.
const QUAD_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }'
const PASSTHROUGH_FRAG = 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tDiffuse, vUv); }'
// The FBO chain works in linear space; the main scene's render to the canvas applies
// the sRGB output encoding, but this overlay (a raw ShaderMaterial) bypasses it — so it
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

/**
 * Per-object screen-space shader chain (plan §4.6, Option A — ported from Excellent DAW).
 * The object is rendered — with its world transform — into an offscreen scene/FBO, each
 * shader plugin runs as a fullscreen post pass (ping-pong FBOs), and the result is drawn
 * as a clip-space fullscreen overlay (depth-test off) over the 3D scene. So a shaded object
 * becomes a full-frame post-processed layer; un-shaded objects render normally, unaffected.
 */
export function ShaderWrapper({ trackId, plugins, children }: { trackId: string; plugins: EffectInstance[]; children: ReactNode }) {
  const { gl, camera, size } = useThree()
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

    const w = Math.max(1, Math.floor(size.width)), h = Math.max(1, Math.floor(size.height))
    const opts = { minFilter: LinearFilter, magFilter: LinearFilter }
    const src = new WebGLRenderTarget(w, h, opts)
    const ping = new WebGLRenderTarget(w, h, opts)
    const pong = new WebGLRenderTarget(w, h, opts)

    const quadScene = new Scene()
    const quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const quad = new Mesh(new PlaneGeometry(2, 2))
    quadScene.add(quad)

    const outUniforms: Record<string, IUniform> = { tDiffuse: { value: null as Texture | null } }
    return { scene, holder, src, ping, pong, quadScene, quadCam, quad, outUniforms }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  useEffect(() => {
    const w = Math.max(1, Math.floor(size.width)), h = Math.max(1, Math.floor(size.height))
    rig.src.setSize(w, h); rig.ping.setSize(w, h); rig.pong.setSize(w, h)
  }, [size.width, size.height, rig])

  useEffect(() => () => {
    rig.src.dispose(); rig.ping.dispose(); rig.pong.dispose()
  }, [rig])
  useEffect(() => () => { passes.forEach((p) => p.mat.dispose()) }, [passes])

  useFrame(() => {
    const state = getObjectState(trackId)
    if (outMeshRef.current) outMeshRef.current.visible = !state?.blackedOut
    if (state?.blackedOut) return

    // Render the object (with its world transform) into the source FBO.
    if (state) rig.holder.matrix.copy(state.world)
    const beat = useTimeStore.getState().currentBeat
    const prev = gl.getRenderTarget()
    gl.setRenderTarget(rig.src)
    gl.setClearColor(0x000000, 0); gl.clear()
    gl.render(rig.scene, camera)

    // Chain the enabled shader passes, ping-ponging between two targets.
    let inputTex: Texture = rig.src.texture
    let a = rig.ping, b = rig.pong
    for (const inst of plugins) {
      if (!inst.enabled) continue
      const pass = passes.get(inst.id)
      if (!pass) continue
      pass.mat.uniforms.tDiffuse.value = inputTex
      if (pass.mat.uniforms.time) pass.mat.uniforms.time.value = beat
      for (const pd of pass.plugin?.params ?? []) {
        if (pass.mat.uniforms[pd.key]) pass.mat.uniforms[pd.key].value = inst.settings[pd.key] ?? pd.default
      }
      rig.quad.material = pass.mat
      gl.setRenderTarget(a)
      gl.setClearColor(0x000000, 0); gl.clear()
      gl.render(rig.quadScene, rig.quadCam)
      inputTex = a.texture
      const t = a; a = b; b = t
    }

    gl.setRenderTarget(prev)
    rig.outUniforms.tDiffuse.value = inputTex
  })

  return (
    <>
      {createPortal(children, rig.holder)}
      {/* The post-processed result, drawn as a clip-space fullscreen overlay. */}
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
