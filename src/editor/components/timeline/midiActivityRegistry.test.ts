import test from 'node:test'
import assert from 'node:assert/strict'
import { registerMidiActivityBlock, updateMidiActivityAtBeat } from './midiActivityRegistry'
import { evaluateMidiActivity, midiActivityTriggersForBlock } from '../../core/visual/midiActivity'
import type { Block } from '../../types'

class Style {
  opacity = ''
  willChange = ''
  writes = 0
  values = new Map<string, string>()
  setProperty(key: string, value: string) { this.writes++; this.values.set(key, value) }
  removeProperty(key: string) {
    if (key === 'will-change') this.willChange = ''
    this.values.delete(key)
  }
}
function fixture(id: string, count = 4) {
  const block: Block = { id, startBar: 0, durationBars: count, loop: false,
    notes: Array.from({ length: count }, (_, i) => ({ id: `${id}-${i}`, startBeat: i, durationBeats: 0.5, pitch: 60, velocity: 100 })) }
  const notes = block.notes.map(n => ({ dataset: { midiPreviewKey: `${n.id}:0` }, style: new Style() }))
  const pulses = [{ style: new Style() }, { style: new Style() }]
  const element = { style: new Style(), querySelectorAll: (selector: string) => selector === '[data-midi-preview-key]' ? notes : pulses }
  return { block, notes, pulses, element, register: (muted = false) => registerMidiActivityBlock(block, 4, element as unknown as HTMLDivElement, muted) }
}

test('pulse opacity keeps the original envelope without invalidating the block subtree', () => {
  updateMidiActivityAtBeat(0, false)
  const f = fixture('pulse')
  const dispose = f.register()
  try {
    updateMidiActivityAtBeat(0.2, true)
    const expected = Math.min(0.5, evaluateMidiActivity(midiActivityTriggersForBlock(f.block, 4), 0.2) * 0.65).toFixed(4)
    assert.equal(f.pulses[0].style.opacity, expected)
    assert.equal(f.pulses[1].style.opacity, expected)
    assert.equal(f.pulses[0].style.willChange, 'opacity')
    assert.equal(f.element.style.writes, 0)
    assert.ok(Number(f.notes[0].style.values.get('--midi-note-activity')) > 0)
    updateMidiActivityAtBeat(0, false)
    assert.equal(f.pulses[0].style.opacity, '0.0000')
    assert.equal(f.pulses[0].style.willChange, '')
    assert.equal(f.notes[0].style.values.get('--midi-note-activity') ?? '0.0000', '0.0000')
  } finally { dispose(); updateMidiActivityAtBeat(0, false) }
})

test('starting playback does not rewrite thousands of silent preview notes', () => {
  const f = fixture('silent', 10000)
  const dispose = f.register()
  try {
    const before = f.notes.reduce((sum, n) => sum + n.style.writes, 0)
    updateMidiActivityAtBeat(-1, true)
    assert.equal(f.notes.reduce((sum, n) => sum + n.style.writes, 0), before)
  } finally { dispose(); updateMidiActivityAtBeat(0, false) }
})

test('previews entering during playback pulse immediately; leaving releases layers', () => {
  updateMidiActivityAtBeat(0.2, true)
  const f = fixture('incoming')
  const dispose = f.register()
  assert.equal(f.pulses[0].style.willChange, 'opacity')
  updateMidiActivityAtBeat(0.3, true)
  assert.ok(Number(f.pulses[0].style.opacity) > 0)
  dispose()
  assert.equal(f.pulses[0].style.willChange, '')
  assert.equal(f.pulses[0].style.opacity, '0.0000')
  assert.equal(f.notes[0].style.values.has('--midi-note-activity'), false)
  const writes = f.notes[0].style.writes
  updateMidiActivityAtBeat(0.4, true)
  assert.equal(f.notes[0].style.writes, writes)
  updateMidiActivityAtBeat(0, false)
})

test('muted previews stay unpromoted and silent', () => {
  const f = fixture('muted')
  const dispose = f.register(true)
  try {
    updateMidiActivityAtBeat(0.2, true)
    assert.equal(f.pulses[0].style.willChange, '')
    assert.equal(f.pulses[0].style.opacity, '0.0000')
    assert.equal(f.notes[0].style.values.get('--midi-note-activity') ?? '0.0000', '0.0000')
  } finally { dispose(); updateMidiActivityAtBeat(0, false) }
})
