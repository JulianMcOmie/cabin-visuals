import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  FLASH_WALL_BASE_PITCH,
  FLASH_WALL_COLOR_MODE,
  FLASH_WALL_LAYOUT,
  flashEnvelopeAt,
  flashGate,
  flashWallGrid,
  resolveZoneFlashes,
  zoneColorHex,
  zoneOfPitch,
  type FlashWallEnvelope,
} from './flashWallCore'
import type { ResolvedNote } from '../core/visual/types'

const ENV: FlashWallEnvelope = { attackSec: 0.1, decaySec: 0.2, sustain: 0.5, releaseSec: 0.4 }

function note(partial: Partial<ResolvedNote>): ResolvedNote {
  return {
    beat: 0,
    blockStartBeat: 0,
    blockEndBeat: 16,
    pitch: FLASH_WALL_BASE_PITCH,
    velocity: 1,
    durationBeats: 1,
    ...partial,
  }
}

describe('flashGate', () => {
  it('ramps linearly through the attack to 1', () => {
    assert.equal(flashGate(ENV, -0.01), 0)
    assert.equal(flashGate(ENV, 0.05), 0.5)
    assert.equal(flashGate(ENV, 0.1), 1)
  })

  it('a zero attack is instantaneous full level', () => {
    assert.equal(flashGate({ ...ENV, attackSec: 0 }, 0), 1)
  })

  it('decays to the sustain level and holds it', () => {
    // End of decay and well beyond both sit at sustain.
    assert.ok(Math.abs(flashGate(ENV, 0.3) - ENV.sustain) < 1e-9)
    assert.equal(flashGate(ENV, 5), ENV.sustain)
    // Mid-decay is between sustain and 1.
    const mid = flashGate(ENV, 0.2)
    assert.ok(mid > ENV.sustain && mid < 1)
  })
})

describe('flashEnvelopeAt', () => {
  it('is silent before the onset and after the release ends', () => {
    assert.equal(flashEnvelopeAt(ENV, -0.1, 1), 0)
    // The exact boundary can leave a float residue (1.4 - 1 < 0.4); silent
    // means indistinguishable from dark, not bit-exact zero.
    assert.ok(flashEnvelopeAt(ENV, 1 + ENV.releaseSec, 1) < 1e-9)
    assert.equal(flashEnvelopeAt(ENV, 10, 1), 0)
  })

  it('releases from wherever the gate had reached', () => {
    // Held long enough to reach sustain: release starts at sustain.
    const justReleased = flashEnvelopeAt(ENV, 1.0001, 1)
    assert.ok(Math.abs(justReleased - ENV.sustain) < 0.01)
    // A stab shorter than the attack releases from its partial attack level.
    const stab = flashEnvelopeAt(ENV, 0.05001, 0.05)
    assert.ok(stab < 0.51 && stab > 0.4)
  })

  it('release decreases monotonically to zero', () => {
    let prev = Infinity
    for (let t = 1.01; t < 1.4; t += 0.05) {
      const v = flashEnvelopeAt(ENV, t, 1)
      assert.ok(v < prev)
      prev = v
    }
  })
})

describe('zoneOfPitch', () => {
  it('walks up from the base pitch and wraps at the zone count', () => {
    assert.equal(zoneOfPitch(FLASH_WALL_BASE_PITCH, 6), 0)
    assert.equal(zoneOfPitch(FLASH_WALL_BASE_PITCH + 5, 6), 5)
    assert.equal(zoneOfPitch(FLASH_WALL_BASE_PITCH + 6, 6), 0)
    assert.equal(zoneOfPitch(FLASH_WALL_BASE_PITCH - 1, 6), 5)
  })
})

