import assert from 'node:assert/strict'
import test from 'node:test'
import { COLOR_FILTER_ROWS, colorFiltersInstrument, resolveActiveColorFilter } from '../../instruments/ColorFilters'
import type { ResolvedNote } from './types'

function note(beat: number, pitch: number, velocity = 1): ResolvedNote {
  return { beat, blockStartBeat: 0, blockEndBeat: 16, pitch, velocity, durationBeats: 2 }
}

function state(activeNotes: ResolvedNote[], overrides: Partial<Parameters<typeof resolveActiveColorFilter>[0]> = {}) {
  return {
    activeNotes,
    params: { amount: 1 },
    opacity: 1,
    blackedOut: false,
    beat: 4,
    ...overrides,
  }
}

test('color filters expose distinct labeled MIDI rows', () => {
  assert.equal(colorFiltersInstrument.id, 'colorFilters')
  assert.equal(colorFiltersInstrument.name, 'Color Filters')
  assert.deepEqual(COLOR_FILTER_ROWS.map(({ pitch, label }) => ({ pitch, label })), [
    { pitch: 72, label: 'Invert' },
    { pitch: 71, label: 'Solarize' },
    { pitch: 70, label: 'Remap · RGB → GBR' },
    { pitch: 69, label: 'Remap · RGB → BRG' },
    { pitch: 68, label: 'Heat map' },
    { pitch: 67, label: 'Neon duotone' },
    { pitch: 66, label: 'Posterize' },
    { pitch: 65, label: 'Luma rainbow' },
    { pitch: 64, label: 'Hue cycle' },
  ])
})

test('latest held recognized note selects the filter', () => {
  assert.deepEqual(resolveActiveColorFilter(state([
    note(1, 72),
    note(2, 68),
    note(3, 10),
  ])), { mode: 5, amount: 1, beat: 4 })
})

test('velocity, Amount, and track opacity compose into filter strength', () => {
  const active = resolveActiveColorFilter(state(
    [note(1, 72, 0.5)],
    { params: { amount: 0.8 }, opacity: 0.5 },
  ))
  assert.equal(active?.amount, 0.2)
})

test('no held filter, zero strength, or a blacked-out track is inactive', () => {
  assert.equal(resolveActiveColorFilter(state([])), null)
  assert.equal(resolveActiveColorFilter(state([note(1, 72)], { params: { amount: 0 } })), null)
  assert.equal(resolveActiveColorFilter(state([note(1, 72)], { blackedOut: true })), null)
})
