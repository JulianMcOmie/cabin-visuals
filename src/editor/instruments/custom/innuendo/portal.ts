import { defineComposition, p, clamp, GLSL } from '../../code'
import type { CompositionLayer } from '../../code'

// Portal: scene changes as one continuous flight. A note on a scene's row CUTS
// to that scene on its downbeat - and because a composition can read its own
// future notes, the dive starts `beats` BEFORE the note: the current scene
// magnifies into a portal shaped like the next scene's motif, the next scene
// grows out of it (its outline echoing inward, Droste-style, into a tunnel of
// frames), and the crash lands exactly on the note. A flash on the crash.
//
// Style rows, placed at the SAME beat as a scene note, shape that cut:
//   36-44  portal shape (circle, triangle … 12-gon)
//   47     warp: a longer, faster dive with a bigger flash (for drops)
//   45     hard cut: no dive at all
// With no style row, a cut uses the Portal/Beats params.

const SHAPES: Record<number, number> = { 36: 0, 37: 3, 38: 4, 39: 5, 40: 6, 41: 7, 42: 8, 43: 10, 44: 12 }
const ROW_WARP = 47
const ROW_HARD = 45

const OUT = /* glsl */ `
uniform float uZoom, uBlur, uDim;
void main(){
  vec2 d = vUv - 0.5;
  vec3 c = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float f = float(i) / 7.0;
    c += texture2D(tScene, clamp(0.5 + d / (uZoom * (1.0 + f * uBlur)), 0.0005, 0.9995)).rgb;
  }
  gl_FragColor = vec4(c / 8.0 * uDim, uOpacity);
}`

const IN = /* glsl */ `
uniform float uP, uSides, uRot, uWarp, uFlash;
uniform vec3 uRim;
${GLSL.screen}
void main(){
  vec2 p = toCentered(vUv, uAspect);
  float K = uWarp > 0.5 ? 3.9 : 3.4;
  float zb = exp((uP - 1.0) * K);
  float Rfull = length(vec2(uAspect, 1.0)) * 1.04 / (uSides > 2.5 ? cos(3.14159265 / uSides) : 1.0);
  float rp = shapeR(p, uSides, uRot + uP * (uWarp > 0.5 ? 1.2 : 0.4));
  float R = Rfull * zb;
  float d = rp - R;
  float m = smoothstep(0.003 * (1.0 + R), -0.003 * (1.0 + R), d);
  vec3 scene = texture2D(tScene, clamp(toUv(p / zb, uAspect), 0.0005, 0.9995)).rgb;
  float rim = exp(-abs(d) / (0.004 + 0.01 * R)) * (1.0 - uP * 0.6);
  for (int n = 1; n < 7; n++) {
    float Rn = R * exp(-float(n) * 0.55);
    rim += exp(-abs(rp - Rn) / (0.003 + 0.01 * Rn)) * 0.55 * exp(-float(n) * 0.35) * (uWarp > 0.5 ? 1.6 : 0.8) * smoothstep(0.0, 0.3, uP);
  }
  rim *= step(uP, 0.999);
  vec3 col = scene * m + uRim * rim * 2.2;
  col = mix(col, vec3(1.15), uFlash);
  gl_FragColor = vec4(col, clamp(max(m, rim) + uFlash, 0.0, 1.0) * uOpacity);
}`

export const composition = defineComposition({
  id: 'innuendo.portal',
  name: 'Portal',
  description: 'Cuts between scenes by diving through a portal shaped like the next scene; the crash lands on the note.',
  params: {
    beats: p.num(2, 0.25, 8, { label: 'Dive (beats)' }),
    warpBeats: p.num(4, 0.5, 16, { label: 'Warp (beats)' }),
    sides: p.select(['Circle', 'Triangle', 'Square', 'Pentagon', 'Hexagon', 'Octagon', '12-gon'], 0, { label: 'Portal' }),
    rim: p.color('#ffffff', { label: 'Rim' }),
    flash: p.num(1, 0, 2, { label: 'Flash' }),
  },
  rows: {
    47: { label: 'Warp (this cut)', color: '#f472b6' },
    45: 'Hard cut (this cut)',
    36: 'Portal ○', 37: 'Portal △', 38: 'Portal □', 39: 'Portal ⬠', 40: 'Portal ⬡', 41: 'Portal 7', 42: 'Portal 8', 43: 'Portal 10', 44: 'Portal 12',
  },
  resolve(ctx) {
    const isScene = (pitch: number) => !!ctx.scene(pitch)
    const cutAt = (beat: number, pitch: number) => ctx.between(pitch, beat - 1e-3, beat + 1e-3).length > 0
    const styleOf = (beat: number) => {
      const warp = cutAt(beat, ROW_WARP)
      const hard = cutAt(beat, ROW_HARD)
      let sides = [0, 3, 4, 5, 6, 8, 12][Math.round(ctx.params.sides)] ?? 0
      for (const [pitch, s] of Object.entries(SHAPES)) if (cutAt(beat, Number(pitch))) sides = s
      return { warp, hard, sides, beats: warp ? ctx.params.warpBeats : ctx.params.beats }
    }
    const current = ctx.last(isScene)
    const next = ctx.next(isScene)
    const rim = ctx.colors.rim
    const flashLayer = (layer: CompositionLayer, age: number, warp: boolean): CompositionLayer => {
      const f = age >= 0 ? Math.exp(-age / (warp ? 0.18 : 0.12)) * ctx.params.flash * (warp ? 1 : 0.35) : 0
      return f > 0.002
        ? ctx.shaded(layer.sceneId, {
          key: 'innuendo.portal:flash',
          fragment: 'uniform float uFlash; void main(){ vec3 c = texture2D(tScene, vUv).rgb; gl_FragColor = vec4(mix(c, vec3(1.15), uFlash), uOpacity); }',
          uniforms: { uFlash: clamp(f) },
        })
        : layer
    }
    // Before the first scene note: the first bound scene, plain.
    if (!current) {
      const first = next ? ctx.scene(next.pitch) : ctx.scenes[0]
      return first ? [ctx.layer(first.sceneId)] : []
    }
    const here = ctx.scene(current.pitch)!.sceneId
    if (next) {
      const style = styleOf(next.beat)
      const to = ctx.scene(next.pitch)!.sceneId
      if (!style.hard && to !== here && next.in < style.beats) {
        const pr = Math.pow(1 - next.in / style.beats, 1.35)
        const K = style.warp ? 3.9 : 3.4
        return [
          ctx.shaded(here, { key: 'innuendo.portal:out', fragment: OUT, uniforms: { uZoom: Math.exp(pr * K), uBlur: pr * pr * (style.warp ? 0.22 : 0.14), uDim: 1 - Math.min(1, Math.max(0, (pr - 0.45) / 0.55)) * 0.85 } }),
          ctx.shaded(to, {
            key: 'innuendo.portal:in', fragment: IN,
            uniforms: { uP: pr, uSides: style.sides, uRot: style.sides >= 3 ? Math.PI / 2 : 0, uWarp: style.warp ? 1 : 0, uFlash: 0, uRim: [rim.r, rim.g, rim.b] },
          }),
        ]
      }
    }
    return [flashLayer(ctx.layer(here), current.age, styleOf(current.beat).warp)]
  },
})
