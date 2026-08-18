import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import type { ResolvedNote } from '../visual/types'
import { mergeDefinitionSettings } from './definitions'
import {
  COSINE_KICK_PITCH,
  COSINE_MAP_DEPTH,
  COSINE_MAP_INDEX,
  COSINE_MAP_RADIAL,
  COSINE_MAP_SPHERICAL,
  COSINE_MAP_X,
  COSINE_BLEND_LINEAR,
  COSINE_PALETTE_PRESETS,
  cosineKickPhase,
  cosinePaletteColor,
  cosinePaletteColorizer,
  cosinePaletteLut,
  cosinePalettePosition,
  type CosinePaletteSettings,
} from './cosinePalette'
import { identityVisualCopy } from './identityVisualCopy'

function settings(overrides: Partial<CosinePaletteSettings> = {}): CosinePaletteSettings {
  return {
    ...mergeDefinitionSettings(cosinePaletteColorizer, undefined),
    ...overrides,
  } as unknown as CosinePaletteSettings
}

function note(beat: number, pitch = COSINE_KICK_PITCH, velocity = 127): ResolvedNote {
  return { beat, pitch, velocity, durationBeats: 0.25 } as ResolvedNote
}

const close = (actual: number, expected: number, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`)

// ── The formula ──────────────────────────────────────────────────────────────

test('the color IS a + b·cos(2π(u + d)), channel for channel', () => {
  // Independent evaluation of IQ's formula at the Rainbow preset, so a change
  // to the implementation path (LUT, phase folding) cannot silently retune it.
  const opts = settings()
  const u = 0.37
  const expected = '#' + COSINE_PALETTE_PRESETS[0].d
    .map((d) => Math.round(Math.max(0, Math.min(1, 0.5 + 0.5 * Math.cos(2 * Math.PI * (u + d)))) * 255)
      .toString(16).padStart(2, '0'))
    .join('')
  assert.equal(cosinePaletteColor(opts, u), expected)
})

test('the palette is periodic: u and u+1 are the same color exactly', () => {
  const opts = settings()
  assert.equal(cosinePaletteColor(opts, 0.2), cosinePaletteColor(opts, 1.2))
  assert.equal(cosinePaletteColor(opts, 0), cosinePaletteColor(opts, 1))
})

test('presets differ only by phase: RANGE 0 collapses every preset to flat BRIGHT grey', () => {
  for (let palette = 0; palette < COSINE_PALETTE_PRESETS.length; palette++) {
    assert.equal(cosinePaletteColor(settings({ palette, range: 0 }), 0.61), '#808080')
  }
})

test('PHASE knobs offset the selected preset rather than replacing it', () => {
  // Shifting all three channels by the same amount equals sliding u itself.
  const shifted = settings({ phaseR: 0.1, phaseG: 0.1, phaseB: 0.1 })
  assert.equal(cosinePaletteColor(shifted, 0.25), cosinePaletteColor(settings(), 0.35))
})

test('the LUT is the same palette, sampled evenly over one period', () => {
  const opts = settings()
  const lut = cosinePaletteLut(opts, 64)
  assert.equal(lut.length, 64)
  assert.equal(lut[0], cosinePaletteColor(opts, 0))
  assert.equal(lut[16], cosinePaletteColor(opts, 0.25))
})

// ── The mapping ──────────────────────────────────────────────────────────────

test('position modes read their axis; SPAN is units per period, OFFSET slides zero', () => {
  const opts = settings({ mode: COSINE_MAP_X, span: 4 })
  close(cosinePalettePosition(opts, 0, 1, 2, 9, 9), 0.5)
  close(cosinePalettePosition(settings({ mode: COSINE_MAP_X, span: 4, offset: 2 }), 0, 1, 2, 0, 0), 0)
  close(cosinePalettePosition(settings({ mode: COSINE_MAP_DEPTH, span: 4 }), 0, 1, 9, 9, 2), 0.5)
})

test('RADIAL is symmetric about the origin and ignores depth; SPHERICAL includes it', () => {
  const radial = settings({ mode: COSINE_MAP_RADIAL, span: 4 })
  const atPlus = cosinePalettePosition(radial, 0, 1, 3, 0, 0)
  close(cosinePalettePosition(radial, 0, 1, -3, 0, 0), atPlus)
  close(cosinePalettePosition(radial, 0, 1, 0, 3, 7), atPlus)
  const spherical = settings({ mode: COSINE_MAP_SPHERICAL, span: 4 })
  close(cosinePalettePosition(spherical, 0, 1, 0, 0, 3), atPlus)
})

test('no clamp: past SPAN the palette enters its next period instead of padding', () => {
  const opts = settings({ mode: COSINE_MAP_X, span: 2 })
  close(cosinePalettePosition(opts, 0, 1, 5, 0, 0), 2.5)
})

test('INDEX mode spans one t across the run, so integer CYCLES closes a ring seamlessly', () => {
  const opts = settings({ mode: COSINE_MAP_INDEX })
  close(cosinePalettePosition(opts, 0, 8, 0, 0, 0), 0)
  close(cosinePalettePosition(opts, 7, 8, 0, 0, 0), 1)
  close(cosinePalettePosition(opts, 0, 1, 0, 0, 0), 0.5)
  // t=0 and t=1 wrap to the same color at cycles 1 - the seam is invisible.
  assert.equal(cosinePaletteColor(settings(), 0), cosinePaletteColor(settings(), 1))
})

// ── The kick ─────────────────────────────────────────────────────────────────

test('a kick lands full-strength on its onset frame and eases back to ~5% at KICK DECAY', () => {
  const notes = [note(4)]
  close(cosineKickPhase(notes, 3.999, 0.25, 1), 0)
  close(cosineKickPhase(notes, 4, 0.25, 1), 0.25)
  close(cosineKickPhase(notes, 5, 0.25, 1), 0.25 * Math.exp(-3))
})

test('kicks sum over the note history, so a roll winds further than one hit', () => {
  const notes = [note(0), note(0.25), note(0.5)]
  // The earlier hits have partly decayed, so the sum lands between one fresh
  // hit and three: 0.25·(1 + e^-0.75 + e^-1.5) ≈ 1.7 hits' worth.
  close(cosineKickPhase(notes, 0.5, 0.25, 1), 0.25 * (1 + Math.exp(-0.75) + Math.exp(-1.5)))
})

test('velocity scales the shove; duration is deliberately ignored', () => {
  const soft = cosineKickPhase([note(0, COSINE_KICK_PITCH, 64)], 0, 0.25, 1)
  const hard = cosineKickPhase([note(0, COSINE_KICK_PITCH, 127)], 0, 0.25, 1)
  close(soft / hard, 64 / 127, 1e-6)
  const long = { ...note(0), durationBeats: 8 } as ResolvedNote
  close(cosineKickPhase([long], 0.5, 0.25, 1), cosineKickPhase([note(0)], 0.5, 0.25, 1))
})

// ── The chain entry ──────────────────────────────────────────────────────────

test('applies the sampled palette color as tint, perceptual by default', () => {
  const opts = settings({ mode: COSINE_MAP_X, span: 4 })
  const resolved = cosinePaletteColorizer.resolve({ settings: opts, notes: [] })
  const placement = new Matrix4().makeTranslation(1, 0, 0)
  const [copy] = resolved.apply(identityVisualCopy(), {
    beat: 0, index: 0, count: 1, placementTransform: placement,
  })
  assert.equal(copy.colorShift.tint, cosinePaletteColor(opts, 0.25))
  assert.equal(copy.colorShift.tintAmount, 1)
  assert.equal(copy.colorShift.tintPerceptual, true)
  const linear = cosinePaletteColorizer.resolve({
    settings: settings({ blend: COSINE_BLEND_LINEAR }), notes: [],
  })
  assert.equal(linear.apply(identityVisualCopy(), { beat: 0, index: 0, count: 1 })[0]
    .colorShift.tintPerceptual, false)
})

test('SCROLL slides the palette: scroll s at x equals scroll 0 a span further along', () => {
  const at = (scroll: number, x: number) => {
    const resolved = cosinePaletteColorizer.resolve({
      settings: settings({ mode: COSINE_MAP_X, span: 4, scroll }), notes: [],
    })
    const placement = new Matrix4().makeTranslation(x, 0, 0)
    return resolved.apply(identityVisualCopy(), {
      beat: 0, index: 0, count: 1, placementTransform: placement,
    })[0].colorShift.tint
  }
  assert.equal(at(0.25, 0), at(0, 1))
  assert.equal(at(1, 2), at(0, 2)) // a full turn is a seamless loop
})

test('a Kick note shifts every copy\'s phase at that beat and has decayed later', () => {
  const opts = settings({ mode: COSINE_MAP_X, span: 4, kick: 0.5, kickDecay: 1 })
  const resolved = cosinePaletteColorizer.resolve({ settings: opts, notes: [note(2)] })
  const tintAt = (beat: number) =>
    resolved.apply(identityVisualCopy(), { beat, index: 0, count: 1 })[0].colorShift.tint
  assert.equal(tintAt(2), cosinePaletteColor(opts, 0.5))
  assert.equal(tintAt(0), cosinePaletteColor(opts, 0))
  assert.equal(tintAt(20), cosinePaletteColor(opts, 0))
})

test('AMOUNT zero leaves upstream color state untouched', () => {
  const resolved = cosinePaletteColorizer.resolve({ settings: settings({ amount: 0 }), notes: [] })
  const upstream = identityVisualCopy()
  upstream.colorShift.tint = '#123456'
  upstream.colorShift.tintAmount = 0.4
  upstream.colorShift.hue = 0.2
  const [copy] = resolved.apply(upstream, { beat: 0, index: 0, count: 1 })
  assert.equal(copy.colorShift.tint, '#123456')
  assert.equal(copy.colorShift.tintAmount, 0.4)
  assert.equal(copy.colorShift.hue, 0.2)
})

test('relative HSL shifts ride through; transform and opacity are preserved', () => {
  const resolved = cosinePaletteColorizer.resolve({ settings: settings(), notes: [] })
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

test('declares exactly one MIDI row: the Kick', () => {
  const rows = cosinePaletteColorizer.midiRows!(settings())
  assert.equal(rows.length, 1)
  assert.equal(rows[0].pitch, COSINE_KICK_PITCH)
  assert.equal(cosinePaletteColorizer.strictMidiRows, true)
})
