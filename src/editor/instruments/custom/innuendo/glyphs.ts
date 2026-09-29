import { defineInstrument, p, Strokes, Sprites, SPRITE, clamp, ease, hash } from '../../code'
import { interval, JUST, KEY_OPTIONS } from './_shared'

// The voice as figures: each note draws a Lissajous knot whose frequency ratio
// IS the sung interval over the key's root (just intonation - a fifth is 3:2,
// a major third 5:4), so consonance reads as simple shapes and tension as dense
// ones. The newest note draws itself in at the centre over its length; older
// ones are pushed outward in mirrored pairs, shrinking - the big-word-with-
// echoes layout of a lyric video, with no words. Any pitch.

interface State { lines: Strokes; heads: Sprites; pts: Float32Array }

function knot(out: Float32Array, a: number, b: number, delta: number, rotY: number, rotX: number, size: number,
  x0: number, y0: number, z0: number, progress: number, depth: number, flipX: number): number {
  const n = Math.min(900, Math.max(48, Math.ceil(56 * Math.max(a, b) * progress)))
  const S = Math.PI * 2 * progress
  const cy = Math.cos(rotY), sy = Math.sin(rotY), cx = Math.cos(rotX), sx = Math.sin(rotX)
  for (let k = 0; k < n; k++) {
    const s = (k / (n - 1)) * S
    const x = Math.sin(a * s + delta), y = Math.sin(b * s), z = Math.sin((a + b) * 0.5 * s + delta * 0.5) * depth
    const xr = x * cy + z * sy, z1 = -x * sy + z * cy
    const yr = y * cx - z1 * sx, zr = y * sx + z1 * cx
    out[k * 3] = x0 + xr * flipX * size; out[k * 3 + 1] = y0 + yr * size; out[k * 3 + 2] = z0 + zr * size
  }
  return n
}

export const instrument = defineInstrument<State>({
  id: 'innuendo.glyphs',
  name: 'Interval Glyphs',
  description: 'Each note draws a Lissajous knot whose ratio is the sung interval; older notes step outward as mirrored echoes.',
  color: '#eaf4ff',
  params: {
    key: p.select(KEY_OPTIONS, 6, { label: 'Key root' }),
    size: p.num(0.6, 0.05, 4),
    width: p.num(0.009, 0.001, 0.05, { label: 'Line width' }),
    spacing: p.num(2.2, 0, 8, { label: 'Echo spacing' }),
    echoes: p.int(3, 0, 6),
    echoScale: p.num(0.42, 0.1, 1, { label: 'Echo scale' }),
    depth: p.num(0.6, 0, 1.5, { label: '3D depth' }),
    spin: p.num(0.5, -3, 3, { label: 'Turn (rad/s)' }),
    gain: p.num(2.4, 0.2, 6, { label: 'Glow' }),
    color: p.color('#eaf4ff'),
    hot: p.color('#56d8ff', { label: 'Pen tip' }),
  },

  setup(ctx) {
    const lines = ctx.own(new Strokes(16000, { glow: 1.3 }))
    const heads = ctx.own(new Sprites(16))
    ctx.root.add(lines, heads)
    return { lines, heads, pts: new Float32Array(3 * 1024) }
  },

  frame(ctx, s) {
    const root = Math.round(ctx.params.key)
    const hits = ctx.hits(undefined, 16, Math.round(ctx.params.echoes) + 1)
    s.lines.begin()
    s.heads.begin()
    for (let m = hits.length - 1; m >= 0; m--) {
      const h = hits[m]
      const [a, b] = JUST[interval(h.pitch, root)]
      const delta = (Math.PI / 2) * (0.3 + hash(h.index, 1) * 0.7)
      const tilt = (hash(h.index, 2) - 0.5) * 0.9
      const octave = Math.floor((Math.round(h.pitch) - root) / 12)
      const d = Math.max(0.12, h.ageSec >= 0 ? h.dur * ctx.secPerBeat : 0.3)
      let push = 0
      for (let j = 0; j < m; j++) push += ease.expo.out(clamp(hits[j].ageSec / 0.3))
      const draw = ease.expo.out(clamp(h.ageSec / (d * 0.9 + 0.05)))
      const fade = m === 0 ? clamp(1 - (h.ageSec - d - 0.35) / 0.8) : Math.pow(0.55, push) * clamp(1 - (h.ageSec - d - 1.2) / 1.2)
      if (fade <= 0.01) continue
      const size = ctx.params.size * Math.pow(1.12, octave - 4) * (0.75 + h.velocity * 0.5)
        * Math.pow(ctx.params.echoScale, Math.min(push, 3)) * (1 + (1 - draw) * 0.08)
      const rotY = tilt + h.ageSec * ctx.params.spin
      const sides: Array<1 | -1> = push < 0.02 ? [1] : [1, -1]
      for (const side of sides) {
        const x = side * ctx.params.spacing * Math.min(push, 3.2) * (0.55 + 0.45 * Math.min(push, 1))
        const flip = side > 0 ? 1 : -1
        const n = knot(s.pts, a, b, delta, rotY * flip, 0.35, size, x, 0, 0, draw, ctx.params.depth, flip)
        const w = ctx.params.width * (0.6 + 0.4 * size / Math.max(0.01, ctx.params.size))
        s.lines.poly(s.pts, n, w, ctx.colors.color, (u) => fade * (0.35 + 0.65 * u), ctx.params.gain)
        if (m === 0 && draw < 0.999) {
          const k = n - 1
          s.heads.put(s.pts[k * 3], s.pts[k * 3 + 1], s.pts[k * 3 + 2], w * 14, SPRITE.flare, ctx.colors.hot, fade, ctx.params.gain * 1.5)
        }
      }
    }
    s.lines.end()
    s.heads.end()
  },
})

