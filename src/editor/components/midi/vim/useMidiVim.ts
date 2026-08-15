import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Block, Note } from '../../../types'
import type { MidiRow } from '../types'
import { useTimeStore } from '../../../store/TimeStore'
import { useProjectStore } from '../../../store/ProjectStore'
import { useUIStore } from '../../../store/UIStore'
import { useHistoryStore } from '../../../store/HistoryStore'
import { anchorForCursor } from './keyMap'
import { notesInSelection, projectDraft, vimReduce } from './vimReducer'
import {
  initialVimState,
  type VimContext,
  type VimIntent,
  type VimKeyRegime,
  type VimState,
} from './types'

/** How long the two Shift presses may be apart and still read as one gesture. */
const DOUBLE_TAP_MS = 450

interface UseMidiVimOptions {
  enabled: boolean
  setEnabled: (on: boolean) => void
  rows: MidiRow[]
  regime: VimKeyRegime
  notes: Note[]
  trackId: string
  block: Block
  blockStartBeat: number
  blockDurationBeats: number
  beatsPerBar: number
  stepBeats: number
  totalBeats: number
  commit: (notes: Note[]) => void
  setQuantize: (beats: number) => void
  setSelectedNoteIds: (ids: Set<string>) => void
}

/**
 * Mounts midi vim over the piano roll.
 *
 * The keyboard listener sits on WINDOW in the CAPTURE phase, which is what puts
 * it ahead of everything else without touching any of it: capture runs
 * outermost-first, so this fires before `useNoteGestures`' document-capture
 * handler and long before the transport's bubble-phase listener. Keys vim
 * claims are stopped dead there; keys it doesn't claim are never touched, so
 * ⌘C/⌘V/⌘Z and the rest behave exactly as they do with vim off.
 *
 * Play/pause and return-to-start are the deliberate exception: vim recognises
 * them but lets the event through, because App already binds Shift+Space and
 * Enter to the real transport. Re-implementing them here would mean a second
 * `usePlayback`, and that hook re-initialises the playback engine.
 */
