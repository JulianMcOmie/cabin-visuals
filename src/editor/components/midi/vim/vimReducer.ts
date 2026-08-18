import type { Note } from '../../../types'
import {
  DEFAULT_VELOCITY,
  VIM_GRID_STEPS,
  VIM_NOTE_LENGTHS,
  VIM_PAGE_BARS,
  VIM_TRIPLET_OF,
  type VimAction,
  type VimContext,
  type VimDraft,
  type VimIntent,
  type VimResult,
  type VimSelection,
  type VimState,
  type VimTimeRange,
} from './types'
import { anchorForCursor, bigRowStep, keyMapForRows, TYPING_KEY_SET } from './keyMap'

const EPS = 1e-6

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
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

/**
 * The region's time spans. Explicit ranges (bar slots toggled with 1-4) if it
 * has them, else the single span between the anchor and the cursor — whose end
 * includes the cursor's own step, so a region that hasn't been dragged anywhere
 * still covers the cell under it.
 */
export function selectionSpans(state: VimState, ctx: VimContext, selection: VimSelection): VimTimeRange[] {
  if (selection.timeRanges) return selection.timeRanges
  return [{
    startBeat: Math.min(selection.anchorBeat, state.cursorBeat),
    endBeat: Math.max(selection.anchorBeat, state.cursorBeat) + ctx.stepBeats,
  }]
}

/** Outer bounds of the region, for the operations that need one number (`r`'s
 *  travel distance, delete's fallback cursor). */
function selectionBounds(state: VimState, ctx: VimContext, selection: VimSelection) {
  const spans = selectionSpans(state, ctx, selection)
  return {
    startBeat: Math.min(...spans.map((s) => s.startBeat)),
    endBeat: Math.max(...spans.map((s) => s.endBeat)),
  }
}

export function notesInSelection(state: VimState, ctx: VimContext): Note[] {
  if (!state.selection) return []
  const spans = selectionSpans(state, ctx, state.selection)
  const rows = new Set(selectionRows(state, state.selection))
  return ctx.notes.filter((n) => {
    const beat = noteStartGlobal(ctx, n)
    if (!spans.some((s) => beat >= s.startBeat - EPS && beat < s.endBeat - EPS)) return false
    return rows.has(rowIndexForPitch(ctx, n.pitch))
  })
}

/** Start of the 4-bar page the cursor is in. */
function pageStartBeat(state: VimState, ctx: VimContext) {
  const pageBeats = VIM_PAGE_BARS * ctx.beatsPerBar
  return Math.floor(state.cursorBeat / pageBeats) * pageBeats
}

function slotRange(state: VimState, ctx: VimContext, slot: number): VimTimeRange {
  const start = pageStartBeat(state, ctx) + (slot - 1) * ctx.beatsPerBar
  return { startBeat: start, endBeat: start + ctx.beatsPerBar }
}

/** `1-4` in ground: hop to that bar of the current page. */
function jumpToPageBar(state: VimState, ctx: VimContext, slot: number): VimResult {
  const next = withCursor(state, ctx, slotRange(state, ctx, slot).startBeat, state.cursorRow)
  return done({ ...next, actionPendingClear: false }, [{ type: 'seek', beat: next.cursorBeat }])
}

/** `1-4` in select: toggle that bar of the page in or out of the region. This
 *  is where selections become disjoint — bars 1 and 3 with bar 2 untouched. */
