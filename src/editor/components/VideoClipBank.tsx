'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Film, Pause, Play, Plus, X } from 'lucide-react'
import { Input, ALL_FORMATS, BlobSource, VideoSampleSink, type Input as MbInput } from 'mediabunny'
import { useProjectStore } from '../store/ProjectStore'
import { useVideoStore } from '../store/VideoStore'
import { useUIStore } from '../store/UIStore'
import { beginSaveVideo, retryVideoUpload, removeVideo, getVideoSource } from '../core/video/videoSource'
import { usePlan } from '../../billing/usePlan'
import type { Track, VideoPad } from '../types'

// The Video instrument's pad bank: upload a source once, then pick MOMENTS
// from it in a modal picker - each pad is (source, in-point), played from its
// own start on a note hit (see core/video/decodeEngine). Several pads can
// share one source, so chopping a video into clips uploads it once. The
// picker opens the instant a file is chosen: preview scrubs the LOCAL bytes
// while the upload runs in the background inside the modal; arming unlocks
// when the upload lands. Each pad is one row in the MIDI editor.

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

interface PickerState {
  /** Fresh upload: preview reads these local bytes immediately. */
  file: File | null
  /** Minted BEFORE the upload starts - clips arm against it instantly; the
   *  upload behind it is durability, not a gate. */
  ref: string | null
  fileName: string
  /** Background persistence state. Clips work locally in every state; 'failed'
   *  means they won't survive a reload until a retry succeeds. */
  save: 'saving' | 'saved' | 'failed'
  progress: number
  error: string | null
}

/** A pad from the picker's source, as shown (and deletable) in the modal. */
interface ArmedClip {
  bankIndex: number
  inPoint: number
}

/**
 * The moment picker modal: dimmed backdrop, big preview, scrub the source,
 * arm pads at chosen in-points. Space toggles play, Escape closes. Decodes
 * via mediabunny (coalesced - newest scrub position wins), so it works for
 * local files and saved projects' streamed sources alike.
 */
