import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveTrackDisplayColor, resolveTrackIdentityColor } from './trackDisplayColor'
import { AUDIO_TRACK_COLOR } from './trackColors'
import { IMPACT_PULSE_COLOR, VISIBILITY_COLOR } from '../core/visualCopies/identityColors'
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
  assert.equal(resolveTrackDisplayColor(stored), '#ff2200')
  // No stored value → the param's declared default
  assert.equal(resolveTrackDisplayColor(baseTrack({})), '#5757db')
})

test('fixed identityColor wins for instruments without a color param', () => {
  assert.equal(resolveTrackDisplayColor(baseTrack({ instrumentId: 'bassRipple' })), '#5865f2')
})

test('declared param identity follows that param on multi-color instruments', () => {
  const t = baseTrack({ instrumentId: 'filmCard', stringParams: { paperColor: '#2299aa', inkColor: '#111111' } })
  assert.equal(resolveTrackDisplayColor(t), '#2299aa')
})

test('near-achromatic derived colors fall back to the cycle color', () => {
  // textDisplay's identity param defaults to pure white - hue is meaningless
  assert.equal(resolveTrackDisplayColor(baseTrack({ instrumentId: 'textDisplay' })), CYCLE_COLOR)
})

test('audio tracks keep the fixed sapphire identity', () => {
  assert.equal(resolveTrackDisplayColor(baseTrack({ type: 'audio' })), AUDIO_TRACK_COLOR)
})

// ── Independent child lanes (2026-07-31) ───────────────────────────────────
// Lanes used to inherit the owning instrument's color via a walk up to the
// nearest base ancestor. They no longer do: a chain row wears its definition's
// color and a param lane wears its own cycle color, so the parent's identity
// must NOT leak into either.

test('a mover wears its definition color, not its parent instrument', () => {
  const parent = baseTrack({ id: 'p', stringParams: { baseColor: '#00cc88' } })
  const lane = baseTrack({ id: 'lane', type: 'mover', moverId: 'impactPulse', parentId: 'p', color: '#123456' })
  assert.equal(resolveTrackDisplayColor(lane), IMPACT_PULSE_COLOR)
  // The inspector's tab rail agrees with the timeline.
  assert.equal(resolveTrackIdentityColor(lane), IMPACT_PULSE_COLOR)
  // and the parent keeps its own
  assert.equal(resolveTrackDisplayColor(parent), '#00cc88')
})

test('every mover has its own color - two under one instrument differ', () => {
  const pulse = baseTrack({ id: 'a', type: 'mover', moverId: 'impactPulse', parentId: 'p' })
  const visibility = baseTrack({ id: 'b', type: 'mover', moverId: 'visibility', parentId: 'p' })
  assert.equal(resolveTrackDisplayColor(pulse), IMPACT_PULSE_COLOR)
  assert.equal(resolveTrackDisplayColor(visibility), VISIBILITY_COLOR)
  assert.notEqual(resolveTrackDisplayColor(pulse), resolveTrackDisplayColor(visibility))
})

test('splitters resolve through splitterId, not moverId', () => {
  const lane = baseTrack({ id: 'lane', type: 'splitter', splitterId: 'grid', parentId: 'p', color: '#123456' })
  assert.notEqual(resolveTrackDisplayColor(lane), '#123456')
})

test('a param lane wears its own cycle color rather than its parent instrument', () => {
  const parent = baseTrack({ id: 'p', stringParams: { baseColor: '#00cc88' } })
  const lane = baseTrack({ id: 'lane', type: 'automation', parentId: 'p', color: '#123456' })
  assert.equal(resolveTrackDisplayColor(lane), '#123456')
  assert.equal(resolveTrackIdentityColor(lane), '#123456')
  void parent
})

test('an unresolvable mover id falls through to the cycle color', () => {
  const lane = baseTrack({ id: 'lane', type: 'mover', moverId: 'nope.legacy', parentId: 'p', color: '#123456' })
  assert.equal(resolveTrackDisplayColor(lane), '#123456')
})

// ── Identity color (inspector chrome naming ONE instrument) ─────────────────

test('identity color keeps an achromatic instrument achromatic', () => {
  // The tab is naming this instrument. Sending white to the cycle color made it
  // BLUE (the cycle is seeded from the audio sapphire) and the tab then read as
  // the app accent rather than as Text Display.
  const t = baseTrack({ instrumentId: 'textDisplay' })
  assert.equal(resolveTrackDisplayColor(t), CYCLE_COLOR)
  assert.equal(resolveTrackIdentityColor(t), '#ffffff')
})

test('identity color follows the instrument color param, like the display color', () => {
  assert.equal(resolveTrackIdentityColor(baseTrack({ stringParams: { baseColor: '#ff3b30' } })), '#ff3b30')
})

test('identity color falls back to the cycle when an instrument declares no color', () => {
  assert.equal(resolveTrackIdentityColor(baseTrack({ instrumentId: 'kaleidoSolid' })), CYCLE_COLOR)
})

test('audio tracks keep the sapphire identity here too', () => {
  assert.equal(resolveTrackIdentityColor(baseTrack({ type: 'audio' })), AUDIO_TRACK_COLOR)
})

// ── Chain entries that follow a live color param ────────────────────────────
// The Colorizer's subject IS a color the user picked, so it declares
// `{ param: 'color' }` instead of taking a constant from identityColors.ts.

test('a Colorizer wears its own primary color', () => {
  const colorizer = baseTrack({
    id: 'c', type: 'mover', moverId: 'calmHueRotate', parentId: 'p',
    stringParams: { color: '#06d6a0' },
  })
  assert.equal(resolveTrackDisplayColor(colorizer), '#06d6a0')
  assert.equal(resolveTrackIdentityColor(colorizer), '#06d6a0')
})

test('a Colorizer with nothing picked yet wears the palette`s declared first color', () => {
  const colorizer = baseTrack({ id: 'c', type: 'mover', moverId: 'calmHueRotate', parentId: 'p' })
  assert.equal(resolveTrackDisplayColor(colorizer), '#ffd166')
})

test('an achromatic primary sends the Colorizer to its own cycle color', () => {
  // Same guard the instruments get - a white flash color says nothing about
  // which lane this is - but the fallback is the lane's OWN cycle color now,
  // since nothing inherits from the parent instrument any more.
  const colorizer = baseTrack({
    id: 'c', type: 'mover', moverId: 'calmHueRotate', parentId: 'p',
    color: '#123456', stringParams: { color: '#ffffff' },
  })
  assert.equal(resolveTrackDisplayColor(colorizer), '#123456')
})
