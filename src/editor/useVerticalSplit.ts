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
 * pointerdown handlers and can't be told to stop propagating - so it double-fires
 * with the ruler scrub sitting directly beneath it. A real grab element (topmost +
 * stopPropagation) is the only way to get a 1px line AND a grab that resizes only.
 * The other splits keep the library since nothing competes with them.
 *
 * Returns the live fraction, a ref for the measured container, and the pointer-down
 * handler to wire onto the divider's grab pad.
 */
export function useVerticalSplit() {
  const containerRef = useRef<HTMLDivElement>(null)
  // The upper panel itself: during a drag its flex-basis is written straight
  // to the DOM and the store is only told the final fraction on release.
  // Streaming every pointermove through the store re-rendered the whole
  // editor root (header, library, inspector, timeline...) per frame - the
  // canvas resize is the only per-frame work this gesture actually needs.
  const topPanelRef = useRef<HTMLDivElement>(null)
  const topFrac = useUIStore((s) => s.topPanelFraction)
  const setTopPanelFraction = useUIStore((s) => s.setTopPanelFraction)

  const startResize = useCallback((e: ReactPointerEvent) => {
    const panel = topPanelRef.current
    if (!panel) return
    // Both edges of the scene bar move the same split. Preserve the grab
    // offset so starting at the lower edge doesn't jump by the bar's height.
    const grabOffset = e.clientY - panel.getBoundingClientRect().bottom
    e.preventDefault()
    e.stopPropagation()
    lockCursor('ns-resize')
    const controller = new AbortController()
    let last: number | null = null
    window.addEventListener('pointermove', (ev) => {
      const c = containerRef.current
      if (!c) return
      const r = c.getBoundingClientRect()
      // Same clamp as the store's setter, so the live preview never shows a
      // size the commit would then snap away from.
      last = Math.max(0.3, Math.min(0.85, (ev.clientY - grabOffset - r.top) / r.height))
      if (topPanelRef.current) topPanelRef.current.style.flexBasis = `${last * 100}%`
    }, { signal: controller.signal })
    const onUp = () => {
      controller.abort()
      unlockCursor()
      if (last !== null) setTopPanelFraction(last)
    }
    window.addEventListener('pointerup', onUp, { signal: controller.signal })
    window.addEventListener('pointercancel', onUp, { signal: controller.signal })
  }, [setTopPanelFraction])

  return { topFrac, containerRef, topPanelRef, startResize }
}
