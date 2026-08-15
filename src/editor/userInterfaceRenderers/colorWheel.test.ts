import assert from 'node:assert/strict'
import test from 'node:test'
import { hexToHsv, hsvToHex } from './colorWheel'

// The wheel's HSV↔hex math is the one piece of this file every panel's color
// flows through, and it shipped with the LAST SEXTANT WRONG for months: 300°+
// used the first sextant's [c, x, 0] instead of [c, 0, x], so every magenta or
// pink pick came out orange (hue 330 → #ff8000 instead of #ff0080). The picker
// LOOKED right - the ring is a CSS conic-gradient - only the committed value
// was wrong, which is why it survived. These pin all six sextants exactly.

test('hsvToHex lands every sextant on its exact primary/secondary mix', () => {
  const fullOf = (h: number) => hsvToHex(h, 1, 1)
  assert.equal(fullOf(0), '#ff0000')
  assert.equal(fullOf(30), '#ff8000', 'red→yellow')
  assert.equal(fullOf(90), '#80ff00', 'yellow→green')
  assert.equal(fullOf(150), '#00ff80', 'green→cyan')
  assert.equal(fullOf(210), '#0080ff', 'cyan→blue')
  assert.equal(fullOf(270), '#8000ff', 'blue→magenta')
  // The sextant that was broken: magenta→red, blue channel falling, not green.
  assert.equal(fullOf(300), '#ff00ff')
  assert.equal(fullOf(330), '#ff0080', 'hot pink, not orange')
  assert.equal(fullOf(359), '#ff0004')
})

test('hex→HSV→hex round-trips across the whole wheel', () => {
  for (let h = 0; h < 360; h += 7) {
    for (const [s, v] of [[1, 1], [0.6, 0.85], [0.25, 0.4]] as const) {
      const hex = hsvToHex(h, s, v)
      const back = hexToHsv(hex)
      const again = hsvToHex(back.h, back.s, back.v)
      // 8-bit quantization allows ±1 per channel, so compare the re-emitted
      // hex rather than the floats.
      assert.equal(again, hex, `h=${h} s=${s} v=${v}`)
    }
  }
})

test('achromatic and black inputs stay put', () => {
  assert.equal(hsvToHex(123, 0, 1), '#ffffff')
  assert.equal(hsvToHex(300, 0, 0.5), '#808080')
  assert.equal(hsvToHex(45, 1, 0), '#000000')
  assert.deepEqual(hexToHsv('#000000'), { h: 0, s: 0, v: 0 })
})
