import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import { paramAtBeat } from './instrumentFrame'
import type { ObjectState, ResolvedAutomation } from './types'

// paramAtBeat answers "what was this param at some OTHER beat" - the primitive
// that lets a word latch its placement at the beat it was placed, instead of
// following the live automated value while it fades.

function stateWith(automations: ResolvedAutomation[], params: Record<string, number>): ObjectState {
  return {
    beat: 8,
    secPerBeat: 0.5,
    beatsPerBar: 4,
    params,
    baseParams: params,
    automations,
    energy: 0,
    blackedOut: false,
    world: new Matrix4(),
    opacity: 1,
    stringParams: {},
    abilityEvents: new Map(),
    notes: [],
    activeNotes: [],
  }
}

const ramp: ResolvedAutomation = {
  param: 'posX',
  mode: 'linear',
  keyframes: [
    { beat: 0, value: -1 },
    { beat: 4, value: 1 },
  ],
}

test('a param with no lane falls back to its base value', () => {
  const state = stateWith([], { posX: 0.25 })
  assert.equal(paramAtBeat(state, 'posX', 0), 0.25)
  assert.equal(paramAtBeat(state, 'posX', 99), 0.25)
  // An unknown param is 0, not undefined - callers do arithmetic on this.
  assert.equal(paramAtBeat(state, 'nope', 3), 0)
})

test('an automated param is sampled at the beat asked for, not the current one', () => {
  // state.beat is 8 - well past the ramp - so reading params would give the
  // held end value for every word. The point is that it does not.
  const state = stateWith([ramp], { posX: 0 })
  assert.equal(paramAtBeat(state, 'posX', 0), -1)
  assert.equal(paramAtBeat(state, 'posX', 2), 0)
  assert.equal(paramAtBeat(state, 'posX', 4), 1)
})

test('two words placed at different beats latch different values', () => {
  const state = stateWith([ramp], { posX: 0 })
  const firstWord = paramAtBeat(state, 'posX', 1)
  const secondWord = paramAtBeat(state, 'posX', 3)
  assert.notEqual(firstWord, secondWord)
  assert.equal(firstWord, -0.5)
  assert.equal(secondWord, 0.5)
  // And the first word's value does not drift as the playhead advances: the
  // sample depends only on the beat passed in.
  assert.equal(paramAtBeat({ ...state, beat: 40 }, 'posX', 1), firstWord)
})

test('sampling is a pure function of beat, so scrub reproduces playback', () => {
  const state = stateWith([ramp], { posX: 0 })
  const forwards = [0, 1, 2, 3, 4].map((b) => paramAtBeat(state, 'posX', b))
  const backwards = [4, 3, 2, 1, 0].map((b) => paramAtBeat(state, 'posX', b)).reverse()
  assert.deepEqual(forwards, backwards)
})

test('a lane for another param does not leak into this one', () => {
  const state = stateWith([ramp], { posX: 0, posY: 0.75 })
  assert.equal(paramAtBeat(state, 'posY', 2), 0.75)
})
