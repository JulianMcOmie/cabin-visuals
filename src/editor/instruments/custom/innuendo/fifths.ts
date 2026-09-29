import * as THREE from 'three'
import { defineInstrument, p, Strokes, Sprites, SPRITE, clamp, impulse, hash } from '../../code'
import { fifths, fifthsAngle, KEY_OPTIONS, pitchClass } from './_shared'

// Harmony as a constellation: twelve points round the circle of fifths (the
// key's root at the top), mirrored left/right. Each note flares its pitch
// class's star and throws sparks; notes struck together are joined, so every
// chord draws as a symmetric polygon - consonant ones compact, dissonant ones
// sprawling. Any pitch (the full piano roll).

interface State { lines: Strokes; stars: Sprites; tmp: THREE.Color }

export const instrument = defineInstrument<State>({
  id: 'innuendo.fifths',
  name: 'Fifths Constellation',
  description: 'Notes flare as stars on the circle of fifths (mirrored); notes struck together join into symmetric chord polygons.',
  color: '#b9a2ff',
  params: {
    key: p.select(KEY_OPTIONS, 6, { label: 'Key root' }),
    radius: p.num(2.2, 0.2, 8),
    size: p.num(0.34, 0.05, 2, { label: 'Star size' }),
    decay: p.num(0.8, 0.05, 8, { label: 'Decay (beats)' }),
    sparks: p.int(10, 0, 40),
    ghost: p.num(0.18, 0, 1),
    spin: p.num(0, -1, 1, { label: 'Spin (rev/bar)' }),
    color: p.color('#b9a2ff'),
    hot: p.color('#ffffff', { label: 'Flare colour' }),
  },

  setup(ctx) {
    const lines = ctx.own(new Strokes(1024, { glow: 1.2 }))
    const stars = ctx.own(new Sprites(2048))
    ctx.root.add(lines, stars)
    return { lines, stars, tmp: new THREE.Color() }
  },

  frame(ctx, s) {
    const root = Math.round(ctx.params.key)
    const R = ctx.params.radius, size = ctx.params.size, decay = ctx.params.decay
    const spin = ctx.bar * ctx.params.spin * Math.PI * 2
    s.lines.begin()
    s.stars.begin()
    if (ctx.params.ghost > 0) {
      for (let k = 0; k < 12; k++) {
        const a = fifthsAngle(k, 1, spin)
        s.stars.put(Math.cos(a) * R, Math.sin(a) * R, 0, size * 0.12, SPRITE.dot, ctx.colors.color, ctx.params.ghost, 1.2)
      }
    }
    const nodes: Array<{ x: number; y: number; e: number; step: number }> = []
    for (const h of ctx.hits(undefined, decay * 6, 48)) {
      const env = impulse(h.age, 0.02, decay * (0.5 + Math.min(2, h.dur))) * h.velocity
      if (env < 0.01) continue
      const k = fifths(pitchClass(h.pitch), root)
      const step = Math.round(h.beat * 4)
      for (const side of [1, -1] as const) {
        const a = fifthsAngle(k, side, spin)
        const x = Math.cos(a) * R, y = Math.sin(a) * R
        s.tmp.copy(ctx.colors.color).lerp(ctx.colors.hot, clamp(env * 1.5))
        s.stars.put(x, y, 0, size * (0.5 + env), SPRITE.flare, s.tmp, clamp(env * 1.4), 3, side * 0.2)
        nodes.push({ x, y, e: env, step })
        const n = Math.round(ctx.params.sparks)
        for (let j = 0; j < n; j++) {
          const dir = a + (hash(h.index, h.pitch, j, 1) - 0.5) * 2.4 * side
          const dist = ((0.35 + hash(h.index, h.pitch, j, 2) * 0.9) * (1 - Math.exp(-h.ageSec * 3.5)) / 3.5) * 3
          s.stars.put(x + Math.cos(dir) * dist, y + Math.sin(dir) * dist, 0, size * 0.07 * (1 + hash(h.index, j, 3)), SPRITE.dot, s.tmp, Math.exp(-h.ageSec / 0.5) * h.velocity, 3)
        }
      }
    }
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j]
      if (Math.abs(a.step - b.step) > 1) continue
      const e = Math.min(a.e, b.e)
      if (e > 0.02) s.lines.seg(a.x, a.y, 0, b.x, b.y, 0, 0.006, 0.006, ctx.colors.color, clamp(e * 1.2), 2.4)
    }
    s.lines.end()
    s.stars.end()
  },
})
