'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Film, Plus, X } from 'lucide-react'
import { Input, ALL_FORMATS, VideoSampleSink, type Input as MbInput } from 'mediabunny'
import { useProjectStore } from '../store/ProjectStore'
import { useVideoStore } from '../store/VideoStore'
import { saveVideo, removeVideo, getVideoSource } from '../core/video/videoSource'
import { usePlan } from '../../billing/usePlan'
import type { Track, VideoPad } from '../types'

// The Video instrument's pad bank: upload a source once, then pick MOMENTS
// from it - each pad is (source, in-point), played from its own start on a
// note hit (see core/video/decodeEngine). Several pads can share one source,
// so chopping a video into clips uploads it once. Each pad is one row in the
// MIDI editor (newest at the top).

const MAX_PADS = 8
// Per-plan caps on the SOURCE file (the only thing uploaded). Picking moments
// out of it is free. PRO_MAX_MB must equal the bucket's file_size_limit
// (migration 0004): the picker rejects oversized files instantly; the bucket
// backstops. (Like all plan gating, the free cap is client-side only.)
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

/**
 * The moment picker: scrub a source, see the frame, arm pads at chosen
 * in-points. Decodes preview frames via mediabunny (coalesced - newest scrub
 * position wins), so it works for session files and saved projects alike.
 */
function MomentPicker({
  sourceRef,
  onArm,
  onDone,
  atPadLimit,
}: {
  sourceRef: string
  onArm: (inPoint: number) => void
  onDone: () => void
  atPadLimit: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sinkRef = useRef<VideoSampleSink | null>(null)
  const inputRef = useRef<MbInput | null>(null)
  const chainRef = useRef<{ pending: number | null; busy: boolean }>({ pending: null, busy: false })
  const [t, setT] = useState(0)
  const [ready, setReady] = useState(false)
  const source = useVideoStore((s) => s.videoClips[sourceRef])
  const duration = source?.duration ?? 0

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const input = new Input({ formats: ALL_FORMATS, source: await getVideoSource(sourceRef) })
        const track = await input.getPrimaryVideoTrack()
        if (!track || cancelled) {
          void input.dispose()
          return
        }
        inputRef.current = input
        sinkRef.current = new VideoSampleSink(track)
        setReady(true)
        seek(0)
      } catch (err) {
        console.error('Moment picker failed to open source', sourceRef, err)
      }
    })()
    return () => {
      cancelled = true
      void inputRef.current?.dispose()
      inputRef.current = null
      sinkRef.current = null
    }
  }, [sourceRef])

  const seek = (time: number) => {
    setT(time)
    const chain = chainRef.current
    chain.pending = time
    if (chain.busy) return
    chain.busy = true
    void (async () => {
      try {
        while (chain.pending !== null) {
          const want = chain.pending
          chain.pending = null
          const sink = sinkRef.current
          const canvas = canvasRef.current
          if (!sink || !canvas) break
          const sample = await sink.getSample(want)
          if (sample) {
            if (canvas.width !== sample.displayWidth || canvas.height !== sample.displayHeight) {
              canvas.width = sample.displayWidth
              canvas.height = sample.displayHeight
            }
            sample.draw(canvas.getContext('2d')!, 0, 0, canvas.width, canvas.height)
            sample.close()
          }
        }
      } catch (err) {
        console.error('Moment picker seek failed', err)
      } finally {
        chain.busy = false
      }
    })()
  }

  return (
    <div className="mb-2 rounded border border-[var(--border)] bg-[var(--bg-app)] p-2">
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
        Pick a moment · {source?.fileName ?? sourceRef}
      </p>
      <canvas ref={canvasRef} className="aspect-video w-full rounded bg-black object-contain" />
      <input
        type="range"
        min={0}
        max={Math.max(0.1, duration - 0.5)}
        step={0.05}
        value={t}
        onChange={(e) => seek(Number(e.target.value))}
        disabled={!ready}
        className="mt-1.5 w-full"
      />
      <div className="mt-1 flex items-center justify-between">
        <span className="font-mono text-[10px] text-[var(--text-muted)]">
          {t.toFixed(2)}s / {duration.toFixed(1)}s
        </span>
        <div className="flex gap-1.5">
          <button
            onClick={() => onArm(t)}
            disabled={!ready || atPadLimit}
            className="h-6 cursor-pointer rounded bg-[var(--accent)] px-2 text-[11px] font-bold text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:cursor-default disabled:opacity-50"
          >
            + Clip at {t.toFixed(1)}s
          </button>
          <button
            onClick={onDone}
            className="h-6 cursor-pointer rounded border border-[var(--border)] px-2 text-[11px] text-[var(--text-2)] hover:text-[var(--text)]"
          >
            Done
          </button>
        </div>
      </div>
      {atPadLimit && <p className="mt-1 text-[11px] text-[var(--warn)]">{MAX_PADS}-clip limit reached</p>}
    </div>
  )
}

