import test from 'node:test'
import assert from 'node:assert/strict'
import { createMidiActivityBlock, updateMidiActivityAtBeat } from './midiActivityRegistry'
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
  let queryCount = 0
  const element = { style: new Style(), querySelectorAll: (selector: string) => { queryCount++; return selector === '[data-midi-preview-key]' ? notes : pulses } }
  const create = (muted = false) => createMidiActivityBlock(block, 4, element as unknown as HTMLDivElement, muted)
  return { block, notes, pulses, element, create, get queryCount() { return queryCount }, register: (muted = false) => {
    const handle = create(muted)
    handle.setVisible(true)
    return handle.dispose
  } }
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


test('offscreen previews prepare lazily and reuse their lookup on repeated entry', () => {
  updateMidiActivityAtBeat(0, false)
  const f = fixture('parked', 10000)
  const handle = f.create()
  try {
    assert.equal(f.queryCount, 0)
    handle.setVisible(false)
    assert.equal(f.queryCount, 0)
    handle.setVisible(true)
    assert.equal(f.queryCount, 2)
    updateMidiActivityAtBeat(0.2, true)
    const opacity = f.pulses[0].style.opacity
    const activity = f.notes[0].style.values.get('--midi-note-activity')
    for (let i = 0; i < 3; i++) {
      handle.setVisible(false)
      assert.equal(f.pulses[0].style.willChange, '')
      assert.equal(f.pulses[0].style.opacity, '0.0000')
      assert.equal(f.notes[0].style.values.has('--midi-note-activity'), false)
      const writes = f.notes[0].style.writes
      updateMidiActivityAtBeat(0.2, true)
      assert.equal(f.notes[0].style.writes, writes, 'hidden notes must not update')
      handle.setVisible(true)
      updateMidiActivityAtBeat(0.2, true)
      assert.equal(f.pulses[0].style.opacity, opacity)
      assert.equal(f.notes[0].style.values.get('--midi-note-activity'), activity)
      assert.equal(f.queryCount, 2, 'viewport re-entry must reuse the DOM lookup')
      handle.setVisible(true)
      assert.equal(f.pulses[0].style.opacity, opacity, 'duplicate visibility must not reset a pulse')
    }
  } finally { handle.dispose(); updateMidiActivityAtBeat(0, false) }
})

test('disposed previews ignore late viewport notifications', () => {
  const f = fixture('disposed')
  const handle = f.create()
  handle.dispose()
  handle.setVisible(true)
  assert.equal(f.queryCount, 0)
  const live = f.create()
  live.setVisible(true)
  updateMidiActivityAtBeat(0.2, true)
  live.dispose()
  const writes = f.notes[0].style.writes
  live.setVisible(true)
  updateMidiActivityAtBeat(0.3, true)
  assert.equal(f.queryCount, 2)
  assert.equal(f.notes[0].style.writes, writes)
  assert.equal(f.pulses[0].style.willChange, '')
  updateMidiActivityAtBeat(0, false)
})

test('re-entering after transport stops leaves a parked preview silent', () => {
  const f = fixture('park-pause')
  const handle = f.create()
  try {
    handle.setVisible(true)
    updateMidiActivityAtBeat(0.2, true)
    handle.setVisible(false)
    updateMidiActivityAtBeat(0.2, false)
    handle.setVisible(true)
    updateMidiActivityAtBeat(0.2, false)
    assert.equal(f.pulses[0].style.opacity, '0.0000')
    assert.equal(f.pulses[0].style.willChange, '')
    assert.equal(f.notes[0].style.values.has('--midi-note-activity'), false)
  } finally { handle.dispose(); updateMidiActivityAtBeat(0, false) }
})
