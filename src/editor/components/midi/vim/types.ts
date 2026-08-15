import type { Note } from '../../../types'
import type { MidiRow } from '../types'

/**
 * midi vim — a modal, keyboard-only note editor layered over the piano roll.
 *
 * The grammar is a tracker's, not hjkl-vim's: the note keys are Logic's musical
 * typing row (`a w s e d f t g y h u j k o l p`), which eats most of the
 * alphabet, so navigation lives on `z x c v` and the operators on what's left.
 * What IS vim about it: modes, a cursor with a size, count prefixes, and
 * operators that act on a region.
 *
 * The reducer here owns NO notes. It owns the cursor, the mode, the region and
 * the prefs, and emits INTENTS the host applies through the roll's existing
 * `commit()` — so every op is one store write, hence one undo step, and
 * HistoryStore needs to know nothing about this feature.
 */

export type VimMode = 'ground' | 'select' | 'draft'

/**
 * How the 16 note keys land on rows, which depends on what the rows MEAN:
 * - `chromatic`  full piano — `a` is the C of the current octave, keys ascend by semitone.
 * - `vocabulary` declared rows (trigger lanes, video/photo pads, style lanes) — keys map
 *                positionally from an anchor row upward.
 * - `value`      automation lanes, where pitch encodes a param value — the 16 keys spread
 *                across the whole range, so `a` is the minimum and `p` the maximum.
 */
export type VimKeyRegime = 'chromatic' | 'vocabulary' | 'value'

/** A half-open span of absolute beats: `[startBeat, endBeat)`. */
export interface VimTimeRange {
  startBeat: number
  endBeat: number
}

/** Region selection. The head is always the cursor, so only the anchor is stored.
 *
 *  Both filters are null by default and mean "whatever the anchor and the cursor
 *  span". Setting either switches that axis to an EXPLICIT set, which is what
 *  makes disjoint selections possible: `rowFilter` is built by pressing note keys,
 *  `timeRanges` by toggling bar slots with 1-4 — so "the kick and snare rows, in
 *  bars 1 and 3" is one selection. */
export interface VimSelection {
  anchorBeat: number
  anchorRow: number
  rowFilter: number[] | null
  timeRanges: VimTimeRange[] | null
}

/** A move/copy in flight: nudged with the nav keys, committed with its own key. */
export interface VimDraft {
  kind: 'move' | 'copy'
  noteIds: string[]
  offsetBeats: number
  offsetRows: number
  /** Whether a real region started this, or the draft grabbed the note under
   *  the cursor and synthesized one. Cancelling must return you to the mode you
   *  were actually in, not to a select mode you never entered. */
  fromSelection: boolean
}

export interface VimStamp {
  rows: number[]
  lengthBeats: number
  velocity: number
}

export interface VimState {
  mode: VimMode
  /** Cursor position in ABSOLUTE project beats (the same space as the playhead). */
  cursorBeat: number
  /** Cursor row as an index into `rows` — 0 is the top row (highest pitch). */
  cursorRow: number
  /** Duration written into placed notes, in beats. The cursor's own step is the
   *  roll's quantize, which vim drives rather than duplicates. */
  noteLengthBeats: number
  /** Row that the `a` key currently lands on; the 16-key window runs upward from it. */
  anchorRow: number
  /** Pending count prefix ("12" then a note key = place it twelve times). */
  count: string
  /** Rows staged for a chord, waiting on Enter. */
  staged: number[]
  /** Shift-tap latches staging, so chords don't need the modifier held. */
  staging: boolean
  selection: VimSelection | null
  draft: VimDraft | null
  lastStamp: VimStamp | null
  showSheet: boolean
  /** Bars of the current page currently looped by Shift+1-4 (1-based slots). */
  loopSlots: number[]
  /** Set by an action that LEAVES its region selected and repeatable (`r`). The
   *  next nav key then clears the region and moves, instead of re-shaping it —
   *  so `r r r` builds a phrase and `x` walks away from it, with no Escape in
   *  between. Ported from the prototype's `selectionActionPendingClear`. */
  actionPendingClear: boolean
}