export function VideoClipBank({ track }: { track: Track }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pickerRef, setPickerRef] = useState<string | null>(null)
  const setTrackVideoPads = useProjectStore((s) => s.setTrackVideoPads)
  const videoClips = useVideoStore((s) => s.videoClips)
  const { isPro } = usePlan()
  const maxMb = isPro ? PRO_MAX_MB : FREE_MAX_MB

  const pads = track.videoPads ?? []

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // re-selecting the same file must still fire onChange
    if (!file) return
    setError(null)
    if (pads.length >= MAX_PADS) return setError(`Up to ${MAX_PADS} clips per track`)
    if (file.size > maxMb * 1024 * 1024) {
      const mb = Math.round(file.size / (1024 * 1024))
      return setError(
        isPro
          ? `This video is ${mb} MB - sources are capped at ${PRO_MAX_MB} MB. Compress it first.`
          : `This video is ${mb} MB - free sources are capped at ${FREE_MAX_MB} MB. Upgrade to Pro for ${PRO_MAX_MB} MB, or compress it first.`,
      )
    }
    setBusy(true)
    setProgress(0)
    try {
      const meta = await probeVideo(file)
      const ref = await saveVideo(file, setProgress)
      useVideoStore.getState().addClip({ ref, fileName: file.name, ...meta })
      // Straight into the picker: choosing the moment IS adding the clip.
      setPickerRef(ref)
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

  // Pads are appended from the picker; track state is read fresh (several adds
  // per picker session).
  const armPad = (inPoint: number) => {
    const ref = pickerRef
    if (!ref) return
    const current = useProjectStore.getState().tracks[track.id]?.videoPads ?? []
    if (current.length >= MAX_PADS) return
    const pad: VideoPad = { ref, inPoint: Math.round(inPoint * 1000) / 1000 }
    setTrackVideoPads(track.id, [...current, pad])
  }

  /** Is `ref` still used by any pad on any track? */
  const sourceStillUsed = (ref: string): boolean =>
    Object.values(useProjectStore.getState().tracks).some((t) => (t.videoPads ?? []).some((p) => p.ref === ref))

  const closePicker = () => {
    const ref = pickerRef
    setPickerRef(null)
    // An upload the user walked away from without arming anything is an
    // orphan - drop its bytes and catalog entry.
    if (ref && !sourceStillUsed(ref)) {
      useVideoStore.getState().removeClip(ref)
      removeVideo(ref)
    }
  }

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= pads.length) return
    const next = pads.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    setTrackVideoPads(track.id, next)
  }

  const remove = (i: number) => {
    const removed = pads[i]
    setTrackVideoPads(track.id, pads.filter((_, k) => k !== i))
    if (!sourceStillUsed(removed.ref)) {
      useVideoStore.getState().removeClip(removed.ref)
      removeVideo(removed.ref)
    }
  }

  // Distinct sources already on this track - "add another moment" candidates.
  const trackSources = [...new Set(pads.map((p) => p.ref))]

  return (
    <div className="mb-5">
      <p className="mb-3 text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">CLIPS</p>
      {pads.length === 0 && !pickerRef && (
        <p className="mb-2 text-[11px] text-[var(--text-muted)]">
          Upload a video, pick the moments you want, then draw notes in the MIDI editor to cut between them.
        </p>
      )}
      {pads.map((pad, i) => {
        const source = videoClips[pad.ref]
        return (
          <div key={`${pad.ref}-${pad.inPoint}-${i}`} className="mb-1 flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--bg-app)] px-2 py-1.5">
            <span className="w-5 flex-shrink-0 font-mono text-[10px] text-[var(--accent)]">{i + 1}</span>
            <Film size={11} className="flex-shrink-0 text-[var(--text-muted)]" />
            <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-2)]" title={source?.fileName ?? pad.ref}>
              {source?.fileName ?? 'missing clip'}
            </span>
            <span className="flex-shrink-0 font-mono text-[10px] text-[var(--text-muted)]">@ {pad.inPoint.toFixed(1)}s</span>
            <button onClick={() => move(i, -1)} disabled={i === 0} className="flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--text-2)] disabled:opacity-30 cursor-pointer disabled:cursor-default" aria-label="Move clip up"><ArrowUp size={11} /></button>
            <button onClick={() => move(i, 1)} disabled={i === pads.length - 1} className="flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--text-2)] disabled:opacity-30 cursor-pointer disabled:cursor-default" aria-label="Move clip down"><ArrowDown size={11} /></button>
            <button onClick={() => remove(i)} className="flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--warn)] cursor-pointer" aria-label="Remove clip"><X size={11} /></button>
          </div>
        )
      })}

      {pickerRef && (
        <MomentPicker
          sourceRef={pickerRef}
          onArm={armPad}
          onDone={closePicker}
          atPadLimit={pads.length >= MAX_PADS}
        />
      )}

      {!pickerRef && (
        <>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || pads.length >= MAX_PADS}
            className="mt-1 flex h-7 w-full items-center justify-center gap-1.5 rounded border border-dashed border-[var(--border)] text-[11px] text-[var(--text-3)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:opacity-50 cursor-pointer disabled:cursor-default"
          >
            <Plus size={11} />
            {busy
              ? progress !== null ? `Uploading… ${Math.round(progress * 100)}%` : 'Uploading…'
              : pads.length >= MAX_PADS ? `${MAX_PADS}-clip limit` : 'Upload video'}
          </button>
          {trackSources.length > 0 && pads.length < MAX_PADS && !busy && (
            <div className="mt-1 flex flex-wrap gap-1">
              {trackSources.map((ref) => (
                <button
                  key={ref}
                  onClick={() => setPickerRef(ref)}
                  className="h-6 cursor-pointer rounded border border-[var(--border)] px-2 font-mono text-[10px] text-[var(--text-3)] hover:text-[var(--text)]"
                  title={`Add another moment from ${videoClips[ref]?.fileName ?? ref}`}
                >
                  + from {(videoClips[ref]?.fileName ?? 'clip').slice(0, 14)}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {busy && progress !== null && (
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-[var(--bg-elevated)]">
          <div className="h-full rounded bg-[var(--accent)] transition-[width] duration-150" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
      {error && <p className="mt-1.5 text-[11px] text-[var(--warn)]">{error}</p>}
      <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => void onFile(e)} />
    </div>
  )
}
