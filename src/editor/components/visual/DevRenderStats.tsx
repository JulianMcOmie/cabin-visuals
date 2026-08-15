import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'

/**
 * Dev-only draw-call readout: draws / triangles / compiled programs, sampled
 * twice a second from `gl.info`. This is the measuring stick for renderer
 * work - instancing and pass-skipping claims are checked here, and a perf
 * regression reads as a jump in the draws number.
 *
 * three resets `gl.info` after EVERY `render()` call by default, and
 * VisualScene issues many per frame (scene targets, filters, compositor), so
 * autoReset would leave only the last pass's numbers. This component owns the
 * counters instead: autoReset off, one manual reset per frame AFTER
 * VisualScene's priority-100 render (this useFrame runs at 1000), so the
 * numbers are per-FRAME totals across all passes.
 *
 * Off by default so the overlay never photobombs a take: toggle with
 * `window.__cabinRenderStats(true|false)` (persists via localStorage).
 */
const FLAG_KEY = 'cabin:renderStats'

export function DevRenderStats() {
  const gl = useThree((s) => s.gl)
  const elRef = useRef<HTMLDivElement | null>(null)
  const onRef = useRef(false)
  useEffect(() => {
    onRef.current = localStorage.getItem(FLAG_KEY) === '1'
    const div = document.createElement('div')
    div.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:9999;font:11px/1.5 ui-monospace,monospace;color:#a1a1aa;background:rgba(9,9,11,.75);padding:4px 8px;border-radius:6px;pointer-events:none;white-space:pre;display:none'
    document.body.appendChild(div)
    elRef.current = div
    ;(window as unknown as Record<string, unknown>).__cabinRenderStats = (on: boolean) => {
      onRef.current = !!on
      localStorage.setItem(FLAG_KEY, on ? '1' : '0')
      div.style.display = on ? 'block' : 'none'
    }
    if (onRef.current) div.style.display = 'block'
    gl.info.autoReset = false
    return () => {
      gl.info.autoReset = true
      delete (window as unknown as Record<string, unknown>).__cabinRenderStats
      div.remove()
    }
  }, [gl])
  const lastSample = useRef(0)
  useFrame(() => {
    const info = gl.info
    if (onRef.current && elRef.current) {
      const now = performance.now()
      if (now - lastSample.current > 500) {
        lastSample.current = now
        elRef.current.textContent =
          `draws ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(1)}k  progs ${info.programs?.length ?? 0}`
      }
    }
    // Per-frame totals: reset AFTER the frame's passes have all counted.
    info.reset()
  }, 1000)
  return null
}
