import assert from 'node:assert/strict'
import test from 'node:test'
import type { Note } from '../../../types'
import type { MidiRow } from '../types'
import { keyMapForRows, rowKeyLabels } from './keyMap'
import { notesInSelection, projectDraft, vimReduce } from './vimReducer'
import { initialVimState, type VimContext, type VimIntent, type VimState } from './types'

// Rows are ordered top-to-bottom (index 0 is the highest pitch) everywhere in
// the roll, so a key window that ascends runs DOWN the indices.
function chromaticRows(top = 84, count = 37): MidiRow[] {
  return Array.from({ length: count }, (_, i) => ({ pitch: top - i, label: `p${top - i}`, color: '#fff' }))
}

let idCounter = 0
function makeCtx(over: Partial<VimContext> = {}): VimContext {
  return {
    rows: chromaticRows(),
    regime: 'chromatic',
    notes: [],
    blockStartBeat: 0,
    blockDurationBeats: 16,
    beatsPerBar: 4,
    stepBeats: 0.5,
    totalBeats: 256,
    newId: () => `n${++idCounter}`,
    ...over,
  }
}

function state(over: Partial<VimState> = {}): VimState {
  return { ...initialVimState(0, 20, 20), ...over }
}

function press(s: VimState, ctx: VimContext, key: string, mods: { shift?: boolean; meta?: boolean } = {}) {
  return vimReduce(s, { type: 'key', key, shift: !!mods.shift, meta: !!mods.meta }, ctx)
}

function committed(intents: VimIntent[]): Note[] | null {
  const hit = intents.find((i) => i.type === 'commitNotes')
  return hit && hit.type === 'commitNotes' ? hit.notes : null
}

test('key map: the 16 typing keys ascend from the anchor row', () => {
  const rows = chromaticRows()
  const map = keyMapForRows(rows, 'chromatic', 20)
  assert.equal(map.get('a'), 20, '`a` sits on the anchor')
  assert.equal(map.get('w'), 19, 'the next key is one row UP, i.e. one index down')
  assert.equal(map.get('p'), 5, 'sixteen keys span fifteen rows')
  // A pitch a semitone above the anchor's is what `w` writes.
  assert.equal(rows[map.get('w')!].pitch - rows[map.get('a')!].pitch, 1)
})

test('key map: value lanes spread the keys across the whole range', () => {
  const rows = chromaticRows(84, 49)
  const map = keyMapForRows(rows, 'value', 0)
  assert.equal(map.get('a'), rows.length - 1, '`a` is the minimum (bottom row)')
  assert.equal(map.get('p'), 0, '`p` is the maximum (top row)')
  const labels = rowKeyLabels(rows, 'value', 0)
  assert.ok(labels.size > 8, 'most keys land on distinct rows')
})

test('key map: a short vocabulary only binds the keys that have a row', () => {
  const rows = chromaticRows(64, 4)
  const map = keyMapForRows(rows, 'vocabulary', 3)
  assert.equal(map.size, 4, 'no key points off the end of the list')
  assert.equal(map.get('a'), 3)
  assert.equal(map.get('e'), 0)
})

test('typing a note writes it block-local and advances the cursor one step', () => {
  const ctx = makeCtx({ blockStartBeat: 8 })
  const s = state({ cursorBeat: 8 })
  const { state: next, intents } = press(s, ctx, 'a')

  const notes = committed(intents)
  assert.ok(notes)
  assert.equal(notes!.length, 1)
  assert.equal(notes![0].startBeat, 0, 'global beat 8 in a block starting at 8 is local 0')
  assert.equal(notes![0].pitch, ctx.rows[20].pitch)
  assert.equal(next.cursorBeat, 8.5, 'the cursor advances by the grid step')
  assert.ok(intents.some((i) => i.type === 'seek' && i.beat === 8.5), 'and the playhead follows it')
})

test('a count prefix repeats the note that many steps', () => {
  const ctx = makeCtx()
  let s = state()
  s = press(s, ctx, '3').state
  const { state: next, intents } = press(s, ctx, 'a')

  const notes = committed(intents)!
  assert.equal(notes.length, 3)
  assert.deepEqual(notes.map((n) => n.startBeat), [0, 0.5, 1])
  assert.equal(next.cursorBeat, 1.5)
  assert.equal(next.count, '', 'the count is spent')
})

test('typing over a cell replaces what was there', () => {
  const existing: Note = { id: 'old', startBeat: 0, durationBeats: 4, pitch: chromaticRows()[20].pitch, velocity: 20 }
  const ctx = makeCtx({ notes: [existing] })
  const notes = committed(press(state(), ctx, 'a').intents)!
  assert.equal(notes.length, 1)
  assert.notEqual(notes[0].id, 'old')
})

