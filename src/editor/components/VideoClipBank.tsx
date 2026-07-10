'use client'

import { useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Film, Plus, X } from 'lucide-react'
import { useProjectStore } from '../store/ProjectStore'
import { useVideoStore } from '../store/VideoStore'
import { saveVideo, removeVideo } from '../core/video/videoSource'
import { usePlan } from '../../billing/usePlan'
import type { Track } from '../types'

// The Video instrument's pad bank editor: upload clips, order them, remove
// them. Each clip is one row in the MIDI editor (newest at the top); the
// underlying pitch mapping is internal (see VIDEO_BASE_PITCH).

const MAX_CLIPS = 8
// Per-clip caps by plan. PRO_MAX_MB must equal the bucket's file_size_limit
// (migration 0004): the picker rejects oversized files instantly; the bucket
// backstops. If one changes, change both. (Like all plan gating, the free cap
// is client-side only - the bucket enforces the Pro cap for everyone.)
const FREE_MAX_MB = 50
const PRO_MAX_MB = 250

/** Probe duration + dimensions from the file before it enters the catalog. */
function probeVideo(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('video')
    const url = URL.createObjectURL(file)
    el.preload = 'metadata'
    el.onloadedmetadata = () => {
      const meta = { duration: el.duration, width: el.videoWidth, height: el.videoHeight }
      URL.revokeObjectURL(url)
      resolve(meta)
    }
    el.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read this video file'))
    }
    el.src = url
  })
}

export function VideoClipBank({ track }: { track: Track }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  // 0-1 while an upload is in flight; null when idle (or during the instant
  // session-only save). Drives the button label and the bar below it.
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const setTrackVideoRefs = useProjectStore((s) => s.setTrackVideoRefs)
  const videoClips = useVideoStore((s) => s.videoClips)
  const { isPro } = usePlan()
  const maxMb = isPro ? PRO_MAX_MB : FREE_MAX_MB

  const refs = track.videoRefs ?? []

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // re-selecting the same file must still fire onChange
    if (!file) return
    setError(null)
    if (refs.length >= MAX_CLIPS) return setError(`Up to ${MAX_CLIPS} clips per track`)
    if (file.size > maxMb * 1024 * 1024) {
      const mb = Math.round(file.size / (1024 * 1024))
      return setError(
        isPro
          ? `This video is ${mb} MB - clips are capped at ${PRO_MAX_MB} MB. Trim or compress it first.`
          : `This video is ${mb} MB - free clips are capped at ${FREE_MAX_MB} MB. Upgrade to Pro for ${PRO_MAX_MB} MB, or trim it first.`,
      )
    }
    setBusy(true)
    setProgress(0)
    try {
      const meta = await probeVideo(file)
      const ref = await saveVideo(file, setProgress)
      useVideoStore.getState().addClip({ ref, fileName: file.name, ...meta })
      setTrackVideoRefs(track.id, [...refs, ref])
    } catch (err) {
      // Supabase storage errors are plain objects, not Error instances - pull
      // the message out of either shape so failures are actually readable.
      const message =
        (err as { message?: string } | null)?.message ?? (err instanceof Error ? err.message : 'Upload failed')
      console.error('Video upload failed:', message, err)
      setError(message)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= refs.length) return
    const next = refs.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    setTrackVideoRefs(track.id, next)
  }

  const remove = (i: number) => {
    const ref = refs[i]
    setTrackVideoRefs(track.id, refs.filter((_, k) => k !== i))
    // Drop bytes + catalog entry only when no other track still uses the clip.
    const stillUsed = Object.values(useProjectStore.getState().tracks).some(
      (t) => t.id !== track.id && t.videoRefs?.includes(ref),
    )
    if (!stillUsed) {
      useVideoStore.getState().removeClip(ref)
      removeVideo(ref)
    }
  }

  return (
    <div className="mb-5">
      <p className="mb-3 text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">CLIPS</p>
      {refs.length === 0 && (
        <p className="mb-2 text-[11px] text-[var(--text-muted)]">
          Add clips, then draw notes in the MIDI editor to cut between them.
        </p>
      )}
      {refs.map((ref, i) => {
        const clip = videoClips[ref]
        return (
          <div key={ref} className="mb-1 flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--bg-app)] px-2 py-1.5">
            <span className="w-5 flex-shrink-0 font-mono text-[10px] text-[var(--accent)]">{i + 1}</span>
            <Film size={11} className="flex-shrink-0 text-[var(--text-muted)]" />
            <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-2)]" title={clip?.fileName ?? ref}>
              {clip?.fileName ?? 'missing clip'}
            </span>
            {clip && <span className="flex-shrink-0 font-mono text-[10px] text-[var(--text-muted)]">{clip.duration.toFixed(1)}s</span>}
            <button onClick={() => move(i, -1)} disabled={i === 0} className="flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--text-2)] disabled:opacity-30 cursor-pointer disabled:cursor-default" aria-label="Move clip up"><ArrowUp size={11} /></button>
            <button onClick={() => move(i, 1)} disabled={i === refs.length - 1} className="flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--text-2)] disabled:opacity-30 cursor-pointer disabled:cursor-default" aria-label="Move clip down"><ArrowDown size={11} /></button>
            <button onClick={() => remove(i)} className="flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--warn)] cursor-pointer" aria-label="Remove clip"><X size={11} /></button>
          </div>
        )
      })}
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy || refs.length >= MAX_CLIPS}
        className="mt-1 flex h-7 w-full items-center justify-center gap-1.5 rounded border border-dashed border-[var(--border)] text-[11px] text-[var(--text-3)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:opacity-50 cursor-pointer disabled:cursor-default"
      >
        <Plus size={11} />
        {busy
          ? progress !== null ? `Uploading… ${Math.round(progress * 100)}%` : 'Uploading…'
          : refs.length >= MAX_CLIPS ? `${MAX_CLIPS}-clip limit` : 'Add video clip'}
      </button>
      {busy && progress !== null && (
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-[var(--bg-elevated)]">
          <div
            className="h-full rounded bg-[var(--accent)] transition-[width] duration-150"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      )}
      {error && <p className="mt-1.5 text-[11px] text-[var(--warn)]">{error}</p>}
      <input ref={inputRef} type="file" accept="video/mp4,video/webm" className="hidden" onChange={(e) => void onFile(e)} />
    </div>
  )
}