describe('flashWallGrid', () => {
  it('lays out columns, rows, and a near-square grid', () => {
    assert.deepEqual(flashWallGrid(6, FLASH_WALL_LAYOUT.columns), { cols: 6, rows: 1 })
    assert.deepEqual(flashWallGrid(6, FLASH_WALL_LAYOUT.rows), { cols: 1, rows: 6 })
    assert.deepEqual(flashWallGrid(6, FLASH_WALL_LAYOUT.grid), { cols: 3, rows: 2 })
    assert.deepEqual(flashWallGrid(7, FLASH_WALL_LAYOUT.grid), { cols: 3, rows: 3 })
    assert.deepEqual(flashWallGrid(4, FLASH_WALL_LAYOUT.grid), { cols: 2, rows: 2 })
  })
})

describe('resolveZoneFlashes', () => {
  const levels: number[] = []
  const pitches: number[] = []

  it('lights the zone of a sounding note and reports its pitch', () => {
    // 120bpm: secPerBeat 0.5. Note at beat 0, probed at beat 0.5 = 0.25s in.
    resolveZoneFlashes([note({ pitch: FLASH_WALL_BASE_PITCH + 2 })], 0.5, 0.5, 6, ENV, levels, pitches)
    assert.ok(levels[2] > 0)
    assert.equal(pitches[2], FLASH_WALL_BASE_PITCH + 2)
    for (const z of [0, 1, 3, 4, 5]) assert.equal(levels[z], 0)
    assert.equal(pitches[0], -1)
  })

  it('overlapping notes on one zone combine by max, not sum', () => {
    const a = note({ beat: 0 })
    const b = note({ beat: 0.1 })
    resolveZoneFlashes([a, b], 0.5, 0.5, 6, ENV, levels, pitches)
    const combined = levels[0]
    resolveZoneFlashes([a], 0.5, 0.5, 6, ENV, levels, pitches)
    const aAlone = levels[0]
    resolveZoneFlashes([b], 0.5, 0.5, 6, ENV, levels, pitches)
    const bAlone = levels[0]
    assert.ok(Math.abs(combined - Math.max(aAlone, bAlone)) < 1e-9)
  })

  it('velocity scales the peak with a floor for quiet notes', () => {
    const env = { ...ENV, attackSec: 0 }
    resolveZoneFlashes([note({ velocity: 127 })], 0, 0.5, 6, env, levels, pitches)
    const loud = levels[0]
    resolveZoneFlashes([note({ velocity: 10 })], 0, 0.5, 6, env, levels, pitches)
    const quiet = levels[0]
    assert.equal(loud, 1)
    assert.ok(quiet > 0.2 && quiet < loud)
  })

  it('a finished note leaves its zone dark again', () => {
    resolveZoneFlashes([note({ beat: 0, durationBeats: 1 })], 4, 0.5, 6, ENV, levels, pitches)
    assert.equal(levels[0], 0)
    assert.equal(pitches[0], -1)
  })
})

describe('zoneColorHex', () => {
  it('solid mode passes the base through untouched', () => {
    assert.equal(zoneColorHex('#ff8800', FLASH_WALL_COLOR_MODE.solid, 3, 6, 64), '#ff8800')
  })

  it('spectrum mode gives distinct hues per zone', () => {
    const colors = new Set(
      [0, 1, 2, 3, 4, 5].map((z) => zoneColorHex('#ff0000', FLASH_WALL_COLOR_MODE.spectrum, z, 6, -1)),
    )
    assert.equal(colors.size, 6)
    // Zone 0 keeps the base hue.
    assert.equal(zoneColorHex('#ff0000', FLASH_WALL_COLOR_MODE.spectrum, 0, 6, -1), '#ff0000')
  })

  it('pitch mode follows the pitch class and falls back to base while dark', () => {
    const c = zoneColorHex('#ff0000', FLASH_WALL_COLOR_MODE.pitch, 0, 6, FLASH_WALL_BASE_PITCH)
    const octaveUp = zoneColorHex('#ff0000', FLASH_WALL_COLOR_MODE.pitch, 0, 6, FLASH_WALL_BASE_PITCH + 12)
    assert.equal(c, octaveUp)
    assert.equal(zoneColorHex('#ff0000', FLASH_WALL_COLOR_MODE.pitch, 0, 6, -1), '#ff0000')
  })
})