test('shift-tap latches staging; note keys stage, Enter commits the chord', () => {
  const ctx = makeCtx()
  let s = vimReduce(state(), { type: 'shiftTap' }, ctx).state
  assert.equal(s.staging, true)

  s = press(s, ctx, 'a').state
  s = press(s, ctx, 'd').state
  assert.deepEqual(s.staged, [20, 16], 'staged rows accumulate without advancing')
  assert.equal(s.cursorBeat, 0, 'staging never moves the cursor forward')

  const { state: next, intents } = press(s, ctx, 'enter')
  const notes = committed(intents)!
  assert.equal(notes.length, 2, 'both staged rows land on the same beat')
  assert.ok(notes.every((n) => n.startBeat === 0))
  assert.deepEqual(next.staged, [])
  assert.equal(next.cursorBeat, 0.5)
})

test('pressing a staged key again unstages it', () => {
  const ctx = makeCtx()
  let s = state({ staging: true })
  s = press(s, ctx, 'a').state
  s = press(s, ctx, 'a').state
  assert.deepEqual(s.staged, [])
})

test('placing past the block end asks for the block to grow', () => {
  const ctx = makeCtx({ blockDurationBeats: 4 })
  const s = state({ cursorBeat: 6, noteLengthBeats: 1 })
  const { intents } = press(s, ctx, 'a')
  const grow = intents.find((i) => i.type === 'growBlockTo')
  assert.ok(grow && grow.type === 'growBlockTo')
  assert.equal(grow.endBeatLocal, 7)
})

test('placing inside the block does not touch its length', () => {
  const ctx = makeCtx({ blockDurationBeats: 16 })
  const { intents } = press(state(), ctx, 'a')
  assert.ok(!intents.some((i) => i.type === 'growBlockTo'))
})

test('space rests, z/x step, c/v change row, shift jumps by bar and octave', () => {
  const ctx = makeCtx()
  assert.equal(press(state(), ctx, ' ').state.cursorBeat, 0.5)
  assert.equal(press(state({ cursorBeat: 4 }), ctx, 'z').state.cursorBeat, 3.5)
  assert.equal(press(state({ cursorBeat: 4 }), ctx, 'x', { shift: true }).state.cursorBeat, 8)
  assert.equal(press(state(), ctx, 'c').state.cursorRow, 21, 'c goes down the rows')
  assert.equal(press(state(), ctx, 'v').state.cursorRow, 19, 'v goes up')
  assert.equal(press(state(), ctx, 'v', { shift: true }).state.cursorRow, 8, 'an octave is twelve rows on a piano')
})

test('the cursor never leaves the row list or runs before beat 0', () => {
  const ctx = makeCtx()
  assert.equal(press(state({ cursorBeat: 0 }), ctx, 'z').state.cursorBeat, 0)
  assert.equal(press(state({ cursorRow: 0 }), ctx, 'v').state.cursorRow, 0)
  assert.equal(press(state({ cursorRow: 36 }), ctx, 'c').state.cursorRow, 36)
})

test('b deletes the note under the cursor and nothing else', () => {
  const rows = chromaticRows()
  const notes: Note[] = [
    { id: 'hit', startBeat: 0, durationBeats: 1, pitch: rows[20].pitch, velocity: 100 },
    { id: 'other-row', startBeat: 0, durationBeats: 1, pitch: rows[19].pitch, velocity: 100 },
    { id: 'later', startBeat: 4, durationBeats: 1, pitch: rows[20].pitch, velocity: 100 },
  ]
  const ctx = makeCtx({ notes })
  const next = committed(press(state(), ctx, 'b').intents)!
  assert.deepEqual(next.map((n) => n.id), ['other-row', 'later'])
})

test('Tab opens a region that grows with the nav keys and selects what it covers', () => {
  const rows = chromaticRows()
  const notes: Note[] = [
    { id: 'in', startBeat: 0.5, durationBeats: 0.5, pitch: rows[20].pitch, velocity: 100 },
    { id: 'out-of-time', startBeat: 8, durationBeats: 0.5, pitch: rows[20].pitch, velocity: 100 },
    { id: 'out-of-row', startBeat: 0.5, durationBeats: 0.5, pitch: rows[30].pitch, velocity: 100 },
  ]
  const ctx = makeCtx({ notes })

  let s = press(state(), ctx, 'tab').state
  assert.equal(s.mode, 'select')

  const stepped = press(s, ctx, 'x')
  s = stepped.state
  const ids = notesInSelection(s, ctx).map((n) => n.id)
  assert.deepEqual(ids, ['in'])
  assert.ok(
    stepped.intents.some((i) => i.type === 'selectNotes' && i.ids.join() === 'in'),
    'the region projects onto the roll’s own selection',
  )
})

