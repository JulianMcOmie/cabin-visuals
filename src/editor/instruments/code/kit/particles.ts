import * as THREE from 'three'
import { FORCE_TRANSPARENT_KEY } from '../../../core/visual/animatedOpacity'
import { GLSL } from './glsl'
import { rng } from '../motion'

// GPU particles whose every position is computed in the vertex shader from a
// per-particle seed and uniforms - so a hundred thousand motes cost one draw and
// no CPU per frame, and stay a pure function of the beat (no simulation state:
// "physics" is closed-form in the shader, as in the Chladni sand).
//
//   const sand = particles({
//     count: 120_000,
//     uniforms: { uKick: { value: 0 } },
//     vertex: `
//       pos = vec3(aSeed.x * 2.0 - 1.0, 0.0, aSeed.y * 2.0 - 1.0);
//       pos.y += uKick * aSeed.z;
//       size = 1.5; color = vec4(1.0, 0.8, 0.5, 0.6);`,
//   })
//   ctx.root.add(sand)                 // then per frame: sand.u('uKick').value = ...
//
// Inputs available to `vertex`: attribute vec4 aSeed (uniform randoms),
// attribute float aIndex, uniform float uBeat / uSec / uPx, your uniforms, and
// GLSL.noise + GLSL.rotate helpers. Outputs to assign: vec3 pos (local space),
// float size (pixels at 1080p, before perspective), vec4 color (linear rgb, a).
// A point smaller than a pixel at the render size is drawn at one pixel with
// its alpha scaled by its true area, so brightness doesn't depend on resolution.
// Optional `header` goes above main (functions, extra uniforms/varyings).

export interface ParticleOpts {
  count: number
  seed?: number
  vertex: string
  header?: string
  /** Replace the default soft-sprite fragment. Inputs: varying vec4 vColor,
   *  gl_PointCoord, uniform float uOpacity. Must write gl_FragColor. */
  fragment?: string
  uniforms?: Record<string, THREE.IUniform>
  blend?: 'add' | 'normal'
  /** Sprite hardness for the default fragment (0 = all glow, 1 = hard disc). */
  hardness?: number
  /** Perspective size falloff reference distance (size is exact at this depth). */
  sizeRef?: number
}

export class Particles extends THREE.Points {
  readonly mat: THREE.ShaderMaterial

  constructor(opts: ParticleOpts) {
    const geo = new THREE.BufferGeometry()
    const n = opts.count
    const seeds = new Float32Array(n * 4)
    const idx = new Float32Array(n)
    const r = rng(opts.seed ?? 1)
    for (let i = 0; i < n; i++) {
      seeds[i * 4] = r(); seeds[i * 4 + 1] = r(); seeds[i * 4 + 2] = r(); seeds[i * 4 + 3] = r()
      idx[i] = i
    }
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4))
    geo.setAttribute('aIndex', new THREE.BufferAttribute(idx, 1))
    const vertexShader = /* glsl */ `
      attribute vec4 aSeed;
      attribute float aIndex;
      uniform float uBeat, uSec, uPx, uSizeRef;
      varying vec4 vColor;
      ${GLSL.noise}
      ${GLSL.rotate}
      ${opts.header ?? ''}
      void main(){
        vec3 pos = vec3(0.0);
        float size = 2.0;
        vec4 color = vec4(1.0);
        ${opts.vertex}
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mv;
        // A point can't rasterize below one pixel: draw it at one and dim it by
        // the area it really covers, so a small render (an audit, a thumbnail)
        // keeps the full-size frame's brightness instead of fogging over.
        float cabinPointPx = size * uPx * (uSizeRef / max(0.05, -mv.z));
        gl_PointSize = max(cabinPointPx, 1.0);
        vColor = vec4(color.rgb, color.a * min(1.0, cabinPointPx * cabinPointPx));
      }
    `
    const fragmentShader = opts.fragment ?? /* glsl */ `
      uniform float uOpacity;
      uniform float uHardness;
      varying vec4 vColor;
      ${GLSL.pointSprite}
      void main(){
        float a = pointSprite(gl_PointCoord, uHardness) * vColor.a * uOpacity;
        if (a < 0.003) discard;
        #ifdef ADDITIVE
          gl_FragColor = vec4(vColor.rgb * a, 1.0);
        #else
          gl_FragColor = vec4(vColor.rgb, a);
        #endif
      }
    `
    const blend = opts.blend ?? 'add'
    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uBeat: { value: 0 }, uSec: { value: 0 }, uPx: { value: 1 }, uOpacity: { value: 1 },
        uHardness: { value: opts.hardness ?? 0.25 }, uSizeRef: { value: opts.sizeRef ?? 5 },
        ...opts.uniforms,
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending,
      defines: blend === 'add' ? { ADDITIVE: '' } : {},
    })
    mat.userData[FORCE_TRANSPARENT_KEY] = true
    super(geo, mat)
    this.mat = mat
    this.frustumCulled = false
  }

  /** A uniform by name (throws on a typo, which beats a silent no-op). */
  u(name: string): THREE.IUniform {
    const uni = this.mat.uniforms[name]
    if (!uni) throw new Error(`particles: no uniform "${name}"`)
    return uni
  }

  /** Feed the standard clock uniforms; call once per frame. */
  tick(beat: number, sec: number, px: number) {
    this.mat.uniforms.uBeat.value = beat
    this.mat.uniforms.uSec.value = sec
    this.mat.uniforms.uPx.value = px
  }

  dispose() {
    this.geometry.dispose()
    this.mat.dispose()
  }
}

export const particles = (opts: ParticleOpts) => new Particles(opts)
