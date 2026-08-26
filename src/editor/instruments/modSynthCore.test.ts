import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  DEFAULT_SYNTH_MODS, MIN_VOICE_BEATS, computeSynthVoice, mkSynthMod,
  sampleSynthMod, synthModSpanBeats, synthVoiceSpanBeats,
  type SynthVoiceChannels,
} from './modSynthCore'
import type { SynthMod } from '../types'

const chans = (): SynthVoiceChannels => ({ size: 0, posX: 0, posY: 0, posZ: 0, alpha: 0, hue: 0, rotZ: 0 })

const adsrMod = (over: Partial<SynthMod> = {}): SynthMod => ({
  ...mkSynthMod('size', 't'),
  attack: 0.2, decay: 0.4, sustain: 0.5, release: 0.5,
  ...over,
})

describe('modSynthCore: ADSR sampling', () => {
  it('gate: rises over attack, decays to sustain, holds to note end, releases after', () => {
    const m = adsrMod()
    assert.equal(sampleSynthMod(m, 0, 2), 0)
    assert.ok(Math.abs(sampleSynthMod(m, 0.2, 2) - 1) < 1e-9, 'attack peak')
    assert.ok(Math.abs(sampleSynthMod(m, 0.6, 2) - 0.5) < 1e-9, 'decay lands on sustain')
    assert.ok(Math.abs(sampleSynthMod(m, 1.5, 2) - 0.5) < 1e-9, 'sustain holds')
    assert.ok(Math.abs(sampleSynthMod(m, 2.25, 2) - 0.25) < 1e-9, 'release halfway')
    assert.equal(sampleSynthMod(m, 2.5, 2), 0)
    assert.ok(Math.abs(synthModSpanBeats(m, 2) - 2.5) < 1e-9)
  })

  it('gate on a short note releases from the CURRENT level, not sustain', () => {
    const m = adsrMod()
    // Note ends at 0.1, mid-attack: level there is 0.5, and release decays it.
    const atRelease = sampleSynthMod(m, 0.1 + 0.25, 0.1)
    assert.ok(Math.abs(atRelease - 0.25) < 1e-9)
  })

  it('oneshot: fixed a+d+r flight, note duration ignored', () => {
    const m = adsrMod({ life: 'oneshot' })
    assert.ok(Math.abs(synthModSpanBeats(m, 8) - 1.1) < 1e-9)
    assert.ok(Math.abs(sampleSynthMod(m, 0.2, 8) - 1) < 1e-9)
    // Release starts right after decay - no sustain shelf.
    assert.ok(Math.abs(sampleSynthMod(m, 0.85, 8) - 0.25) < 1e-9)
    assert.equal(sampleSynthMod(m, 1.2, 8), 0)
    assert.equal(sampleSynthMod(m, 0.2, 8), sampleSynthMod(m, 0.2, 0.01), 'duration-independent')
  })

  it('loop: repeats its cycle while the note sounds, silent after', () => {
    const m = adsrMod({ life: 'loop' })
    const cycle = 0.2 + 0.4 + 0.5
    assert.equal(sampleSynthMod(m, 0.3, 4), sampleSynthMod(m, 0.3 + cycle, 4))
    assert.equal(sampleSynthMod(m, 4.01, 4), 0)
  })
})

describe('modSynthCore: bezier and points', () => {
  it('bezier: pinned at 0 at both ends, positive inside, spans BEATS on oneshot', () => {
    const m = adsrMod({ shape: 'bezier', life: 'oneshot', beats: 2 })
    assert.equal(sampleSynthMod(m, 0, 8), 0)
    assert.ok(sampleSynthMod(m, 0.6, 8) > 0.3, 'mid-flight lifts')
    assert.equal(sampleSynthMod(m, 2, 8), 0)
    assert.ok(Math.abs(synthModSpanBeats(m, 8) - 2) < 1e-9)
  })

  it('bezier gate: stretches over the note', () => {
    const m = adsrMod({ shape: 'bezier', life: 'gate' })
    const half = sampleSynthMod(m, 1, 2)
    const halfLong = sampleSynthMod(m, 2, 4)
    assert.ok(Math.abs(half - halfLong) < 1e-9, 'same normalized position, same value')
  })

  it('points: the curve passes exactly through its knots', () => {
    const m = adsrMod({ shape: 'points', life: 'oneshot', beats: 1 })
    for (const p of m.points) {
      const v = sampleSynthMod(m, p.x * 1, 8)
      assert.ok(Math.abs(v - p.y) < 1e-9, `knot (${p.x}, ${p.y}) got ${v}`)
    }
  })
})

describe('modSynthCore: voices', () => {
  it('voice span is the longest enabled modulator; disabled ones are ignored', () => {
    const long = adsrMod({ shape: 'bezier', life: 'oneshot', beats: 6 })
    const short = adsrMod()
    assert.ok(Math.abs(synthVoiceSpanBeats([short, long], 1) - 6) < 1e-9)
    assert.ok(Math.abs(synthVoiceSpanBeats([short, { ...long, enabled: false }], 1) - 1.5) < 1e-9)
  })

  it('a bare rack flies for the note itself, floored', () => {
    assert.ok(Math.abs(synthVoiceSpanBeats([], 2) - 2) < 1e-9)
    assert.equal(synthVoiceSpanBeats([], 0), MIN_VOICE_BEATS)
  })

  it('unmodulated channels sit at neutral: size 1, opacity 1, home position', () => {
    const out = computeSynthVoice([], 0.5, 1, 1, 60, chans())
    assert.equal(out.size, 1)
    assert.equal(out.alpha, 1)
    assert.equal(out.posX, 0)
    assert.equal(out.hue, 0)
  })

  it('velocity sensitivity scales the value; zero sensitivity ignores velocity', () => {
    const m = { ...adsrMod({ target: 'posY' }), amount: 2, velocity: 1, keyTracking: 0 }
    const soft = computeSynthVoice([m], 0.2, 2, 0.25, 60, chans()).posY
    const hard = computeSynthVoice([m], 0.2, 2, 1, 60, chans()).posY
    assert.ok(Math.abs(soft - hard * 0.25) < 1e-9)
    const deaf = { ...m, velocity: 0 }
    assert.equal(computeSynthVoice([deaf], 0.2, 2, 0.25, 60, chans()).posY, hard)
  })

  it('key tracking silences the bottom of the range and passes the top', () => {
    const m = { ...adsrMod({ target: 'posY' }), amount: 2, velocity: 0, keyTracking: 1 }
    assert.equal(computeSynthVoice([m], 0.2, 2, 1, 36, chans()).posY, 0)
    const top = computeSynthVoice([m], 0.2, 2, 1, 84, chans()).posY
    assert.ok(Math.abs(top - 2) < 1e-9)
  })

  it('the starter rack is frozen and answers a note with a finished voice', () => {
    assert.equal(DEFAULT_SYNTH_MODS.length, 3)
    assert.ok(Object.isFrozen(DEFAULT_SYNTH_MODS))
    const mid = computeSynthVoice(DEFAULT_SYNTH_MODS, 0.3, 1, 1, 60, chans())
    assert.ok(mid.size > 0, 'size swell live')
    assert.ok(mid.alpha > 0, 'opacity gate live')
  })
})
