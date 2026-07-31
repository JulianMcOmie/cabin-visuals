import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveTrackDisplayColor, resolveTrackIdentityColor } from './trackDisplayColor'
import { AUDIO_TRACK_COLOR } from './trackColors'
import type { Track } from '../types'

const CYCLE_COLOR = '#529af2'

function baseTrack(overrides: Partial<Track>): Track {
  return {
    id: 't1',
    name: 'T',
    type: 'base',
    instrumentId: 'cube',
    color: CYCLE_COLOR,
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
    ...overrides,
  } as Track
}

test('sole color param drives the display color (auto-detect)', () => {
  const stored = baseTrack({ stringParams: { baseColor: '#ff2200' } })
  assert.equal(resolveTrackDisplayColor(stored, { [stored.id]: stored }), '#ff2200')
  // No stored value → the param's declared default
  const fresh = baseTrack({})
  assert.equal(resolveTrackDisplayColor(fresh, { [fresh.id]: fresh }), '#5757db')
})

test('fixed identityColor wins for instruments without a color param', () => {
  const t = baseTrack({ instrumentId: 'bassRipple' })
  assert.equal(resolveTrackDisplayColor(t, { [t.id]: t }), '#5865f2')
})

test('declared param identity follows that param on multi-color instruments', () => {
  const t = baseTrack({ instrumentId: 'filmCard', stringParams: { paperColor: '#2299aa', inkColor: '#111111' } })
  assert.equal(resolveTrackDisplayColor(t, { [t.id]: t }), '#2299aa')
})

test('near-achromatic derived colors fall back to the cycle color', () => {
  // textDisplay's identity param defaults to pure white - hue is meaningless
  const t = baseTrack({ instrumentId: 'textDisplay' })
  assert.equal(resolveTrackDisplayColor(t, { [t.id]: t }), CYCLE_COLOR)
})

test('child lanes wear the owning instrument color via the parent walk', () => {
  const parent = baseTrack({ id: 'p', stringParams: { baseColor: '#00cc88' } })
  const lane = baseTrack({ id: 'lane', type: 'automation', parentId: 'p', color: '#123456' })
  assert.equal(resolveTrackDisplayColor(lane, { p: parent, lane }), '#00cc88')
})

test('audio tracks keep the fixed sapphire identity', () => {
  const t = baseTrack({ type: 'audio' })
  assert.equal(resolveTrackDisplayColor(t, { [t.id]: t }), AUDIO_TRACK_COLOR)
})

// ── Identity color (inspector chrome naming ONE instrument) ─────────────────

test('identity color keeps an achromatic instrument achromatic', () => {
  // The tab is naming this instrument. Sending white to the cycle color made it
  // BLUE (the cycle is seeded from the audio sapphire) and the tab then read as
  // the app accent rather than as Text Display.
  const t = baseTrack({ instrumentId: 'textDisplay' })
  assert.equal(resolveTrackDisplayColor(t, { [t.id]: t }), CYCLE_COLOR)
  assert.equal(resolveTrackIdentityColor(t, { [t.id]: t }), '#ffffff')
})

test('identity color follows the instrument color param, like the display color', () => {
  const t = baseTrack({ stringParams: { baseColor: '#ff3b30' } })
  assert.equal(resolveTrackIdentityColor(t, { [t.id]: t }), '#ff3b30')
})

test('identity color falls back to the cycle when an instrument declares no color', () => {
  const t = baseTrack({ instrumentId: 'kaleidoSolid' })
  assert.equal(resolveTrackIdentityColor(t, { [t.id]: t }), CYCLE_COLOR)
})

test('identity color reaches the owning instrument from a child lane', () => {
  const parent = baseTrack({ id: 'p', instrumentId: 'textDisplay' })
  const lane = baseTrack({ id: 'lane', type: 'mover', parentId: 'p', color: '#123456' })
  assert.equal(resolveTrackIdentityColor(lane, { p: parent, lane }), '#ffffff')
})

test('audio tracks keep the sapphire identity here too', () => {
  const t = baseTrack({ type: 'audio' })
  assert.equal(resolveTrackIdentityColor(t, { [t.id]: t }), AUDIO_TRACK_COLOR)
})

// ── Chain entries with a color of their own ──────────────────────────────────

test('a Colorizer wears its own primary color, not its instrument`s', () => {
  const parent = baseTrack({ id: 'p', stringParams: { baseColor: '#ff2200' } })
  const colorizer = baseTrack({
    id: 'c', type: 'mover', moverId: 'calmHueRotate', parentId: 'p',
    stringParams: { color: '#06d6a0' },
  })
  assert.equal(resolveTrackDisplayColor(colorizer, { p: parent, c: colorizer }), '#06d6a0')
  assert.equal(resolveTrackIdentityColor(colorizer, { p: parent, c: colorizer }), '#06d6a0')
})

test('a Colorizer with nothing picked yet wears the palette`s declared first color', () => {
  const parent = baseTrack({ id: 'p', stringParams: { baseColor: '#ff2200' } })
  const colorizer = baseTrack({ id: 'c', type: 'mover', moverId: 'calmHueRotate', parentId: 'p' })
  assert.equal(resolveTrackDisplayColor(colorizer, { p: parent, c: colorizer }), '#ffd166')
})

test('an achromatic primary sends the Colorizer back to its instrument`s color', () => {
  // Same guard the instruments get: a white flash color says nothing about
  // which voice this is, so the lane family wins again.
  const parent = baseTrack({ id: 'p', stringParams: { baseColor: '#ff2200' } })
  const colorizer = baseTrack({
    id: 'c', type: 'mover', moverId: 'calmHueRotate', parentId: 'p',
    stringParams: { color: '#ffffff' },
  })
  assert.equal(resolveTrackDisplayColor(colorizer, { p: parent, c: colorizer }), '#ff2200')
})

test('movers that declare no color of their own still inherit the instrument', () => {
  const parent = baseTrack({ id: 'p', stringParams: { baseColor: '#ff2200' } })
  const mover = baseTrack({ id: 'm', type: 'mover', moverId: 'motion', parentId: 'p', color: '#123456' })
  assert.equal(resolveTrackDisplayColor(mover, { p: parent, m: mover }), '#ff2200')
})
