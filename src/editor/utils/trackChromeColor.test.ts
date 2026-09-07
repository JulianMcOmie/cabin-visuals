import assert from 'node:assert/strict'
import test from 'node:test'
import { trackChromeColor } from './trackChromeColor'
import { colorToOklch } from './oklch'
import { midiNoteBaseColor } from './midiEditorPalette'

test('white is bright and distinct from gray, while black stays readable', () => {
  const tones = ['#ffffff', '#f8f7f6', '#808080', '#000000'].map(color => colorToOklch(trackChromeColor(color))!)
  assert.ok(tones.every(tone => tone.c < 0.001))
  assert.ok(tones[0].l > 0.97)
  assert.ok(tones[1].l > 0.95)
  assert.ok(tones[0].l - tones[2].l > 0.15)
  assert.ok(tones[2].l - tones[3].l > 0.2)
  assert.ok(tones[3].l >= 0.49)
})

test('colored chrome has more chroma than the previous note palette', () => {
  for (const color of ['#ff6040', '#4080ff', '#20bb80']) {
    assert.ok(colorToOklch(trackChromeColor(color))!.c > colorToOklch(midiNoteBaseColor(color))!.c)
  }
})
