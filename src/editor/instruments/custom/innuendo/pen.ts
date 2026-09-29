import * as THREE from 'three'
import { defineInstrument, p, Strokes, Sprites, SPRITE, clamp, ease } from '../../code'
import type { ResolvedNote } from '../../../core/visual/types'
import { interval, JUST, KEY_OPTIONS } from './_shared'

// A harmonograph pen played by MIDI: it only moves while a note is held, and
// the held note's interval over the key root sets its pendulums' frequency
// ratio, so a melody draws a continuous spirograph that changes character with
// the harmony and spirals inward as the phrase goes on. Every `phrase` bars the
// drawing is released (it swells and fades) and a new one begins. Any pitch;
// velocity sets how fast the pen moves.
//
// Phases are integrated from frequency over the whole note stream once per
// resolve (cached by the stream's identity), then sampled - so the drawing at
// any beat is a pure function of the beat.

const RATE = 120 // samples per second

interface Path { px: Float32Array; py: Float32Array; pz: Float32Array; arc: Float32Array; live: Float32Array; seconds: number }
const cache = new WeakMap<readonly ResolvedNote[], Map<string, Path>>()

function buildPath(notes: readonly ResolvedNote[], secPerBeat: number, root: number, speed: number, attack: number, release: number): Path {
  const end = notes.reduce((m, n) => Math.max(m, n.beat + n.durationBeats), 0) * secPerBeat + 4
  const n = Math.ceil(end * RATE) + 2
  const px = new Float32Array(n), py = new Float32Array(n), pz = new Float32Array(n), arc = new Float32Array(n), live = new Float32Array(n)
  const sorted = [...notes].sort((a, b) => a.beat - b.beat)
  let ax = 0, ay = 0, az = 0, acc = 0, a = 1, b = 1, env = 0, idx = 0
  const W = Math.PI * 2 * speed
  const active: ResolvedNote[] = []
  for (let i = 0; i < n; i++) {
    const beat = (i / RATE) / secPerBeat
    while (idx < sorted.length && sorted[idx].beat <= beat) active.push(sorted[idx++])
    for (let k = active.length - 1; k >= 0; k--) if (beat >= active[k].beat + active[k].durationBeats) active.splice(k, 1)
    const held = active[active.length - 1]
    if (held) [a, b] = JUST[interval(held.pitch, root)]
    const target = held ? held.velocity / 127 : 0
    const tc = target > env ? attack : release
    env += (target - env) * (1 - Math.exp(-1 / (RATE * Math.max(1e-3, tc))))
    const m = Math.max(a, b)
    ax += (W * (a / m + 0.011) * env) / RATE
    ay += (W * (b / m) * env) / RATE
    az += (W * 0.37 * env) / RATE
    acc += env / RATE
    px[i] = ax; py[i] = ay; pz[i] = az; arc[i] = acc; live[i] = env
  }
  return { px, py, pz, arc, live, seconds: end }
}

function pathFor(notes: readonly ResolvedNote[], secPerBeat: number, root: number, speed: number, attack: number, release: number): Path {
  let byKey = cache.get(notes)
  if (!byKey) cache.set(notes, byKey = new Map())
  const key = `${secPerBeat}|${root}|${speed}|${attack}|${release}`
  let path = byKey.get(key)
  if (!path) byKey.set(key, path = buildPath(notes, secPerBeat, root, speed, attack, release))
  return path
}

interface State { lines: Strokes; tip: Sprites; buf: Float32Array; tmp: THREE.Color }

