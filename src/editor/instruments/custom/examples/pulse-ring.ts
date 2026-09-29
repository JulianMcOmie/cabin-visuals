import * as THREE from 'three'
import { defineInstrument, p, Strokes, Sprites, SPRITE, ease, springKick, tween, GLSL } from '../../code'

// The reference code instrument: a ring of ticks that lights per MIDI row, a
// core that thumps on its own row, and a radial zoom-blur post pass that fires
// on a third. Small on purpose - copy it to start a new instrument.

export const instrument = defineInstrument({
  id: 'examples.pulse-ring',
  name: 'Pulse Ring',
  description: 'A ring of 16 ticks lit by notes on its rows, a core that thumps, and a zoom blur you can play.',
  color: '#7dd3fc',
  params: {
    radius: p.num(1.6, 0.2, 5),
    ticks: p.int(16, 3, 64),
    color: p.color('#7dd3fc'),
    hot: p.color('#ffffff'),
    blur: p.num(0.6, 0, 2, { label: 'Zoom blur' }),
  },
  rows: {
    72: 'Zoom blur',
    64: { label: 'Core thump', emphasized: true },
    60: 'Tick (next)',
  },

  setup(ctx) {
    const strokes = ctx.own(new Strokes(512, { glow: 1.3 }))
    const sprites = ctx.own(new Sprites(64))
    ctx.root.add(strokes, sprites)
    return { strokes, sprites, tmp: new THREE.Color() }
  },

  frame(ctx, s) {
    const { strokes, sprites, tmp } = s
    const n = Math.round(ctx.params.ticks)
    const R = ctx.params.radius
    strokes.begin()
    sprites.begin()
    // Each tick note lights the NEXT tick round the ring: tick k is the k-th hit.
    const ticks = ctx.hits(60, 2)
    for (let k = 0; k < n; k++) {
      const a = Math.PI / 2 - (k / n) * Math.PI * 2
      let lit = 0
      for (const h of ticks) if (h.index % n === k) lit = Math.max(lit, h.velocity * Math.exp(-h.age / 0.35))
      tmp.copy(ctx.colors.color).lerp(ctx.colors.hot, lit)
      const r0 = R * 0.92, r1 = R * (1.04 + lit * 0.25)
      strokes.seg(Math.cos(a) * r0, Math.sin(a) * r0, 0, Math.cos(a) * r1, Math.sin(a) * r1, 0, 0.02, 0.012, tmp, 0.25 + lit, 1.5 + lit * 3)
    }
    // Core thump: a closed-form spring kick per note, summed.
    let thump = 0
    for (const h of ctx.hits(64, 2)) thump += h.velocity * springKick(h.ageSec, { freq: 3, damping: 0.3 })
    sprites.put(0, 0, 0, R * (0.25 + 0.15 * thump), SPRITE.dot, ctx.colors.hot, 0.6 + 0.4 * Math.abs(thump), 2)
    // A ring flung outward on each thump.
    for (const h of ctx.hits(64, 1.5)) {
      const k = tween(h.age, 0, 1.5, ease.expo.out)
      strokes.ring(0, 0, 0, R * (0.3 + k * 1.6), 0.012 * (1 - k), ctx.colors.color, (1 - k) * h.velocity, 2.5)
    }
    strokes.end()
    sprites.end()
  },

  // Radial zoom blur, gated by the 'Zoom blur' row: idle = no pass at all.
  post: {
    fragment: /* glsl */ `
      uniform float uAmount;
      ${GLSL.screen}
      void main() {
        vec2 d = vUv - 0.5;
        vec3 c = vec3(0.0);
        float tot = 0.0;
        for (int i = 0; i < 16; i++) {
          float f = float(i) / 15.0;
          float w = 1.0 - f * 0.7;
          c += texture2D(tDiffuse, 0.5 + d * (1.0 - f * uAmount * 0.3)).rgb * w;
          tot += w;
        }
        gl_FragColor = vec4(c / tot, texture2D(tDiffuse, vUv).a);
      }`,
    uniforms: { uAmount: { value: 0 } },
    update(ctx, u) {
      const h = ctx.last(72)
      const amount = h ? h.velocity * ctx.params.blur * Math.exp(-h.age / 0.5) : 0
      if (amount < 0.002) return false
      u.uAmount.value = amount
    },
  },
})