function MomentPickerModal({
  picker,
  armedClips,
  onArm,
  onRemove,
  onRetry,
  onClose,
  atPadLimit,
}: {
  picker: PickerState
  /** This source's pads on the track - listed in the modal, deletable. */
  armedClips: ArmedClip[]
  onArm: (inPoint: number) => void
  onRemove: (bankIndex: number) => void
  onRetry: () => void
  onClose: () => void
  atPadLimit: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sinkRef = useRef<VideoSampleSink | null>(null)
  const inputRef = useRef<MbInput | null>(null)
  const chainRef = useRef<{ pending: number | null; busy: boolean }>({ pending: null, busy: false })
  const playRef = useRef<{ raf: number; playing: boolean; startT: number; startWall: number }>({ raf: 0, playing: false, startT: 0, startWall: 0 })
  const [t, setT] = useState(0)
  const [duration, setDuration] = useState(0)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)

  // Stand down editor surfaces with document-level pointer handling (panel
  // resize hit-testing) while the modal is up - the overlay can't block them.
  const setModalOpen = useUIStore((s) => s.setModalOpen)
  useEffect(() => {
    setModalOpen(true)
    return () => setModalOpen(false)
  }, [setModalOpen])

  // Open the source: local bytes if fresh, storage stream if existing.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const source = picker.file ? new BlobSource(picker.file) : await getVideoSource(picker.ref!)
        const input = new Input({ formats: ALL_FORMATS, source })
        const track = await input.getPrimaryVideoTrack()
        if (!track || cancelled) {
          void input.dispose()
          return
        }
        const dur = await input.computeDuration()
        if (cancelled) {
          void input.dispose()
          return
        }
        inputRef.current = input
        sinkRef.current = new VideoSampleSink(track)
        setDuration(dur)
        setReady(true)
        seek(0)
      } catch (err) {
        console.error('Moment picker failed to open source', err)
      }
    })()
    return () => {
      cancelled = true
      stopPlaying()
      void inputRef.current?.dispose()
      inputRef.current = null
      sinkRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker.file, picker.ref])

  const drawAt = async (want: number) => {
    const sink = sinkRef.current
    const canvas = canvasRef.current
    if (!sink || !canvas) return
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

  const seek = (time: number) => {
    stopPlaying()
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
          await drawAt(want)
        }
      } catch (err) {
        console.error('Moment picker seek failed', err)
      } finally {
        chain.busy = false
      }
    })()
  }

  const stopPlaying = () => {
    const p = playRef.current
    if (p.playing) {
      cancelAnimationFrame(p.raf)
      p.playing = false
      setPlaying(false)
    }
  }

  // Preview playback: wall-clock advance + coalesced draws. Editor transport is
  // untouched - this exists purely to FIND a moment by watching.
  const togglePlay = () => {
    const p = playRef.current
    if (p.playing) {
      stopPlaying()
      return
    }
    if (!ready) return
    p.playing = true
    p.startT = t >= duration - 0.6 ? 0 : t
    p.startWall = performance.now()
    setPlaying(true)
    const tick = () => {
      if (!p.playing) return
      const now = p.startT + (performance.now() - p.startWall) / 1000
      if (now >= duration - 0.05) {
        stopPlaying()
        return
      }
      setT(now)
      const chain = chainRef.current
      chain.pending = now
      if (!chain.busy) {
        chain.busy = true
        void (async () => {
          try {
            while (chain.pending !== null) {
              const want = chain.pending
              chain.pending = null
              await drawAt(want)
            }
          } finally {
            chain.busy = false
          }
        })()
      }
      p.raf = requestAnimationFrame(tick)
    }
    p.raf = requestAnimationFrame(tick)
  }

  // Space toggles preview, Escape closes; editor shortcuts stay blocked.
  useEffect(() => {
    const block = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) {
        if (e.code !== 'Space' && e.key !== 'Escape') return
      }
      e.stopPropagation()
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      }
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', block, true)
    return () => window.removeEventListener('keydown', block, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, playing, t, duration, onClose])

  const canArm = ready && picker.ref !== null && !atPadLimit

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
      <div className="w-[560px] rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-4 shadow-2xl shadow-black/60">
        <div className="mb-3 flex items-center justify-between">
          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[var(--text)]">
            <Film size={14} className="flex-shrink-0 text-[var(--accent)]" />
            <span className="truncate">Pick clips - {picker.fileName}</span>
          </span>
          <button
            onClick={onClose}
            className="flex h-5 w-5 flex-shrink-0 cursor-pointer items-center justify-center rounded bg-[var(--bg-elevated)] text-[var(--text-3)] hover:bg-[var(--border)] hover:text-[var(--text)]"
            aria-label="Close"
          >
            <X size={12} />
          </button>
        </div>

        <canvas ref={canvasRef} onClick={togglePlay} className="aspect-video w-full cursor-pointer rounded bg-black object-contain" />

        <input
          type="range"
          min={0}
          max={Math.max(0.1, duration - 0.2)}
          step={0.05}
          value={Math.min(t, duration)}
          onChange={(e) => seek(Number(e.target.value))}
          disabled={!ready}
          className="mt-2 w-full"
        />

        <div className="mt-1.5 flex items-center gap-2">
          <button
            onClick={togglePlay}
            disabled={!ready}
            className="flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text)] disabled:cursor-default disabled:opacity-50"
            aria-label={playing ? 'Pause preview' : 'Play preview'}
          >
            {playing ? <Pause size={12} /> : <Play size={12} />}
          </button>
          <span className="font-mono text-[11px] text-[var(--text-muted)]">
            {t.toFixed(2)}s / {duration.toFixed(1)}s
          </span>
          <div className="flex-1" />
          <button
            onClick={() => onArm(t)}
            disabled={!canArm}
            className="flex h-7 cursor-pointer items-center gap-1.5 rounded bg-[var(--accent)] px-3 text-[11px] font-bold text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:cursor-default disabled:opacity-50"
          >
            <Plus size={11} />
            {atPadLimit ? `${MAX_PADS}-clip limit` : `Clip at ${t.toFixed(1)}s`}
          </button>
          <button
            onClick={onClose}
            className="h-7 cursor-pointer rounded border border-[var(--border)] px-3 text-[11px] text-[var(--text-2)] hover:text-[var(--text)]"
          >
            {armedClips.length > 0 ? 'Done' : 'Cancel'}
          </button>
        </div>

        {armedClips.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {armedClips.map((clip) => (
              <span
                key={clip.bankIndex}
                className="flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--bg-app)] px-2 py-1 font-mono text-[10px] text-[var(--text-2)]"
              >
                <button
                  onClick={() => seek(clip.inPoint)}
                  className="cursor-pointer hover:text-[var(--text)]"
                  title="Jump to this moment"
                >
                  {clip.inPoint.toFixed(1)}s
                </button>
                <button
                  onClick={() => onRemove(clip.bankIndex)}
                  className="cursor-pointer text-[var(--text-muted)] hover:text-[var(--warn)]"
                  aria-label={`Remove clip at ${clip.inPoint.toFixed(1)}s`}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        {picker.save === 'failed' ? (
          <div className="mt-2 flex items-center gap-2">
            <p className="flex-1 text-[11px] text-[var(--warn)]">
              {picker.error ?? 'Upload failed'} - clips still work this session, but won&apos;t survive a reload until it saves.
            </p>
            <button
              onClick={onRetry}
              className="h-6 flex-shrink-0 cursor-pointer rounded border border-[var(--warn)] px-2 text-[11px] text-[var(--warn)] hover:bg-[var(--warn)] hover:text-[var(--bg-panel)]"
            >
              Retry upload
            </button>
          </div>
        ) : picker.save === 'saving' ? (
          <div className="mt-3">
            <p className="mb-1 font-mono text-[10px] text-[var(--text-muted)]">
              SAVING {Math.round(picker.progress * 100)}% · clips arm instantly - the upload just makes them survive reloads
            </p>
            <div className="h-1 w-full overflow-hidden rounded bg-[var(--bg-elevated)]">
              <div className="h-full rounded bg-[var(--accent)] transition-[width] duration-150" style={{ width: `${picker.progress * 100}%` }} />
            </div>
          </div>
        ) : armedClips.length > 0 ? (
          <p className="mt-2 text-[11px] text-[var(--text-3)]">
            {armedClips.length} clip{armedClips.length > 1 ? 's' : ''} on this video - scrub to another moment and add more, or Done.
          </p>
        ) : null}
      </div>
    </div>
  )
}

export function VideoClipBank({ track }: { track: Track }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [picker, setPicker] = useState<PickerState | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Identifies the picker session an in-flight upload belongs to, so a
  // completion after the modal closed can orphan-clean instead of resurrecting.
  const pickerSeqRef = useRef(0)
  // The in-flight background upload, so close-mid-upload defers orphan cleanup
  // to completion (deleting a path that's still POSTing would race).
  const uploadTaskRef = useRef<{ ref: string; settled: boolean; cleanupWhenSettled: boolean } | null>(null)
  const setTrackVideoPads = useProjectStore((s) => s.setTrackVideoPads)
  const videoClips = useVideoStore((s) => s.videoClips)
  const { isPro } = usePlan()
  const maxMb = isPro ? PRO_MAX_MB : FREE_MAX_MB

  const pads = track.videoPads ?? []

  /** Is `ref` still used by any pad on any track? */
  const sourceStillUsed = (ref: string): boolean =>
    Object.values(useProjectStore.getState().tracks).some((t) => (t.videoPads ?? []).some((p) => p.ref === ref))

  const cleanOrphan = (ref: string) => {
    if (!sourceStillUsed(ref)) {
      useVideoStore.getState().removeClip(ref)
      removeVideo(ref)
    }
  }

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
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
    // Modal opens NOW on the local bytes; ref mints in a beat (arm unlocks),
    // and the upload runs behind everything as pure durability.
    const seq = ++pickerSeqRef.current
    setPicker({ file, ref: null, fileName: file.name, save: 'saving', progress: 0, error: null })
    void (async () => {
      try {
        const meta = await probeVideo(file)
        const { ref, completion } = await beginSaveVideo(file, (progress) =>
          setPicker((p) => (p && pickerSeqRef.current === seq ? { ...p, progress } : p)),
        )
        useVideoStore.getState().addClip({ ref, fileName: file.name, ...meta })
        const task = { ref, settled: false, cleanupWhenSettled: false }
        uploadTaskRef.current = task
        if (pickerSeqRef.current === seq) {
          setPicker((p) => (p ? { ...p, ref } : p)) // ARM UNLOCKED - still saving
        } else {
          task.cleanupWhenSettled = true // modal already closed
        }
        try {
          await completion
          if (pickerSeqRef.current === seq) setPicker((p) => (p ? { ...p, save: 'saved', progress: 1 } : p))
        } catch (err) {
          const message =
            (err as { message?: string } | null)?.message ?? (err instanceof Error ? err.message : 'Upload failed')
          console.error('Video upload failed:', message, err)
          if (pickerSeqRef.current === seq) {
            setPicker((p) => (p ? { ...p, save: 'failed', error: message } : p))
          } else if (sourceStillUsed(ref)) {
            // Clips exist against bytes that never landed and the modal is
            // gone - surface it in the bank so it isn't silent data loss.
            setError(`Upload of ${file.name} failed - its clips won't survive a reload. Reopen it via "+ from" to retry.`)
          }
        } finally {
          task.settled = true
          if (task.cleanupWhenSettled) cleanOrphan(ref)
          if (uploadTaskRef.current === task) uploadTaskRef.current = null
        }
      } catch (err) {
        // Probe/mint failure: nothing persisted, nothing armed.
        const message =
          (err as { message?: string } | null)?.message ?? (err instanceof Error ? err.message : 'Could not save video')
        console.error('Video save failed to start:', message, err)
        if (pickerSeqRef.current === seq) setPicker((p) => (p ? { ...p, save: 'failed', error: message } : p))
      }
    })()
  }

  const retryUpload = () => {
    const p = picker
    if (!p?.ref || p.save !== 'failed') return
    const seq = pickerSeqRef.current
    const ref = p.ref
    setPicker((cur) => (cur ? { ...cur, save: 'saving', progress: 0, error: null } : cur))
    void retryVideoUpload(ref, (progress) =>
      setPicker((cur) => (cur && pickerSeqRef.current === seq ? { ...cur, progress } : cur)),
    ).then(
      () => {
        if (pickerSeqRef.current === seq) setPicker((cur) => (cur ? { ...cur, save: 'saved', progress: 1 } : cur))
      },
      (err) => {
        const message = err instanceof Error ? err.message : 'Upload failed'
        if (pickerSeqRef.current === seq) setPicker((cur) => (cur ? { ...cur, save: 'failed', error: message } : cur))
      },
    )
  }

  const openExisting = (ref: string) => {
    if (pads.length >= MAX_PADS) return setError(`Up to ${MAX_PADS} clips per track`)
    setError(null)
    pickerSeqRef.current++
    setPicker({
      file: null,
      ref,
      fileName: videoClips[ref]?.fileName ?? 'clip',
      save: 'saved',
      progress: 1,
      error: null,
    })
  }

  const armPad = (inPoint: number) => {
    const ref = picker?.ref
    if (!ref) return
    const current = useProjectStore.getState().tracks[track.id]?.videoPads ?? []
    if (current.length >= MAX_PADS) return
    const pad: VideoPad = { ref, inPoint: Math.round(inPoint * 1000) / 1000 }
    setTrackVideoPads(track.id, [...current, pad])
  }

  /** Remove from inside the modal: NO orphan-clean - the picker still holds
   *  the source (deleting the last clip then arming again must keep working).
   *  closePicker's cleanup settles the source's fate when the modal ends. */
  const removeFromModal = (bankIndex: number) => {
    const current = useProjectStore.getState().tracks[track.id]?.videoPads ?? []
    setTrackVideoPads(track.id, current.filter((_, k) => k !== bankIndex))
  }

  const closePicker = () => {
    const p = picker
    pickerSeqRef.current++ // detach the modal from any in-flight upload
    setPicker(null)
    if (!p?.ref) return
    const task = uploadTaskRef.current
    if (task && task.ref === p.ref && !task.settled) {
      // Upload still in flight: deleting the path now would race the POST.
      // Completion handles cleanup (and only if nothing armed against it).
      task.cleanupWhenSettled = true
      return
    }
    cleanOrphan(p.ref)
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
    cleanOrphan(removed.ref)
  }

  // Distinct sources already on this track - "add another moment" candidates.
  const trackSources = [...new Set(pads.map((p) => p.ref))]

  return (
    <div className="mb-5">
      <p className="mb-3 text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">CLIPS</p>
      {pads.length === 0 && (
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

      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={pads.length >= MAX_PADS || picker !== null}
        className="mt-1 flex h-7 w-full items-center justify-center gap-1.5 rounded border border-dashed border-[var(--border)] text-[11px] text-[var(--text-3)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:opacity-50 cursor-pointer disabled:cursor-default"
      >
        <Plus size={11} />
        {pads.length >= MAX_PADS ? `${MAX_PADS}-clip limit` : 'Upload video'}
      </button>
      {trackSources.length > 0 && pads.length < MAX_PADS && picker === null && (
        <div className="mt-1 flex flex-wrap gap-1">
          {trackSources.map((ref) => (
            <button
              key={ref}
              onClick={() => openExisting(ref)}
              className="h-6 cursor-pointer rounded border border-[var(--border)] px-2 font-mono text-[10px] text-[var(--text-3)] hover:text-[var(--text)]"
              title={`Add another moment from ${videoClips[ref]?.fileName ?? ref}`}
            >
              + from {(videoClips[ref]?.fileName ?? 'clip').slice(0, 14)}
            </button>
          ))}
        </div>
      )}
      {error && <p className="mt-1.5 text-[11px] text-[var(--warn)]">{error}</p>}
      <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={onFile} />

      {picker && (
        <MomentPickerModal
          picker={picker}
          armedClips={pads
            .map((pad, bankIndex) => ({ pad, bankIndex }))
            .filter(({ pad }) => picker.ref !== null && pad.ref === picker.ref)
            .map(({ pad, bankIndex }) => ({ bankIndex, inPoint: pad.inPoint }))}
          onArm={armPad}
          onRemove={removeFromModal}
          onRetry={retryUpload}
          onClose={closePicker}
          atPadLimit={pads.length >= MAX_PADS}
        />
      )}
    </div>
  )
}