test('in select mode the note keys filter rows instead of playing them', () => {
  const rows = chromaticRows()
  const notes: Note[] = [
    { id: 'a-row', startBeat: 0, durationBeats: 1, pitch: rows[20].pitch, velocity: 100 },
    { id: 'w-row', startBeat: 0, durationBeats: 1, pitch: rows[19].pitch, velocity: 100 },
  ]
  const ctx = makeCtx({ notes })
  let s = state({ mode: 'select', selection: { anchorBeat: 0, anchorRow: 0, rowFilter: null }, cursorRow: 36 })

  const filtered = press(s, ctx, 'w')
  s = filtered.state
  assert.deepEqual(s.selection!.rowFilter, [19])
  assert.deepEqual(notesInSelection(s, ctx).map((n) => n.id), ['w-row'], 'only the filtered row is in')
  assert.ok(!committed(filtered.intents), 'and nothing was written')

  s = press(s, ctx, 'a').state
  assert.deepEqual(s.selection!.rowFilter, [19, 20], 'a second key adds its row')
})

test('deleting in select mode removes the region and drops back to ground', () => {
  const rows = chromaticRows()
  const notes: Note[] = [
    { id: 'doomed', startBeat: 0, durationBeats: 1, pitch: rows[20].pitch, velocity: 100 },
    { id: 'safe', startBeat: 12, durationBeats: 1, pitch: rows[20].pitch, velocity: 100 },
  ]
  const ctx = makeCtx({ notes })
  const s = state({ mode: 'select', selection: { anchorBeat: 0, anchorRow: 20, rowFilter: null } })
  const { state: next, intents } = press(s, ctx, 'b')

  assert.deepEqual(committed(intents)!.map((n) => n.id), ['safe'])
  assert.equal(next.mode, 'ground')
  assert.equal(next.selection, null)
})

test('Shift+A selects the whole block', () => {
  const rows = chromaticRows()
  const notes: Note[] = [
    { id: 'early', startBeat: 0, durationBeats: 1, pitch: rows[2].pitch, velocity: 100 },
    { id: 'late', startBeat: 15, durationBeats: 1, pitch: rows[33].pitch, velocity: 100 },
    { id: 'past-the-end', startBeat: 40, durationBeats: 1, pitch: rows[10].pitch, velocity: 100 },
  ]
  const ctx = makeCtx({ notes })
  const { state: next } = press(state(), ctx, 'a', { shift: true })
  assert.equal(next.mode, 'select')
  assert.deepEqual(notesInSelection(next, ctx).map((n) => n.id), ['early', 'late'])
})

test('r after a selection lands a copy directly after it', () => {
  const rows = chromaticRows()
  const notes: Note[] = [{ id: 'seed', startBeat: 0, durationBeats: 1, pitch: rows[20].pitch, velocity: 100 }]
  const ctx = makeCtx({ notes })
  // A region one bar wide: anchor at 0, cursor at 3.5, plus the cursor's step.
  const s = state({ mode: 'select', cursorBeat: 3.5, selection: { anchorBeat: 0, anchorRow: 20, rowFilter: null } })
  const { state: next, intents } = press(s, ctx, 'r')

  const out = committed(intents)!
  assert.equal(out.length, 2)
  assert.equal(out[1].startBeat, 4, 'the copy starts one region-length later')
  assert.equal(next.cursorBeat, 7.5, 'region and cursor travel with it, so r repeats')
})

test('m nudges a draft and commits it in place', () => {
  const rows = chromaticRows()
  const notes: Note[] = [{ id: 'movable', startBeat: 0, durationBeats: 1, pitch: rows[20].pitch, velocity: 100 }]
  const ctx = makeCtx({ notes })

  let s = press(state(), ctx, 'm').state
  assert.equal(s.mode, 'draft', 'with no region, m grabs the note under the cursor')

  s = press(s, ctx, 'x').state
  s = press(s, ctx, 'v').state
  const ghost = projectDraft(s, ctx)
  assert.equal(ghost[0].startBeat, 0.5)
  assert.equal(ghost[0].pitch, rows[19].pitch)

  const { state: next, intents } = press(s, ctx, 'm')
  const out = committed(intents)!
  assert.equal(out.length, 1, 'a move does not duplicate')
  assert.equal(out[0].startBeat, 0.5)
  assert.equal(next.mode, 'ground')
})

