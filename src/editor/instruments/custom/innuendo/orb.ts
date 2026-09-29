import * as THREE from 'three'
import { defineInstrument, p, particles, springKick, Strokes, ease, tween, clamp, type Particles } from '../../code'

// The kick orb: a Fibonacci sphere of motes that thumps (a closed-form sprung
// membrane per note), scatters on hard hits, throws shockwave rings, and
// re-forms into other shapes on the Shape row.
//
//   60  Kick: thump + a ring; velocity > 0.75 also scatters the motes
//   62  Scatter: motes burst outward and fall back
//   64  Shape: step to the next shape (sphere → flower → disc → torus → …)
//   66  Ring only: a shockwave with no thump

const ROW = { kick: 60, scatter: 62, shape: 64, ring: 66 }
const SHAPES = ['sphere', 'flower', 'disc', 'torus'] as const

const HEADER = /* glsl */ `
  uniform float uCount, uRadius, uPulse, uNoise, uScatter, uHit, uPetals, uSpin, uFlower, uDisc, uTorus, uGrain, uAlpha;
  uniform vec3 uColA, uColB, uColHot;
`
const VERTEX = /* glsl */ `
  // aIndex → Fibonacci sphere direction (uniform coverage)
  float N = uCount;
  float y = 1.0 - (aIndex / max(1.0, N - 1.0)) * 2.0;
  float rr = sqrt(max(0.0, 1.0 - y * y));
  float th = 2.39996323 * aIndex;
  vec3 d = vec3(cos(th) * rr, y, sin(th) * rr);
  float n = snoise(d * 1.7 + vec3(0.0, 0.0, uSec * 0.22));
  vec3 q = d * uRadius * (1.0 + uPulse * 0.3 + n * uNoise);
  float ang = aSeed.x * 6.2831853 + uSpin;
  float rose = abs(cos(uPetals * 0.5 * (aSeed.x * 6.2831853)));
  float fr = uRadius * 1.45 * (1.0 + uPulse * 0.25) * rose * pow(aSeed.y, 0.35);
  q = mix(q, vec3(cos(ang) * fr, sin(ang) * fr, (aSeed.z - 0.5) * 0.08 * uRadius), uFlower);
  float ga = aIndex * 2.39996323 + uSpin;
  float dr = uRadius * 1.35 * sqrt(aSeed.w) * (1.0 + uPulse * 0.25);
  q = mix(q, vec3(cos(ga) * dr, sin(ga) * dr, 0.0), uDisc);
  float tu = aSeed.x * 6.2831853 + uSpin, tv = aSeed.y * 6.2831853;
  float R = uRadius * 1.25 * (1.0 + uPulse * 0.2), r2 = uRadius * 0.28 * (1.0 + n * uNoise * 2.0);
  q = mix(q, vec3((R + r2 * cos(tv)) * cos(tu), (R + r2 * cos(tv)) * sin(tu), r2 * sin(tv)), uTorus);
  q += normalize(q + 1e-4) * uScatter * (0.25 + aSeed.w * 1.4);
  pos = q;
  size = uGrain * (0.45 + aSeed.y * 0.9) * (1.0 + uHit * 0.5);
  color = vec4(mix(uColA, uColB, aSeed.z) + uColHot * uHit * (0.4 + aSeed.w), uAlpha * (0.5 + 0.5 * aSeed.w));
`

interface State { motes: Particles | null; count: number; rings: Strokes }

