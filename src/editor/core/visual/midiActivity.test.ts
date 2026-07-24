import assert from 'node:assert/strict'
import test from 'node:test'
import {
  evaluateMidiActivity,
  MIDI_ACTIVITY_ATTACK_BEATS,
  midiActivityTriggersForBlock,
  type MidiActivityTrigger,
} from './midiActivity'
import type { Block } from '../../types'

const trigger = (beat: number, velocity = 127): MidiActivityTrigger => ({ beat, velocity })

test('MIDI activity is silent before a note and naturally falls away afterward', () => {
  const triggers = [trigger(2)]
  assert.equal(evaluateMidiActivity(triggers, 1.999), 0)
  assert.ok(evaluateMidiActivity(triggers, 2 + MIDI_ACTIVITY_ATTACK_BEATS) > 0)
  assert.ok(evaluateMidiActivity(triggers, 2.3) > evaluateMidiActivity(triggers, 2.8))
  assert.equal(evaluateMidiActivity(triggers, 4), 0)
})

test('MIDI activity has a fast smooth attack rather than a hard visual step', () => {
  const triggers = [trigger(0)]
  const early = evaluateMidiActivity(triggers, MIDI_ACTIVITY_ATTACK_BEATS * 0.25)
  const middle = evaluateMidiActivity(triggers, MIDI_ACTIVITY_ATTACK_BEATS * 0.5)
  const peak = evaluateMidiActivity(triggers, MIDI_ACTIVITY_ATTACK_BEATS)
  assert.ok(early > 0)
  assert.ok(early < middle)
  assert.ok(middle < peak)
})

test('MIDI activity keeps a readable musical tail after the initial flash', () => {
  const triggers = [trigger(0)]
  const peak = evaluateMidiActivity(triggers, MIDI_ACTIVITY_ATTACK_BEATS)
  const tail = evaluateMidiActivity(triggers, 0.3)
  assert.ok(tail > 0.15)
  assert.ok(tail < peak)
})

test('simultaneous and overlapping notes stack through soft compression', () => {
  const one = evaluateMidiActivity([trigger(0)], MIDI_ACTIVITY_ATTACK_BEATS)
  const chord = evaluateMidiActivity(
    [trigger(0), trigger(0), trigger(0), trigger(0)],
    MIDI_ACTIVITY_ATTACK_BEATS,
  )
  const rolling = evaluateMidiActivity(
    [trigger(0), trigger(0.1), trigger(0.2)],
    0.2 + MIDI_ACTIVITY_ATTACK_BEATS,
  )
  assert.ok(chord > one)
  assert.ok(rolling > one)
  assert.ok(chord < 1)
})

test('0..1 and 0..127 velocity forms produce the same activity', () => {
  const at = MIDI_ACTIVITY_ATTACK_BEATS
  assert.equal(evaluateMidiActivity([trigger(0, 1)], at), evaluateMidiActivity([trigger(0, 127)], at))
})

test('block triggers are absolute, ordered, clipped, and expanded through loops', () => {
  const block: Block = {
    id: 'loop',
    startBar: 2,
    durationBars: 1,
    loop: true,
    loopLengthBars: 0.5,
    notes: [
      { id: 'later', startBeat: 1, durationBeats: 0.25, pitch: 64, velocity: 80 },
      { id: 'earlier', startBeat: 0, durationBeats: 0.25, pitch: 60, velocity: 100 },
    ],
  }
  const triggers = midiActivityTriggersForBlock(block, 4)
  assert.deepEqual(triggers.map(({ beat }) => beat), [8, 9, 10, 11])
  assert.deepEqual(
    triggers.map(({ previewKey }) => previewKey),
    ['earlier:0', 'later:0', 'earlier:1', 'later:1'],
  )
})
