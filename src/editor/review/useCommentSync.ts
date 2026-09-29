import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useCommentsStore } from './commentsStore'
import { useTimeStore } from '../store/TimeStore'
import { useUIStore } from '../store/UIStore'
import { useProjectStore } from '../store/ProjectStore'
import { getPlaybackEngine } from '../core/playback'
import { getFrameDriver } from '../core/export/frameDriver'
import type { CommentNote } from '../../devtools/commentsCore'

// Binds review comments to the `?file=` project (dev only): polls the comments
// file, and owns the keyboard - C pins a comment at the playhead (on the
// selected track), Shift+C toggles comment mode, Esc closes the composer.

const POLL_MS = 1500

export function useCommentSync() {
  const file = useSearchParams().get('file')

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development' || !file) return
    const store = useCommentsStore.getState()
    store.setFile(file)
    void store.refresh()
    let stopped = false
    const poll = setInterval(async () => {
      if (stopped) return
      try {
        const r = await fetch(`/api/dev/projects/${encodeURIComponent(file)}/comments?versionOnly=1`, { cache: 'no-store' })
        if (!r.ok) return
        const { version } = (await r.json()) as { version: string }
        if (version !== useCommentsStore.getState().version) await useCommentsStore.getState().refresh()
      } catch { /* dev server restarting */ }
    }, POLL_MS)

    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (useUIStore.getState().modalOpen) return
      const s = useCommentsStore.getState()
      if (e.key === 'Escape' && (s.composer || s.mode)) {
        if (s.composer) s.closeComposer()
        else s.setMode(false)
        e.preventDefault()
        return
      }
      if (e.key.toLowerCase() !== 'c') return
      e.preventDefault()
      if (e.shiftKey) { s.setMode(!s.mode); return }
      const beat = useTimeStore.getState().currentBeat
      const trackId = useUIStore.getState().selectedTrackId ?? undefined
      s.openComposer({ beat, trackId, x: window.innerWidth / 2, y: window.innerHeight * 0.45 })
    }
    window.addEventListener('keydown', onKey)
    return () => {
      stopped = true
      clearInterval(poll)
      window.removeEventListener('keydown', onKey)
      useCommentsStore.getState().setFile(null)
    }
  }, [file])
}

/** Move the playhead (and the transport, if playing). */
export function seekTo(beat: number) {
  useTimeStore.getState().setCurrentBeat(beat)
  if (useTimeStore.getState().isPlaying) getPlaybackEngine().seek(beat)
}

/** The canvas as it looks at `beat` (JPEG data URL), for a comment's still. */
export function captureStill(beat: number): string | undefined {
  try {
    const driver = getFrameDriver()
    if (!driver) return undefined
    const { bpm } = useProjectStore.getState()
    driver.renderFrame(beat, (beat * 60_000) / bpm)
    return driver.getCanvas().toDataURL('image/jpeg', 0.82)
  } catch {
    return undefined
  }
}

/** Notes on a track around a beat (what the comment was about). */
export function notesNear(trackId: string | undefined, beat: number, endBeat?: number): CommentNote[] {
  if (!trackId) return []
  const { scenes, beatsPerBar } = useProjectStore.getState()
  for (const scene of Object.values(scenes)) {
    const t = scene.tracks[trackId]
    if (!t) continue
    const lo = beat - 1, hi = (endBeat ?? beat) + 1
    const out: CommentNote[] = []
    for (const b of t.blocks) {
      for (const n of b.notes) {
        const at = b.startBar * beatsPerBar + n.startBeat
        if (at >= lo && at < hi) out.push({ beat: at, pitch: n.pitch, dur: n.durationBeats, vel: n.velocity })
      }
    }
    return out.sort((a, b) => a.beat - b.beat).slice(0, 24)
  }
  return []
}
