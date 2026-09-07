import assert from 'node:assert/strict'
import test from 'node:test'
import { Color, Matrix4 } from 'three'
import { applyColorShiftToInstrumentParams } from '../visual/instrumentColor'
import { colorToOklch } from '../../utils/oklch'
import { mergeDefinitionSettings } from './definitions'
import {
  HUE_MAP_INDEX,
  HUE_MAP_RADIAL,
  HUE_MAP_X,
  HUE_MODE_HSL,
  HUE_MODE_PERCEPTUAL,
  hueRotateColorizer,
  hueRotatePosition,
  hueRotateTurns,
  type HueRotateSettings,
} from './hueRotate'
import { identityVisualCopy } from './identityVisualCopy'

function settings(overrides: Partial<HueRotateSettings> = {}): HueRotateSettings {
  return {
    ...mergeDefinitionSettings(hueRotateColorizer, undefined),
    ...overrides,
  } as unknown as HueRotateSettings
}

const close = (actual: number, expected: number, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`)

/** One copy's resulting hue turn. */
function turnOf(opts: HueRotateSettings, index = 0, count = 1, placement?: Matrix4): number {
  const resolved = hueRotateColorizer.resolve({ settings: opts, notes: [] })
  const [copy] = resolved.apply(identityVisualCopy(), {
    beat: 0, index, count, placementTransform: placement,
  })
  return copy.colorShift.hue
}

// ── Where a copy sits on the spread ──────────────────────────────────────────

test('INDEX spreads one unit across the copy run; a lone copy takes none of it', () => {
  const opts = settings({ mode: HUE_MAP_INDEX })
  close(hueRotatePosition(opts, 0, 3, 0, 0, 0), 0)
  close(hueRotatePosition(opts, 1, 3, 0, 0, 0), 0.5)
  close(hueRotatePosition(opts, 2, 3, 0, 0, 0), 1)
  // A single copy sits at 0, not at the midpoint: with nothing to spread
  // across, the device must reduce to exactly its ROTATE knob.
  close(hueRotatePosition(opts, 0, 1, 0, 0, 0), 0)
})

test('position modes measure in SPAN units and never clamp - the wheel has no ends', () => {
  const opts = settings({ mode: HUE_MAP_X, span: 4 })
  close(hueRotatePosition(opts, 0, 1, 4, 0, 0), 1)
  close(hueRotatePosition(opts, 0, 1, 40, 0, 0), 10)
  close(hueRotatePosition(opts, 0, 1, -4, 0, 0), -1)
})

test('RADIAL measures from the chain origin and is symmetric by construction', () => {
  const opts = settings({ mode: HUE_MAP_RADIAL, span: 4 })
  close(hueRotatePosition(opts, 0, 1, 0, 0, 0), 0)
  close(hueRotatePosition(opts, 0, 1, 2, 0, 0), hueRotatePosition(opts, 0, 1, -2, 0, 0))
  close(hueRotatePosition(opts, 0, 1, 0, 4, 0), 1)
})

test('OFFSET slides the mapping\'s zero along its axis', () => {
  const opts = settings({ mode: HUE_MAP_X, span: 4, offset: 2 })
  close(hueRotatePosition(opts, 0, 1, 2, 0, 0), 0)
  close(hueRotatePosition(opts, 0, 1, 6, 0, 0), 1)
})

// ── The turn ─────────────────────────────────────────────────────────────────

test('SPREAD reads as turns from one end of the formation to the other', () => {
  const opts = settings({ rotate: 0, spread: 0.5 })
  close(hueRotateTurns(opts, 0), 0)
  close(hueRotateTurns(opts, 1), 0.5)
  const negative = settings({ rotate: 0, spread: -0.5 })
  close(hueRotateTurns(negative, 1), -0.5)
})

test('ROTATE offsets every copy equally, leaving the spread between them intact', () => {
  const spread = settings({ mode: HUE_MAP_INDEX, rotate: 0, spread: 0.25 })
  const turned = settings({ mode: HUE_MAP_INDEX, rotate: 0.4, spread: 0.25 })
  for (let i = 0; i < 5; i++) {
    close(turnOf(turned, i, 5) - turnOf(spread, i, 5), 0.4, 1e-12)
  }
})

test('a full turn of ROTATE returns the same colour, so a 0→1 lane loops', () => {
  const opts = settings({ mode: HUE_MAP_INDEX, rotate: 1, spread: 0 })
  const start = new Color('#3f7fd0')
  const end = start.clone()
  end.offsetHSL(turnOf(opts, 0, 1), 0, 0)
  close(end.r, start.r, 1e-12)
  close(end.g, start.g, 1e-12)
  close(end.b, start.b, 1e-12)
})

test('SPREAD zero is a legitimate global filter: every copy turns together', () => {
  const opts = settings({ mode: HUE_MAP_INDEX, rotate: 0.3, spread: 0 })
  for (let i = 0; i < 4; i++) close(turnOf(opts, i, 4), 0.3)
})

// ── Composition: the property that makes it safe to stack ────────────────────

test('the turn ACCUMULATES onto upstream relative shifts instead of replacing them', () => {
  const opts = settings({ mode: HUE_MAP_INDEX, rotate: 0.25, spread: 0, saturation: 0.1, lightness: -0.05 })
  const resolved = hueRotateColorizer.resolve({ settings: opts, notes: [] })
  const upstream = identityVisualCopy()
  upstream.colorShift.hue = 0.5
  upstream.colorShift.saturation = 0.2
  upstream.colorShift.lightness = 0.1
  const [copy] = resolved.apply(upstream, { beat: 0, index: 0, count: 1 })
  close(copy.colorShift.hue, 0.75)
  close(copy.colorShift.saturation, 0.30000000000000004, 1e-12)
  close(copy.colorShift.lightness, 0.05, 1e-12)
})

test('an upstream tint survives untouched - this device never owns a colour', () => {
  const resolved = hueRotateColorizer.resolve({ settings: settings({ rotate: 0.2 }), notes: [] })
  const upstream = identityVisualCopy()
  upstream.colorShift.tint = '#ff48b0'
  upstream.colorShift.tintAmount = 0.6
  upstream.colorShift.tintPerceptual = true
  const [copy] = resolved.apply(upstream, { beat: 0, index: 0, count: 1 })
  assert.equal(copy.colorShift.tint, '#ff48b0')
  assert.equal(copy.colorShift.tintAmount, 0.6)
  assert.equal(copy.colorShift.tintPerceptual, true)
})

test('at ROTATE and SPREAD zero it adds exactly nothing', () => {
  const opts = settings({ rotate: 0, spread: 0, saturation: 0, lightness: 0 })
  const resolved = hueRotateColorizer.resolve({ settings: opts, notes: [] })
  const upstream = identityVisualCopy()
  upstream.colorShift.hue = 0.4
  const [copy] = resolved.apply(upstream, { beat: 0, index: 3, count: 8 })
  close(copy.colorShift.hue, 0.4)
})

test('passive of the beat, and the transform and opacity ride through', () => {
  const opts = settings({ mode: HUE_MAP_INDEX, rotate: 0.1 })
  const resolved = hueRotateColorizer.resolve({ settings: opts, notes: [] })
  const upstream = identityVisualCopy()
  upstream.opacity = 0.5
  upstream.transform.makeTranslation(1, 2, 3)
  const [early] = resolved.apply(upstream, { beat: 0, index: 1, count: 4 })
  const [late] = resolved.apply(upstream, { beat: 987.6, index: 1, count: 4 })
  close(early.colorShift.hue, late.colorShift.hue)
  assert.equal(early.opacity, 0.5)
  assert.ok(early.transform.equals(upstream.transform))
  assert.notEqual(early.transform, upstream.transform) // independently owned matrix
})

test('continuous rotation runs without notes and preserves phase, spread and upstream hue', () => {
  const resolved = hueRotateColorizer.resolve({
    settings: settings({ continuous: 1, speed: 0.125, rotate: 0.2, spread: 0.5 }),
    notes: [],
  })
  const upstream = identityVisualCopy()
  upstream.colorShift.hue = 0.1
  const at = (beat: number, index = 0) => resolved.apply(upstream, { beat, index, count: 3 })[0].colorShift.hue
  close(at(0), 0.3)
  close(at(2), 0.55)
  close(at(2, 2), 1.05)
  close(at(8), at(0) + 1)
  // Revisit earlier beats after later ones: there is no accumulated frame state.
  close(at(2), 0.55)
  close(at(-2), 0.05)
  close(upstream.colorShift.hue, 0.1)
})

test('continuous speed supports reverse and stopped rotation, and disabling it restores the fixed hue', () => {
  for (const speed of [-0.25, 0, 0.5]) {
    const opts = settings({ continuous: 1, speed, rotate: 0.2, spread: 0 })
    close(hueRotateTurns(opts, 0, 3), 0.2 + speed * 3)
    close(hueRotateTurns({ ...opts, continuous: 0 }, 0, 3), 0.2)
  }
})

test('POSITION maps read the copy\'s world position through the placement transform', () => {
  const opts = settings({ mode: HUE_MAP_X, span: 4, rotate: 0, spread: 1 })
  close(turnOf(opts, 0, 1, new Matrix4().makeTranslation(4, 0, 0)), 1)
})

// ── The two circles ──────────────────────────────────────────────────────────

/** What an instrument's color param comes out as after a shift. */
function rendered(source: string, shift: Partial<ReturnType<typeof identityVisualCopy>['colorShift']>): string {
  const copy = identityVisualCopy()
  Object.assign(copy.colorShift, shift)
  const out = applyColorShiftToInstrumentParams(
    { tone: source },
    [{ key: 'tone', defaultColor: source }],
    copy.colorShift,
    {},
    new Color(),
    new Color(),
  )
  return out.tone
}

test('the perceptual circle holds lightness and chroma across a whole sweep', () => {
  // The failure this exists to prevent: an HSL sweep of a mid blue passes
  // through a yellow that is far lighter than where it started, so the object
  // pulses in brightness twice a turn.
  const source = '#3f7fd0'
  const start = colorToOklch(source)!
  let worstPerceptual = 0
  let worstHsl = 0
  for (let i = 1; i < 12; i++) {
    const turns = i / 12
    const okl = colorToOklch(rendered(source, { hue: turns, huePerceptual: true }))!
    const hsl = colorToOklch(rendered(source, { hue: turns }))!
    worstPerceptual = Math.max(worstPerceptual, Math.abs(okl.l - start.l))
    worstHsl = Math.max(worstHsl, Math.abs(hsl.l - start.l))
  }
  assert.ok(worstPerceptual < 0.02, `perceptual sweep drifted ${worstPerceptual.toFixed(3)} in L`)
  assert.ok(worstHsl > 0.1, `HSL sweep only drifted ${worstHsl.toFixed(3)} in L - has three changed?`)
})

test('the perceptual circle turns the hue by the amount asked for', () => {
  const source = '#3f7fd0'
  const start = colorToOklch(source)!
  const quarter = colorToOklch(rendered(source, { hue: 0.25, huePerceptual: true }))!
  const delta = ((quarter.h - start.h) % 360 + 360) % 360
  assert.ok(Math.abs(delta - 90) < 2, `a quarter turn moved the hue ${delta.toFixed(1)}°`)
})

test('a grey object has no hue to turn, on either circle', () => {
  for (const perceptual of [true, false]) {
    assert.equal(rendered('#808080', { hue: 0.3, huePerceptual: perceptual }), '#808080')
  }
})

test('saturation and lightness still ride on top of a perceptual turn', () => {
  const lifted = colorToOklch(rendered('#3f7fd0', { hue: 0.25, huePerceptual: true, lightness: 0.2 }))!
  const plain = colorToOklch(rendered('#3f7fd0', { hue: 0.25, huePerceptual: true }))!
  assert.ok(lifted.l > plain.l + 0.1, 'the lightness offset was dropped')
})

test('the definition flags its circle onto the copy', () => {
  assert.equal(turnOfFlag(settings({ hueMode: HUE_MODE_PERCEPTUAL })), true)
  assert.equal(turnOfFlag(settings({ hueMode: HUE_MODE_HSL })), false)
})

function turnOfFlag(opts: HueRotateSettings): boolean | undefined {
  const resolved = hueRotateColorizer.resolve({ settings: opts, notes: [] })
  const [copy] = resolved.apply(identityVisualCopy(), { beat: 0, index: 0, count: 1 })
  return copy.colorShift.huePerceptual
}

test('declares itself passive: zero strict MIDI rows', () => {
  assert.equal(hueRotateColorizer.midiRows!(settings()).length, 0)
  assert.equal(hueRotateColorizer.strictMidiRows, true)
})
