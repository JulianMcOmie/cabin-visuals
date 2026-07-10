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

/** One background persistence job (ref minted, bytes still uploading or
 *  failed). Absent from the map = durable (or session-only). */
interface BgUpload {
  progress: number
  status: 'saving' | 'failed'
  error: string | null
}

export function VideoClipBank({ track }: { track: Track }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Modal identity only - save/progress/error derive from bgUploads, so
  // button-, drop- and retry-initiated uploads all report through one place.
  const [pickerCore, setPickerCore] = useState<{ file: File | null; ref: string | null; fileName: string } | null>(null)
  const [bgUploads, setBgUploads] = useState<Record<string, BgUpload>>({})
  const [error, setError] = useState<string | null>(null)
  // Drag affordance: any file drag in the window shows the drop cue on the
  // bank; hovering the bank itself brightens it. Hover uses a depth counter -
  // dragenter/leave fire at every CHILD boundary, and toggling on the raw
  // events flickers as the drag crosses rows.
  const [fileDragActive, setFileDragActive] = useState(false)
  const [dropHover, setDropHover] = useState(false)
  const hoverDepthRef = useRef(0)
  // Session guard: async pipelines check it before touching modal state.
  const pickerSeqRef = useRef(0)
  // Uploads whose bytes are still POSTing (sync mirror of 'saving' entries).
  const inFlightRef = useRef<Set<string>>(new Set())
  // Refs whose orphan-cleanup must wait for their upload to settle (deleting a
  // path that's still POSTing would race).
  const cleanupOnSettleRef = useRef<Set<string>>(new Set())
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

  const patchUpload = (ref: string, patch: Partial<BgUpload> | null) =>
    setBgUploads((m) => {
      if (patch === null) {
        const { [ref]: _gone, ...rest } = m
        return rest
      }
      const prev = m[ref] ?? { progress: 0, status: 'saving' as const, error: null }
      return { ...m, [ref]: { ...prev, ...patch } }
    })

  const capError = (file: File): string | null => {
    if (file.size <= maxMb * 1024 * 1024) return null
    const mb = Math.round(file.size / (1024 * 1024))
    return isPro
      ? `${file.name} is ${mb} MB - sources are capped at ${PRO_MAX_MB} MB. Compress it first.`
      : `${file.name} is ${mb} MB - free sources are capped at ${FREE_MAX_MB} MB. Upgrade to Pro for ${PRO_MAX_MB} MB, or compress it first.`
  }

  /**
   * Validate + begin persisting one file. Resolves with the minted ref (usable
   * IMMEDIATELY - local bytes back it) or null if it couldn't start. The
   * upload itself reports through bgUploads and settles in the background.
   */
  const startUpload = async (file: File): Promise<string | null> => {
    const cap = capError(file)
    if (cap) {
      setError(cap)
      return null
    }
    try {
      const meta = await probeVideo(file)
      let refBox: string | null = null
      const { ref, completion } = await beginSaveVideo(file, (progress) => {
        if (refBox) patchUpload(refBox, { progress })
      })
      refBox = ref
      useVideoStore.getState().addClip({ ref, fileName: file.name, ...meta })
      patchUpload(ref, { progress: 0, status: 'saving', error: null })
      inFlightRef.current.add(ref)
      void completion
        .then(
          () => patchUpload(ref, null), // durable
          (err) => {
            const message =
              (err as { message?: string } | null)?.message ?? (err instanceof Error ? err.message : 'Upload failed')
            console.error('Video upload failed:', message, err)
            patchUpload(ref, { status: 'failed', error: message })
            if (sourceStillUsed(ref)) {
              setError(`Upload of ${file.name} failed - its clips won't survive a reload. Click one of its clips to retry.`)
            }
          },
        )
        .then(() => {
          inFlightRef.current.delete(ref)
          if (cleanupOnSettleRef.current.delete(ref)) cleanOrphan(ref)
        })
      return ref
    } catch (err) {
      const message =
        (err as { message?: string } | null)?.message ?? (err instanceof Error ? err.message : 'Could not read this video')
      console.error('Video save failed to start:', message, err)
      setError(message)
      return null
    }
  }

  /** Single file (button or one-file drop): the picker opens NOW on the local
   *  bytes; the ref lands a beat later (arm unlocks). No clip is auto-added -
   *  picking the moment is the point. */
  const addSingle = (file: File) => {
    setError(null)
    if (pads.length >= MAX_PADS) return setError(`Up to ${MAX_PADS} clips per track`)
    const seq = ++pickerSeqRef.current
    setPickerCore({ file, ref: null, fileName: file.name })
    void startUpload(file).then((ref) => {
      if (!ref) {
        // Couldn't start (cap/probe) - the error shows in the bank.
        if (pickerSeqRef.current === seq) setPickerCore(null)
        return
      }
      if (pickerSeqRef.current === seq) {
        setPickerCore((p) => (p ? { ...p, ref } : p)) // ARM UNLOCKED
      } else if (inFlightRef.current.has(ref)) {
        cleanupOnSettleRef.current.add(ref) // modal closed before the ref landed
      } else {
        cleanOrphan(ref)
      }
    })
  }

  /** Multi-file drop: no modal - each file uploads in the background and lands
   *  as one clip starting at 0s. */
  const addMany = (files: File[]) => {
    setError(null)
    void (async () => {
      for (const file of files) {
        const current = useProjectStore.getState().tracks[track.id]?.videoPads ?? []
        if (current.length >= MAX_PADS) {
          setError(`Up to ${MAX_PADS} clips per track - some files were skipped`)
          break
        }
        const ref = await startUpload(file) // resolves at mint, not upload end
        if (!ref) continue // cap/probe failure - error already surfaced
        const fresh = useProjectStore.getState().tracks[track.id]?.videoPads ?? []
        setTrackVideoPads(track.id, [...fresh, { ref, inPoint: 0 }])
      }
    })()
  }

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // re-selecting the same file must still fire onChange
    if (file) addSingle(file)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    hoverDepthRef.current = 0
    setDropHover(false)
    if (pickerCore) return // modal open - drops belong to another flow
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('video/'))
    if (files.length === 0) return
    if (files.length === 1) addSingle(files[0])
    else addMany(files)
  }

  // Window-level file-drag detection (dragenter/leave are per-element and
  // noisy, so a depth counter decides "a file drag is happening at all").
  useEffect(() => {
    let depth = 0
    const isFileDrag = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
    const onEnter = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      depth++
      setFileDragActive(true)
    }
    const onLeave = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setFileDragActive(false)
    }
    const onSettle = () => {
      depth = 0
      hoverDepthRef.current = 0
      setFileDragActive(false)
      setDropHover(false)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onSettle)
    window.addEventListener('dragend', onSettle)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onSettle)
      window.removeEventListener('dragend', onSettle)
    }
  }, [])

  const retryUpload = () => {
    const ref = pickerCore?.ref
    if (!ref) return
    patchUpload(ref, { status: 'saving', progress: 0, error: null })
    inFlightRef.current.add(ref)
    void retryVideoUpload(ref, (progress) => patchUpload(ref, { progress }))
      .then(
        () => patchUpload(ref, null),
        (err) => patchUpload(ref, { status: 'failed', error: err instanceof Error ? err.message : 'Upload failed' }),
      )
      .then(() => {
        inFlightRef.current.delete(ref)
        if (cleanupOnSettleRef.current.delete(ref)) cleanOrphan(ref)
      })
  }

  /** Clip rows open the picker on their source (managing/adding moments is
   *  allowed even at the pad limit - only arming is gated). */
  const openExisting = (ref: string) => {
    setError(null)
    pickerSeqRef.current++
    setPickerCore({ file: null, ref, fileName: videoClips[ref]?.fileName ?? 'clip' })
  }

  const armPad = (inPoint: number) => {
    const ref = pickerCore?.ref
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
    const core = pickerCore
    pickerSeqRef.current++ // detach the modal from any in-flight pipeline
    setPickerCore(null)
    if (!core?.ref) return
    if (inFlightRef.current.has(core.ref)) {
      // Upload still POSTing: deleting the path now would race. Completion
      // handles cleanup (and only if nothing armed against it).
      cleanupOnSettleRef.current.add(core.ref)
      return
    }
    cleanOrphan(core.ref)
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

  // The modal's view of persistence, derived from the shared upload registry.
  const picker: PickerState | null = pickerCore
    ? {
        ...pickerCore,
        ...(() => {
          if (pickerCore.ref === null) return { save: 'saving' as const, progress: 0, error: null }
          const up = bgUploads[pickerCore.ref]
          return up
            ? { save: up.status, progress: up.progress, error: up.error }
            : { save: 'saved' as const, progress: 1, error: null }
        })(),
      }
    : null

  return (
    <div
      className={`relative mb-5 rounded ${dropHover ? 'bg-[var(--accent)]/10' : ''}`}
      onDragEnter={(e) => {
        if (!Array.from(e.dataTransfer.types).includes('Files')) return
        e.preventDefault()
        hoverDepthRef.current++
        setDropHover(true)
      }}
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.types).includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={() => {
        hoverDepthRef.current = Math.max(0, hoverDepthRef.current - 1)
        if (hoverDepthRef.current === 0) setDropHover(false)
      }}
      onDrop={onDrop}
    >
      {fileDragActive && !pickerCore && (
        <div
          className={`pointer-events-none absolute -inset-1.5 z-10 flex items-center justify-center rounded border border-dashed transition-colors ${
            dropHover ? 'border-[var(--accent)] bg-[var(--accent)]/15' : 'border-[var(--border-strong)] bg-[var(--bg-panel)]/70'
          }`}
        >
          <span className={`flex items-center gap-1.5 font-mono text-[11px] ${dropHover ? 'text-[var(--accent)]' : 'text-[var(--text-3)]'}`}>
            <Plus size={13} /> drop videos to add clips
          </span>
        </div>
      )}

      <p className="mb-3 text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">CLIPS</p>
      {pads.length === 0 && (
        <p className="mb-2 text-[11px] text-[var(--text-muted)]">
          Upload or drop videos, pick the moments you want, then draw notes in the MIDI editor to cut between them.
        </p>
      )}
      {pads.map((pad, i) => {
        const source = videoClips[pad.ref]
        const up = bgUploads[pad.ref]
        return (
          // The row itself reopens the picker on this clip's source - that's
          // how you add more moments from a video (no separate button).
          <div
            key={`${pad.ref}-${pad.inPoint}-${i}`}
            onClick={() => openExisting(pad.ref)}
            title={`Open ${source?.fileName ?? 'this video'} to add or edit clips`}
            className="mb-1 flex cursor-pointer items-center gap-2 rounded border border-[var(--border)] bg-[var(--bg-app)] px-2 py-1.5 transition-colors hover:border-[var(--border-strong)]"
          >
            <span className="w-5 flex-shrink-0 font-mono text-[10px] text-[var(--accent)]">{i + 1}</span>
            <Film size={11} className="flex-shrink-0 text-[var(--text-muted)]" />
            <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-2)]" title={source?.fileName ?? pad.ref}>
              {source?.fileName ?? 'missing clip'}
            </span>
            <span className="flex-shrink-0 font-mono text-[10px] text-[var(--text-muted)]">@ {pad.inPoint.toFixed(1)}s</span>
            {up && (up.status === 'saving' ? (
              <span className="flex-shrink-0 font-mono text-[9px] text-[var(--accent)]" title="Uploading in the background">
                ↑{Math.round(up.progress * 100)}%
              </span>
            ) : (
              <span className="flex-shrink-0 font-mono text-[9px] font-bold text-[var(--warn)]" title={`${up.error ?? 'Upload failed'} - click to retry`}>
                !
              </span>
            ))}
            <button onClick={(e) => { e.stopPropagation(); move(i, -1) }} disabled={i === 0} className="flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--text-2)] disabled:opacity-30 cursor-pointer disabled:cursor-default" aria-label="Move clip up"><ArrowUp size={11} /></button>
            <button onClick={(e) => { e.stopPropagation(); move(i, 1) }} disabled={i === pads.length - 1} className="flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--text-2)] disabled:opacity-30 cursor-pointer disabled:cursor-default" aria-label="Move clip down"><ArrowDown size={11} /></button>
            <button onClick={(e) => { e.stopPropagation(); remove(i) }} className="flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--warn)] cursor-pointer" aria-label="Remove clip"><X size={11} /></button>
          </div>
        )
      })}

      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={pads.length >= MAX_PADS || pickerCore !== null}
        className="mt-1 flex h-7 w-full items-center justify-center gap-1.5 rounded border border-dashed border-[var(--border)] text-[11px] text-[var(--text-3)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:opacity-50 cursor-pointer disabled:cursor-default"
      >
        <Plus size={11} />
        {pads.length >= MAX_PADS ? `${MAX_PADS}-clip limit` : 'Upload video'}
      </button>
      {error && <p className="mt-1.5 text-[11px] text-[var(--warn)]">{error}</p>}
      <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={onFileInput} />

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