export const instrument = defineInstrument<State>({
  id: 'innuendo.pen',
  name: 'Voice Pen',
  description: 'A harmonograph pen that moves only while notes are held; the held interval sets its ratio, so a melody draws a spirograph phrase by phrase.',
  color: '#eaf4ff',
  params: {
    key: p.select(KEY_OPTIONS, 6, { label: 'Key root' }),
    size: p.num(1.3, 0.1, 6),
    width: p.num(0.0065, 0.001, 0.05, { label: 'Line width' }),
    speed: p.num(2.1, 0.1, 8, { label: 'Pen speed' }),
    decay: p.num(0.26, 0, 2, { label: 'Spiral in' }),
    depth: p.num(0.6, 0, 1.5, { label: '3D depth' }),
    phrase: p.int(4, 0, 64, { label: 'Phrase (bars, 0 = never)' }),
    rotate: p.num(90, -180, 180, { label: 'Rotate (°)' }),
    gain: p.num(2.3, 0.2, 6, { label: 'Glow' }),
    color: p.color('#eaf4ff'),
    hot: p.color('#56d8ff', { label: 'Fresh ink' }),
  },

  setup(ctx) {
    const lines = ctx.own(new Strokes(5200, { glow: 1.3 }))
    const tip = ctx.own(new Sprites(4))
    ctx.root.add(lines, tip)
    return { lines, tip, buf: new Float32Array(3 * 2400), tmp: new THREE.Color() }
  },

  frame(ctx, s) {
    const path = pathFor(ctx.notes, ctx.secPerBeat, Math.round(ctx.params.key), ctx.params.speed, 0.08, 0.35)
    const phraseBeats = Math.round(ctx.params.phrase) * ctx.beatsPerBar
    const from = phraseBeats > 0 ? Math.floor(ctx.beat / phraseBeats) * phraseBeats : 0
    s.lines.begin()
    s.tip.begin()
    const draw = (t0Beat: number, t1Beat: number, release: number, tip: boolean) => {
      const i0 = Math.max(0, Math.floor(t0Beat * ctx.secPerBeat * RATE))
      const i1 = Math.min(path.px.length - 1, Math.floor(t1Beat * ctx.secPerBeat * RATE))
      if (i1 <= i0 + 1) return
      const grow = 1 + ease.expo.out(release) * 0.6
      const fade = 1 - release
      if (fade <= 0.01) return
      const size = ctx.params.size * grow, depth = ctx.params.depth, decay = ctx.params.decay
      const rot = (ctx.params.rotate * Math.PI) / 180, c = Math.cos(rot), sn = Math.sin(rot)
      const arc0 = path.arc[i0]
      const stepN = Math.max(1, Math.ceil((i1 - i0) / 2300))
      const B = s.buf
      let n = 0
      for (let i = i0; i <= i1; i += stepN) {
        const R = size * (0.3 + 0.7 * Math.exp(-(path.arc[i] - arc0) * decay))
        const x = Math.sin(path.px[i] + 1.1) * R, y = Math.sin(path.py[i]) * R, z = Math.sin(path.pz[i] + 0.4) * R * depth
        const bx = x * c - y * sn, by = x * sn + y * c
        // While no note is held the pen rests: skip the repeated points, or
        // hundreds of zero-length strokes stack into one blown-out dot.
        if (n > 0 && Math.abs(bx - B[n * 3 - 3]) + Math.abs(by - B[n * 3 - 2]) + Math.abs(z - B[n * 3 - 1]) < 1e-5) continue
        B[n * 3] = bx; B[n * 3 + 1] = by; B[n * 3 + 2] = z
        n++
      }
      if (n < 2) return
      for (let k = 0; k < n - 1; k++) {
        const u = k / (n - 1)
        const heat = Math.pow(u, 6)
        s.tmp.copy(ctx.colors.color).lerp(ctx.colors.hot, heat)
        const w = ctx.params.width * (0.55 + 0.45 * u + heat * 0.6)
        s.lines.seg(B[k * 3], B[k * 3 + 1], B[k * 3 + 2], B[k * 3 + 3], B[k * 3 + 4], B[k * 3 + 5], w, w, s.tmp, fade * (0.25 + 0.75 * u), ctx.params.gain * (0.7 + heat * 0.8))
      }
      if (tip) {
        const k = n - 1
        const live = path.live[i1]
        s.tip.put(B[k * 3], B[k * 3 + 1], B[k * 3 + 2], ctx.params.width * (10 + live * 30), SPRITE.flare, ctx.colors.hot, clamp(0.2 + live) * fade, ctx.params.gain * 1.4)
      }
    }
    // the drawing being released, then the current one
    const since = (ctx.beat - from) * ctx.secPerBeat
    if (phraseBeats > 0 && from > 0 && since < 0.9) draw(from - phraseBeats, from, clamp(since / 0.9), false)
    draw(from, ctx.beat, 0, true)
    s.lines.end()
    s.tip.end()
  },
})