test('n commits a copy, leaving the original alone', () => {
  const rows = chromaticRows()
  const notes: Note[] = [{ id: 'source', startBeat: 0, durationBeats: 1, pitch: rows[20].pitch, velocity: 100 }]
  const ctx = makeCtx({ notes })

  let s = press(state(), ctx, 'n').state
  s = press(s, ctx, 'x').state
  const out = committed(press(s, ctx, 'n').intents)!

  assert.equal(out.length, 2)
  assert.ok(out.some((n) => n.id === 'source' && n.startBeat === 0), 'the original stays put')
  assert.ok(out.some((n) => n.id !== 'source' && n.startBeat === 0.5), 'the copy takes the offset')
})

test('Escape cancels a draft without writing anything', () => {
  const rows = chromaticRows()
  const ctx = makeCtx({ notes: [{ id: 'x', startBeat: 0, durationBeats: 1, pitch: rows[20].pitch, velocity: 100 }] })
  let s = press(state(), ctx, 'm').state
  s = press(s, ctx, 'x').state
  const { state: next, intents } = press(s, ctx, 'escape')
  assert.equal(next.mode, 'ground')
  assert.equal(next.draft, null)
  assert.ok(!committed(intents))
})

test('Escape pops one level at a time and only then leaves vim', () => {
  const ctx = makeCtx()
  const staged = state({ staging: true, staged: [20] })
  const cleared = press(staged, ctx, 'escape')
  assert.deepEqual(cleared.state.staged, [], 'first Escape drops the staged chord')
  assert.ok(!cleared.intents.some((i) => i.type === 'exit'))

  assert.ok(press(cleared.state, ctx, 'escape').intents.some((i) => i.type === 'exit'), 'a clean ground Escape exits')

  const selecting = state({ mode: 'select', selection: { anchorBeat: 0, anchorRow: 0, rowFilter: null } })
  assert.equal(press(selecting, ctx, 'escape').state.mode, 'ground', 'Escape in select returns to ground, not out')
})

test('command-modified keys are left to cabin-visuals, except the row jump', () => {
  const ctx = makeCtx()
  const copy = press(state(), ctx, 'c', { meta: true })
  assert.equal(copy.handled, false, '⌘C must still reach the roll’s own copy')
  assert.equal(committed(copy.intents), null)

  const jump = press(state(), ctx, 'd', { meta: true })
  assert.equal(jump.handled, true)
  assert.equal(jump.state.cursorRow, 16, '⌘+note moves the cursor without writing')
  assert.equal(committed(jump.intents), null)
})

test('transport rides shifted so the bare keys can type', () => {
  const ctx = makeCtx()
  assert.ok(press(state(), ctx, ' ', { shift: true }).intents.some((i) => i.type === 'togglePlay'))
  assert.ok(press(state(), ctx, 'enter', { shift: true }).intents.some((i) => i.type === 'returnToStart'))
  assert.equal(press(state(), ctx, ' ').state.cursorBeat, 0.5, 'bare space still rests')
})

test('grid and note length are prefs, live in every mode', () => {
  const ctx = makeCtx({ stepBeats: 0.5 })
  const wider = press(state(), ctx, ']')
  assert.ok(wider.intents.some((i) => i.type === 'setQuantize' && i.beats > 0.5), 'the roll’s own quantize is what moves')

  const longer = press(state(), ctx, ')')
  assert.ok(longer.state.noteLengthBeats > 0.5)
  const shorter = press(state(), ctx, '(')
  assert.ok(shorter.state.noteLengthBeats < 0.5)
})

test('/ and \\ travel to the next note, preferring the row you are on', () => {
  const rows = chromaticRows()
  const notes: Note[] = [
    { id: 'same-row-far', startBeat: 8, durationBeats: 1, pitch: rows[20].pitch, velocity: 100 },
    { id: 'other-row-near', startBeat: 2, durationBeats: 1, pitch: rows[30].pitch, velocity: 100 },
  ]
  const ctx = makeCtx({ notes })
  const fwd = press(state(), ctx, '/')
  assert.equal(fwd.state.cursorBeat, 8, 'the row you are editing wins over sheer proximity')

  const back = press(state({ cursorBeat: 12 }), ctx, '\\')
  assert.equal(back.state.cursorBeat, 8)
})

test('? opens the key sheet and Escape closes it without exiting vim', () => {
  const ctx = makeCtx()
  const opened = press(state(), ctx, '?')
  assert.equal(opened.state.showSheet, true)
  const closed = press(opened.state, ctx, 'escape')
  assert.equal(closed.state.showSheet, false)
  assert.ok(!closed.intents.some((i) => i.type === 'exit'))
})