export const instrument = defineInstrument<State>({
  id: 'innuendo.orb',
  name: 'Kick Orb',
  description: 'A sphere of motes that thumps and rings on kicks, scatters on hard hits, throws shockwaves, and morphs into flower / disc / torus on its Shape row.',
  color: '#56d8ff',
  params: {
    radius: p.num(0.85, 0.1, 4),
    points: p.int(7000, 500, 60000),
    grain: p.num(3.4, 0.5, 10, { label: 'Mote size' }),
    alpha: p.num(1, 0.1, 2, { label: 'Brightness' }),
    noise: p.num(0.06, 0, 0.6),
    petals: p.int(6, 2, 16),
    shape: p.select([...SHAPES], 0, { label: 'First shape' }),
    spin: p.num(0.2, -2, 2, { label: 'Spin (rev/bar)' }),
    rings: p.bool(true, { label: 'Shockwave rings' }),
    ringReach: p.num(3.4, 0.5, 10, { label: 'Ring reach' }),
    a: p.color('#56d8ff', { label: 'Colour A' }),
    b: p.color('#eaf4ff', { label: 'Colour B' }),
    hot: p.color('#ff8a5b', { label: 'Hit colour' }),
  },
  rows: {
    [ROW.ring]: 'Ring only',
    [ROW.shape]: 'Next shape',
    [ROW.scatter]: 'Scatter',
    [ROW.kick]: { label: 'Kick', emphasized: true },
  },

  setup(ctx) {
    const rings = ctx.own(new Strokes(2048, { glow: 1.2 }))
    ctx.root.add(rings)
    return { motes: null, count: 0, rings }
  },

  frame(ctx, s) {
    const count = Math.round(ctx.params.points)
    if (!s.motes || s.count !== count) {
      if (s.motes) { ctx.root.remove(s.motes); s.motes.dispose() }
      s.motes = particles({
        count, seed: 3, header: HEADER, vertex: VERTEX, hardness: 0.25,
        uniforms: {
          uCount: { value: count }, uRadius: { value: 1 }, uPulse: { value: 0 }, uNoise: { value: 0 }, uScatter: { value: 0 }, uHit: { value: 0 },
          uPetals: { value: 6 }, uSpin: { value: 0 }, uFlower: { value: 0 }, uDisc: { value: 0 }, uTorus: { value: 0 },
          uGrain: { value: 3 }, uAlpha: { value: 1 },
          uColA: { value: new THREE.Color() }, uColB: { value: new THREE.Color() }, uColHot: { value: new THREE.Color() },
        },
      })
      s.count = count
      ctx.root.add(s.motes)
    }
    const m = s.motes
    const u = m.mat.uniforms
    m.tick(ctx.beat, ctx.sec, ctx.px)
    // thump: every kick's sprung response, summed (closed form - no state)
    let thump = 0
    for (const h of ctx.hits(ROW.kick, 6)) thump += h.velocity * springKick(h.ageSec, { freq: 2.4, damping: 0.28 })
    let scatter = 0
    for (const h of ctx.hits([ROW.kick, ROW.scatter], 3)) {
      if (h.pitch === ROW.kick && h.velocity < 0.75) continue
      scatter += h.velocity * Math.exp(-h.ageSec / 0.22)
    }
    // shape morph: the shape index steps on each Shape note, easing over 3/4 of a beat
    const base = Math.round(ctx.params.shape)
    const steps = ctx.count(ROW.shape)
    const lastStep = ctx.last(ROW.shape)
    const to = (base + steps) % 4
    const from = (base + Math.max(0, steps - 1)) % 4
    const k = steps > 0 && lastStep ? tween(lastStep.age, 0, 0.75, ease.expo.inOut) : 1
    const w = [0, 0, 0, 0]
    w[from] += 1 - k
    w[to] += k
    u.uRadius.value = ctx.params.radius
    u.uPulse.value = thump
    u.uHit.value = clamp(thump)
    u.uNoise.value = ctx.params.noise
    u.uScatter.value = scatter * 0.5
    u.uPetals.value = ctx.params.petals
    u.uSpin.value = (ctx.bar * ctx.params.spin) * Math.PI * 2
    u.uFlower.value = w[1]
    u.uDisc.value = w[2]
    u.uTorus.value = w[3]
    u.uGrain.value = ctx.params.grain
    u.uAlpha.value = ctx.params.alpha
    ;(u.uColA.value as THREE.Color).copy(ctx.colors.a)
    ;(u.uColB.value as THREE.Color).copy(ctx.colors.b).multiplyScalar(0.6)
    ;(u.uColHot.value as THREE.Color).copy(ctx.colors.hot).multiplyScalar(1.5)
    m.rotation.set(0.35, ctx.bar * ctx.params.spin * 0.5, 0)

    const r = s.rings
    r.begin()
    if (ctx.params.rings >= 0.5) {
      for (const h of ctx.hits([ROW.kick, ROW.ring], 2.5)) {
        const life = 1.1 / ctx.secPerBeat
        const t = h.age / life
        if (t >= 1) continue
        const rad = ctx.params.radius + (ctx.params.ringReach - ctx.params.radius) * ease.expo.out(t)
        r.ring(0, 0, 0, rad, 0.011 * (1 - t * 0.6), ctx.colors.a, h.velocity * (1 - t) * (1 - t), 2.6, { seg: 128 })
      }
    }
    r.end()
  },

  dispose(s) {
    s.motes?.dispose()
  },
})