export type VimAction =
  | { type: 'key'; key: string; shift: boolean; meta: boolean }
  /** Shift pressed and released with nothing in between — latches chord staging. */
  | { type: 'shiftTap' }
  /** A pointer gesture moved the cursor (click on the grid). */
  | { type: 'setCursor'; beat: number; row: number }
  /** Rows changed under us (track switch, vocabulary edit) — re-clamp. */
  | { type: 'clamp' }

export type VimIntent =
  /** Replace the block's notes; the host routes this through `commit()`. */
  | { type: 'commitNotes'; notes: Note[] }
  /** The cursor ran past the block's end — grow it to cover this block-local beat. */
  | { type: 'growBlockTo'; endBeatLocal: number }
  /** Project the region onto the roll's own selection, so the existing
   *  selection visuals and mouse ops see exactly what vim sees. */
  | { type: 'selectNotes'; ids: string[] }
  /** Move the playhead to the cursor: on a visual DAW the viewport is the audition. */
  | { type: 'seek'; beat: number }
  | { type: 'setQuantize'; beats: number }
  | { type: 'zoom'; direction: 1 | -1 }
  /** Loop the transport over these absolute beats; null disables the loop. */
  | { type: 'setLoop'; range: VimTimeRange | null }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'togglePlay' }
  | { type: 'returnToStart' }
  | { type: 'exit' }

export interface VimResult {
  state: VimState
  intents: VimIntent[]
  /** False = vim did not claim this key, so the host must let it through to
   *  cabin-visuals' own shortcuts (⌘C, ⌘Z, the transport) untouched. */
  handled: boolean
}

/** Everything the reducer reads but never owns. */
export interface VimContext {
  rows: MidiRow[]
  regime: VimKeyRegime
  /** The block's notes, block-local (`startBeat` is relative to the block). */
  notes: Note[]
  blockStartBeat: number
  blockDurationBeats: number
  beatsPerBar: number
  /** The roll's effective quantize, in beats — this is the cursor's step. */
  stepBeats: number
  totalBeats: number
  /** Injected so the reducer stays deterministic under test. */
  newId: () => string
}

export const DEFAULT_VELOCITY = 100

/**
 * midi vim's signature color — deliberately NOT the edited track's hue. Track
 * colors cycle, so a per-track accent would make "the keyboard is claimed"
 * look different every time; one constant color means the mode is recognisable
 * at a glance. Kept as hex because the overlays append alpha suffixes to it.
 */
export const VIM_ACCENT = '#5ad1e8'

/** Note lengths `(` / `)` cycle through, in beats. */
export const VIM_NOTE_LENGTHS = [1 / 8, 1 / 6, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 1, 1.5, 2, 3, 4, 8]

/** Grid steps `[` / `]` cycle through, in beats. Written to the roll's quantize.
 *  Straight values only — `|` swaps the current one for its triplet. */
export const VIM_GRID_STEPS = [1 / 8, 1 / 4, 1 / 2, 1, 2, 4]

/** Triplet counterparts, keyed by the straight step they replace: three in the
 *  space of two, so `|` is a toggle rather than another rung on the ladder. */
export const VIM_TRIPLET_OF: [straight: number, triplet: number][] = [
  [1 / 8, 1 / 12],
  [1 / 4, 1 / 6],
  [1 / 2, 1 / 3],
  [1, 2 / 3],
  [2, 4 / 3],
  [4, 8 / 3],
]

/**
 * How many bars the `1-4` keys address. The prototype's "page" — the cursor's
 * position rounds down to a page boundary and the four keys hop to the bars
 * inside it, so the digits always mean something local and never need a target
 * typed out. `Shift+z/x` travels a whole page at a time.
 */
export const VIM_PAGE_BARS = 4

export function initialVimState(cursorBeat: number, cursorRow: number, anchorRow: number): VimState {
  return {
    mode: 'ground',
    cursorBeat,
    cursorRow,
    noteLengthBeats: 0.5,
    anchorRow,
    count: '',
    staged: [],
    staging: false,
    selection: null,
    draft: null,
    lastStamp: null,
    showSheet: false,
    loopSlots: [],
    actionPendingClear: false,
  }
}
