import assert from 'node:assert/strict'
import test from 'node:test'
import { colorToHsl, midiBlockPalette, midiSelectionSpill } from '../../utils/colors'

// The timeline block voice (2026-08-02): resting blocks are dark panes with
// lit notes; the selected block inverts - an ignited body with outshone dark
// notes and no selection ring. These pin the inversions, not exact values.

test('resting blocks: lit notes on a near-black pane', () => {
  const palette = midiBlockPalette('#3a7694')
  const fill = colorToHsl(palette.fill)!
  const note = colorToHsl(palette.note)!
  const repeatedNote = colorToHsl(palette.repeatedNote)!

  assert.ok(fill.lightness < 0.3, 'pane stays dark so the notes carry the light')
  assert.ok(note.lightness > repeatedNote.lightness, 'loop repeats dim')
  assert.ok(repeatedNote.lightness > fill.lightness)
})

test('selected block: dark outshone notes on an ignited body, no ring', () => {
  const palette = midiBlockPalette('#3a7694')
  const note = colorToHsl(palette.note)!
  const selectedNote = colorToHsl(palette.selectedNote)!
  const selectedRepeat = colorToHsl(palette.selectedRepeatedNote)!

  assert.ok(selectedNote.lightness < 0.35, 'notes flip dark against the lit body')
  assert.ok(selectedNote.lightness < note.lightness, 'selection inverts the note contrast')
  assert.ok(selectedRepeat.lightness > selectedNote.lightness, 'repeats dim by LOWER contrast on a bright ground')
  assert.match(palette.selectedBody, /^radial-gradient/, 'body is the star-anatomy gradient')
  assert.ok(!palette.selectedBloom.includes('0 0 0 1px'), 'selection draws light, never a ring')
  assert.ok(palette.selectedBloom.startsWith('inset'), 'the burning rim leads the bloom stack')
})

test('grey tracks stay grey in both states', () => {
  const palette = midiBlockPalette('#808080')
  for (const hex of [palette.fill, palette.note, palette.selectedNote]) {
    const parsed = colorToHsl(hex)!
    assert.equal(parsed.saturation, 0, `${hex} should carry no chroma`)
  }
})

test('selection spill centers its wash on the block', () => {
  const spill = midiSelectionSpill('#3a7694', 150, 100)
  assert.match(spill, /at 150px 50%/)
  assert.match(spill, /ellipse 160px/) // 1.6× the block width - a close wash, not a row-wide flood
})
