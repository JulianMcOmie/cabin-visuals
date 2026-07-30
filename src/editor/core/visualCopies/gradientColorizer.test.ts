import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import { colorToOklch } from '../../utils/oklch'
import { mergeDefinitionSettings } from './definitions'
import {
  GRADIENT_MODE_INDEX,
  GRADIENT_MODE_POSITION,
  gradientColorizer,
  gradientPosition,
  gradientStops,
  type GradientColorizerSettings,
} from './gradientColorizer'
import { identityVisualCopy } from './identityVisualCopy'

function settings(overrides: Partial<GradientColorizerSettings> = {}): GradientColorizerSettings {
  return {
    ...mergeDefinitionSettings(gradientColorizer, undefined),
    ...overrides,
  } as unknown as GradientColorizerSettings
}

const close = (actual: number, expected: number, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`)

// ── The ramp ─────────────────────────────────────────────────────────────────

test('the endpoint stops are the picked colors verbatim, no color-math roundtrip', () => {
  const stops = gradientStops('#4dd2ff', '#ff4d88', 65)
  assert.equal(stops.length, 65)
  assert.equal(stops[0], '#4dd2ff')
  assert.equal(stops[64], '#ff4d88')
})

test('interior stops walk OKLCH monotonically in lightness', () => {
  const stops = gradientStops('#111111', '#eeeeee', 17)
  const lightnesses = stops.map((hex) => colorToOklch(hex)!.l)
  for (let i = 1; i < lightnesses.length; i++) {
    assert.ok(lightnesses[i] >= lightnesses[i - 1] - 1e-6, `L dipped at stop ${i}`)
  }
})

test('a grey endpoint borrows the other stop\'s hue instead of sweeping the wheel', () => {
  // Black → saturated red: every colored interior stop should stay red-ish
  // (hue within the red neighbourhood), never detour through green (~145°).
  const stops = gradientStops('#000000', '#ff0022', 17)
  for (const hex of stops.slice(1, -1)) {
    const oklch = colorToOklch(hex)!
    if (oklch.c < 0.02) continue
    const distanceFromRed = Math.min(
      Math.abs(oklch.h - colorToOklch('#ff0022')!.h),
      360 - Math.abs(oklch.h - colorToOklch('#ff0022')!.h),
    )
    assert.ok(distanceFromRed < 30, `stop ${hex} strayed to hue ${oklch.h}`)
  }
})

test('hue takes the short way around the wheel', () => {
  // Pink-red → orange-red sit either side of hue 0/360. The short arc crosses
  // 0°, so the midpoint hue stays in the red neighbourhood - nowhere near the
  // 180° a naive long-way lerp would pass through.
  const stops = gradientStops('#ff2f6d', '#ff5b2f', 3)
  const mid = colorToOklch(stops[1])!
  assert.ok(Math.abs(mid.h - 180) > 90, `midpoint hue ${mid.h} went the long way`)
})

test('unparseable input degrades to a hard split, not a throw', () => {
  const stops = gradientStops('nonsense', '#ff0000', 5)
  assert.equal(stops[0], 'nonsense')
  assert.equal(stops[4], '#ff0000')
  assert.equal(stops[1], 'nonsense')
  assert.equal(stops[3], '#ff0000')
})

// ── Placement on the ramp ────────────────────────────────────────────────────

test('INDEX mode spreads first→last copy across the ramp; one copy sits mid-blend', () => {
  const opts = settings({ mode: GRADIENT_MODE_INDEX })
  close(gradientPosition(opts, 0, 3, 0, 0), 0)
  close(gradientPosition(opts, 1, 3, 0, 0), 0.5)
  close(gradientPosition(opts, 2, 3, 0, 0), 1)
  close(gradientPosition(opts, 0, 1, 0, 0), 0.5)
})

test('FLIP reverses the ramp in both modes', () => {
  const byIndex = settings({ mode: GRADIENT_MODE_INDEX, flip: 1 })
  close(gradientPosition(byIndex, 0, 3, 0, 0), 1)
  close(gradientPosition(byIndex, 2, 3, 0, 0), 0)
  const byPosition = settings({ mode: GRADIENT_MODE_POSITION, span: 4, flip: 1 })
  close(gradientPosition(byPosition, 0, 1, 2, 0), 0)
})

test('POSITION mode maps ±SPAN/2 along the ANGLE axis to the ends and clamps beyond', () => {
  const opts = settings({ mode: GRADIENT_MODE_POSITION, span: 4, angle: 0 })
  close(gradientPosition(opts, 0, 1, 0, 0), 0.5)
  close(gradientPosition(opts, 0, 1, -2, 0), 0)
  close(gradientPosition(opts, 0, 1, 2, 0), 1)
  close(gradientPosition(opts, 0, 1, -50, 0), 0) // clamped, like a fill past its stops
  close(gradientPosition(opts, 0, 1, 50, 0), 1)
  // Y is orthogonal to a 0° gradient: it must not move the sample.
  close(gradientPosition(opts, 0, 1, 0, 3), 0.5)
})

test('ANGLE turns the axis: at 90° the gradient climbs Y', () => {
  const opts = settings({ mode: GRADIENT_MODE_POSITION, span: 4, angle: 90 })
  close(gradientPosition(opts, 0, 1, 0, -2), 0)
  close(gradientPosition(opts, 0, 1, 0, 2), 1)
  close(gradientPosition(opts, 0, 1, 3, 0), 0.5)
})

test('OFFSET slides the center along the axis', () => {
  const opts = settings({ mode: GRADIENT_MODE_POSITION, span: 4, angle: 0, offset: 2 })
  close(gradientPosition(opts, 0, 1, 2, 0), 0.5)
  close(gradientPosition(opts, 0, 1, 0, 0), 0)
})

// ── The chain entry ──────────────────────────────────────────────────────────

test('applies the sampled stop as tint, passive of notes and beat', () => {
  const opts = settings({ mode: GRADIENT_MODE_INDEX })
  const resolved = gradientColorizer.resolve({ settings: opts, notes: [] })
  const first = resolved.apply(identityVisualCopy(), { beat: 0, index: 0, count: 3 })
  const last = resolved.apply(identityVisualCopy(), { beat: 123.45, index: 2, count: 3 })
  assert.equal(first.length, 1)
  assert.equal(first[0].colorShift.tint, opts.colorA)
  assert.equal(first[0].colorShift.tintAmount, 1)
  assert.equal(last[0].colorShift.tint, opts.colorB)
})

test('POSITION mode reads the copy\'s world position through the placement transform', () => {
  const opts = settings({ mode: GRADIENT_MODE_POSITION, span: 4, angle: 0 })
  const resolved = gradientColorizer.resolve({ settings: opts, notes: [] })
  const placement = new Matrix4().makeTranslation(2, 0, 0)
  const [copy] = resolved.apply(identityVisualCopy(), {
    beat: 0, index: 0, count: 1, placementTransform: placement,
  })
  assert.equal(copy.colorShift.tint, opts.colorB)
})

test('AMOUNT zero leaves upstream color state untouched', () => {
  const opts = settings({ amount: 0 })
  const resolved = gradientColorizer.resolve({ settings: opts, notes: [] })
  const upstream = identityVisualCopy()
  upstream.colorShift.tint = '#123456'
  upstream.colorShift.tintAmount = 0.4
  upstream.colorShift.hue = 0.2
  const [copy] = resolved.apply(upstream, { beat: 0, index: 0, count: 1 })
  assert.equal(copy.colorShift.tint, '#123456')
  assert.equal(copy.colorShift.tintAmount, 0.4)
  assert.equal(copy.colorShift.hue, 0.2)
})

test('relative HSL shifts from upstream ride through; transform and opacity are preserved', () => {
  const opts = settings({ mode: GRADIENT_MODE_INDEX })
  const resolved = gradientColorizer.resolve({ settings: opts, notes: [] })
  const upstream = identityVisualCopy()
  upstream.colorShift.hue = 0.25
  upstream.opacity = 0.5
  upstream.transform.makeTranslation(1, 2, 3)
  const [copy] = resolved.apply(upstream, { beat: 0, index: 0, count: 2 })
  assert.equal(copy.colorShift.hue, 0.25)
  assert.equal(copy.opacity, 0.5)
  assert.ok(copy.transform.equals(upstream.transform))
  assert.notEqual(copy.transform, upstream.transform) // independently owned matrix
})

test('declares itself passive: zero strict MIDI rows', () => {
  assert.equal(gradientColorizer.midiRows!(settings()).length, 0)
  assert.equal(gradientColorizer.strictMidiRows, true)
})
