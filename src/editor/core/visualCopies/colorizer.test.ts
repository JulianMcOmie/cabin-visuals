import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResolvedNote } from '../visual/types'
import { mergeDefinitionSettings } from './definitions'
import { colorToOklch } from '../../utils/oklch'
import {
  BLEND_LINEAR,
  COLORIZER_FLASH_PITCH,
  COLORIZER_FLASH_SLOTS,
  COLORIZER_RAINBOW_PITCH,
  rainbowDiagonal,
  SHAPE_EVEN,
  SHAPE_SPIKE,
  SHAPE_SWELL,
  evaluateColorizer,
  evaluateNoteEnvelope,
  noteColorizer,
  type ColorizerSettings,
} from './colorizer'
import { identityVisualCopy } from './identityVisualCopy'

function note(beat: number, durationBeats = 0.25, velocity = 1, pitch = COLORIZER_FLASH_PITCH): ResolvedNote {
  return { beat, pitch, durationBeats, velocity, blockStartBeat: 0, blockEndBeat: 1024 }
}

function settings(overrides: Partial<ColorizerSettings> = {}): ColorizerSettings {
  return {
    ...mergeDefinitionSettings(noteColorizer, undefined),
    ...overrides,
  } as unknown as ColorizerSettings
}

const close = (actual: number, expected: number, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`)

test('a zero-attack note flashes full intensity on its beat, then falls to nothing', () => {
  const opts = settings({ intensity: 1, attackBeats: 0, releaseBeats: 1, shape: SHAPE_EVEN })
  const notes = [note(2, 0)]
  assert.equal(evaluateColorizer(notes, opts, 1.9).tintAmount, 0)
  close(evaluateColorizer(notes, opts, 2).tintAmount, 1)
  close(evaluateColorizer(notes, opts, 2.5).tintAmount, 0.5)
  assert.equal(evaluateColorizer(notes, opts, 3).tintAmount, 0)
  assert.equal(evaluateColorizer(notes, opts, 9).tintAmount, 0)
})

test('ATTACK is never truncated by a shorter note: the attack always completes', () => {
  // A 16th-note hit with a half-beat swell still reaches full intensity.
  close(evaluateNoteEnvelope(note(0, 0.0625), 0.5, 0.5, 1, SHAPE_EVEN), 1)
  close(evaluateNoteEnvelope(note(0, 0.0625), 0.25, 0.5, 1, SHAPE_EVEN), 0.5)
})

test('the note is held at full while it sounds, then releases over RELEASE', () => {
  const held = note(0, 4)
  close(evaluateNoteEnvelope(held, 3.9, 0, 2, SHAPE_EVEN), 1)
  close(evaluateNoteEnvelope(held, 5, 0, 2, SHAPE_EVEN), 0.5)
  assert.equal(evaluateNoteEnvelope(held, 6, 0, 2, SHAPE_EVEN), 0)
})

test('SHAPE bends the release: SPIKE drops off a cliff, SWELL hangs on', () => {
  const halfway = (shape: number) => evaluateNoteEnvelope(note(0, 0), 0.5, 0, 1, shape)
  close(halfway(SHAPE_SPIKE), 0.125)
  close(halfway(SHAPE_EVEN), 0.5)
  close(halfway(SHAPE_SWELL), 0.5)
  // The distinguishing part of SWELL is the shoulder, not the midpoint.
  const quarter = (shape: number) => evaluateNoteEnvelope(note(0, 0), 0.25, 0, 1, shape)
  assert.ok(quarter(SHAPE_SWELL) > quarter(SHAPE_EVEN))
  assert.ok(quarter(SHAPE_EVEN) > quarter(SHAPE_SPIKE))
})

test('only the declared flash pitch triggers; the rest of the keyboard is inert', () => {
  const opts = settings({ intensity: 1, releaseBeats: 1 })
  assert.equal(evaluateColorizer([note(0, 0, 1, COLORIZER_FLASH_PITCH + 1)], opts, 0).tintAmount, 0)
  assert.equal(evaluateColorizer([note(0, 0, 1, 72)], opts, 0).tintAmount, 0)
  close(evaluateColorizer([note(0, 0)], opts, 0).tintAmount, 1)
})

test('velocity scales the flash, and INTENSITY caps how far it can ever go', () => {
  const opts = settings({ intensity: 0.5, attackBeats: 0, releaseBeats: 1, shape: SHAPE_EVEN })
  close(evaluateColorizer([note(0, 0, 1)], opts, 0).tintAmount, 0.5)
  close(evaluateColorizer([note(0, 0, 0.25)], opts, 0).tintAmount, 0.125)
  // The raw sound curve is reported unscaled, for the panel to draw.
  close(evaluateColorizer([note(0, 0, 0.25)], opts, 0).envelope, 0.25)
})

test('overlapping notes take the loudest rather than summing past the color', () => {
  const opts = settings({ intensity: 1, attackBeats: 0, releaseBeats: 1, shape: SHAPE_EVEN })
  const both = evaluateColorizer([note(0, 0, 0.6), note(0, 0, 0.9)], opts, 0)
  close(both.tintAmount, 0.9)
})

test('STAGGER delays each copy so one hit rolls across the split', () => {
  const opts = settings({ intensity: 1, staggerBeats: 0.25, attackBeats: 0, releaseBeats: 1, shape: SHAPE_EVEN })
  const notes = [note(0, 0)]
  close(evaluateColorizer(notes, opts, 0.5, 0).tintAmount, 0.5)
  close(evaluateColorizer(notes, opts, 0.5, 1).tintAmount, 0.75)
  close(evaluateColorizer(notes, opts, 0.5, 2).tintAmount, 1)
  assert.equal(evaluateColorizer(notes, opts, 0.5, 3).tintAmount, 0)
  // A negative stagger runs the wave the other way: later copies are further
  // along the decay instead of still waiting for the hit.
  const reversed = settings({ ...opts, staggerBeats: -0.25 })
  close(evaluateColorizer(notes, reversed, 0.5, 1).tintAmount, 0.25)
  assert.equal(evaluateColorizer(notes, reversed, 0.5, 2).tintAmount, 0)
})

test('the flash sets an absolute tint and leaves transform, opacity and HSL alone', () => {
  const input = identityVisualCopy()
  input.transform.makeTranslation(2, 3, 4)
  input.opacity = 0.4
  input.colorShift = { hue: 0.1, saturation: 0.2, lightness: -0.15, tint: null, tintAmount: 0 }
  const output = noteColorizer.resolve({
    settings: settings({ intensity: 1, attackBeats: 0, releaseBeats: 1, color: '#ff0066' }),
    notes: [note(0, 0)],
  }).apply(input, { beat: 0, index: 0, count: 1 })[0]

  assert.deepEqual(output.transform.elements, input.transform.elements)
  assert.notEqual(output.transform, input.transform)
  assert.equal(output.opacity, 0.4)
  assert.equal(output.colorShift.hue, 0.1)
  assert.equal(output.colorShift.saturation, 0.2)
  assert.equal(output.colorShift.lightness, -0.15)
  assert.equal(output.colorShift.tint, '#ff0066')
  close(output.colorShift.tintAmount, 1)
})

test('silence passes an upstream tint through instead of clearing it', () => {
  const input = identityVisualCopy()
  input.colorShift.tint = '#00ff88'
  input.colorShift.tintAmount = 0.5
  const output = noteColorizer.resolve({
    settings: settings({ releaseBeats: 0.25 }),
    notes: [note(0, 0)],
  }).apply(input, { beat: 8, index: 0, count: 1 })[0]
  assert.equal(output.colorShift.tint, '#00ff88')
  assert.equal(output.colorShift.tintAmount, 0.5)
})

test('the editor is held to the declared rows, and evaluation is scrub-deterministic', () => {
  assert.equal(noteColorizer.strictMidiRows, true)
  const notes = [note(1, 3, 0.75), note(2, 0.5), rainbowNote(1.5, 2, 0.8)]
  const opts = settings({ staggerBeats: 0.1 })
  const first = evaluateColorizer(notes, opts, 2.25, 2, 1.75)
  evaluateColorizer(notes, opts, 100, 2, 1.75)
  assert.deepEqual(evaluateColorizer(notes, opts, 2.25, 2, 1.75), first)
})

test('the color param defaults through mergeDefinitionSettings and can be stored', () => {
  assert.equal(mergeDefinitionSettings(noteColorizer, undefined).color, '#ffd166')
  assert.equal(mergeDefinitionSettings(noteColorizer, undefined, { color: '#123456' }).color, '#123456')
  // Numeric params keep coming from inputValues, untouched by the string pass.
  assert.equal(mergeDefinitionSettings(noteColorizer, { intensity: 0.2 }, { color: '#123456' }).intensity, 0.2)
})

// ── Rainbow row ──────────────────────────────────────────────────────────────

function rainbowNote(beat: number, durationBeats = 1, velocity = 1): ResolvedNote {
  return { beat, pitch: COLORIZER_RAINBOW_PITCH, durationBeats, velocity, blockStartBeat: 0, blockEndBeat: 1024 }
}

test('the rainbow row rotates hue rapidly with the beat, from zero at note-on', () => {
  const opts = settings({ rainbowRate: 2, rainbowSpread: 0, attackBeats: 0, releaseBeats: 0, shape: SHAPE_EVEN })
  const notes = [rainbowNote(1, 4)]
  // Phase starts at zero when the note starts, so a replay looks identical.
  close(evaluateColorizer(notes, opts, 1).hue, 0)
  close(evaluateColorizer(notes, opts, 1.5).hue, 1)
  close(evaluateColorizer(notes, opts, 2).hue, 2)
})

test('position along the diagonal offsets the phase - that is the sweep', () => {
  const opts = settings({ rainbowRate: 0, rainbowSpread: 0.25, attackBeats: 0, releaseBeats: 0, shape: SHAPE_EVEN })
  const notes = [rainbowNote(0, 4)]
  close(evaluateColorizer(notes, opts, 1, 0, 0).hue, 0)
  close(evaluateColorizer(notes, opts, 1, 0, 4).hue, 1)
  close(evaluateColorizer(notes, opts, 1, 0, -4).hue, -1)
})

test('the diagonal runs corner to corner, not along a single axis', () => {
  // Equal steps in x and y advance the sweep; moving perpendicular to the
  // diagonal (+x, -y) does not move along it at all.
  close(rainbowDiagonal(0, 0), 0)
  close(rainbowDiagonal(1, -1), 0)
  close(rainbowDiagonal(1, 1), Math.SQRT2)
  assert.ok(rainbowDiagonal(2, 2) > rainbowDiagonal(1, 1))
})

test('the rainbow fades with its envelope instead of popping off', () => {
  const opts = settings({ rainbowRate: 1, rainbowSpread: 0, attackBeats: 0, releaseBeats: 2, shape: SHAPE_EVEN })
  const notes = [rainbowNote(0, 0)]
  // At note-off + half the release the envelope is 0.5, so the sweep is halved.
  close(evaluateColorizer(notes, opts, 1).hue, 0.5)
  assert.equal(evaluateColorizer(notes, opts, 3).hue, 0)
})

test('velocity scales the rainbow, and the two rows drive different channels', () => {
  const opts = settings({ intensity: 1, rainbowRate: 1, rainbowSpread: 0, attackBeats: 0, releaseBeats: 0, shape: SHAPE_EVEN })
  const soft = evaluateColorizer([rainbowNote(0, 4, 0.5)], opts, 1)
  close(soft.hue, 0.5)
  // A rainbow note alone never tints; a flash note alone never rotates hue.
  assert.equal(soft.tintAmount, 0)
  const flashOnly = evaluateColorizer([note(0, 4)], opts, 1)
  assert.equal(flashOnly.hue, 0)
  assert.ok(flashOnly.tintAmount > 0)
})

test('holding both rows composes: absolute tint plus a relative sweep', () => {
  const opts = settings({ intensity: 1, rainbowRate: 1, rainbowSpread: 0, attackBeats: 0, releaseBeats: 0, shape: SHAPE_EVEN })
  const both = evaluateColorizer([note(0, 4), rainbowNote(0, 4)], opts, 1)
  close(both.tintAmount, 1)
  close(both.hue, 1)
})

test('the rainbow reaches the copy as a relative hue offset on top of upstream', () => {
  const input = identityVisualCopy()
  input.colorShift.hue = 0.25
  const output = noteColorizer.resolve({
    settings: settings({ rainbowRate: 1, rainbowSpread: 0, attackBeats: 0, releaseBeats: 0, shape: SHAPE_EVEN }),
    notes: [rainbowNote(0, 4)],
  }).apply(input, { beat: 1, index: 0, count: 1 })
  close(output[0].colorShift.hue, 1.25)
  // The rainbow never touches the absolute channel.
  assert.equal(output[0].colorShift.tint, null)
})

test('the Colorizer declares one row per color slot, plus the rainbow', () => {
  const rows = noteColorizer.midiRows!(settings())
  assert.deepEqual(rows.map((row) => row.pitch), [60, 62, 63, 64, 65, COLORIZER_RAINBOW_PITCH])
  // Slot 1 keeps the original pitch and stays first, so a Colorizer saved
  // before the palette existed opens with its notes on the row it wrote them to.
  assert.equal(rows[0].pitch, COLORIZER_FLASH_PITCH)
  // 61 was already the rainbow's, which is why the color rows skip it.
  assert.ok(!COLORIZER_FLASH_SLOTS.some((slot) => slot.pitch === COLORIZER_RAINBOW_PITCH))
})

test('each color row wears its own live color, so the piano roll IS the palette', () => {
  const rows = noteColorizer.midiRows!(settings({ color: '#123456' }))
  assert.equal(rows[0].color, '#123456')
  assert.equal(rows[1].color, '#ef476f')
  // The rainbow has no single color to show, so it takes the track hue.
  assert.equal(rows[5].color, undefined)
})

// ── The palette ──────────────────────────────────────────────────────────────

const slotNote = (slot: number, beat: number, durationBeats = 0.25, velocity = 1) =>
  note(beat, durationBeats, velocity, COLORIZER_FLASH_SLOTS[slot].pitch)

test('every slot flashes its own color', () => {
  const opts = settings({ intensity: 1, attackBeats: 0, releaseBeats: 0, shape: SHAPE_EVEN })
  for (let slot = 0; slot < COLORIZER_FLASH_SLOTS.length; slot++) {
    const out = evaluateColorizer([slotNote(slot, 0, 4)], opts, 1)
    close(out.tintAmount, 1)
    // A lone slot hands back the user's exact string - no round trip.
    assert.equal(out.tint, opts[COLORIZER_FLASH_SLOTS[slot].key])
  }
})

test('nothing sounding means no color to flash toward', () => {
  assert.equal(evaluateColorizer([], settings(), 0).tint, null)
})

test('two slots at once blend toward the louder one, at the louder one`s strength', () => {
  const opts = settings({
    intensity: 1, attackBeats: 0, releaseBeats: 0, shape: SHAPE_EVEN,
    color: '#ff0000', color2: '#0000ff',
  })
  const notes = [slotNote(0, 0, 4, 1), slotNote(1, 0, 4, 0.25)]
  const out = evaluateColorizer(notes, opts, 1)
  // STRENGTH is the loudest row's, never the sum: two flashes are one flash.
  close(out.tintAmount, 1)
  const blended = colorToOklch(out.tint!)!
  const red = colorToOklch('#ff0000')!
  const blue = colorToOklch('#0000ff')!
  // The blend sits between the two hues and nearer the louder red.
  assert.ok(out.tint !== '#ff0000' && out.tint !== '#0000ff', `${out.tint} is one of the endpoints`)
  const toward = (h: number) => Math.abs(((h - blended.h + 540) % 360) - 180)
  assert.ok(toward(red.h) < toward(blue.h), 'blend should lean toward the louder slot')
})

