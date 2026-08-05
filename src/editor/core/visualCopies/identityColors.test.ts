// The palette's integrity, which is the one thing no single definition file can
// check for itself: a colour is only meaningful relative to the other twenty-six.

import assert from 'node:assert/strict'
import test from 'node:test'
import { colorToOklch } from '../../utils/oklch'
import { listMoverOrSplitterDefinitions } from './registry'

const shipped = () => listMoverOrSplitterDefinitions().filter((d) => !d.id.startsWith('test.'))

/** Definitions with a FIXED color. The Colorizer follows one of its own color
 *  params live, so it has no constant to check - its hue slot (86°, its palette
 *  default) is simply left unclaimed by everything here. */
const fixed = () => shipped().filter((d) => typeof d.identityColor === 'string')
  .map((d) => ({ id: d.id, hex: d.identityColor as string }))

test('every shipped definition declares an identity color', () => {
  const missing = shipped().filter((d) => !d.identityColor).map((d) => d.id)
  assert.deepEqual(missing, [], `definitions with no identityColor: ${missing.join(', ')}`)
})

test('the Colorizer is the only definition following a live param', () => {
  const dynamic = shipped().filter((d) => typeof d.identityColor === 'object').map((d) => d.id)
  assert.deepEqual(dynamic, ['calmHueRotate'])
})

test('identity colors are well-formed hex and parse as a color', () => {
  for (const def of fixed()) {
    assert.match(def.hex, /^#[0-9a-f]{6}$/, `${def.id} is not a lowercase #rrggbb`)
    assert.ok(colorToOklch(def.hex), `${def.id} does not parse`)
  }
})

test('no two definitions share an identity color', () => {
  const byColor = new Map<string, string[]>()
  for (const def of fixed()) {
    const list = byColor.get(def.hex) ?? []
    list.push(def.id)
    byColor.set(def.hex, list)
  }
  const clashes = [...byColor.entries()].filter(([, ids]) => ids.length > 1)
  assert.deepEqual(clashes, [], `shared colors: ${clashes.map(([c, ids]) => `${c} → ${ids.join(' + ')}`).join('; ')}`)
})

/** The chroma at or below which midiEditorPalette treats a source as grey and
 *  leaves it grey. Above it, the hue is re-voiced to full chroma. */
const GREY_FLOOR = 0.02

test('identity colors are either properly colored or properly grey, never between', () => {
  // A definition sitting just above the grey floor is the worst case: it looks
  // tasteful here and renders as a fully saturated lane in the editor.
  for (const def of fixed()) {
    const chroma = colorToOklch(def.hex)!.c
    const ok = chroma <= GREY_FLOOR || chroma > 0.1
    assert.ok(ok, `${def.id} (${def.hex}) has chroma ${chroma.toFixed(3)} - either drop it to <=${GREY_FLOOR} to stay grey, or raise it above 0.1`)
  }
})

test('every pair of colored definitions is at least 11 degrees apart in HUE', () => {
  // The one property that survives midiEditorPalette's re-voicing, which pins
  // lightness and chroma and keeps only the hue. Two definitions separated by
  // lightness alone render identically on the timeline and in the piano roll.
  //
  // 11 and not 12, for two reasons that both cost a round to find: a hex is
  // only 8 bits per channel, so a hue placed exactly 12 apart round-trips to
  // ~11.7; and the app's own shipped accents are already tighter than 12 -
  // Visibility (163.2) against Conveyor (174.5) is 11.3. This is a guard
  // against crowding, not an aspiration the existing palette would fail.
  const MIN_HUE_GAP = 11
  const hued = fixed()
    .map((d) => ({ id: d.id, ...colorToOklch(d.hex)! }))
    .filter((d) => d.c > GREY_FLOOR)
    .sort((a, b) => a.h - b.h)

  for (let i = 0; i < hued.length; i++) {
    const a = hued[i]
    const b = hued[(i + 1) % hued.length]
    const raw = Math.abs(b.h - a.h)
    const gap = raw > 180 ? 360 - raw : raw
    assert.ok(
      gap >= MIN_HUE_GAP,
      `${a.id} (${Math.round(a.h)}°) and ${b.id} (${Math.round(b.h)}°) are ${gap.toFixed(1)}° apart - they will look like the same lane`,
    )
  }
})

test('identity colors sit in a consistent lightness band, so no panel accent reads as dim', () => {
  for (const def of fixed()) {
    const { l } = colorToOklch(def.hex)!
    assert.ok(l > 0.6 && l < 0.92, `${def.id} (${def.hex}) has lightness ${l.toFixed(2)}, outside 0.6-0.92`)
  }
})
