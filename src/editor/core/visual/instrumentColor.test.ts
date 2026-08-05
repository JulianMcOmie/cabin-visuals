import assert from 'node:assert/strict'
import test from 'node:test'
import { Color } from 'three'
import { colorToOklch } from '../../utils/oklch'
import { applyColorShiftToInstrumentParams } from './instrumentColor'

const params = [
  { key: 'color', defaultColor: '#25dfff' },
  { key: 'strokeColor', defaultColor: '#000000' },
]

test('copy hue changes declared instrument color params, including schema defaults', () => {
  const output: Record<string, string> = {}
  applyColorShiftToInstrumentParams(
    { label: 'LASER' },
    params,
    { hue: 0.25, saturation: 0, lightness: 0, tint: null, tintAmount: 0 },
    output,
    new Color(),
    new Color(),
  )

  const expected = `#${new Color('#25dfff').offsetHSL(0.25, 0, 0).getHexString()}`
  assert.equal(output.color, expected)
  assert.equal(output.label, 'LASER')
})

test('stored colors are shifted while non-color and intentionally empty params are preserved', () => {
  const output: Record<string, string> = { stale: 'remove me' }
  applyColorShiftToInstrumentParams(
    { color: '#ff0000', strokeColor: '', geometry: 'cube' },
    params,
    { hue: -1 / 3, saturation: 0, lightness: 0, tint: null, tintAmount: 0 },
    output,
    new Color(),
    new Color(),
  )

  assert.equal(output.color, `#${new Color('#ff0000').offsetHSL(-1 / 3, 0, 0).getHexString()}`)
  assert.equal(output.strokeColor, '')
  assert.equal(output.geometry, 'cube')
  assert.equal('stale' in output, false)
})

// ── The tint mix ─────────────────────────────────────────────────────────────

function mix(source: string, tint: string, tintAmount: number, tintPerceptual?: boolean): string {
  const output: Record<string, string> = {}
  applyColorShiftToInstrumentParams(
    { color: source },
    [{ key: 'color', defaultColor: source }],
    { hue: 0, saturation: 0, lightness: 0, tint, tintAmount, tintPerceptual },
    output,
    new Color(),
    new Color(),
  )
  return output.color
}

test('a full-strength flash lands exactly on the picked color, either way', () => {
  for (const perceptual of [false, true]) {
    assert.equal(mix('#2c3760', '#ffd166', 1, perceptual), '#ffd166')
  }
})

test('a partial flash moves a proportional amount, instead of leaping in brightness', () => {
  // This is the whole point of the flag, and the reason a flash used to read as
  // "it just goes white". A straight channel lerp runs in LINEAR light, where a
  // quarter-strength flash from a dark object toward a bright color is already
  // most of the way up in perceived brightness - so the object blows out long
  // before it arrives at the color, and the scene's bloom threshold finishes the
  // job. OKLab's L is perceived lightness, so a quarter of the way really looks
  // a quarter of the way.
  const dark = colorToOklch('#2c3760')!
  const gold = colorToOklch('#ffd166')!
  for (const t of [0.25, 0.5, 0.75]) {
    const expected = dark.l + (gold.l - dark.l) * t
    const perceptual = colorToOklch(mix('#2c3760', '#ffd166', t, true))!
    const linear = colorToOklch(mix('#2c3760', '#ffd166', t))!
    assert.ok(
      Math.abs(perceptual.l - expected) < 0.01,
      `t=${t}: perceptual L ${perceptual.l.toFixed(3)} should track ${expected.toFixed(3)}`,
    )
    assert.ok(
      linear.l > perceptual.l + 0.05,
      `t=${t}: linear L ${linear.l.toFixed(3)} should overshoot ${perceptual.l.toFixed(3)}`,
    )
  }
})

test('a partial flash toward a NEARBY color stays that color, rather than washing out', () => {
  // The complaint that started this: pick a color close to the object's own and
  // the flash should read as that color, not as a brighter, paler version of
  // nothing in particular. Neighbouring hues never cross the neutral axis, so
  // the perceptual walk holds its chroma the whole way.
  const from = colorToOklch('#2c3760')!
  const to = colorToOklch('#4cc9f0')!
  const perceptual = colorToOklch(mix('#2c3760', '#4cc9f0', 0.5, true))!
  const linear = colorToOklch(mix('#2c3760', '#4cc9f0', 0.5))!
  const between = (h: number) => h > Math.min(from.h, to.h) - 1 && h < Math.max(from.h, to.h) + 1
  assert.ok(between(perceptual.h), `hue ${perceptual.h.toFixed(0)} left the arc between the endpoints`)
  assert.ok(
    perceptual.c > Math.min(from.c, to.c) * 0.9,
    `chroma ${perceptual.c.toFixed(3)} collapsed below both endpoints`,
  )
  assert.ok(
    linear.l > perceptual.l + 0.05,
    `linear L ${linear.l.toFixed(3)} should still overshoot ${perceptual.l.toFixed(3)}`,
  )
})

test('the mix is inert at zero and never touches a null tint', () => {
  assert.equal(mix('#2c3760', '#ffd166', 0, true), '#2c3760')
  const output: Record<string, string> = {}
  applyColorShiftToInstrumentParams(
    { color: '#2c3760' },
    [{ key: 'color', defaultColor: '#2c3760' }],
    { hue: 0, saturation: 0, lightness: 0, tint: null, tintAmount: 1, tintPerceptual: true },
    output,
    new Color(),
    new Color(),
  )
  assert.equal(output.color, '#2c3760')
})

test('an omitted tintPerceptual keeps the historic straight lerp', () => {
  // Every definition written before the flag leaves it undefined, and their
  // saved projects must not change appearance.
  const scratch = new Color('#2c3760').lerp(new Color('#ffd166'), 0.5)
  assert.equal(mix('#2c3760', '#ffd166', 0.5), `#${scratch.getHexString()}`)
})
