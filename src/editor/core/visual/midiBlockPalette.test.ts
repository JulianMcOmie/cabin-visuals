import assert from 'node:assert/strict'
import test from 'node:test'
import { colorToHsl, midiBlockPalette } from '../../utils/colors'

test('MIDI note previews are lighter than their block surfaces', () => {
  const palette = midiBlockPalette('#3a7694')
  const fill = colorToHsl(palette.fill)!
  const selectedFill = colorToHsl(palette.selectedFill)!
  const note = colorToHsl(palette.note)!
  const repeatedNote = colorToHsl(palette.repeatedNote)!

  assert.ok(note.lightness > selectedFill.lightness)
  assert.ok(repeatedNote.lightness > selectedFill.lightness)
  assert.ok(note.lightness > repeatedNote.lightness)
  assert.ok(selectedFill.lightness > fill.lightness)
})
