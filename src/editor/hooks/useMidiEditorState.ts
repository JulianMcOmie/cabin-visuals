import { useEffect, useRef, useState } from 'react'
import type { Block, Note } from '../types'
import { useProjectStore } from '../store/ProjectStore'

interface UseMidiEditorStateOptions {
  trackId: string
  block: Block
  defaultQuantize: number
}

/**
 * Editor-local note state with debounced coarse writes.
 *
 * The piano roll edits a local copy of the block's notes at interaction
 * speed; the ProjectStore is only written via updateBlockNotes after 500ms
 * of inactivity. Store changes that did NOT come from our own save (undo,
 * block switch, external edits) re-extract the local copy. Our own save
 * echoing back through the store is detected with localEditRef and skipped,
 * so in-flight edits are never clobbered.
 *
 * Change detection uses block object identity: the store creates a new
 * block object on every change, so `prevBlockRef !== block` is exact.
 */
export function useMidiEditorState({ trackId, block, defaultQuantize }: UseMidiEditorStateOptions) {
  const updateBlockNotes = useProjectStore((s) => s.updateBlockNotes)

  const [quantize, setQuantize] = useState(defaultQuantize)
  const [notes, setNotes] = useState<Note[]>(() => block.notes)

  const localEditRef = useRef(false)
  const prevBlockRef = useRef<Block>(block)
  const prevBlockIdRef = useRef(block.id)

  useEffect(() => {
    if (prevBlockRef.current === block) return
    const blockChanged = prevBlockIdRef.current !== block.id
    prevBlockRef.current = block
    prevBlockIdRef.current = block.id

    if (localEditRef.current && !blockChanged) {
      // This change came from our own auto-save writing back to the store — skip
      localEditRef.current = false
      return
    }
    localEditRef.current = false
    setNotes(block.notes)
  }, [block])

  // Auto-save when notes change
  useEffect(() => {
    if (notes === block.notes) return
    const timeout = setTimeout(() => {
      localEditRef.current = true
      updateBlockNotes(trackId, block.id, notes)
    }, 500)
    return () => clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, trackId, block.id, updateBlockNotes])

  return {
    notes,
    setNotes,
    quantize,
    setQuantize,
  }
}
