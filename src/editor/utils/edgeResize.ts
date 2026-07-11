import type { PointerEvent as ReactPointerEvent } from 'react'
import { lockCursor, unlockCursor } from './dragCursor'

/**
 * Drag-resize a column edge: locks the cursor for the gesture and streams
 * width = startWidth + dx into `setWidth` until release. Clamping is the
 * setter's job (the store owns its own bounds). Shared by the tracks label
 * column and the MIDI editor's label gutter so the two feel identical.
 */
export function startEdgeResize(
  e: ReactPointerEvent,
  startWidth: number,
  setWidth: (px: number) => void,
) {
  e.preventDefault()
  e.stopPropagation()
  const startX = e.clientX
  lockCursor('ew-resize')
  const controller = new AbortController()
  window.addEventListener('pointermove', (ev) => {
    setWidth(startWidth + (ev.clientX - startX))
  }, { signal: controller.signal })
  window.addEventListener('pointerup', () => {
    controller.abort()
    unlockCursor()
  }, { signal: controller.signal })
}
