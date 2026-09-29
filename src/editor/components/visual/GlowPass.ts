import {
  HalfFloatType,
  LinearFilter,
  Mesh,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three'
import { glowAxes, glowSettings, glowWeights } from '../../effects/shaders/glow'

export const GLOW_VERTEX =
  'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}'
const sample = `vec4 readSource(vec2 uv){if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return vec4(0.);return texture2D(tDiffuse,uv);}`
export const GLOW_EXTRACT = `
uniform sampler2D tDiffuse; uniform vec2 pixel; uniform float source,threshold,softness,tintMix; uniform vec3 tint;
varying vec2 vUv;
${sample}
void main(){
 vec4 s=readSource(vUv);
 // Offscreen geometry is premultiplied. Unassociate only to measure color;
 // coverage/fades enter emission exactly once, after the threshold decision.
 vec3 color=s.rgb/max(s.a,0.00001);
 float peak=max(color.r,max(color.g,color.b));
 float gate=source<0.5 ? (softness<0.00001 ? step(threshold,peak) : smoothstep(max(0.,threshold-softness*.5),threshold+softness*.5,peak)) : 1.;
 if(source>1.5){
  float edge=1.;
  edge=min(edge,readSource(vUv+vec2(pixel.x,0.)).a/max(s.a,0.00001));
  edge=min(edge,readSource(vUv-vec2(pixel.x,0.)).a/max(s.a,0.00001));
  edge=min(edge,readSource(vUv+vec2(0.,pixel.y)).a/max(s.a,0.00001));
  edge=min(edge,readSource(vUv-vec2(0.,pixel.y)).a/max(s.a,0.00001));
  gate*=clamp(1.-edge,0.,1.);
 }
 // Whole Object / Outline normalize chroma for dark colored emitters. Black
 // remains black unless a tint is chosen; the original is never whitened.
 vec3 emission=source<0.5 ? color : color/max(peak,0.00001);
 emission=mix(emission,tint*max(1.,source<0.5 ? peak : 1.),tintMix);
 gl_FragColor=vec4(emission*s.a*gate,s.a*gate);
}`
const DOWN = `uniform sampler2D tDiffuse;uniform vec2 pixel;varying vec2 vUv;${sample}
void main(){gl_FragColor=(readSource(vUv+pixel*vec2(-.5,-.5))+readSource(vUv+pixel*vec2(.5,-.5))+readSource(vUv+pixel*vec2(-.5,.5))+readSource(vUv+pixel*vec2(.5,.5)))*.25;}`
const BLUR = `uniform sampler2D tDiffuse;uniform vec2 direction;varying vec2 vUv;${sample}
void main(){vec4 c=vec4(0.);float total=0.;for(int i=-16;i<=16;i++){float x=float(i);float w=exp(-.5*x*x/16.);c+=readSource(vUv+direction*x)*w;total+=w;}gl_FragColor=c/total;}`
const COMPOSE = `uniform sampler2D tDiffuse,tSmall,tMedium,tWide;uniform vec3 weights;uniform float strength,coreBrightness,coreWhite;varying vec2 vUv;
void main(){vec4 b=texture2D(tDiffuse,vUv);vec3 core=b.rgb*coreBrightness;float peak=max(core.r,max(core.g,core.b));core=mix(core,vec3(peak),coreWhite);
vec4 h=vec4(0.);if(strength>0.)h=(texture2D(tSmall,vUv)*weights.x+texture2D(tMedium,vUv)*weights.y+texture2D(tWide,vUv)*weights.z)*strength;
// Keep additive light unassociated from core coverage; composite core + emitted
// radiance in linear HDR. Alpha only records the light's visible support.
gl_FragColor=vec4(core+h.rgb*(1.-clamp(b.a,0.,1.)),b.a+(1.-b.a)*(1.-exp(-max(h.r,max(h.g,h.b)))));}`

export function glowTarget(w = 1, h = 1) {
  return new WebGLRenderTarget(w, h, {
    type: HalfFloatType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
  })
}
export function glowMaterial(fragmentShader: string, uniforms: Record<string, { value: unknown }>) {
  return new ShaderMaterial({
    vertexShader: GLOW_VERTEX,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    blending: NoBlending,
  })
}
/** A future depth-fog stage belongs AFTER extraction (Whole Object normalizes
 * chroma) and BEFORE spreading. Returned radiance is linear/premultiplied and
 * must remain alive until render returns. Core/source are never modified here.
 * Depth is the scene's visibility depth; translucent non-depth-writing emitters
 * need their own depth representation before a spatial fog stage can use it. */
export interface GlowEmissionStage {
  (context: {
    renderer: WebGLRenderer
    emission: Texture
    source: Texture
    depth: Texture | null
    width: number
    height: number
  }): Texture
}

/** Stateless filtering; all intermediates are overwritten every invocation. One
 * instance can be reused sequentially for every compatible group in a scene. */
export class GlowPass {
  emissionStage?: GlowEmissionStage
  sourceDepth: Texture | null = null
  /** Diagnostic/extension view of current extracted emission; scratch lifetime,
   * overwritten on the next render, not a persistent per-track texture. */
  emissionTexture: Texture | null = null
  private scene = new Scene()
  private camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private quad = new Mesh(new PlaneGeometry(2, 2))
  private extract = glowMaterial(GLOW_EXTRACT, {
    tDiffuse: { value: null },
    pixel: { value: new Vector2() },
    source: { value: 1 },
    threshold: { value: 0.7 },
    softness: { value: 0.3 },
    tintMix: { value: 0 },
    tint: { value: new Vector3() },
  })
  private down = glowMaterial(DOWN, {
    tDiffuse: { value: null },
    pixel: { value: new Vector2() },
  })
  private blur = glowMaterial(BLUR, {
    tDiffuse: { value: null },
    direction: { value: new Vector2() },
  })
  private compose = glowMaterial(
    COMPOSE,
    Object.fromEntries(
      ['tDiffuse', 'tSmall', 'tMedium', 'tWide', 'strength', 'coreBrightness', 'coreWhite'].map(
        (k) => [k, { value: null }],
      ),
    ),
  )
  private levels: WebGLRenderTarget[] = []
  private scratch = new Map<string, WebGLRenderTarget>()
  private width = 0
  private height = 0
  private cached(slot: string, w: number, h: number) {
    const key = `${slot}:${w}x${h}`
    let target = this.scratch.get(key)
    if (!target) {
      target = glowTarget(w, h)
      this.scratch.set(key, target)
    }
    return target
  }
  draws = 0
  constructor() {
    this.scene.add(this.quad)
    this.compose.uniforms.weights = { value: new Vector3() }
    this.extract.name = 'Glow extract'
    this.blur.name = 'Glow blur'
    this.down.name = 'Glow downsample'
    this.compose.name = 'Glow composite'
  }
  draw(gl: WebGLRenderer, mat: ShaderMaterial, target: WebGLRenderTarget) {
    this.quad.material = mat
    gl.setRenderTarget(target)
    gl.clear(true, false, false)
    gl.render(this.scene, this.camera)
    this.draws++
  }
  render(
    gl: WebGLRenderer,
    input: Texture,
    output: WebGLRenderTarget,
    values: Record<string, number>,
    halo = true,
  ) {
    const s = glowSettings(values),
      w = output.width,
      h = output.height
    this.draws = 0
    this.emissionTexture = null
    if (w !== this.width || h !== this.height) {
      for (const t of [...this.levels, ...this.scratch.values()]) t.dispose()
      this.levels = []
      this.scratch.clear()
      this.width = w
      this.height = h
    }
    const scales: WebGLRenderTarget[] = []
    if (halo && s.strength > 0) {
      const hue = s.tintHue / 60,
        chroma = s.tintSaturation
      const rgb = [0, 4, 2].map(
        (n) => 1 - chroma + chroma * Math.max(0, Math.min(1, Math.abs(((hue + n) % 6) - 3) - 1)),
      )
      Object.assign(this.extract.uniforms, {
        tDiffuse: { value: input },
        source: { value: s.source },
        threshold: { value: s.threshold },
        softness: { value: s.softness },
        tintMix: { value: s.tintMix },
      })
      this.extract.uniforms.tint.value.set(...rgb)
      this.extract.uniforms.pixel.value.set(
        Math.max(1 / w, 1 / ((1080 * w) / h)),
        Math.max(1 / h, 1 / 1080),
      )
      const extracted = this.levels[0] ?? (this.levels[0] = glowTarget(w, h))
      this.draw(gl, this.extract, extracted)
      this.emissionTexture =
        this.emissionStage?.({
          renderer: gl,
          emission: extracted.texture,
          source: input,
          depth: this.sourceDepth,
          width: w,
          height: h,
        }) ?? extracted.texture
      const axes = glowAxes(s.radius, s.stretch, s.angle, w, h)
      const built = new Set<string>()
      for (const [i, factor] of [0.18, 0.45, 1].entries()) {
        // Prefilter each screen axis separately. Horizontal streaks retain
        // vertical detail, and even maximum stretch has densely sampled taps.
        const reachX = Math.hypot(axes[0][0], axes[1][0]) * w * factor
        const reachY = Math.hypot(axes[0][1], axes[1][1]) * h * factor
        const lx = Math.max(0, Math.floor(Math.log2(Math.max(1, reachX / 8))))
        const ly = Math.max(0, Math.floor(Math.log2(Math.max(1, reachY / 8))))
        let source = this.emissionTexture,
          sw = w,
          sh = h
        for (let l = 1; l <= Math.max(lx, ly); l++) {
          const dw = Math.max(1, Math.ceil(w / 2 ** Math.min(l, lx))),
            dh = Math.max(1, Math.ceil(h / 2 ** Math.min(l, ly)))
          const down = this.cached('down', dw, dh),
            key = `${dw}x${dh}`
          if (!built.has(key)) {
            this.down.uniforms.tDiffuse.value = source
            this.down.uniforms.pixel.value.set(dw === sw ? 0 : 1 / sw, dh === sh ? 0 : 1 / sh)
            this.draw(gl, this.down, down)
            built.add(key)
          }
          source = down.texture
          sw = dw
          sh = dh
        }
        const target = this.cached(`scale${i}`, sw, sh),
          ping = this.cached('ping', sw, sh)
        scales.push(target)
        this.blur.uniforms.tDiffuse.value = source
        // Radius is approximately the 3-sigma reach. 33 Gaussian taps with
        // sigma=4 sample units, on a prefiltered mip, have no stochastic rings.
        this.blur.uniforms.direction.value.set(
          (axes[0][0] * factor) / 12,
          (axes[0][1] * factor) / 12,
        )
        this.draw(gl, this.blur, ping)
        this.blur.uniforms.tDiffuse.value = ping.texture
        this.blur.uniforms.direction.value.set(
          (axes[1][0] * factor) / 12,
          (axes[1][1] * factor) / 12,
        )
        this.draw(gl, this.blur, target)
      }
    }
    const u = this.compose.uniforms
    u.tDiffuse.value = input
    u.tSmall.value = scales[0]?.texture ?? input
    u.tMedium.value = scales[1]?.texture ?? input
    u.tWide.value = scales[2]?.texture ?? input
    u.weights.value.set(...glowWeights(s.spread))
    u.strength.value = halo ? s.strength : 0
    u.coreBrightness.value = s.coreBrightness
    u.coreWhite.value = s.coreWhite
    this.draw(gl, this.compose, output)
  }
  dispose() {
    for (const t of [...this.levels, ...this.scratch.values()]) t.dispose()
    for (const m of [this.extract, this.down, this.blur, this.compose]) m.dispose()
    this.quad.geometry.dispose()
  }
}
