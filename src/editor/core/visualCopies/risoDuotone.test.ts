import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import { mergeDefinitionSettings } from './definitions'
import { identityVisualCopy } from './identityVisualCopy'
import {
  RISO_DITHER_GRID,
  RISO_DITHER_OFF,
  RISO_DITHER_SEQUENCE,
  RISO_MAP_INDEX,
  RISO_MAP_RADIAL,
  RISO_MAP_X,
  overprint,
  risoCoverage,
  risoDuotoneColorizer,
  risoInks,
  risoTone,
  screenThreshold,
  type RisoDuotoneSettings,
} from './risoDuotone'

function settings(overrides: Partial<RisoDuotoneSettings> = {}): RisoDuotoneSettings {
  return {
    ...mergeDefinitionSettings(risoDuotoneColorizer, undefined),
    ...overrides,
  } as unknown as RisoDuotoneSettings
}

const close = (actual: number, expected: number, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`)

/** The tint every copy of a one-copy chain comes out wearing. */
function printedTint(opts: RisoDuotoneSettings, index = 0, count = 1, placement?: Matrix4): string {
  const resolved = risoDuotoneColorizer.resolve({ settings: opts, notes: [] })
  const [copy] = resolved.apply(identityVisualCopy(), {
    beat: 0, index, count, placementTransform: placement,
  })
  return copy.colorShift.tint as string
}

// ── The inks ─────────────────────────────────────────────────────────────────

test('inks multiply onto the paper, and the overprint is both of them', () => {
  const opts = settings({ paper: '#ffffff', inkA: '#ff0000', inkB: '#0000ff' })
  const [paper, withA, withB, both] = risoInks(opts)
  assert.equal(paper, '#ffffff')
  assert.equal(withA, '#ff0000')
  assert.equal(withB, '#0000ff')
  // Red x blue leaves nothing: the overprint is a colour neither ink contains.
  assert.equal(both, '#000000')
})

test('a tinted paper darkens every ink, the way stock does', () => {
  const [, withA] = risoInks(settings({ paper: '#808080', inkA: '#ffffff', inkB: '#ffffff' }))
  // 128 x 255 / 255 = 128, unchanged by a white ink; the stock is the ceiling.
  assert.equal(withA, '#808080')
  const [, half] = risoInks(settings({ paper: '#ffffff', inkA: '#808080', inkB: '#ffffff' }))
  assert.equal(half, '#808080')
})

test('an unparseable ink degrades to the other operand instead of throwing', () => {
  assert.equal(overprint('#ffffff', 'nonsense'), '#ffffff')
  assert.equal(overprint('nonsense', '#ff0000'), '#ff0000')
})

// ── The tone ramp ────────────────────────────────────────────────────────────

test('INDEX mode spreads first→last copy across the ramp; one copy sits mid-ramp', () => {
  const opts = settings({ mode: RISO_MAP_INDEX, ink: 0 })
  close(risoTone(opts, 0, 3, 0, 0, 0), 0)
  close(risoTone(opts, 1, 3, 0, 0, 0), 0.5)
  close(risoTone(opts, 2, 3, 0, 0, 0), 1)
  close(risoTone(opts, 0, 1, 0, 0, 0), 0.5)
})

test('X mode centres its zero and clamps past either end, like a gradient fill', () => {
  const opts = settings({ mode: RISO_MAP_X, span: 4 })
  close(risoTone(opts, 0, 1, 0, 0, 0), 0.5)
  close(risoTone(opts, 0, 1, -2, 0, 0), 0)
  close(risoTone(opts, 0, 1, 2, 0, 0), 1)
  close(risoTone(opts, 0, 1, -50, 0, 0), 0)
  close(risoTone(opts, 0, 1, 50, 0, 0), 1)
})

test('RADIAL measures from the chain origin, so its ramp starts at zero distance', () => {
  const opts = settings({ mode: RISO_MAP_RADIAL, span: 4 })
  close(risoTone(opts, 0, 1, 0, 0, 0), 0)
  close(risoTone(opts, 0, 1, 4, 0, 0), 1)
  close(risoTone(opts, 0, 1, 0, 2, 0), 0.5)
  // Symmetric by construction: sign of the offset cannot matter.
  close(risoTone(opts, 0, 1, -2, 0, 0), risoTone(opts, 0, 1, 2, 0, 0))
})

test('TONE shifts the whole ramp and FLIP reverses it', () => {
  const up = settings({ mode: RISO_MAP_INDEX, tone: 0.25 })
  close(risoTone(up, 0, 3, 0, 0, 0), 0.25)
  close(risoTone(up, 2, 3, 0, 0, 0), 1) // clamped past the end
  const flipped = settings({ mode: RISO_MAP_INDEX, flip: 1 })
  close(risoTone(flipped, 0, 3, 0, 0, 0), 1)
  close(risoTone(flipped, 2, 3, 0, 0, 0), 0)
})

// ── Coverage: the one knob that opens the overprint ──────────────────────────

test('at INK zero the two coverages are exact complements - one ink or the other', () => {
  for (const tone of [0, 0.25, 0.5, 0.75, 1]) {
    const [a, b] = risoCoverage(tone, 0)
    close(a + b, 1)
  }
})

test('INK above zero floods both screens; below zero it starves them', () => {
  const [floodA, floodB] = risoCoverage(0.5, 0.3)
  assert.ok(floodA > 0.5 && floodB > 0.5, 'mid-tone should take both inks')
  const [starveA, starveB] = risoCoverage(0.5, -0.3)
  assert.ok(starveA < 0.5 && starveB < 0.5, 'mid-tone should leave paper showing')
})

// ── The screen ───────────────────────────────────────────────────────────────

test('thresholds stay strictly inside 0..1, so both ends of the ramp print solid', () => {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const threshold = screenThreshold(x, y)
      assert.ok(threshold > 0 && threshold < 1, `cell ${x},${y} = ${threshold}`)
    }
  }
})

test('the matrix tiles and takes negative cells - copies left of the origin still print', () => {
  close(screenThreshold(-1, -1), screenThreshold(7, 7))
  close(screenThreshold(8, 16), screenThreshold(0, 0))
})

test('every threshold is distinct: an ordered screen spreads its dots, never clumps', () => {
  const seen = new Set<number>()
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) seen.add(screenThreshold(x, y))
  assert.equal(seen.size, 64)
})

test('SEQUENCE dither stipples neighbouring copies that share a tone', () => {
  // Every copy sits at the same place, so only the screen can separate them:
  // a flat mid-grey field must come out as a mix, not one solid colour.
  const opts = settings({ mode: RISO_MAP_X, span: 4, dither: RISO_DITHER_SEQUENCE, ink: 0 })
  const printed = new Set(Array.from({ length: 16 }, (_, i) => printedTint(opts, i, 16)))
  assert.ok(printed.size > 1, `expected a stipple, got only ${[...printed].join(', ')}`)
})

test('GRID dither stipples by WHERE the copy is, not by its index', () => {
  const opts = settings({ mode: RISO_MAP_X, span: 40, dither: RISO_DITHER_GRID, grain: 1 })
  const printed = new Set(
    Array.from({ length: 8 }, (_, i) => printedTint(opts, 0, 1, new Matrix4().makeTranslation(i, 0, 0))),
  )
  assert.ok(printed.size > 1, 'copies across a lattice should not all print the same')
})

test('screen OFF is a hard two-tone split at the middle of the ramp', () => {
  const opts = settings({ mode: RISO_MAP_INDEX, dither: RISO_DITHER_OFF, ink: 0 })
  const [paper, withA, withB, both] = risoInks(opts)
  // Below the middle only ink B lands; above it, only ink A.
  assert.equal(printedTint(opts, 0, 3), withB)
  assert.equal(printedTint(opts, 2, 3), withA)
  // With the screen off and no extra ink, neither of the other two outcomes
  // can happen at all - that is what makes it a poster rather than a print.
  // The odd run's middle copy sits at exactly 0.5 against a 0.5 threshold; the
  // tie-break hands it ink A rather than leaving it bare.
  const everything = new Set(Array.from({ length: 9 }, (_, i) => printedTint(opts, i, 9)))
  assert.ok(!everything.has(paper) && !everything.has(both))
  assert.equal(printedTint(opts, 4, 9), withA)
})

test('flooding the ink with the screen off prints the overprint through the middle', () => {
  const opts = settings({ mode: RISO_MAP_INDEX, dither: RISO_DITHER_OFF, ink: 0.4 })
  const [, , , both] = risoInks(opts)
  assert.equal(printedTint(opts, 1, 3), both)
})

test('starving the ink with the screen off leaves bare paper through the middle', () => {
  const opts = settings({ mode: RISO_MAP_INDEX, dither: RISO_DITHER_OFF, ink: -0.4 })
  assert.equal(printedTint(opts, 1, 3), risoInks(opts)[0])
})

// ── The chain entry ──────────────────────────────────────────────────────────

test('prints as an absolute tint, passive of notes and beat', () => {
  const opts = settings({ mode: RISO_MAP_INDEX, dither: RISO_DITHER_OFF })
  const resolved = risoDuotoneColorizer.resolve({ settings: opts, notes: [] })
  const early = resolved.apply(identityVisualCopy(), { beat: 0, index: 0, count: 3 })
  const late = resolved.apply(identityVisualCopy(), { beat: 123.45, index: 0, count: 3 })
  assert.equal(early.length, 1)
  assert.equal(early[0].colorShift.tintAmount, 1)
  assert.equal(early[0].colorShift.tintPerceptual, true)
  assert.equal(early[0].colorShift.tint, late[0].colorShift.tint)
})

test('POSITION maps read the copy\'s world position through the placement transform', () => {
  const opts = settings({ mode: RISO_MAP_X, span: 4, dither: RISO_DITHER_OFF })
  const [, withA] = risoInks(opts)
  assert.equal(printedTint(opts, 0, 1, new Matrix4().makeTranslation(2, 0, 0)), withA)
})

test('AMOUNT zero leaves upstream color state untouched', () => {
  const resolved = risoDuotoneColorizer.resolve({ settings: settings({ amount: 0 }), notes: [] })
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
  const resolved = risoDuotoneColorizer.resolve({ settings: settings(), notes: [] })
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
  assert.equal(risoDuotoneColorizer.midiRows!(settings()).length, 0)
  assert.equal(risoDuotoneColorizer.strictMidiRows, true)
})
