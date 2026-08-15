import type { Note } from '../../../types'
import {
  DEFAULT_VELOCITY,
  VIM_GRID_STEPS,
  VIM_NOTE_LENGTHS,
  type VimAction,
  type VimContext,
  type VimDraft,
  type VimIntent,
  type VimResult,
  type VimSelection,
  type VimState,
} from './types'
import { anchorForCursor, bigRowStep, keyMapForRows, TYPING_KEY_SET } from './keyMap'

const EPS = 1e-6

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}

/** Nudge a beat back onto the step grid — keeps the cursor legible after a
 *  grid change, exactly like retuning a tracker's row height. */
function snapBeat(beat: number, step: number) {
  if (step <= 0) return Math.max(0, beat)
  return Math.max(0, Math.round(beat / step) * step)
}

function done(state: VimState, intents: VimIntent[] = [], handled = true): VimResult {
  return { state, intents, handled }
}

function unhandled(state: VimState): VimResult {
  return { state, intents: [], handled: false }
}

function countOf(state: VimState) {
  const n = Number.parseInt(state.count || '1', 10)
  return Number.isFinite(n) ? clamp(n, 1, 128) : 1
}

function rowIndexForPitch(ctx: VimContext, pitch: number) {
  return ctx.rows.findIndex((r) => r.pitch === pitch)
}

function noteStartGlobal(ctx: VimContext, note: Note) {
  return ctx.blockStartBeat + note.startBeat
}

/** Rows the region covers: the explicit key-built filter, else the span between
 *  the anchor row and the cursor. */
function selectionRows(state: VimState, selection: VimSelection): number[] {
  if (selection.rowFilter) return [...selection.rowFilter].sort((a, b) => a - b)
  const lo = Math.min(selection.anchorRow, state.cursorRow)
  const hi = Math.max(selection.anchorRow, state.cursorRow)
  const rows: number[] = []
  for (let r = lo; r <= hi; r += 1) rows.push(r)
  return rows
}

/** The region's time span. The end is inclusive of the cursor's own step, so a
 *  region that hasn't been dragged anywhere still covers the cell under it. */
export function selectionSpan(state: VimState, ctx: VimContext, selection: VimSelection) {
  const start = Math.min(selection.anchorBeat, state.cursorBeat)
  const end = Math.max(selection.anchorBeat, state.cursorBeat) + ctx.stepBeats
  return { start, end }
}

export function notesInSelection(state: VimState, ctx: VimContext): Note[] {
  if (!state.selection) return []
  const { start, end } = selectionSpan(state, ctx, state.selection)
  const rows = new Set(selectionRows(state, state.selection))
  return ctx.notes.filter((n) => {
    const beat = noteStartGlobal(ctx, n)
    if (beat < start - EPS || beat >= end - EPS) return false
    return rows.has(rowIndexForPitch(ctx, n.pitch))
  })
}

/** The note the cursor is sitting on: same row, overlapping the cursor's cell. */
function noteUnderCursor(state: VimState, ctx: VimContext): Note | null {
  const row = ctx.rows[state.cursorRow]
  if (!row) return null
  const cellEnd = state.cursorBeat + ctx.stepBeats
  return (
    ctx.notes.find((n) => {
      if (n.pitch !== row.pitch) return false
      const start = noteStartGlobal(ctx, n)
      return start < cellEnd - EPS && start + Math.max(n.durationBeats, EPS) > state.cursorBeat + EPS
    }) ?? null
  )
}

/** Emitted after any write: grow the block if notes now run past its end.
 *  Placing past the end is the tracker flow — you type until you stop and the
 *  clip follows — so the cursor is never walled in. */
function growthIntent(ctx: VimContext, notes: Note[]): VimIntent[] {
  let maxEnd = 0
  for (const n of notes) maxEnd = Math.max(maxEnd, n.startBeat + n.durationBeats)
  return maxEnd > ctx.blockDurationBeats + EPS ? [{ type: 'growBlockTo', endBeatLocal: maxEnd }] : []
}

