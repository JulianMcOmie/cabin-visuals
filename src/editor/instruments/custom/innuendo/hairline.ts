import { defineInstrument, p, Strokes, Sprites, SPRITE, ease, clamp, lerp } from '../../code'

// A single hairline across the frame, plucked like a string: each row excites a
// standing-wave harmonic that rings and decays, always symmetric about the
// centre. It draws itself outward from a point, and can curl shut into a circle.
//
//   60  Pluck · fundamental (the kick)      62  Pluck · 3rd harmonic (snare)
//   64  Pluck · 9th harmonic (hats)         70  Curl into a circle (hold: curled while held)
//   72  Draw on (from the centre, at the onset)

const ROW = { low: 60, mid: 62, high: 64, curl: 70, draw: 72 }
const MODES: Array<[number, number, number, number, number]> = [
  // row, harmonic, amplitude, decay (s), angular frequency (rad/s)
  [ROW.low, 1, 0.55, 0.45, 9],
  [ROW.mid, 3, 0.28, 0.3, 21],
  [ROW.high, 9, 0.05, 0.12, 40],
]

interface State { line: Strokes; dots: Sprites; pts: Float32Array }

export const instrument = defineInstrument<State>({
  id: 'innuendo.hairline',
  name: 'Hairline',
  description: 'A hairline plucked like a string - each row a harmonic, symmetric about the centre; draws on from a point and curls into a circle.',
  color: '#eaf4ff',
  params: {
    width: p.num(1.04, 0.2, 3, { label: 'Width (× frame)' }),
    thickness: p.num(0.0055, 0.001, 0.05),
    amp: p.num(1, 0, 4, { label: 'Pluck depth' }),
    radius: p.num(0.82, 0.1, 4, { label: 'Curl radius' }),
    color: p.color('#eaf4ff'),
    seed: p.color('#56d8ff', { label: 'Centre point' }),
  },
  rows: {
    [ROW.draw]: 'Draw on',
    [ROW.curl]: 'Curl (hold)',
    [ROW.high]: 'Pluck · high',
    [ROW.mid]: 'Pluck · mid',
    [ROW.low]: { label: 'Pluck · low', emphasized: true },
  },

  setup(ctx) {
    const line = ctx.own(new Strokes(1024, { glow: 1.4 }))
    const dots = ctx.own(new Sprites(8))
    ctx.root.add(line, dots)
    return { line, dots, pts: new Float32Array(3 * 420) }
  },

  frame(ctx, s) {
    const n = 420
    const X = (ctx.viewport.width / 2) * ctx.params.width
    const acts: Array<{ k: number; a: number; w: number; age: number }> = []
    for (const [row, k, a, dec, w] of MODES) {
      for (const h of ctx.hits(row, dec * 5 / ctx.secPerBeat)) {
        const env = (1 - Math.exp(-h.ageSec / 0.01)) * Math.exp(-h.ageSec / dec)
        acts.push({ k, a: a * h.velocity * env, w, age: h.ageSec })
      }
    }
    // curl: eases in over 0.6 beats from the onset, holds while held, eases back after
    const curlNote = ctx.last(ROW.curl)
    let curl = 0
    if (curlNote) {
      const inK = ease.expo.inOut(clamp(curlNote.age / 0.6))
      const outK = curlNote.held ? 0 : ease.expo.inOut(clamp((ctx.beat - curlNote.end) / 0.6))
      curl = inK * (1 - outK)
    }
    const draw = ctx.last(ROW.draw)
    const reveal = draw ? ease.expo.out(clamp(draw.ageSec / 1.3)) : 1
    const R = ctx.params.radius
    const P = s.pts
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1)
      const x = -X + 2 * X * u
      let y = 0
      for (const m of acts) y += m.a * Math.cos((m.k * Math.PI * x) / (2 * X)) * Math.cos(m.w * m.age)
      y *= ctx.params.amp
      const th = -Math.PI / 2 + (x / X) * Math.PI
      P[i * 3] = lerp(x, Math.cos(th) * R, curl)
      P[i * 3 + 1] = lerp(y, Math.sin(th) * R + y * 0.3, curl)
      P[i * 3 + 2] = 0
    }
    s.line.begin()
    s.line.poly(P, n, ctx.params.thickness, ctx.colors.color, (u) => {
      const d = Math.abs(u - 0.5) * 2
      return clamp((reveal - d) / 0.04) * (0.35 + 0.65 * Math.pow(Math.sin(Math.PI * u), 0.4))
    }, 2.4)
    s.line.end()
    s.dots.begin()
    const k = ctx.pulse(ROW.low, 0.3)
    s.dots.put(0, 0, 0, 0.05 + k * 0.12, SPRITE.dot, ctx.colors.seed, clamp(0.3 + k), 3)
    s.dots.put(0, 0, 0, 0.5 + k * 0.6, SPRITE.flare, ctx.colors.seed, clamp(k * 0.8), 1.5)
    s.dots.end()
  },
})

