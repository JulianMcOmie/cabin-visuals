import * as THREE from 'three'
import { defineInstrument, p, Strokes, clamp, ease, hash } from '../../code'

// Snare blades: each note flings tapered blades out of the centre in mirrored
// pairs (or n-fold, for kaleidoscopic scenes), hot white at the strike and
// cooling as they fly. Any pitch; velocity sets reach and brightness.

interface State { lines: Strokes; tmp: THREE.Color }

export const instrument = defineInstrument<State>({
  id: 'innuendo.blades',
  name: 'Blades',
  description: 'Each note flings tapered blades from the centre - mirrored pairs, or n-fold radial.',
  color: '#ff8a5b',
  params: {
    count: p.int(3, 1, 12, { label: 'Blades per side' }),
    radial: p.int(0, 0, 16, { label: 'Radial n (0 = mirror)' }),
    axis: p.num(0, -180, 180, { label: 'Axis (°)' }),
    spread: p.num(0.9, 0, 3),
    start: p.num(0.9, 0, 6, { label: 'Start radius' }),
    travel: p.num(2.6, 0, 10),
    length: p.num(0.8, 0.05, 4),
    width: p.num(0.03, 0.002, 0.3),
    life: p.num(0.7, 0.1, 4, { label: 'Life (s)' }),
    color: p.color('#ff8a5b'),
    hot: p.color('#ffffff', { label: 'Strike colour' }),
  },

  setup(ctx) {
    const lines = ctx.own(new Strokes(2048, { glow: 1.2 }))
    ctx.root.add(lines)
    return { lines, tmp: new THREE.Color() }
  },

  frame(ctx, s) {
    const life = ctx.params.life
    const n = Math.round(ctx.params.radial)
    const axis = (ctx.params.axis * Math.PI) / 180
    s.lines.begin()
    for (const h of ctx.hits(undefined, life / ctx.secPerBeat, 8)) {
      const k = h.ageSec / life
      if (k >= 1) continue
      const reach = ctx.params.start + ctx.params.travel * ease.expo.out(clamp(h.ageSec / (life * 0.8)))
      const L = ctx.params.length * (1 - k) * (0.6 + h.velocity * 0.6)
      const w = ctx.params.width * (1 - k * 0.5)
      const alpha = (1 - k) * (1 - k * 0.5) * clamp(h.velocity * 1.4)
      s.tmp.copy(ctx.colors.color).lerp(ctx.colors.hot, Math.exp(-h.ageSec / 0.08))
      const reps = n > 0 ? n : 2
      for (let j = 0; j < Math.round(ctx.params.count); j++) {
        const spread = ctx.params.spread * (hash(h.index, h.pitch, j, 7) - 0.5) * 2
        const r = reach * (0.75 + hash(h.index, j, 8) * 0.5)
        for (let m = 0; m < reps; m++) {
          const base = n > 0 ? (m / n) * Math.PI * 2 + axis + Math.PI / 2 : (m === 0 ? 0 : Math.PI) + axis
          const dir = n > 0 ? base + spread * (Math.PI / n) * 0.5 : base + (m === 0 ? spread : -spread) * 0.6
          const c = Math.cos(dir), sn = Math.sin(dir)
          s.lines.seg(c * r, sn * r, 0, c * (r + L), sn * (r + L), 0, w, 0, s.tmp, alpha, 3)
        }
      }
    }
    s.lines.end()
  },
})
