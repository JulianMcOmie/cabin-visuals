import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Block, Note } from '../../types'
import { useProjectStore } from '../../store/ProjectStore'

// Layout effect on the client (runs before paint, so re-syncing notes after an
// atomic block change never shows an intermediate frame); plain effect on the
// server to avoid the SSR warning.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

interface UseMidiEditorStateOptions {
  trackId: string
  block: Block
  defaultQuantize: number
  /** Set when editing a block in an ability lane, so commits write to the lane. */
  laneKey?: string
}

/**
 * Editor-local note state with per-gesture commits.
 *
 * The piano roll edits a local copy of the block's notes at interaction speed,
 * so a drag never writes the store on every frame. The store is written via
 * `commit` exactly once per note gesture — on pointer-up, and after discrete
 * edits like delete/paste. One store write per gesture means one undo step per
 * gesture, so fast note editing stays individually undoable (nothing is batched
 * together the way a debounced timer-save would merge rapid edits).
 *
 * Store changes that did NOT come from our own commit (undo, block switch,
 * external edits) re-extract the local copy. Our own write echoing back through
 * the store is detected with localEditRef and skipped, so in-flight edits are
 * never clobbered. Change detection uses block object identity: the store
 * creates a new block object on every change, so `prevBlockRef !== block` is exact.
 */
export function useMidiEditorState({ trackId, block, defaultQuantize, laneKey }: UseMidiEditorStateOptions) {
  const updateBlockNotes = useProjectStore((s) => s.updateBlockNotes)

  const [quantize, setQuantize] = useState(defaultQuantize)
  const [notes, setNotes] = useState<Note[]>(() => block.notes)

  const localEditRef = useRef(false)
  const prevBlockRef = useRef<Block>(block)
  const prevBlockIdRef = useRef(block.id)
  // Latest block, read by commit() from gesture pointer-up listeners.
  const blockRef = useRef(block)
  blockRef.current = block

  useIsomorphicLayoutEffect(() => {
    if (prevBlockRef.current === block) return
    const blockChanged = prevBlockIdRef.current !== block.id
    prevBlockRef.current = block
    prevBlockIdRef.current = block.id

    if (localEditRef.current && !blockChanged) {
      // This change came from our own commit writing back to the store — skip
      localEditRef.current = false
      return
    }
    localEditRef.current = false
    setNotes(block.notes)
  }, [block])

  // Persist a gesture's result to the store as a single write (= one undo step).
  // setNotes keeps the local copy in sync for discrete edits (delete/paste),
  // where the caller hasn't already streamed the change through setNotes during
  // a drag. localEditRef marks the write as ours so the layout effect doesn't
  // re-extract the echo and clobber the local copy.
  const commit = useCallback((next: Note[]) => {
    setNotes(next)
    if (next === blockRef.current.notes) return
    localEditRef.current = true
    updateBlockNotes(trackId, blockRef.current.id, next, laneKey)
  }, [trackId, laneKey, updateBlockNotes])

  return {
    notes,
    setNotes,
    commit,
    quantize,
    setQuantize,
  }
}
