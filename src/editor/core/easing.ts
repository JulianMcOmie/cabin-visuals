// Easing curves, shared by the engine (automation keyframes with a per-key
// ease) and the code-instrument SDK (instruments/code/motion.ts re-exports
// these). Pure, dependency-free.
//
// Names (easeByName): linear, step, and <family>.<in|out|inOut> for
// quad cubic quart quint sine expo circ back elastic bounce, plus css.ease,
// css.easeIn, css.easeOut, css.easeInOut, css.emphasized - and the editor's
// InterpolationMode words (ease-in, ease-out, ease-in-out, smooth-step,
// exponential) so a lane's mode and a key's ease speak one vocabulary.

export type Ease = (p: number) => number

const TAU = Math.PI * 2
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

const outOf = (f: Ease): Ease => (p) => 1 - f(1 - p)
const inOutOf = (f: Ease): Ease => (p) => (p < 0.5 ? f(p * 2) / 2 : 1 - f((1 - p) * 2) / 2)
const family = (f: Ease) => ({ in: f, out: outOf(f), inOut: inOutOf(f) })

const backIn = (s: number): Ease => (p) => p * p * ((s + 1) * p - s)
const elasticOut = (amplitude = 1, period = 0.3): Ease => (p) => {
  if (p <= 0) return 0
  if (p >= 1) return 1
  const a = Math.max(1, amplitude)
  const s = (period / TAU) * Math.asin(1 / a)
  return a * Math.pow(2, -10 * p) * Math.sin(((p - s) * TAU) / period) + 1
}
const bounceOut: Ease = (p) => {
  const n = 7.5625, d = 2.75
  if (p < 1 / d) return n * p * p
  if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75
  if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375
  return n * (p -= 2.625 / d) * p + 0.984375
}

/** CSS-style cubic-bezier easing (x1,y1,x2,y2), solved by Newton + bisection. */
export function bezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t
  const sy = (t: number) => ((ay * t + by) * t + cy) * t
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  return (p) => {
    if (p <= 0) return 0
    if (p >= 1) return 1
    let t = p
    for (let i = 0; i < 6; i++) {
      const e = sx(t) - p
      const d = dx(t)
      if (Math.abs(e) < 1e-6 || Math.abs(d) < 1e-6) break
      t -= e / d
    }
    if (t < 0 || t > 1 || Math.abs(sx(t) - p) > 1e-4) {
      let lo = 0, hi = 1
      t = p
      for (let i = 0; i < 30; i++) {
        const x = sx(t)
        if (Math.abs(x - p) < 1e-6) break
        if (x < p) lo = t; else hi = t
        t = (lo + hi) / 2
      }
    }
    return sy(t)
  }
}

export const ease = {
  linear: ((p: number) => p) as Ease,
  quad: family((p) => p * p),
  cubic: family((p) => p * p * p),
  quart: family((p) => p * p * p * p),
  quint: family((p) => p * p * p * p * p),
  sine: family((p) => 1 - Math.cos((p * Math.PI) / 2)),
  expo: family((p) => (p <= 0 ? 0 : Math.pow(2, 10 * (p - 1)))),
  circ: family((p) => 1 - Math.sqrt(Math.max(0, 1 - p * p))),
  /** Overshooting ease; `s` = overshoot amount (1.70158 is the classic). */
  back: (s = 1.70158) => family(backIn(s)),
  elastic: (amplitude = 1, period = 0.3) => ({
    out: elasticOut(amplitude, period),
    in: outOf(elasticOut(amplitude, period)),
    inOut: inOutOf(outOf(elasticOut(amplitude, period))),
  }),
  bounce: { out: bounceOut, in: outOf(bounceOut), inOut: inOutOf(outOf(bounceOut)) },
  /** Hard steps: n stairs across 0..1. */
  steps: (n: number): Ease => (p) => Math.min(1, Math.floor(clamp01(p) * n) / Math.max(1, n - 1)),
  bezier,
  // CSS names, for when a designer's spec says them
  css: {
    ease: bezier(0.25, 0.1, 0.25, 1),
    easeIn: bezier(0.42, 0, 1, 1),
    easeOut: bezier(0, 0, 0.58, 1),
    easeInOut: bezier(0.42, 0, 0.58, 1),
    /** Material 3 emphasized decelerate. */
    emphasized: bezier(0.05, 0.7, 0.1, 1),
  },
}

const NAMED = new Map<string, Ease>()
function build() {
  NAMED.set('linear', ease.linear)
  for (const f of ['quad', 'cubic', 'quart', 'quint', 'sine', 'expo', 'circ'] as const) {
    for (const k of ['in', 'out', 'inOut'] as const) NAMED.set(`${f}.${k}`, ease[f][k])
  }
  const back = ease.back(), el = ease.elastic()
  for (const k of ['in', 'out', 'inOut'] as const) {
    NAMED.set(`back.${k}`, back[k])
    NAMED.set(`elastic.${k}`, el[k])
    NAMED.set(`bounce.${k}`, ease.bounce[k])
  }
  for (const [k, f] of Object.entries(ease.css)) NAMED.set(`css.${k}`, f)
  // the editor's interpolation words
  NAMED.set('ease-in', (t) => t * t)
  NAMED.set('ease-out', (t) => 1 - (1 - t) * (1 - t))
  NAMED.set('ease-in-out', (t) => t * t * (3 - 2 * t))
  NAMED.set('smooth-step', (t) => t * t * (3 - 2 * t))
  NAMED.set('exponential', (t) => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1))))
}

/** An easing by name ('expo.out', 'back.inOut', 'css.emphasized', 'ease-in' …); undefined when unknown. 'step' is not an Ease - callers hold. */
export function easeByName(name: string | undefined): Ease | undefined {
  if (!name) return undefined
  if (!NAMED.size) build()
  return NAMED.get(name)
}

/** Every name easeByName understands (for docs and validation). */
export function easeNames(): string[] {
  if (!NAMED.size) build()
  return ['step', ...NAMED.keys()]
}