function togglePageBarSlot(state: VimState, ctx: VimContext, slot: number): VimResult {
  if (!state.selection) return done(state)
  const range = slotRange(state, ctx, slot)
  const existing = state.selection.timeRanges ?? []
  const hit = existing.findIndex((r) => Math.abs(r.startBeat - range.startBeat) < EPS)
  const timeRanges = hit >= 0
    ? existing.filter((_, i) => i !== hit)
    : [...existing, range].sort((a, b) => a.startBeat - b.startBeat)

  const next: VimState = {
    ...state,
    cursorBeat: range.startBeat,
    // Toggling every slot off leaves an empty explicit set, which would select
    // nothing forever; fall back to the anchor..cursor span.
    selection: { ...state.selection, timeRanges: timeRanges.length > 0 ? timeRanges : null },
    count: '',
    actionPendingClear: false,
  }
  return done(next, [
    { type: 'selectNotes', ids: notesInSelection(next, ctx).map((n) => n.id) },
    { type: 'seek', beat: next.cursorBeat },
  ])
}

/** `Shift+1-4`: loop the transport over bars of the page.
 *
 *  The prototype looped a set of disjoint bars, playing 1 then 3 and skipping 2.
 *  cabin-visuals' transport has ONE contiguous loop region, so a disjoint pick
 *  is honoured as the span that covers it — bars 1 and 3 loop bars 1 THROUGH 3.
 *  Toggling every slot off disables the loop. */
