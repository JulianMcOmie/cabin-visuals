'use client'

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useProjectStore, MIN_BPM, MAX_BPM } from '../store/ProjectStore'
import { getPlaybackEngine } from '../core/playback'
import { lockCursor, unlockCursor } from '../utils/dragCursor'

// Vertical drag sensitivity: bpm change per pixel (up = faster).
const BPM_PER_PX = 0.5
// Two pointer-downs within this window (ms) count as a double-click → type mode.
const DOUBLE_CLICK_MS = 350

// Quiet corner readout - theme mono, no LCD chrome.
const LCD_VALUE = 'font-mono text-[12px] leading-none tabular-nums'
const LCD_CAPTION =
  'font-mono text-[8px] font-semibold uppercase tracking-[0.12em] leading-none text-[#5a6274] select-none'

/**
 * Tempo cell of the transport display. The value is a vertical drag scrubber
 * (up = faster), a double-click-to-type field, a scroll-wheel target (shift
 * for ±10), and an arrow-key nudge when focused; a stepper pair fades in on
 * hover to advertise that any of this exists. Writes the project store; the
 * live transport follows via the bpm subscription in usePlayback.
 */
export function BpmControl() {
  const bpm = useProjectStore((s) => s.bpm)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const lastDownRef = useRef(0)
  const groupRef = useRef<HTMLDivElement>(null)

  const commit = () => {
    // Decimals allowed: typing "106.4" means 106.4 (setBpm keeps two decimals).
    // Dragging and stepping stay whole BPM - precision is a typing gesture.
    const n = parseFloat(draft)
    if (!Number.isNaN(n)) {
      useProjectStore.getState().setBpm(Math.max(MIN_BPM, Math.min(MAX_BPM, n)))
    }
    setEditing(false)
  }

  // Whole-BPM step from the current value (rounded first so 106.4 → 107, not 107.4).
  const nudge = (dir: 1 | -1, step = 1) => {
    const cur = useProjectStore.getState().bpm
    useProjectStore.getState().setBpm(Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(cur) + dir * step)))
  }

  // Wheel needs a non-passive native listener to preventDefault; React's
  // synthetic onWheel is registered passive.
  useEffect(() => {
    const el = groupRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return
      e.preventDefault()
      nudge(e.deltaY < 0 ? 1 : -1, e.shiftKey ? 10 : 1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const startEditing = () => {
    setDraft(String(useProjectStore.getState().bpm))
    setEditing(true)
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    // Double-click (two downs close in time) enters type-to-edit; detected by
    // timing so it doesn't depend on pointer-event `detail`, which browsers
    // populate inconsistently.
    const now = e.timeStamp
    if (now - lastDownRef.current < DOUBLE_CLICK_MS) {
      lastDownRef.current = 0
      e.preventDefault()
      startEditing()
      return
    }
    lastDownRef.current = now

    e.preventDefault()
    const startY = e.clientY
    const startBpm = useProjectStore.getState().bpm
    lockCursor('ns-resize')
    // Audio keeps sounding through the drag; only the re-arm is deferred to the
    // release. Without this the per-move tempo writes re-arm every block on
    // every pointermove and stack into a runaway gain sum (see beginBpmDrag).
    getPlaybackEngine().beginBpmDrag()

    const controller = new AbortController()
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(
        MIN_BPM,
        Math.min(MAX_BPM, Math.round(startBpm + (startY - ev.clientY) * BPM_PER_PX)),
      )
      useProjectStore.getState().setBpm(next)
    }
    const onUp = () => {
      unlockCursor()
      getPlaybackEngine().endBpmDrag()
      controller.abort()
    }
    window.addEventListener('pointermove', onMove, { signal: controller.signal })
    window.addEventListener('pointerup', onUp, { signal: controller.signal })
    // pointercancel too: a cancelled gesture that never released would leave the
    // drag flag set, and every later tempo change would skip its re-arm.
    window.addEventListener('pointercancel', onUp, { signal: controller.signal })
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      nudge(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey ? 10 : 1)
    } else if (e.key === 'Enter') {
      // Enter must not bubble to the transport keys' window listener (which
      // would reset playback); it opens type mode instead.
      e.preventDefault()
      e.stopPropagation()
      startEditing()
    }
  }

  // Readout and input share identical metrics (font, ch-based width), so
  // toggling edit mode never reflows. Three figures are always reserved -
  // dragging across 99 ↔ 100 must not shift the centered cluster - and the
  // width only grows past that for typed decimals ("106.4").
  const chWidth = (len: number) => ({ width: `${Math.max(3, len)}ch` })

  return (
    // The cell owns its own padding + hover wash (same as PositionCell) so the
    // whole tempo region reads as one control, not just the numerals.
    <div
      ref={groupRef}
      className="group flex items-center gap-1 px-1 "
    >
      <div className="flex items-baseline gap-1.5">
        {editing ? (
          <input
            autoFocus
            type="text"
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              else if (e.key === 'Escape') setEditing(false)
            }}
            style={chWidth(draft.length)}
            className={`${LCD_VALUE} border-0 bg-transparent p-0 text-[var(--text)] caret-[var(--accent)] outline-none`}
          />
        ) : (
          <button
            type="button"
            onPointerDown={onPointerDown}
            onKeyDown={onKeyDown}
            title="Drag or scroll to change tempo - double-click to type"
            style={chWidth(String(bpm).length)}
            className={`${LCD_VALUE} cursor-ns-resize border-0 bg-transparent p-0 text-left text-[var(--text-3)] outline-none hover:text-[var(--text)] focus-visible:outline-1 focus-visible:outline-[var(--accent)]`}
          >
            {bpm}
          </button>
        )}
        <span className={LCD_CAPTION}>BPM</span>
      </div>
      {/* Steppers surface on hover / keyboard focus - they advertise the value
          is editable; ±1 clicks are the precision path short of typing. */}
      <div className="flex flex-col opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          onClick={() => nudge(1)}
          aria-label="Raise tempo"
          className="cursor-pointer border-0 bg-transparent px-0.5 text-[7px] leading-[8px] text-[var(--text-muted)] hover:text-[var(--text)] focus-visible:outline-1 focus-visible:outline-[var(--accent)]"
        >
          ▲
        </button>
        <button
          type="button"
          onClick={() => nudge(-1)}
          aria-label="Lower tempo"
          className="cursor-pointer border-0 bg-transparent px-0.5 text-[7px] leading-[8px] text-[var(--text-muted)] hover:text-[var(--text)] focus-visible:outline-1 focus-visible:outline-[var(--accent)]"
        >
          ▼
        </button>
      </div>
    </div>
  )
}
