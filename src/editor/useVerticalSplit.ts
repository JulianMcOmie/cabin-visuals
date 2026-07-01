import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useUIStore } from './store/UIStore'
import { lockCursor, unlockCursor } from './utils/dragCursor'

/** How far (px) the invisible grab pad reaches above and below the 1px divider line. */
export const DIVIDER_GRAB_INSET = 5

/**
 * Hand-rolled vertical split between the upper (editor + canvas) region and the
 * tracks / piano-roll below.
 *
 * Deliberately NOT react-resizable-panels for THIS divider: the library makes a thin
 * handle grabbable via a document-level "phantom" hit that fires alongside other
 * pointerdown handlers and can't be told to stop propagating — so it double-fires
 * with the ruler scrub sitting directly beneath it. A real grab element (topmost +
 * stopPropagation) is the only way to get a 1px line AND a grab that resizes only.
 * The other splits keep the library since nothing competes with them.
 *
 * Returns the live fraction, a ref for the measured container, and the pointer-down
 * handler to wire onto the divider's grab pad.
 */
export function useVerticalSplit() {
  const containerRef = useRef<HTMLDivElement>(null)
  const topFrac = useUIStore((s) => s.topPanelFraction)
  const setTopPanelFraction = useUIStore((s) => s.setTopPanelFraction)

  const startResize = useCallback((e: ReactPointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    lockCursor('ns-resize')
    const controller = new AbortController()
    window.addEventListener('pointermove', (ev) => {
      const c = containerRef.current
      if (!c) return
      const r = c.getBoundingClientRect()
      setTopPanelFraction((ev.clientY - r.top) / r.height) // the store clamps
    }, { signal: controller.signal })
    window.addEventListener('pointerup', () => { controller.abort(); unlockCursor() }, { signal: controller.signal })
  }, [setTopPanelFraction])

  return { topFrac, containerRef, startResize }
}
