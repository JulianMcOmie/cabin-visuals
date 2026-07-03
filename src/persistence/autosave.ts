import { create } from 'zustand'
import { useProjectStore } from '../editor/store/ProjectStore'
import { useAudioStore } from '../editor/store/AudioStore'
import { serialize } from './serialize'
import * as projectStorage from './projectStorage'

// The autosave loop: a debounced store subscription that mirrors the document
// to Supabase — the same mechanism HistoryStore uses (subscribe + burst
// window), aimed at a row instead of an undo stack. Pure observation: nothing
// in the edit path changes, and a failed save never touches memory.

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/** The one React-visible surface of autosave — feeds the header status chip. */
export const useSaveStatus = create<{ status: SaveStatus }>(() => ({ status: 'idle' }))

// ~1s idle: long enough to collapse an edit burst into one write, short enough
// that "it saved" is never in doubt.
const DEBOUNCE_MS = 1000

/**
 * Arm autosave for a project. Call strictly AFTER hydrate so the load itself
 * doesn't fire a redundant save. Returns a stop() that unsubscribes and runs
 * a final flush.
 */
export function startAutosave(projectId: string): () => void {
  let dirty = false
  let inFlight = false // non-overlapping: one write in the air at a time
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const schedule = () => {
    if (stopped) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void flush(), DEBOUNCE_MS)
  }

  const flush = async () => {
    if (timer) { clearTimeout(timer); timer = null }
    if (!dirty || inFlight) return
    dirty = false
    inFlight = true
    useSaveStatus.setState({ status: 'saving' })
    try {
      await projectStorage.save(projectId, serialize())
      if (!dirty) useSaveStatus.setState({ status: 'saved' })
    } catch (err) {
      // Network/RLS failure: the doc stays dirty and retries; memory is intact.
      console.error('Autosave failed', err)
      dirty = true
      useSaveStatus.setState({ status: 'error' })
    } finally {
      inFlight = false
      if (dirty) schedule()
    }
  }

  const markDirty = () => { dirty = true; schedule() }

  // Reference diff — the stores are immutable, so !== is an exact change test.
  const unsubProject = useProjectStore.subscribe((state, prev) => {
    if (state !== prev) markDirty()
  })
  // The audio clip descriptor rides in the document too.
  const unsubAudio = useAudioStore.subscribe((state, prev) => {
    if (state.clip !== prev.clip) markDirty()
  })

  // Flush-on-exit so the debounce window can't eat the last edit. `hidden`
  // fires early enough for the request to get off; beforeunload is best-effort.
  const onVisibility = () => { if (document.visibilityState === 'hidden') void flush() }
  const onBeforeUnload = () => { void flush() }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('beforeunload', onBeforeUnload)

  useSaveStatus.setState({ status: 'saved' }) // in sync at arm time (just hydrated)

  return () => {
    stopped = true
    unsubProject()
    unsubAudio()
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('beforeunload', onBeforeUnload)
    if (timer) { clearTimeout(timer); timer = null }
    void flush()
    useSaveStatus.setState({ status: 'idle' })
  }
}