test('an equal-gain pair lands between the two colors, not on either', () => {
  const opts = settings({
    intensity: 1, attackBeats: 0, releaseBeats: 0, shape: SHAPE_EVEN,
    color: '#ff0000', color2: '#00ff00',
  })
  const out = evaluateColorizer([slotNote(0, 0, 4), slotNote(1, 0, 4)], opts, 1)
  const mid = colorToOklch(out.tint!)!
  // Halfway between red (~29 deg) and green (~142 deg) in OKLab: a real color
  // in between, and NOT the desaturated mud a channel average would give.
  assert.ok(mid.h > 40 && mid.h < 135, `hue ${mid.h} should sit between the endpoints`)
  assert.ok(mid.c > 0.08, `chroma ${mid.c} collapsed - the blend went through grey`)
})

test('releasing one slot crossfades into the other rather than snapping', () => {
  const opts = settings({
    intensity: 1, attackBeats: 0, releaseBeats: 2, shape: SHAPE_EVEN,
    color: '#ff0000', color2: '#0000ff',
  })
  // Slot 1 is a hit that decays; slot 2 is held underneath it.
  const notes = [slotNote(0, 0, 0), slotNote(1, 0, 8)]
  const hues = [0, 0.5, 1, 1.5].map((beat) => colorToOklch(evaluateColorizer(notes, opts, beat).tint!)!.h)
  const blue = colorToOklch('#0000ff')!.h
  const distance = hues.map((h) => Math.abs(((h - blue + 540) % 360) - 180))
  // Every step moves closer to the held color - a crossfade, not a switch.
  for (let i = 1; i < distance.length; i++) {
    assert.ok(distance[i] < distance[i - 1], `step ${i} did not move toward the held color`)
  }
})

