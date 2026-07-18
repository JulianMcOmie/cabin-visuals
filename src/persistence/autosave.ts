import { create } from 'zustand'
import { useProjectStore } from '../editor/store/ProjectStore'
import { useAudioStore } from '../editor/store/AudioStore'
import { useTimeStore } from '../editor/store/TimeStore'
import { serialize } from './serialize'
import * as projectStorage from './projectStorage'
import { getFrameDriver } from '../editor/core/export/frameDriver'

// The autosave loop: a debounced store subscription that mirrors the document
// to Supabase - the same mechanism HistoryStore uses (subscribe + burst
// window), aimed at a row instead of an undo stack. Pure observation: nothing
// in the edit path changes, and a failed save never touches memory.

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/** The one React-visible surface of autosave - feeds the header status chip. */
export const useSaveStatus = create<{ status: SaveStatus }>(() => ({ status: 'idle' }))

// ~1s idle: long enough to collapse an edit burst into one write, short enough
// that "it saved" is never in doubt.
const DEBOUNCE_MS = 1000

// ── Project thumbnail ────────────────────────────────────────────────────────
// A real captured frame rides along in the saved document so the projects
// page shows the project, not a track sketch. Captured from the editor's
// canvas at most every CAPTURE_EVERY_MS; when the canvas isn't mounted (the
// lyric setup page), the last capture from this session is reused so a save
// can't wipe it.

const CAPTURE_EVERY_MS = 30_000
const THUMB_W = 320
const THUMB_H = 180
let lastThumb: string | undefined
let lastCaptureAt = 0

function captureThumbnail(): string | undefined {
  const now = Date.now()
  if (now - lastCaptureAt < CAPTURE_EVERY_MS) return lastThumb
  // Never touch the driver mid-playback - the capture is one paused frame or
  // nothing.
  if (useTimeStore.getState().isPlaying) return lastThumb
  const driver = getFrameDriver()
  if (!driver) return lastThumb
  try {
    // Render the current beat first: the WebGL buffer isn't preserved between
    // frames, so a stale canvas reads back black (same move as ExportDialog).
    driver.renderFrame(useTimeStore.getState().currentBeat, 0)
    const src = driver.getCanvas()
    const out = document.createElement('canvas')
    out.width = THUMB_W
    out.height = THUMB_H
    const ctx = out.getContext('2d')
    if (ctx && src.width > 0 && src.height > 0) {
      // Cover-crop the (any-aspect) canvas into 16:9.
      const scale = Math.max(THUMB_W / src.width, THUMB_H / src.height)
      const w = src.width * scale
      const h = src.height * scale
      ctx.drawImage(src, (THUMB_W - w) / 2, (THUMB_H - h) / 2, w, h)
      lastThumb = out.toDataURL('image/jpeg', 0.6)
      lastCaptureAt = now
    }
  } catch {
    /* tainted/lost context - keep whatever we had */
  } finally {
    // renderFrame pins a beat override on the live canvas; EVERY caller must
    // unpin. Missing this froze the editor's visuals from the first autosave
    // until something else unpinned - the "nothing plays" bug.
    try { driver.unpin() } catch { /* driver unmounted mid-save */ }
  }
  return lastThumb
}

/** Resolve once autosave has the document durably written - for handoffs
 *  where the NEXT page re-hydrates from the row (e.g. lyric setup → editor)
 *  and must not race the debounce. Waits out one debounce window first (the
 *  status still reads 'saved' from before the edit until the flush starts),
 *  then polls; gives up after maxMs rather than stranding the caller. */
export async function waitForSaved(maxMs = 15000): Promise<void> {
  await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 200))
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    if (useSaveStatus.getState().status === 'saved') return
    await new Promise((r) => setTimeout(r, 150))
  }
}

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
      const thumbnail = captureThumbnail()
      await projectStorage.save(projectId, { ...serialize(), ...(thumbnail ? { thumbnail } : {}) })
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

  // Reference diff - the stores are immutable, so !== is an exact change test.
  const unsubProject = useProjectStore.subscribe((state, prev) => {
    if (state !== prev) markDirty()
  })
  // The audioClips catalog rides in the document too.
  const unsubAudio = useAudioStore.subscribe((state, prev) => {
    if (state.audioClips !== prev.audioClips) markDirty()
  })
  const unsubLoop = useTimeStore.subscribe((state, prev) => {
    if (state.loopRegion !== prev.loopRegion) markDirty()
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
    unsubLoop()
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('beforeunload', onBeforeUnload)
    if (timer) { clearTimeout(timer); timer = null }
    void flush()
    useSaveStatus.setState({ status: 'idle' })
  }
}
