import * as THREE from 'three'
import { defineInstrument, p, Strokes, Sprites, SPRITE, clamp, ease, smoothstep, TAU } from '../../code'
import { fifths, KEY_OPTIONS, pitchClass } from './_shared'

// A tunnel built out of the score. The track's notes fly toward the camera and
// land on the beat: a note `in` beats away sits `in × speed` deep, so you see
// the music coming - the next bar is already visible down the tube. The beat
// grid makes the ribs (bar lines brighter), rails run the length, and the far
// end swings on a slow path while the landing plane stays centred.
//
// Rows (drums below 48, everything else melodic):
//   35/36 kick  → a full-width ring that slams outward as it lands
//   37-40 snare → a diamond frame
//   42-46 hats  → a crown of sparks on the rim
//   48+         → a polygon: sides from the pitch class's place on the circle of
//                 fifths, radius from register (low = wide); held notes extrude
//                 into a tube for their whole length.
//
// Gains stay near 1: these shapes cover much of the frame, and the scene bloom
// (threshold ~1.15, wide mip blur) turns large HDR rings into fog. Overlaps
// still add up past the threshold - that's the glow you want.

interface State { lines: Strokes; dots: Sprites; tmp: THREE.Color }

export const instrument = defineInstrument<State>({
  id: 'innuendo.tunnel',
  name: 'Score Tunnel',
  description: 'Fly through the score: upcoming notes approach down a tunnel and land on the beat - kicks ring, snares frame, melody extrudes polygons.',
  color: '#56d8ff',
  params: {
    key: p.select(KEY_OPTIONS, 6, { label: 'Key root' }),
    speed: p.num(2.2, 0.2, 8, { label: 'Depth per beat' }),
    ahead: p.num(8, 1, 32, { label: 'Look ahead (beats)' }),
    radius: p.num(1.6, 0.2, 6),
    ribs: p.num(0.16, 0, 1, { label: 'Beat ribs' }),
    rails: p.int(12, 0, 48),
    bend: p.num(0.7, 0, 3, { label: 'Bend' }),
    twist: p.num(0.06, -1, 1, { label: 'Twist (rev/bar)' }),
    width: p.num(0.012, 0.001, 0.08, { label: 'Line width' }),
    gain: p.num(1, 0.2, 6, { label: 'Glow' }),
    color: p.color('#56d8ff'),
    hot: p.color('#ffffff', { label: 'Landing' }),
    melody: p.color('#b9a2ff', { label: 'Melody' }),
  },

  setup(ctx) {
    const lines = ctx.own(new Strokes(9000, { glow: 1.25 }))
    const dots = ctx.own(new Sprites(1200))
    ctx.root.add(lines, dots)
    return { lines, dots, tmp: new THREE.Color() }
  },

  frame(ctx, s) {
    const P = ctx.params
    const speed = P.speed, ahead = P.ahead, R = P.radius, w = P.width, gain = P.gain
    const far = ahead * speed
    const key = Math.round(P.key)
    const twist = ctx.bar * P.twist * TAU
    const zOf = (beatsAway: number) => -beatsAway * speed
    // distance fog + fade-in at the far end, fade-out as it rushes past the camera
    const fade = (z: number) => (z < 0 ? Math.exp(z / (far * 0.55)) * smoothstep(-far, -far * 0.8, z) : 1 - smoothstep(0.6, 3.4, z))

    s.lines.begin()
    s.dots.begin()

    // ---- ribs: the beat grid rushing past (bar lines brighter)
    if (P.ribs > 0) {
      for (let k = Math.ceil(ctx.beat - 2); k <= ctx.beat + ahead; k++) {
        const z = zOf(k - ctx.beat)
        const f = fade(z)
        if (f < 0.01) continue
        const bar = ((k % ctx.beatsPerBar) + ctx.beatsPerBar) % ctx.beatsPerBar === 0
        s.lines.ring(0, 0, z, R * (bar ? 1.04 : 1), w * (bar ? 1.4 : 0.8), ctx.colors.color, P.ribs * f * (bar ? 1.8 : 1), gain * 0.7, { seg: 72, dash: bar ? 0 : 3 })
      }
    }
    // ---- rails
    const rails = Math.round(P.rails)
    for (let i = 0; i < rails; i++) {
      const a = (i / rails) * TAU + twist
      const cx = Math.cos(a) * R, cy = Math.sin(a) * R
      const steps = 24
      for (let j = 0; j < steps; j++) {
        const z0 = 3 - ((far + 3) * j) / steps, z1 = 3 - ((far + 3) * (j + 1)) / steps
        s.lines.seg(cx, cy, z0, cx, cy, z1, w * 0.6, w * 0.6, ctx.colors.color, 0.3 * fade((z0 + z1) / 2), gain * 0.5)
      }
    }

    // ---- notes: the recent past (landing, rushing by) and the future (approaching)
    const notes: Array<{ pitch: number; velocity: number; beat: number; dur: number; index: number }> = [
      ...ctx.hits(undefined, 3, 64),
      ...ctx.upcoming(undefined, ahead, 160),
    ]
    for (const n of notes) {
      const away = n.beat - ctx.beat
      const z = zOf(away)
      const f = fade(z)
      if (f < 0.01) continue
      const age = -away
      const land = age >= 0 ? Math.exp(-age / 0.35) : smoothstep(-0.5, 0, age) * 0.5
      const v = n.velocity
      const pc = pitchClass(n.pitch)
      if (n.pitch < 48) {
        if (n.pitch <= 36) {
          // kick: a crisp ring that flies past, plus a thin shockwave thrown
          // outward on landing. Punch comes from the shockwave, not from width:
          // fat capsules on a 96-segment ring overlap into a soft fog band.
          const r = R * (0.96 + (age > 0 ? age * 0.6 : 0))
          s.tmp.copy(ctx.colors.color).lerp(ctx.colors.hot, clamp(land * 1.2))
          s.lines.ring(0, 0, z, r, w * (1.4 + land * 1.2) * (0.7 + 0.3 * v), s.tmp, f * (0.35 + 0.65 * v) * (age > 0 ? Math.exp(-age / 0.9) : 1), gain * (0.8 + land * 0.3), { seg: 96 })
          if (age >= 0 && age < 0.75) {
            const k = age / 0.75
            s.lines.ring(0, 0, 0, R * (1 + ease.expo.out(k) * 0.9), w * 1.1, ctx.colors.hot, (1 - k) * (1 - k) * 0.8 * v, gain, { seg: 96 })
          }
        } else if (n.pitch <= 40) {
          // snare: a diamond frame, twisting as it passes
          s.tmp.copy(ctx.colors.hot).lerp(ctx.colors.color, 0.35 - land * 0.35)
          s.lines.polygon(0, 0, z, R * (0.78 + land * 0.2), 4, Math.PI / 4 + twist + (age > 0 ? age * 0.8 : 0), w * (1.4 + land * 2), s.tmp, f * (0.4 + 0.6 * v), gain * (0.8 + land * 0.3))
        } else {
          // hats: a crown of sparks on the rim
          for (let j = 0; j < 8; j++) {
            const a = (j / 8) * TAU + twist + n.index * 0.37
            s.dots.put(Math.cos(a) * R * 1.02, Math.sin(a) * R * 1.02, z, w * (6 + land * 10), SPRITE.flare, ctx.colors.color, f * (0.3 + 0.7 * v) * (0.4 + land), gain)
          }
        }
        continue
      }
      // melody: a polygon per note, extruded along its length
      const k = fifths(pc, key)
      const sides = 3 + (k % 5)
      const reg = clamp((n.pitch - 48) / 40)
      const r = R * (0.72 - reg * 0.5)
      const rot = (k / 12) * TAU + twist * 2
      s.tmp.copy(ctx.colors.melody).lerp(ctx.colors.hot, clamp(land))
      const len = Math.max(0.25, n.dur)
      // additive strokes stack: a held note's tube is a few faint copies, not a solid bar
      const copies = Math.min(6, 1 + Math.floor(len * 1.5))
      for (let c = 0; c < copies; c++) {
        const zc = zOf(away + (len * c) / copies)
        const fc = fade(zc) * (c === 0 ? 1 : 0.4 * (1 - c / copies))
        if (fc < 0.01) continue
        s.lines.polygon(0, 0, zc, r * (1 + (c === 0 ? land * 0.3 : 0)), sides, rot, w * (c === 0 ? 1.2 + land * 1.2 : 0.7), s.tmp, fc * (0.3 + 0.55 * v), gain * (c === 0 ? 0.85 + land * 0.25 : 0.6))
      }
    }

    // the far end swings on a slow path; the landing plane (z = 0) stays put
    const bend = P.bend * R * 2.4
    const ph = ctx.beat / 16
    const u = (z: number) => Math.pow(clamp(-z / far), 2)
    s.lines.bendXY((z) => bend * u(z) * Math.sin(TAU * ph), (z) => bend * u(z) * Math.cos(TAU * ph * 0.73))
    s.dots.bendXY((z) => bend * u(z) * Math.sin(TAU * ph), (z) => bend * u(z) * Math.cos(TAU * ph * 0.73))
    s.lines.end()
    s.dots.end()
  },
})