function withCursor(state: VimState, ctx: VimContext, beat: number, row: number): VimState {
  const cursorBeat = clamp(beat, 0, ctx.totalBeats)
  const cursorRow = clamp(row, 0, Math.max(0, ctx.rows.length - 1))
  return {
    ...state,
    cursorBeat,
    cursorRow,
    anchorRow: ctx.regime === 'value' ? state.anchorRow : anchorForCursor(state.anchorRow, cursorRow, ctx.rows.length),
    count: '',
  }
}

/** A cursor move always seeks the transport: paused, the 3D viewport is showing
 *  exactly the beat under the cursor, which is this editor's audition. */
function moveCursor(state: VimState, ctx: VimContext, dBeat: number, dRow: number): VimResult {
  const next = withCursor(state, ctx, state.cursorBeat + dBeat, state.cursorRow + dRow)
  const intents: VimIntent[] = [{ type: 'seek', beat: next.cursorBeat }]
  if (next.selection) intents.push({ type: 'selectNotes', ids: notesInSelection(next, ctx).map((n) => n.id) })
  return done(next, intents)
}

/** Write `rows` at the cursor, `repetitions` times, one step apart. Existing
 *  notes in a cell being written are replaced — typing over something means
 *  what it means in a tracker. */
function placeStamp(
  state: VimState,
  ctx: VimContext,
  rows: number[],
  repetitions: number,
  advance: boolean,
): VimResult {
  const targetRows = [...new Set(rows)].filter((r) => r >= 0 && r < ctx.rows.length)
  if (targetRows.length === 0) return done({ ...state, count: '' })

  const placed: Note[] = []
  const takenCells = new Set<string>()
  for (let rep = 0; rep < repetitions; rep += 1) {
    const globalBeat = state.cursorBeat + rep * ctx.stepBeats
    for (const rowIndex of targetRows) {
      const pitch = ctx.rows[rowIndex].pitch
      const startBeat = globalBeat - ctx.blockStartBeat
      takenCells.add(`${pitch}:${startBeat.toFixed(4)}`)
      placed.push({
        id: ctx.newId(),
        pitch,
        startBeat,
        durationBeats: state.noteLengthBeats,
        velocity: DEFAULT_VELOCITY,
      })
    }
  }

  const kept = ctx.notes.filter((n) => !takenCells.has(`${n.pitch}:${n.startBeat.toFixed(4)}`))
  const nextNotes = [...kept, ...placed]
  const nextState: VimState = {
    ...withCursor(
      state,
      ctx,
      advance ? state.cursorBeat + repetitions * ctx.stepBeats : state.cursorBeat,
      targetRows[targetRows.length - 1],
    ),
    staged: [],
    lastStamp: { rows: targetRows, lengthBeats: state.noteLengthBeats, velocity: DEFAULT_VELOCITY },
  }

  return done(nextState, [
    { type: 'commitNotes', notes: nextNotes },
    ...growthIntent(ctx, nextNotes),
    { type: 'selectNotes', ids: [] },
    { type: 'seek', beat: nextState.cursorBeat },
  ])
}

function deleteNotes(state: VimState, ctx: VimContext, doomed: Note[], nextState: VimState): VimResult {
  if (doomed.length === 0) return done({ ...nextState, count: '' })
  const ids = new Set(doomed.map((n) => n.id))
  return done({ ...nextState, count: '' }, [
    { type: 'commitNotes', notes: ctx.notes.filter((n) => !ids.has(n.id)) },
    { type: 'selectNotes', ids: [] },
  ])
}

