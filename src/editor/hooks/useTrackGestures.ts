import { useCallback, useEffect, type PointerEvent as ReactPointerEvent } from 'react'
import { useUIStore } from '../store/UIStore'
import { useProjectStore } from '../store/ProjectStore'

/**
 * Gesture state machine for the tracks timeline. Mirrors useNoteGestures in
 * shape, but its verbs write ProjectStore directly and continuously (no local
 * copy / debounce). This first slice covers block selection and keyboard.
 */
export function useTrackGestures() {
  const selectedBlockIds = useUIStore((s) => s.selectedBlockIds)
  const setSelectedBlockIds = useUIStore((s) => s.setSelectedBlockIds)

  // Click a block to select it (shift toggles within the current selection).
  const handleBlockPointerDown = useCallback((e: ReactPointerEvent, _trackId: string, blockId: string) => {
    e.stopPropagation()
    if (e.shiftKey) {
      const next = new Set(selectedBlockIds)
      if (next.has(blockId)) next.delete(blockId)
      else next.add(blockId)
      setSelectedBlockIds(next)
    } else if (!selectedBlockIds.has(blockId)) {
      setSelectedBlockIds(new Set([blockId]))
    }
  }, [selectedBlockIds, setSelectedBlockIds])

  // Pointer down on empty lane clears the selection (marquee added later).
  const handleLanePointerDown = useCallback((e: ReactPointerEvent) => {
    if (!e.shiftKey) setSelectedBlockIds(new Set())
  }, [setSelectedBlockIds])

  // Delete removes selected blocks; Escape clears the selection.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      if (selectedBlockIds.size === 0) return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        const { tracks, deleteBlock } = useProjectStore.getState()
        for (const [trackId, track] of Object.entries(tracks)) {
          for (const block of track.blocks) {
            if (selectedBlockIds.has(block.id)) deleteBlock(trackId, block.id)
          }
        }
        setSelectedBlockIds(new Set())
      } else if (e.key === 'Escape') {
        setSelectedBlockIds(new Set())
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [selectedBlockIds, setSelectedBlockIds])

  return { selectedBlockIds, handleBlockPointerDown, handleLanePointerDown }
}
