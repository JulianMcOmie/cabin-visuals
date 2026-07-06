'use client'

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useProjectStore, MIN_BPM, MAX_BPM } from '../store/ProjectStore'
import { lockCursor, unlockCursor } from '../utils/dragCursor'

// Vertical drag sensitivity: bpm change per pixel (up = faster).
const BPM_PER_PX = 0.5
// Two pointer-downs within this window (ms) count as a double-click → type mode.
const DOUBLE_CLICK_MS = 350

/**
 * Tempo readout that doubles as a vertical drag scrubber — drag up to raise the
 * BPM, down to lower it — and a double-click-to-type field. Writes the project
 * store; the live transport follows via the bpm subscription in usePlayback.
 */
export function BpmControl() {
  const bpm = useProjectStore((s) => s.bpm)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const lastDownRef = useRef(0)

  const commit = () => {
    const n = parseInt(draft, 10)
    if (!Number.isNaN(n)) {
      useProjectStore.getState().setBpm(Math.max(MIN_BPM, Math.min(MAX_BPM, n)))
    }
    setEditing(false)
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    // Double-click (two downs close in time) enters type-to-edit; detected by
    // timing so it doesn't depend on pointer-event `detail`, which browsers
    // populate inconsistently.
    const now = e.timeStamp
    if (now - lastDownRef.current < DOUBLE_CLICK_MS) {
      lastDownRef.current = 0
      e.preventDefault()
      setDraft(String(useProjectStore.getState().bpm))
      setEditing(true)
      return
    }
    lastDownRef.current = now

    e.preventDefault()
    const startY = e.clientY
    const startBpm = useProjectStore.getState().bpm
    lockCursor('ns-resize')

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
      controller.abort()
    }
    window.addEventListener('pointermove', onMove, { signal: controller.signal })
    window.addEventListener('pointerup', onUp, { signal: controller.signal })
  }

  // Readout and input share identical box metrics (padding, border, ch-based
  // width for the current digit count), so toggling edit mode never reflows —
  // and a 2-digit value doesn't reserve 3 digits of dead space.
  const box = 'inline-block box-content align-baseline font-mono text-xs tabular-nums px-1 rounded border'
  const chWidth = (len: number) => ({ width: `${Math.max(2, len)}ch` })

  return (
    <span className="font-mono text-xs text-zinc-500 select-none tabular-nums">
      BPM:{' '}
      {editing ? (
        <input
          autoFocus
          type="text"
          inputMode="numeric"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') setEditing(false)
          }}
          style={chWidth(draft.length)}
          className={`${box} bg-zinc-800 text-zinc-100 border-zinc-600 outline-none focus:border-zinc-400`}
        />
      ) : (
        // Only the number is the drag / double-click target — not the label.
        <span
          onPointerDown={onPointerDown}
          title="Drag up / down to change tempo — double-click to type"
          style={chWidth(String(bpm).length)}
          className={`${box} border-transparent text-zinc-200 cursor-ns-resize hover:text-zinc-100 transition-colors`}
        >
          {bpm}
        </span>
      )}
    </span>
  )
}