export function useMidiVim({
  enabled,
  setEnabled,
  rows,
  regime,
  notes,
  trackId,
  block,
  blockStartBeat,
  blockDurationBeats,
  beatsPerBar,
  stepBeats,
  totalBeats,
  commit,
  setQuantize,
  setSelectedNoteIds,
}: UseMidiVimOptions) {
  const [state, setState] = useState<VimState>(() => initialVimState(blockStartBeat, Math.floor(rows.length / 2), Math.floor(rows.length / 2)))
  const stateRef = useRef(state)
  stateRef.current = state

  // The reducer reads all of this and owns none of it, so it's rebuilt per
  // keystroke from a ref rather than captured in the listener's closure.
  const ctxRef = useRef<VimContext>(null as unknown as VimContext)
  ctxRef.current = {
    rows,
    regime,
    notes,
    blockStartBeat,
    blockDurationBeats,
    beatsPerBar,
    stepBeats,
    totalBeats,
    newId: () => crypto.randomUUID(),
  }

  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  // Behind a ref, not in the listener's deps: callers pass an inline arrow, and
  // the roll re-renders on every note edit, so a dep would tear down and
  // re-register a window capture listener on each keystroke.
  const setEnabledRef = useRef(setEnabled)
  setEnabledRef.current = setEnabled
  const commitRef = useRef(commit)
  commitRef.current = commit
  const setQuantizeRef = useRef(setQuantize)
  setQuantizeRef.current = setQuantize
  const setSelectedRef = useRef(setSelectedNoteIds)
  setSelectedRef.current = setSelectedNoteIds
  const blockRef = useRef(block)
  blockRef.current = block

  const applyIntents = useCallback((intents: VimIntent[]) => {
    for (const intent of intents) {
      switch (intent.type) {
        case 'commitNotes':
          commitRef.current(intent.notes)
          break
        case 'growBlockTo': {
          // Typing past the end grows the clip rather than walling the cursor
          // in. Written before the notes so the block already covers them.
          const bars = Math.ceil(intent.endBeatLocal / beatsPerBar)
          if (bars > blockRef.current.durationBars) {
            useProjectStore.getState().updateBlock(trackId, blockRef.current.id, { durationBars: bars })
          }
          break
        }
        case 'selectNotes':
          setSelectedRef.current(new Set(intent.ids))
          break
        case 'seek':
          // Paused, the viewport is showing the beat under the cursor - that's
          // this editor's audition. Playing, the transport owns the playhead.
          if (!useTimeStore.getState().isPlaying) useTimeStore.getState().setCurrentBeat(intent.beat)
          break
        case 'setQuantize':
          setQuantizeRef.current(intent.beats)
          break
        case 'zoom': {
          const current = useUIStore.getState().midiPixelsPerBeat
          useUIStore.getState().setMidiPixelsPerBeat(intent.direction > 0 ? current * 1.25 : current / 1.25)
          break
        }
        case 'undo':
          useHistoryStore.getState().undo()
          break
        case 'redo':
          useHistoryStore.getState().redo()
          break
        case 'exit':
          setEnabledRef.current(false)
          setSelectedRef.current(new Set())
          break
        case 'togglePlay':
        case 'returnToStart':
          // Handled by App's transport keys - see the note above.
          break
      }
    }
  }, [beatsPerBar, trackId])

  // Growth has to land before the notes that caused it, and the switch above
  // walks intents in order, so the reducer emits commitNotes first for
  // readability and we sort growth to the front here.
  const applyOrdered = useCallback((intents: VimIntent[]) => {
    const growth = intents.filter((i) => i.type === 'growBlockTo')
    applyIntents([...growth, ...intents.filter((i) => i.type !== 'growBlockTo')])
  }, [applyIntents])

  // --- entering: double-tap Shift ----------------------------------------
  // Always live, even with vim off, because that's how it gets turned on.
  const shiftHeldRef = useRef(false)
  const shiftUsedRef = useRef(false)
  const lastTapRef = useRef(0)

  useEffect(() => {
    // SELECT belongs here alongside the text fields: vim stops the keys it
    // claims dead, so without this a note key typed at the open grid dropdown
    // would write a note and never reach the dropdown.
    const isTypingTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return

      if (e.key === 'Shift') {
        if (!e.repeat) {
          shiftHeldRef.current = true
          shiftUsedRef.current = false
        }
        return
      }
      // Any other key while Shift is down makes it a modifier, not a tap.
      if (shiftHeldRef.current) shiftUsedRef.current = true

      if (!enabledRef.current) return

      const key = normalizeKey(e)
      if (!key) return

      const result = vimReduce(
        stateRef.current,
        { type: 'key', key, shift: e.shiftKey, meta: e.metaKey || e.ctrlKey },
        ctxRef.current,
      )
      if (!result.handled) return

      const passThrough = result.intents.some((i) => i.type === 'togglePlay' || i.type === 'returnToStart')
      if (!passThrough) {
        e.preventDefault()
        e.stopImmediatePropagation()
      }

      stateRef.current = result.state
      setState(result.state)
      applyOrdered(result.intents)
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'Shift') return
      const wasTap = shiftHeldRef.current && !shiftUsedRef.current
      shiftHeldRef.current = false
      if (!wasTap || isTypingTarget(e.target)) return

      const now = Date.now()
      const isDouble = now - lastTapRef.current < DOUBLE_TAP_MS
      lastTapRef.current = isDouble ? 0 : now

      if (!enabledRef.current) {
        if (isDouble) setEnabledRef.current(true)
        return
      }
      // Inside vim a single tap latches chord staging (a double tap is two
      // latches, i.e. a harmless no-op). Escape or the chip is the way out.
      const result = vimReduce(stateRef.current, { type: 'shiftTap' }, ctxRef.current)
      stateRef.current = result.state
      setState(result.state)
      applyOrdered(result.intents)
    }

    const onBlur = () => {
      shiftHeldRef.current = false
      shiftUsedRef.current = false
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [applyOrdered, setEnabled])

  // Entering parks the cursor on the playhead if it's over this block, else at
  // the block's start - the same "where were you looking" rule the roll's own
  // auto-scroll uses.
  useEffect(() => {
    if (!enabled) return
    const currentBeat = useTimeStore.getState().currentBeat
    const inBlock = currentBeat >= blockStartBeat && currentBeat < blockStartBeat + blockDurationBeats
    const startBeat = inBlock ? Math.round(currentBeat / stepBeats) * stepBeats : blockStartBeat
    const lastNote = [...notes].sort((a, b) => b.startBeat - a.startBeat)[0]
    const rowForLast = lastNote ? rows.findIndex((r) => r.pitch === lastNote.pitch) : -1
    const row = rowForLast >= 0 ? rowForLast : Math.floor(rows.length / 2)
    const next = initialVimState(startBeat, row, anchorForCursor(row, row, rows.length))
    stateRef.current = next
    setState(next)
    // Only on the enable edge: re-running this on every note edit would yank
    // the cursor back mid-phrase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  // The row list can change under the cursor (track switch, a pad added).
  useEffect(() => {
    if (!enabled) return
    const result = vimReduce(stateRef.current, { type: 'clamp' }, ctxRef.current)
    stateRef.current = result.state
    setState(result.state)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, enabled])

  // Leaving takes the region's selection with it, so the roll doesn't keep
  // notes lit that nothing is pointing at any more.
  useEffect(() => {
    if (enabled) return
    setSelectedRef.current(new Set())
  }, [enabled])

  const setCursorFromPointer = useCallback((beat: number, row: number) => {
    const result = vimReduce(stateRef.current, { type: 'setCursor', beat, row }, ctxRef.current)
    stateRef.current = result.state
    setState(result.state)
    applyOrdered(result.intents)
  }, [applyOrdered])

  /** Clicking the sheet's scrim closes it — Escape does the same through the
   *  reducer, which is also what makes Escape's first press a no-op on the mode. */
  const closeSheet = useCallback(() => {
    const next = { ...stateRef.current, showSheet: false }
    stateRef.current = next
    setState(next)
  }, [])

  const draftGhosts = useMemo(
    () => (enabled && state.draft ? projectDraft(state, ctxRef.current) : []),
    [enabled, state],
  )

  const selectionSpanRows = useMemo(() => {
    if (!enabled || !state.selection) return null
    const rowsIn = state.selection.rowFilter
      ? [...state.selection.rowFilter]
      : (() => {
          const lo = Math.min(state.selection.anchorRow, state.cursorRow)
          const hi = Math.max(state.selection.anchorRow, state.cursorRow)
          return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
        })()
    return {
      rows: rowsIn,
      startBeat: Math.min(state.selection.anchorBeat, state.cursorBeat),
      endBeat: Math.max(state.selection.anchorBeat, state.cursorBeat) + stepBeats,
    }
  }, [enabled, state, stepBeats])

  return {
    state,
    setCursorFromPointer,
    closeSheet,
    draftGhosts,
    selectionSpanRows,
    /** What the region currently covers - used for the status line's count. */
    selectedCount: enabled && state.selection ? notesInSelection(state, ctxRef.current).length : 0,
  }
}

/** Browser key → the reducer's vocabulary. Arrows alias onto the nav cluster so
 *  the mode is usable before the `z x c v` shape is in the fingers. */
function normalizeKey(e: KeyboardEvent): string | null {
  switch (e.key) {
    case 'ArrowLeft': return 'z'
    case 'ArrowRight': return 'x'
    case 'ArrowDown': return 'c'
    case 'ArrowUp': return 'v'
    case 'Enter': return 'enter'
    case 'Escape': return 'escape'
    case 'Tab': return 'tab'
    case 'Backspace': return 'backspace'
    case 'Delete': return 'delete'
    case ' ': return ' '
    default:
      break
  }
  if (e.key.length !== 1) return null
  return e.key.toLowerCase()
}