test('overlapping notes on ONE row still take the loudest rather than summing', () => {
  const opts = settings({ intensity: 1, attackBeats: 0, releaseBeats: 0, shape: SHAPE_EVEN })
  const out = evaluateColorizer([slotNote(0, 0, 4, 0.5), slotNote(0, 0, 4, 0.75)], opts, 1)
  close(out.tintAmount, 0.75)
  assert.equal(out.tint, opts.color)
})

test('the flash asks for a perceptual mix by default, and a linear one on request', () => {
  const notes = [slotNote(0, 0, 4)]
  const run = (blend?: number) => noteColorizer.resolve({
    settings: settings({ intensity: 1, attackBeats: 0, releaseBeats: 0, shape: SHAPE_EVEN, ...(blend === undefined ? {} : { blend }) }),
    notes,
  }).apply(identityVisualCopy(), { beat: 1, index: 0, count: 1 })[0]
  assert.equal(run().colorShift.tintPerceptual, true)
  assert.equal(run(BLEND_LINEAR).colorShift.tintPerceptual, false)
})

test('a silent colorizer leaves the upstream tint - and its mix - untouched', () => {
  const input = identityVisualCopy()
  input.colorShift.tint = '#123456'
  input.colorShift.tintAmount = 0.5
  const output = noteColorizer.resolve({ settings: settings(), notes: [] })
    .apply(input, { beat: 0, index: 0, count: 1 })
  assert.equal(output[0].colorShift.tint, '#123456')
  close(output[0].colorShift.tintAmount, 0.5)
  assert.equal(output[0].colorShift.tintPerceptual, undefined)
})