function startDraft(state: VimState, ctx: VimContext, kind: 'move' | 'copy'): VimResult {
  const targets = state.selection ? notesInSelection(state, ctx) : [noteUnderCursor(state, ctx)].filter(Boolean) as Note[]
  if (targets.length === 0) return done({ ...state, count: '' })

  const fromSelection = state.selection !== null
  const selection: VimSelection = state.selection ?? {
    anchorBeat: state.cursorBeat,
    anchorRow: state.cursorRow,
    rowFilter: [state.cursorRow],
  }
  const draft: VimDraft = {
    kind,
    noteIds: targets.map((n) => n.id),
    offsetBeats: 0,
    offsetRows: 0,
    fromSelection,
  }
  return done(
    { ...state, mode: 'draft', selection, draft, count: '' },
    [{ type: 'selectNotes', ids: draft.noteIds }],
  )
}

/** Where a draft's notes currently sit — the ghost the grid draws, and what
 *  `commitDraft` writes. */
export function projectDraft(state: VimState, ctx: VimContext): Note[] {
  if (!state.draft) return []
  const ids = new Set(state.draft.noteIds)
  const { offsetBeats, offsetRows } = state.draft
  return ctx.notes
    .filter((n) => ids.has(n.id))
    .map((n) => {
      const row = rowIndexForPitch(ctx, n.pitch)
      const nextRow = clamp(row + offsetRows, 0, ctx.rows.length - 1)
      return {
        ...n,
        startBeat: n.startBeat + offsetBeats,
        pitch: row === -1 ? n.pitch : ctx.rows[nextRow].pitch,
      }
    })
}

function commitDraft(state: VimState, ctx: VimContext): VimResult {
  if (!state.draft) return done(state)
  const projected = projectDraft(state, ctx)
  const ids = new Set(state.draft.noteIds)

  const nextNotes =
    state.draft.kind === 'copy'
      ? [...ctx.notes, ...projected.map((n) => ({ ...n, id: ctx.newId() }))]
      : [...ctx.notes.filter((n) => !ids.has(n.id)), ...projected]

  return done({ ...state, mode: 'ground', draft: null, selection: null, count: '' }, [
    { type: 'commitNotes', notes: nextNotes },
    ...growthIntent(ctx, nextNotes),
    { type: 'selectNotes', ids: [] },
  ])
}

/** Copy the region and land the copy directly after itself, region and cursor
 *  travelling with it — hold `r` to build a phrase out of a bar. */
function duplicateSelection(state: VimState, ctx: VimContext): VimResult {
  if (!state.selection) {
    const stamp = state.lastStamp
    return placeStamp(state, ctx, stamp ? stamp.rows : [state.cursorRow], countOf(state), true)
  }
  const selected = notesInSelection(state, ctx)
  if (selected.length === 0) return done({ ...state, count: '' })

  const { start, end } = selectionSpan(state, ctx, state.selection)
  const span = end - start
  const copies = selected.map((n) => ({ ...n, id: ctx.newId(), startBeat: n.startBeat + span }))
  const nextNotes = [...ctx.notes, ...copies]
  const nextState: VimState = {
    ...state,
    count: '',
    cursorBeat: clamp(state.cursorBeat + span, 0, ctx.totalBeats),
    selection: { ...state.selection, anchorBeat: state.selection.anchorBeat + span },
  }

  return done(nextState, [
    { type: 'commitNotes', notes: nextNotes },
    ...growthIntent(ctx, nextNotes),
    { type: 'selectNotes', ids: copies.map((n) => n.id) },
    { type: 'seek', beat: nextState.cursorBeat },
  ])
}

function selectAllInBlock(state: VimState, ctx: VimContext): VimResult {
  const selection: VimSelection = {
    anchorBeat: ctx.blockStartBeat,
    anchorRow: 0,
    rowFilter: null,
  }
  const next: VimState = {
    ...state,
    mode: 'select',
    selection,
    cursorBeat: clamp(ctx.blockStartBeat + ctx.blockDurationBeats - ctx.stepBeats, 0, ctx.totalBeats),
    cursorRow: Math.max(0, ctx.rows.length - 1),
    count: '',
  }
  return done(next, [{ type: 'selectNotes', ids: notesInSelection(next, ctx).map((n) => n.id) }])
}

