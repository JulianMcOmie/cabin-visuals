import { createContext, useContext, useLayoutEffect, useRef, type RefObject } from 'react'
import { useStore, type RenderCallback, type RootStore } from '@react-three/fiber'
import { visualEngine, type VisualEngineInstance } from './VisualEngine'
import type { Track } from '../../types'

/** A preview owns both its evaluator and its truncated document. The ordinary
 * editor has no provider and keeps using its original singleton. */
export const VisualEngineContext = createContext<{
  engine: VisualEngineInstance
  tracks: Record<string, Track>
  renderFrame: RefObject<boolean>
} | null>(null)

export function useVisualEngine(): VisualEngineInstance {
  return useContext(VisualEngineContext)?.engine ?? visualEngine
}

// ── The frame hub ───────────────────────────────────────────────────────────
//
// r3f's `useFrame` is one subscriber per mount, and its store re-SORTS the
// whole subscriber array on every subscribe and FILTERS it on every
// unsubscribe - O(N) each, so mounting N copies costs O(N²). Every mounted
// copy holds two of these (its ObjectRenderer placement frame and its
// instrument frame), and a 3,000-copy project paid ~0.9s of its load stall
// inside that sort/filter alone. So all `useVisualFrame` callbacks register
// here instead: ONE real r3f subscription per (root store, priority) runs the
// hub's callbacks in registration order - exactly the order r3f's stable sort
// gave equal-priority subscribers - and the hub joins r3f's list once, when
// its first member mounts, which is also when that member would have.
//
// The one ordering that matters is preserved by construction: VisualBeatSync
// (a raw useFrame, mounted before any object) still runs computeAtBeat ahead
// of every hub member; within the hub, children commit their layout effects
// before parents, so an instrument's frame still precedes its ObjectRenderer's.

interface FrameHub {
  members: Set<RefObject<RenderCallback>>
  /** Snapshot iterated per frame; rebuilt lazily after membership changes so
   *  a callback that unmounts a sibling mid-frame can't skip or repeat one. */
  order: RefObject<RenderCallback>[]
  dirty: boolean
  unsubscribe: () => void
}

const hubs = new WeakMap<RootStore, Map<number, FrameHub>>()

function joinFrameHub(store: RootStore, priority: number, ref: RefObject<RenderCallback>): () => void {
  let byPriority = hubs.get(store)
  if (!byPriority) { byPriority = new Map(); hubs.set(store, byPriority) }
  let hub = byPriority.get(priority)
  if (!hub) {
    const created: FrameHub = { members: new Set(), order: [], dirty: false, unsubscribe: () => {} }
    const tick: RefObject<RenderCallback> = {
      current: (...args) => {
        if (created.dirty) { created.order = [...created.members]; created.dirty = false }
        const order = created.order
        for (let i = 0; i < order.length; i++) order[i].current?.(...args)
      },
    }
    created.unsubscribe = store.getState().internal.subscribe(tick, priority, store)
    byPriority.set(priority, created)
    hub = created
  }
  hub.members.add(ref)
  hub.dirty = true
  return () => {
    hub.members.delete(ref)
    hub.dirty = true
    if (hub.members.size === 0) {
      hub.unsubscribe()
      byPriority.delete(priority)
    }
  }
}

/** Preview simulations, instruments and shader passes share one frame budget. */
export function useVisualFrame(callback: RenderCallback, priority = 0) {
  const preview = useContext(VisualEngineContext)
  const store = useStore()
  // Latest callback by ref, like r3f's own useFrame - the subscription itself
  // is taken once per (store, priority) for the mount's lifetime.
  const latest = useRef(callback)
  latest.current = callback
  const gate = useRef(preview)
  gate.current = preview
  const ref = useRef<RenderCallback>((...args) => {
    const p = gate.current
    if (!p || p.renderFrame.current) latest.current(...args)
  })
  useLayoutEffect(() => joinFrameHub(store, priority, ref), [store, priority])
}
