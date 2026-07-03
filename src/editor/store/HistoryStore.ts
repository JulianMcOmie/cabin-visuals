import { create } from 'zustand'
import { useProjectStore } from './ProjectStore'

type Snapshot = Record<string, unknown>
const LIMIT = 100          // cap the stack; oldest entries fall off
// Burst window, just above one render frame. A continuous drag (block move,
// param slider, …) writes the store every ~16ms, so its frames fall inside one
// window and collapse to a single entry. Deliberate edits — including note
// gestures, which now commit once per gesture — are spaced well beyond this, so
// each stays its own undo step even when made quickly.
const DEBOUNCE_MS = 80

// The undoable document = every non-function field of the project store.
// Generic on purpose: add track.effects / a project name later and it's covered.
const pick = (s: Record<string, unknown>): Snapshot => {
  const out: Snapshot = {}
  for (const k in s) if (typeof s[k] !== 'function') out[k] = s[k]
  return out
}
const snapshot = () => pick(useProjectStore.getState() as unknown as Record<string, unknown>)
const changed = (a: Snapshot, b: Snapshot) => {
  for (const k in a) if (a[k] !== b[k]) return true // reference compare — immutable store
  return false
}

interface HistoryState {
  past: Snapshot[]
  future: Snapshot[]
  undo: () => void
  redo: () => void
  clear: () => void
  /** Clear stacks AND cancel any in-flight burst. For document loads (project
   *  open), where the hydrate setState must not become an undoable step. */
  reset: () => void
}

// Module-level transient state (not reactive — it's plumbing).
let applying = false                   // true while a restore is in flight
let pendingBase: Snapshot | null = null // pre-burst restore point
let timer: ReturnType<typeof setTimeout> | null = null

export const useHistoryStore = create<HistoryState>((set, get) => {
  const flush = () => { // commit the in-flight burst as one entry
    if (timer) { clearTimeout(timer); timer = null }
    if (!pendingBase) return
    const base = pendingBase
    pendingBase = null
    const past = [...get().past, base]
    if (past.length > LIMIT) past.shift()
    set({ past, future: [] })
  }

  const restore = (snap: Snapshot) => {
    applying = true
    useProjectStore.setState(snap) // shallow-merges data back; actions untouched
    applying = false
  }

  // Record: the subscription is the only writer of `past`.
  useProjectStore.subscribe((state, prev) => {
    if (applying) return
    const a = pick(state as unknown as Record<string, unknown>)
    const b = pick(prev as unknown as Record<string, unknown>)
    if (!changed(a, b)) return
    if (!pendingBase) pendingBase = b        // stash PRE-edit doc at burst start
    if (get().future.length) set({ future: [] }) // any edit kills redo
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, DEBOUNCE_MS)
  })

  return {
    past: [],
    future: [],
    undo: () => {
      flush() // commit any in-flight edit first
      const { past, future } = get()
      if (!past.length) return
      const current = snapshot()
      restore(past[past.length - 1])
      set({ past: past.slice(0, -1), future: [...future, current] })
    },
    redo: () => {
      flush()
      const { past, future } = get()
      if (!future.length) return
      const current = snapshot()
      restore(future[future.length - 1])
      set({ past: [...past, current], future: future.slice(0, -1) })
    },
    clear: () => set({ past: [], future: [] }),
    reset: () => {
      if (timer) { clearTimeout(timer); timer = null }
      pendingBase = null
      set({ past: [], future: [] })
    },
  }
})