/** `/` and `\` — travel to the next thing worth editing rather than stepping
 *  there. Same row first, since that's the line you're working on. */
function jumpToNote(state: VimState, ctx: VimContext, direction: 1 | -1): VimResult {
  const row = ctx.rows[state.cursorRow]
  const ahead = ctx.notes
    .map((n) => ({ note: n, beat: noteStartGlobal(ctx, n) }))
    .filter(({ beat }) => (direction > 0 ? beat > state.cursorBeat + EPS : beat < state.cursorBeat - EPS))
  if (ahead.length === 0) return done({ ...state, count: '' })

  const sameRow = row ? ahead.filter(({ note }) => note.pitch === row.pitch) : []
  const pool = sameRow.length > 0 ? sameRow : ahead
  const target = pool.sort((a, b) => (direction > 0 ? a.beat - b.beat : b.beat - a.beat))[0]
  const nextRow = rowIndexForPitch(ctx, target.note.pitch)
  const next = withCursor(state, ctx, target.beat, nextRow === -1 ? state.cursorRow : nextRow)
  const intents: VimIntent[] = [{ type: 'seek', beat: next.cursorBeat }]
  if (next.selection) intents.push({ type: 'selectNotes', ids: notesInSelection(next, ctx).map((n) => n.id) })
  return done(next, intents)
}

function cycleValue(values: number[], current: number, direction: 1 | -1) {
  let index = 0
  let best = Infinity
  values.forEach((v, i) => {
    const d = Math.abs(v - current)
    if (d < best) {
      best = d
      index = i
    }
  })
  return values[clamp(index + direction, 0, values.length - 1)]
}

export function vimReduce(state: VimState, action: VimAction, ctx: VimContext): VimResult {
  if (action.type === 'shiftTap') {
    if (state.mode !== 'ground') return done(state)
    const staging = !state.staging
    return done({ ...state, staging, staged: staging ? state.staged : [] })
  }

  if (action.type === 'setCursor') {
    const next = withCursor(state, ctx, action.beat, action.row)
    return done(next, [{ type: 'seek', beat: next.cursorBeat }])
  }

  if (action.type === 'clamp') {
    return done(withCursor(state, ctx, state.cursorBeat, state.cursorRow), [])
  }

  return reduceKey(state, action, ctx)
}

