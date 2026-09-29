import * as THREE from 'three'
import { defineInstrument, p, Strokes, Sprites, SPRITE, clamp, impulse } from '../../code'
import { stepAngle } from './_shared'

// The rhythm as a ring: sixteen steps of a bar folded down BOTH sides of a
// circle (top = the downbeat, bottom = the last 16th), so any pattern draws as
// a mirrored shape. Each note lights the step its onset falls on - any pitch;
// higher velocity reaches further. A playhead dot runs the bar on both sides.

interface State { lines: Strokes; dots: Sprites; tmp: THREE.Color }

export const instrument = defineInstrument<State>({
  id: 'innuendo.step-ring',
  name: 'Step Ring',
  description: 'A mirrored 16-step ring that lights the actual rhythm: each note lights the step its onset lands on.',
  color: '#eaf4ff',
  params: {
    radius: p.num(1.45, 0.2, 6),
    length: p.num(0.12, 0.02, 1, { label: 'Tick length' }),
    width: p.num(0.009, 0.001, 0.06, { label: 'Tick width' }),
    reach: p.num(0.35, 0, 2, { label: 'Lit reach' }),
    decay: p.num(0.5, 0.05, 4, { label: 'Decay (beats)' }),
    ghost: p.num(0.12, 0, 1),
    playhead: p.bool(true),
    color: p.color('#eaf4ff'),
    hot: p.color('#56d8ff', { label: 'Lit colour' }),
  },
  // any pitch: the ring reads timing, not pitch

  setup(ctx) {
    const lines = ctx.own(new Strokes(256, { glow: 1.3 }))
    const dots = ctx.own(new Sprites(8))
    ctx.root.add(lines, dots)
    return { lines, dots, tmp: new THREE.Color() }
  },

  frame(ctx, s) {
    const lit = new Float32Array(16)
    const decay = ctx.params.decay
    for (const h of ctx.hits(undefined, decay * 6)) {
      const k = ((Math.round(h.beat * 4) % 16) + 16) % 16
      lit[k] += h.velocity * impulse(h.age, 0.02, decay)
    }
    const R = ctx.params.radius, len = ctx.params.length, w = ctx.params.width, ghost = ctx.params.ghost
    s.lines.begin()
    for (let k = 0; k < 16; k++) {
      const L = clamp(lit[k], 0, 1.5)
      for (const side of [1, -1] as const) {
        const a = stepAngle(k, side)
        const c = Math.cos(a), sn = Math.sin(a)
        const r0 = R - len * 0.5, r1 = R + len * 0.5 + L * ctx.params.reach
        s.tmp.copy(ctx.colors.color).lerp(ctx.colors.hot, clamp(L))
        s.lines.seg(c * r0, sn * r0, 0, c * r1, sn * r1, 0, w * (1 + L * 0.8), w * (1 + L * 0.3), s.tmp, ghost + (1 - ghost) * clamp(L), 2.2 * (0.4 + L))
      }
    }
    s.lines.end()
    s.dots.begin()
    if (ctx.params.playhead >= 0.5) {
      const pos = (((ctx.beat * 4) % 16) + 16) % 16
      for (const side of [1, -1] as const) {
        const a = stepAngle(pos - 0.5, side)
        s.dots.put(Math.cos(a) * (R - len), Math.sin(a) * (R - len), 0, w * 4, SPRITE.dot, ctx.colors.color, 0.7, 2)
      }
    }
    s.dots.end()
  },
})