function toggleLoopSlot(state: VimState, ctx: VimContext, slot: number): VimResult {
  const slots = state.loopSlots.includes(slot)
    ? state.loopSlots.filter((s) => s !== slot)
    : [...state.loopSlots, slot].sort((a, b) => a - b)

  if (slots.length === 0) {
    return done({ ...state, loopSlots: slots, count: '' }, [{ type: 'setLoop', range: null }])
  }
  const first = slotRange(state, ctx, slots[0])
  const last = slotRange(state, ctx, slots[slots.length - 1])
  return done({ ...state, loopSlots: slots, count: '' }, [
    { type: 'setLoop', range: { startBeat: first.startBeat, endBeat: last.endBeat } },
  ])
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

/** `jumpBack` is Shift+b: after the delete, put the cursor on the note before
 *  what was removed, so unwinding a phrase walks backwards through it. */
function deleteNotes(
  state: VimState,
  ctx: VimContext,
  doomed: Note[],
  nextState: VimState,
  jumpBack = false,
  referenceBeat = state.cursorBeat,
): VimResult {
  if (doomed.length === 0) return done({ ...nextState, count: '' })
  const ids = new Set(doomed.map((n) => n.id))
  const remaining = ctx.notes.filter((n) => !ids.has(n.id))
  const back = jumpBack ? previousNoteBefore(state, ctx, remaining, referenceBeat) : null

  const finalState: VimState = {
    ...nextState,
    count: '',
    actionPendingClear: false,
    ...(back ? { cursorBeat: back.beat, cursorRow: back.row } : {}),
  }
  return done(finalState, [
    { type: 'commitNotes', notes: remaining },
    { type: 'selectNotes', ids: [] },
    ...(back ? [{ type: 'seek' as const, beat: back.beat }] : []),
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
    timeRanges: null,
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

  const bounds = selectionBounds(state, ctx, state.selection)
  const span = bounds.endBeat - bounds.startBeat
  const copies = selected.map((n) => ({ ...n, id: ctx.newId(), startBeat: n.startBeat + span }))
  const nextNotes = [...ctx.notes, ...copies]
  const nextState: VimState = {
    ...state,
    count: '',
    cursorBeat: clamp(state.cursorBeat + span, 0, ctx.totalBeats),
    selection: {
      ...state.selection,
      anchorBeat: state.selection.anchorBeat + span,
      // Disjoint ranges travel as a body, so r on "bars 1 and 3" lands the pair
      // at bars 4 and 6 and stays repeatable.
      timeRanges: state.selection.timeRanges?.map((r) => ({
        startBeat: r.startBeat + span,
        endBeat: r.endBeat + span,
      })) ?? null,
    },
    // The region survives, so the next nav key means "walk away", not "reshape".
    actionPendingClear: true,
  }

  return done(nextState, [
    { type: 'commitNotes', notes: nextNotes },
    ...growthIntent(ctx, nextNotes),
    { type: 'selectNotes', ids: copies.map((n) => n.id) },
    { type: 'seek', beat: nextState.cursorBeat },
  ])
}

/**
 * `Shift+A` — select the page under the cursor, narrowed to the rows that
 * actually have notes in it. Grabbing every empty row too would make the next
 * note key (which toggles rows) start from a filter of forty rows nobody chose.
 */
function selectVisiblePage(state: VimState, ctx: VimContext): VimResult {
  const pageStart = pageStartBeat(state, ctx)
  const pageEnd = pageStart + VIM_PAGE_BARS * ctx.beatsPerBar
  const inPage = ctx.notes.filter((n) => {
    const beat = noteStartGlobal(ctx, n)
    return beat >= pageStart - EPS && beat < pageEnd - EPS
  })
  const rowsWithNotes = [...new Set(inPage.map((n) => rowIndexForPitch(ctx, n.pitch)))]
    .filter((r) => r >= 0)
    .sort((a, b) => a - b)

  const selection: VimSelection = {
    anchorBeat: pageStart,
    anchorRow: rowsWithNotes[0] ?? state.cursorRow,
    rowFilter: rowsWithNotes.length > 0 ? rowsWithNotes : null,
    timeRanges: [{ startBeat: pageStart, endBeat: pageEnd }],
  }
  const next: VimState = {
    ...state,
    mode: 'select',
    selection,
    cursorBeat: pageStart,
    cursorRow: rowsWithNotes[0] ?? state.cursorRow,
    count: '',
    actionPendingClear: false,
  }
  return done(next, [
    { type: 'selectNotes', ids: notesInSelection(next, ctx).map((n) => n.id) },
    { type: 'seek', beat: next.cursorBeat },
  ])
}

/** `;` / `'` — travel to the next note in TIME rather than stepping there.
 *  Same row first, since that's the line you're working on. */
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

/**
 * `/` and `\` — move between the notes stacked in the cursor's own COLUMN,
 * i.e. sounding at this beat on other rows. On a drum pattern this is how you
 * walk a hit's chord without knowing which rows are in it.
 */
function jumpToColumnNote(state: VimState, ctx: VimContext, direction: 1 | -1): VimResult {
  const cellEnd = state.cursorBeat + ctx.stepBeats
  const inColumn = ctx.notes
    .filter((n) => {
      const start = noteStartGlobal(ctx, n)
      return start < cellEnd - EPS && start + Math.max(n.durationBeats, EPS) > state.cursorBeat + EPS
    })
    .map((n) => rowIndexForPitch(ctx, n.pitch))
    .filter((r) => r >= 0 && (direction > 0 ? r > state.cursorRow : r < state.cursorRow))

  if (inColumn.length === 0) return done({ ...state, count: '' })
  const target = direction > 0 ? Math.min(...inColumn) : Math.max(...inColumn)
  const next = withCursor(state, ctx, state.cursorBeat, target)
  const intents: VimIntent[] = [{ type: 'seek', beat: next.cursorBeat }]
  if (next.selection) intents.push({ type: 'selectNotes', ids: notesInSelection(next, ctx).map((n) => n.id) })
  return done(next, intents)
}

/** The note before `referenceBeat`, preferring the cursor's own row — where
 *  `Shift+b` lands you after a delete, so backing out of a phrase walks it
 *  backwards instead of leaving the cursor in the hole it just made. */
function previousNoteBefore(state: VimState, ctx: VimContext, notes: Note[], referenceBeat: number) {
  const before = notes
    .map((n) => ({ note: n, beat: noteStartGlobal(ctx, n), row: rowIndexForPitch(ctx, n.pitch) }))
    .filter(({ beat }) => beat < referenceBeat - EPS)
  if (before.length === 0) return null
  return before.sort(
    (a, b) => b.beat - a.beat || Math.abs(a.row - state.cursorRow) - Math.abs(b.row - state.cursorRow),
  )[0]
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
  // Shift travels a PAGE horizontally (the same four bars the 1-4 keys address),
  // not a bar - a bar is what 1-4 are for, so shift is the coarser gear.
  const pageBeats = VIM_PAGE_BARS * ctx.beatsPerBar
  const noteRow = TYPING_KEY_SET.has(key) ? keyMap.get(key) : undefined

  // The key sheet swallows the next Escape, so `?` then Esc is a round trip.
  if (state.showSheet && (key === 'escape' || key === '?' || key === 'q')) {
    return done({ ...state, showSheet: false })
  }
  if (key === '?') return done({ ...state, showSheet: true })

  // Transport rides shifted, because bare Space and Enter are the note keys'.
  if (shift && key === ' ') return done(state, [{ type: 'togglePlay' }])
  if (shift && key === 'enter') return done(state, [{ type: 'returnToStart' }])

  // Shift+1-4 loops a bar of the page, in every mode - it's a monitoring
  // control, not an edit, so it never disturbs the cursor or the region.
  if (shift && /^[1-4]$/.test(key)) return toggleLoopSlot(state, ctx, Number.parseInt(key, 10))

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
  if (key === '(') {
    return done({ ...state, noteLengthBeats: cycleValue(VIM_NOTE_LENGTHS, state.noteLengthBeats, -1), count: '' })
  }
  if (key === ')') {
    return done({ ...state, noteLengthBeats: cycleValue(VIM_NOTE_LENGTHS, state.noteLengthBeats, 1), count: '' })
  }
  // `|` swaps the grid between a straight value and its triplet - a toggle, so
  // the ladder in [ ] stays straight and switching back is the same key.
  if (key === '|') {
    const straight = VIM_TRIPLET_OF.find(([s]) => Math.abs(s - ctx.stepBeats) < EPS)
    const triplet = VIM_TRIPLET_OF.find(([, t]) => Math.abs(t - ctx.stepBeats) < EPS)
    const next = straight ? straight[1] : triplet ? triplet[0] : null
    if (next === null) return done({ ...state, count: '' })
    return done({ ...state, count: '' }, [{ type: 'setQuantize', beats: next }])
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

    if (key === 'z') return nudge(shift ? -pageBeats : -ctx.stepBeats, 0)
    if (key === 'x') return nudge(shift ? pageBeats : ctx.stepBeats, 0)
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
    // Straight after a repeatable action (`r`), a nav key means "walk away from
    // what I just made", not "reshape it" - so r r r x leaves the phrase behind
    // with no Escape in between.
    if (state.actionPendingClear && (key === 'z' || key === 'x' || key === 'c' || key === 'v')) {
      const cleared: VimState = { ...state, mode: 'ground', selection: null, actionPendingClear: false }
      const walked = key === 'z' ? moveCursor(cleared, ctx, shift ? -pageBeats : -ctx.stepBeats, 0)
        : key === 'x' ? moveCursor(cleared, ctx, shift ? pageBeats : ctx.stepBeats, 0)
        : key === 'c' ? moveCursor(cleared, ctx, 0, shift ? bigStep : 1)
        : moveCursor(cleared, ctx, 0, shift ? -bigStep : -1)
      return done(walked.state, [...walked.intents, { type: 'selectNotes', ids: [] }])
    }

    if (/^[1-4]$/.test(key)) return togglePageBarSlot(state, ctx, Number.parseInt(key, 10))

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
        actionPendingClear: false,
      }
      return done(next, [{ type: 'selectNotes', ids: notesInSelection(next, ctx).map((n) => n.id) }])
    }
    if (key === 'z') return moveCursor(state, ctx, shift ? -pageBeats : -ctx.stepBeats, 0)
    if (key === 'x') return moveCursor(state, ctx, shift ? pageBeats : ctx.stepBeats, 0)
    if (key === 'c') return moveCursor(state, ctx, 0, shift ? bigStep : 1)
    if (key === 'v') return moveCursor(state, ctx, 0, shift ? -bigStep : -1)
    if (key === '/') return jumpToColumnNote(state, ctx, 1)
    if (key === '\\') return jumpToColumnNote(state, ctx, -1)
    if (key === ';') return jumpToNote(state, ctx, -1)
    if (key === "'") return jumpToNote(state, ctx, 1)
    if (key === 'a' && shift) return selectVisiblePage(state, ctx)
    if (key === 'r') return duplicateSelection(state, ctx)
    if (key === 'm') return startDraft(state, ctx, 'move')
    if (key === 'n') return startDraft(state, ctx, 'copy')
    if (key === 'b' || key === 'backspace' || key === 'delete') {
      const bounds = selectionBounds(state, ctx, state.selection)
      return deleteNotes(
        state,
        ctx,
        notesInSelection(state, ctx),
        { ...state, mode: 'ground', selection: null },
        key === 'b' && shift,
        bounds.startBeat,
      )
    }
    return done(state)
  }

  // --- ground: type notes ------------------------------------------------
  if (key === 'escape') {
    if (state.staging || state.staged.length > 0) return done({ ...state, staging: false, staged: [] })
    return done(state, [{ type: 'exit' }])
  }
  // `q` also forgets the last stamp, so the next `r` repeats the cursor's row
  // rather than something typed several edits ago.
  if (key === 'q') return done({ ...state, staging: false, staged: [], lastStamp: null, count: '' })

  if (key === 'tab') {
    return done({
      ...state,
      mode: 'select',
      staging: false,
      staged: [],
      count: '',
      actionPendingClear: false,
      selection: {
        anchorBeat: state.cursorBeat,
        anchorRow: state.cursorRow,
        rowFilter: null,
        timeRanges: null,
      },
    })
  }

  if (shift && key === 'a') return selectVisiblePage(state, ctx)

  if (noteRow !== undefined) {
    if (shift || state.staging) {
      const staged = state.staged.includes(noteRow)
        ? state.staged.filter((r) => r !== noteRow)
        : [...state.staged, noteRow]
      return done({ ...state, staged, cursorRow: noteRow, count: '' })
    }
    return placeStamp({ ...state, cursorRow: noteRow }, ctx, [noteRow], countOf(state), true)
  }

  // 1-4 hop to the bars of the current page, so getting somewhere is one key
  // rather than a count. The cost is that a count can only START at 5-9 - but
  // only start: a count already under way swallows any digit, so 52 is
  // reachable even though 12 is not. (The prototype dropped the count here and
  // hopped instead, which threw away unambiguous intent for nothing.)
  if (/^[1-4]$/.test(key) && state.count === '') return jumpToPageBar(state, ctx, Number.parseInt(key, 10))

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
  if (key === 'z') return moveCursor(state, ctx, shift ? -pageBeats : -ctx.stepBeats, 0)
  if (key === 'x') return moveCursor(state, ctx, shift ? pageBeats : ctx.stepBeats, 0)
  if (key === 'c') return moveCursor(state, ctx, 0, shift ? bigStep : 1)
  if (key === 'v') return moveCursor(state, ctx, 0, shift ? -bigStep : -1)
  if (key === '/') return jumpToColumnNote(state, ctx, 1)
  if (key === '\\') return jumpToColumnNote(state, ctx, -1)
  if (key === ';') return jumpToNote(state, ctx, -1)
  if (key === "'") return jumpToNote(state, ctx, 1)
  if (key === 'r') return duplicateSelection(state, ctx)
  if (key === 'm') return startDraft(state, ctx, 'move')
  if (key === 'n') return startDraft(state, ctx, 'copy')
  if (key === 'b' || key === 'backspace' || key === 'delete') {
    const target = noteUnderCursor(state, ctx)
    return deleteNotes(state, ctx, target ? [target] : [], state, key === 'b' && shift)
  }

  return unhandled(state)
}