function reduceKey(state: VimState, action: Extract<VimAction, { type: 'key' }>, ctx: VimContext): VimResult {
  const { key, shift, meta } = action
  const rowCount = ctx.rows.length
  const bigStep = bigRowStep(ctx.regime, rowCount)
  const keyMap = keyMapForRows(ctx.rows, ctx.regime, state.anchorRow)
  const barBeats = ctx.beatsPerBar
  const noteRow = TYPING_KEY_SET.has(key) ? keyMap.get(key) : undefined

  // The key sheet swallows the next Escape, so `?` then Esc is a round trip.
  if (state.showSheet && (key === 'escape' || key === '?' || key === 'q')) {
    return done({ ...state, showSheet: false })
  }
  if (key === '?') return done({ ...state, showSheet: true })

  // Transport rides shifted, because bare Space and Enter are the note keys'.
  if (shift && key === ' ') return done(state, [{ type: 'togglePlay' }])
  if (shift && key === 'enter') return done(state, [{ type: 'returnToStart' }])

  // Everything else with a command modifier stays cabin-visuals': copy, paste,
  // split, join, group, undo. The one exception is jumping to a row.
  if (meta) {
    if (noteRow !== undefined) {
      const next = withCursor(state, ctx, state.cursorBeat, noteRow)
      return done(next, [{ type: 'seek', beat: next.cursorBeat }])
    }
    return unhandled(state)
  }

  // Grid, zoom and note length are always live — they're prefs, not a mode.
  if (key === '[') return done({ ...state, count: '' }, [{ type: 'setQuantize', beats: cycleValue(VIM_GRID_STEPS, ctx.stepBeats, -1) }])
  if (key === ']') return done({ ...state, count: '' }, [{ type: 'setQuantize', beats: cycleValue(VIM_GRID_STEPS, ctx.stepBeats, 1) }])
  if (key === '-' || key === '_') return done({ ...state, count: '' }, [{ type: 'zoom', direction: -1 }])
  if (key === '=' || key === '+') return done({ ...state, count: '' }, [{ type: 'zoom', direction: 1 }])
  if (key === '(' || key === ';') {
    return done({ ...state, noteLengthBeats: cycleValue(VIM_NOTE_LENGTHS, state.noteLengthBeats, -1), count: '' })
  }
  if (key === ')' || key === "'") {
    return done({ ...state, noteLengthBeats: cycleValue(VIM_NOTE_LENGTHS, state.noteLengthBeats, 1), count: '' })
  }
  if (key === ',') return done({ ...state, count: '' }, [{ type: 'undo' }])
  if (key === '.') return done({ ...state, count: '' }, [{ type: 'redo' }])

  // --- draft: nudge it, drop it, or throw it away -------------------------
  if (state.mode === 'draft' && state.draft) {
    const nudge = (dBeat: number, dRow: number): VimResult =>
      done({
        ...state,
        draft: {
          ...state.draft!,
          offsetBeats: state.draft!.offsetBeats + dBeat,
          offsetRows: state.draft!.offsetRows + dRow,
        },
        cursorBeat: clamp(state.cursorBeat + dBeat, 0, ctx.totalBeats),
        cursorRow: clamp(state.cursorRow + dRow, 0, rowCount - 1),
      })

    if (key === 'z') return nudge(shift ? -barBeats : -ctx.stepBeats, 0)
    if (key === 'x') return nudge(shift ? barBeats : ctx.stepBeats, 0)
    if (key === 'c') return nudge(0, shift ? bigStep : 1)
    if (key === 'v') return nudge(0, shift ? -bigStep : -1)
    if (key === 'enter' || key === (state.draft.kind === 'copy' ? 'n' : 'm')) return commitDraft(state, ctx)
    if (key === 'escape' || key === 'q' || key === 'tab') {
      const backToSelect = state.draft.fromSelection
      return done({
        ...state,
        mode: backToSelect ? 'select' : 'ground',
        selection: backToSelect ? state.selection : null,
        draft: null,
      }, backToSelect ? [] : [{ type: 'selectNotes', ids: [] }])
    }
    return done(state)
  }

  // --- select: shape the region, then act on it ---------------------------
  if (state.mode === 'select' && state.selection) {
    if (key === 'tab' || key === 'escape' || key === 'q') {
      return done({ ...state, mode: 'ground', selection: null, count: '' }, [{ type: 'selectNotes', ids: [] }])
    }
    if (noteRow !== undefined) {
      // Note keys filter the region by row instead of playing — the same keys,
      // reading as "these lanes" rather than "these pitches". The FIRST key
      // starts a fresh filter rather than subtracting from the implicit span:
      // pressing one key over a region spanning every row plainly means "just
      // this lane", not "all of them except this one".
      const current = new Set(state.selection.rowFilter ?? [])
      if (current.has(noteRow)) current.delete(noteRow)
      else current.add(noteRow)
      const next: VimState = {
        ...state,
        cursorRow: noteRow,
        selection: { ...state.selection, rowFilter: [...current].sort((a, b) => a - b) },
        count: '',
      }
      return done(next, [{ type: 'selectNotes', ids: notesInSelection(next, ctx).map((n) => n.id) }])
    }
    if (key === 'z') return moveCursor(state, ctx, shift ? -barBeats : -ctx.stepBeats, 0)
    if (key === 'x') return moveCursor(state, ctx, shift ? barBeats : ctx.stepBeats, 0)
    if (key === 'c') return moveCursor(state, ctx, 0, shift ? bigStep : 1)
    if (key === 'v') return moveCursor(state, ctx, 0, shift ? -bigStep : -1)
    if (key === '/') return jumpToNote(state, ctx, 1)
    if (key === '\\') return jumpToNote(state, ctx, -1)
    if (key === 'a' && shift) return selectAllInBlock(state, ctx)
    if (key === 'r') return duplicateSelection(state, ctx)
    if (key === 'm') return startDraft(state, ctx, 'move')
    if (key === 'n') return startDraft(state, ctx, 'copy')
    if (key === 'b' || key === 'backspace' || key === 'delete') {
      return deleteNotes(state, ctx, notesInSelection(state, ctx), { ...state, mode: 'ground', selection: null })
    }
    return done(state)
  }

  // --- ground: type notes ------------------------------------------------
  if (key === 'escape') {
    if (state.staging || state.staged.length > 0) return done({ ...state, staging: false, staged: [] })
    return done(state, [{ type: 'exit' }])
  }
  if (key === 'q') return done({ ...state, staging: false, staged: [], count: '' })

  if (key === 'tab') {
    return done({
      ...state,
      mode: 'select',
      staging: false,
      staged: [],
      count: '',
      selection: { anchorBeat: state.cursorBeat, anchorRow: state.cursorRow, rowFilter: null },
    })
  }

  if (shift && key === 'a') return selectAllInBlock(state, ctx)

  if (noteRow !== undefined) {
    if (shift || state.staging) {
      const staged = state.staged.includes(noteRow)
        ? state.staged.filter((r) => r !== noteRow)
        : [...state.staged, noteRow]
      return done({ ...state, staged, cursorRow: noteRow, count: '' })
    }
    return placeStamp({ ...state, cursorRow: noteRow }, ctx, [noteRow], countOf(state), true)
  }

  if (/^[0-9]$/.test(key)) {
    if (key === '0' && state.count === '') return done(state)
    return done({ ...state, count: `${state.count}${key}`.slice(0, 3) })
  }

  if (key === ' ') {
    const next = withCursor(state, ctx, state.cursorBeat + ctx.stepBeats * countOf(state), state.cursorRow)
    return done(next, [{ type: 'seek', beat: next.cursorBeat }])
  }
  if (key === 'enter') {
    if (state.staged.length > 0) {
      return placeStamp({ ...state, staging: false }, ctx, state.staged, countOf(state), true)
    }
    return placeStamp(state, ctx, [state.cursorRow], countOf(state), true)
  }
  if (key === 'z') return moveCursor(state, ctx, shift ? -barBeats : -ctx.stepBeats, 0)
  if (key === 'x') return moveCursor(state, ctx, shift ? barBeats : ctx.stepBeats, 0)
  if (key === 'c') return moveCursor(state, ctx, 0, shift ? bigStep : 1)
  if (key === 'v') return moveCursor(state, ctx, 0, shift ? -bigStep : -1)
  if (key === '/') return jumpToNote(state, ctx, 1)
  if (key === '\\') return jumpToNote(state, ctx, -1)
  if (key === 'r') return duplicateSelection(state, ctx)
  if (key === 'm') return startDraft(state, ctx, 'move')
  if (key === 'n') return startDraft(state, ctx, 'copy')
  if (key === 'b' || key === 'backspace' || key === 'delete') {
    const target = noteUnderCursor(state, ctx)
    return deleteNotes(state, ctx, target ? [target] : [], state)
  }

  return unhandled(state)
}

/** Re-snap the cursor when the grid changes under it. */
export function resnapCursor(state: VimState, stepBeats: number): VimState {
  return { ...state, cursorBeat: snapBeat(state.cursorBeat, stepBeats) }
}
